const axios = require("axios");
const { gql, request } = require("graphql-request");
const { Web3 } = require("web3");
require("dotenv").config();

class DataFetcher {
  constructor() {
    this.web3 = new Web3(
      process.env.WEB3_PROVIDER_URL ||
        "https://mainnet.infura.io/v3/YOUR_PROJECT_ID"
    );
    this.eigenlayerSubgraphUrl =
      process.env.EIGENLAYER_SUBGRAPH_URL ||
      "https://api.thegraph.com/subgraphs/name/eigenlayer/restaking";
    this.ratedApiUrl = process.env.RATED_API_URL || "https://api.rated.network";
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
    this.retryDelay = parseInt(process.env.RETRY_DELAY_MS) || 5000;
  }

  // Utility method for retries
  async retryOperation(operation, maxRetries = this.maxRetries) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
        if (attempt === maxRetries) {
          throw error;
        }
        await this.delay(this.retryDelay * attempt);
      }
    }
  }

  // Utility delay function
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Fetch restaking data from EigenLayer subgraph
  async fetchRestakingData(first = 100, skip = 0) {
    const query = gql`
      query GetRestakers($first: Int!, $skip: Int!) {
        delegations(
          first: $first
          skip: $skip
          orderBy: createdAt
          orderDirection: desc
        ) {
          id
          delegator {
            id
          }
          operator {
            id
            metadataURI
          }
          shares
          createdAt
          transactionHash
          blockNumber
        }
        stakers(
          first: $first
          skip: $skip
          orderBy: createdAt
          orderDirection: desc
        ) {
          id
          shares
          strategies {
            id
            token {
              id
              name
              symbol
            }
          }
          deposits {
            id
            shares
            strategy {
              id
            }
            transactionHash
            blockNumber
            createdAt
          }
        }
      }
    `;

    return await this.retryOperation(async () => {
      const data = await request(this.eigenlayerSubgraphUrl, query, {
        first,
        skip,
      });
      return this.transformRestakingData(data);
    });
  }

  // Transform raw subgraph data to our format
  transformRestakingData(data) {
    const restakers = [];

    // Process delegations
    if (data.delegations) {
      data.delegations.forEach((delegation) => {
        try {
          const sharesInEther = this.web3.utils.fromWei(
            delegation.shares,
            "ether"
          );
          restakers.push({
            userAddress: delegation.delegator.id,
            amountRestakedStETH: sharesInEther,
            targetAVSOperatorAddress: delegation.operator.id,
            delegationTimestamp: new Date(
              parseInt(delegation.createdAt) * 1000
            ),
            transactionHash: delegation.transactionHash,
            blockNumber: parseInt(delegation.blockNumber),
            status: "active",
          });
        } catch (error) {
          console.error("Error transforming delegation:", error);
        }
      });
    }

    // Process stakers
    if (data.stakers) {
      data.stakers.forEach((staker) => {
        // Find stETH deposits
        const stETHDeposits = staker.deposits.filter(
          (deposit) =>
            deposit.strategy.id.toLowerCase().includes("steth") ||
            deposit.strategy.id ===
              process.env.STETH_STRATEGY_ADDRESS?.toLowerCase()
        );

        stETHDeposits.forEach((deposit) => {
          try {
            const sharesInEther = this.web3.utils.fromWei(
              deposit.shares,
              "ether"
            );
            restakers.push({
              userAddress: staker.id,
              amountRestakedStETH: sharesInEther,
              targetAVSOperatorAddress:
                "0x0000000000000000000000000000000000000000", // Default if no operator
              delegationTimestamp: new Date(parseInt(deposit.createdAt) * 1000),
              transactionHash: deposit.transactionHash,
              blockNumber: parseInt(deposit.blockNumber),
              status: "active",
            });
          } catch (error) {
            console.error("Error transforming staker:", error);
          }
        });
      });
    }

    return restakers;
  }

  // Fetch validator/operator data
  async fetchValidatorData(first = 100, skip = 0) {
    const query = gql`
      query GetOperators($first: Int!, $skip: Int!) {
        operators(
          first: $first
          skip: $skip
          orderBy: createdAt
          orderDirection: desc
        ) {
          id
          metadataURI
          delegatedShares
          operatorShares
          totalShares
          createdAt
          blockNumber
          transactionHash
        }
        slashings(first: 100, orderBy: createdAt, orderDirection: desc) {
          id
          operator {
            id
          }
          amount
          createdAt
          transactionHash
          blockNumber
        }
      }
    `;

    return await this.retryOperation(async () => {
      const data = await request(this.eigenlayerSubgraphUrl, query, {
        first,
        skip,
      });
      return this.transformValidatorData(data);
    });
  }

  // Transform validator data
  transformValidatorData(data) {
    const validators = [];
    const slashingMap = new Map();

    // Process slashings first
    if (data.slashings) {
      data.slashings.forEach((slash) => {
        if (!slashingMap.has(slash.operator.id)) {
          slashingMap.set(slash.operator.id, []);
        }
        slashingMap.get(slash.operator.id).push({
          timestamp: parseInt(slash.createdAt),
          amountStETH: this.web3.utils.fromWei(slash.amount, "ether"),
          reason: "Protocol violation", // Default reason
          transactionHash: slash.transactionHash,
          blockNumber: parseInt(slash.blockNumber),
        });
      });
    }

    // Process operators
    if (data.operators) {
      data.operators.forEach((operator) => {
        try {
          const totalStake = this.web3.utils.fromWei(
            operator.totalShares || "0",
            "ether"
          );
          const slashHistory = slashingMap.get(operator.id) || [];
          const hasBeenSlashed = slashHistory.length > 0;

          validators.push({
            operatorAddress: operator.id,
            totalDelegatedStakeStETH: totalStake,
            slashHistory: slashHistory,
            status: hasBeenSlashed ? "slashed" : "active",
            registrationTimestamp: new Date(
              parseInt(operator.createdAt) * 1000
            ),
            lastActivityTimestamp: new Date(),
            delegatorCount: 0, // Will be calculated from delegations
            commission: 0, // Default commission
            metadata: {
              metadataURI: operator.metadataURI,
            },
          });
        } catch (error) {
          console.error("Error transforming operator:", error);
        }
      });
    }

    return validators;
  }

  // Fetch rewards data from Rated Network API (if available)
  async fetchRewardsFromRated(address) {
    if (!process.env.RATED_API_KEY) {
      console.warn("⚠️  Rated API key not provided, skipping Rated API calls");
      return null;
    }

    const endpoints = [
      `/v1/eigenlayer/rewards/delegator/${address}`,
      `/v1/eigenlayer/rewards/rewards?delegator=${address}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${this.ratedApiUrl}${endpoint}`, {
          headers: {
            Authorization: `Bearer ${process.env.RATED_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        if (response.data) {
          return this.transformRatedRewardsData(response.data, address);
        }
      } catch (error) {
        console.error(
          `Error fetching from Rated API endpoint ${endpoint}:`,
          error.message
        );
      }
    }

    return null;
  }

  // Transform Rated API rewards data
  transformRatedRewardsData(data, walletAddress) {
    const rewardsBreakdown = [];
    let totalRewards = "0";

    // Transform based on Rated API response structure
    if (data.rewards && Array.isArray(data.rewards)) {
      data.rewards.forEach((reward) => {
        const amount = reward.amount || reward.value || "0";
        const operatorAddress =
          reward.operator ||
          reward.validator ||
          "0x0000000000000000000000000000000000000000";
        const timestamp =
          reward.timestamp ||
          reward.block_time ||
          Math.floor(Date.now() / 1000);

        rewardsBreakdown.push({
          operatorAddress: operatorAddress,
          amountStETH: this.web3.utils.fromWei(amount, "ether"),
          timestamps: [timestamp],
          transactionHashes: reward.tx_hash ? [reward.tx_hash] : [],
          blockNumbers: reward.block_number ? [reward.block_number] : [],
        });

        totalRewards = (
          parseFloat(totalRewards) +
          parseFloat(this.web3.utils.fromWei(amount, "ether"))
        ).toString();
      });
    }

    return {
      walletAddress: walletAddress.toLowerCase(),
      totalRewardsReceivedStETH: totalRewards,
      rewardsBreakdown: rewardsBreakdown,
    };
  }

  // Generate mock data for testing (when real APIs are not available)
  generateMockRestakingData(count = 10) {
    const mockData = [];
    const mockOperators = [
      "0x1234567890123456789012345678901234567890",
      "0x2345678901234567890123456789012345678901",
      "0x3456789012345678901234567890123456789012",
      "0x4567890123456789012345678901234567890123",
      "0x5678901234567890123456789012345678901234",
    ];

    for (let i = 0; i < count; i++) {
      mockData.push({
        userAddress: `0x${Math.random().toString(16).substr(2, 40)}`,
        amountRestakedStETH: (Math.random() * 1000 + 10).toFixed(2),
        targetAVSOperatorAddress:
          mockOperators[Math.floor(Math.random() * mockOperators.length)],
        delegationTimestamp: new Date(
          Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000
        ),
        transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`,
        blockNumber: Math.floor(Math.random() * 1000000) + 18000000,
        status: "active",
      });
    }

    return mockData;
  }

  generateMockValidatorData(count = 5) {
    const mockData = [];
    const statuses = ["active", "active", "active", "jailed", "slashed"];
    const operatorNames = [
      "EigenOp1",
      "ValidatorPro",
      "StakeSecure",
      "EthGuard",
      "RestakeMax",
    ];

    for (let i = 0; i < count; i++) {
      const operatorAddress = `0x${Math.random().toString(16).substr(2, 40)}`;
      const status = statuses[i] || "active";
      const slashHistory =
        status === "slashed"
          ? [
              {
                timestamp: Math.floor(Date.now() / 1000) - 86400,
                amountStETH: (Math.random() * 50 + 10).toFixed(2),
                reason: "Protocol violation detected",
                transactionHash: `0x${Math.random()
                  .toString(16)
                  .substr(2, 64)}`,
                blockNumber: Math.floor(Math.random() * 1000000) + 18000000,
              },
            ]
          : [];

      mockData.push({
        operatorAddress: operatorAddress,
        operatorName: operatorNames[i] || `Operator${i}`,
        totalDelegatedStakeStETH: (Math.random() * 10000 + 1000).toFixed(2),
        slashHistory: slashHistory,
        status: status,
        registrationTimestamp: new Date(
          Date.now() - Math.random() * 180 * 24 * 60 * 60 * 1000
        ),
        lastActivityTimestamp: new Date(
          Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000
        ),
        delegatorCount: Math.floor(Math.random() * 100) + 10,
        commission: Math.floor(Math.random() * 10),
        metadata: {
          website: `https://${operatorNames[i] || `operator${i}`}.com`,
          description: `Professional EigenLayer operator providing secure validation services`,
          logo: `https://example.com/logos/${
            operatorNames[i] || `operator${i}`
          }.png`,
        },
      });
    }

    return mockData;
  }

  generateMockRewardsData(walletAddress) {
    const mockOperators = [
      "0x1234567890123456789012345678901234567890",
      "0x2345678901234567890123456789012345678901",
      "0x3456789012345678901234567890123456789012",
    ];

    const rewardsBreakdown = mockOperators.map((operatorAddress) => ({
      operatorAddress: operatorAddress,
      amountStETH: (Math.random() * 50 + 5).toFixed(2),
      timestamps: [
        Math.floor(Date.now() / 1000) - 86400,
        Math.floor(Date.now() / 1000) - 172800,
        Math.floor(Date.now() / 1000) - 259200,
      ],
      transactionHashes: [
        `0x${Math.random().toString(16).substr(2, 64)}`,
        `0x${Math.random().toString(16).substr(2, 64)}`,
        `0x${Math.random().toString(16).substr(2, 64)}`,
      ],
      blockNumbers: [
        Math.floor(Math.random() * 1000000) + 18000000,
        Math.floor(Math.random() * 1000000) + 18000000,
        Math.floor(Math.random() * 1000000) + 18000000,
      ],
    }));

    const totalRewards = rewardsBreakdown
      .reduce((sum, reward) => sum + parseFloat(reward.amountStETH), 0)
      .toFixed(2);

    return {
      walletAddress: walletAddress.toLowerCase(),
      totalRewardsReceivedStETH: totalRewards,
      rewardsBreakdown: rewardsBreakdown,
    };
  }

  // Validate Ethereum address
  isValidAddress(address) {
    return this.web3.utils.isAddress(address);
  }

  // Convert amount to Wei
  toWei(amount, unit = "ether") {
    return this.web3.utils.toWei(amount, unit);
  }

  // Convert amount from Wei
  fromWei(amount, unit = "ether") {
    return this.web3.utils.fromWei(amount, unit);
  }
}

module.exports = DataFetcher;
