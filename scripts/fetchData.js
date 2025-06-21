const connectDB = require("../config/database");
const DataFetcher = require("../utils/dataFetcher");
const Restaker = require("../models/Restaker");
const Validator = require("../models/Validator");
const Reward = require("../models/Reward");
require("dotenv").config();

class DatabasePopulator {
  constructor() {
    this.dataFetcher = new DataFetcher();
    this.useMockData =
      process.env.USE_MOCK_DATA === "true" ||
      !process.env.EIGENLAYER_SUBGRAPH_URL;
  }

  async populateRestakers() {
    console.log("🔄 Fetching restaking data...");

    try {
      let restakingData;

      if (this.useMockData) {
        console.log(
          "⚠️  Using mock data for restakers (real API not configured)"
        );
        restakingData = this.dataFetcher.generateMockRestakingData(20);
      } else {
        restakingData = await this.dataFetcher.fetchRestakingData(100, 0);
      }

      console.log(`📊 Processing ${restakingData.length} restaking records...`);

      for (const restakerData of restakingData) {
        try {
          await Restaker.findOneAndUpdate(
            { userAddress: restakerData.userAddress },
            restakerData,
            { upsert: true, new: true }
          );
        } catch (error) {
          console.error(
            `Error saving restaker ${restakerData.userAddress}:`,
            error.message
          );
        }
      }

      console.log(
        `✅ Successfully processed ${restakingData.length} restakers`
      );
    } catch (error) {
      console.error("❌ Error fetching restaking data:", error.message);
      throw error;
    }
  }

  async populateValidators() {
    console.log("🔄 Fetching validator data...");

    try {
      let validatorData;

      if (this.useMockData) {
        console.log(
          "⚠️  Using mock data for validators (real API not configured)"
        );
        validatorData = this.dataFetcher.generateMockValidatorData(10);
      } else {
        validatorData = await this.dataFetcher.fetchValidatorData(100, 0);
      }

      console.log(`📊 Processing ${validatorData.length} validator records...`);

      for (const validator of validatorData) {
        try {
          // Calculate delegator count from restakers
          const delegatorCount = await Restaker.countDocuments({
            targetAVSOperatorAddress: validator.operatorAddress,
          });

          validator.delegatorCount = delegatorCount;

          await Validator.findOneAndUpdate(
            { operatorAddress: validator.operatorAddress },
            validator,
            { upsert: true, new: true }
          );
        } catch (error) {
          console.error(
            `Error saving validator ${validator.operatorAddress}:`,
            error.message
          );
        }
      }

      console.log(
        `✅ Successfully processed ${validatorData.length} validators`
      );
    } catch (error) {
      console.error("❌ Error fetching validator data:", error.message);
      throw error;
    }
  }

  async populateRewards() {
    console.log("🔄 Fetching rewards data...");

    try {
      // Get all unique wallet addresses from restakers
      const restakers = await Restaker.find({}, "userAddress").lean();
      const walletAddresses = [...new Set(restakers.map((r) => r.userAddress))];

      console.log(
        `📊 Processing rewards for ${walletAddresses.length} wallet addresses...`
      );

      let processedCount = 0;
      for (const walletAddress of walletAddresses) {
        try {
          let rewardData;

          if (this.useMockData) {
            rewardData =
              this.dataFetcher.generateMockRewardsData(walletAddress);
          } else {
            // Try to fetch from Rated API first
            rewardData = await this.dataFetcher.fetchRewardsFromRated(
              walletAddress
            );

            // If Rated API fails, generate mock data
            if (!rewardData) {
              rewardData =
                this.dataFetcher.generateMockRewardsData(walletAddress);
            }
          }

          if (
            rewardData &&
            parseFloat(rewardData.totalRewardsReceivedStETH) > 0
          ) {
            await Reward.findOneAndUpdate(
              { walletAddress: rewardData.walletAddress },
              rewardData,
              { upsert: true, new: true }
            );
            processedCount++;
          }
        } catch (error) {
          console.error(
            `Error processing rewards for ${walletAddress}:`,
            error.message
          );
        }
      }

      console.log(
        `✅ Successfully processed rewards for ${processedCount} addresses`
      );
    } catch (error) {
      console.error("❌ Error fetching rewards data:", error.message);
      throw error;
    }
  }

  async updateStatistics() {
    console.log("🔄 Updating database statistics...");

    try {
      // Update validator delegator counts
      const validators = await Validator.find({});

      for (const validator of validators) {
        const delegatorCount = await Restaker.countDocuments({
          targetAVSOperatorAddress: validator.operatorAddress,
        });

        if (validator.delegatorCount !== delegatorCount) {
          validator.delegatorCount = delegatorCount;
          await validator.save();
        }
      }

      // Log summary statistics
      const totalRestakers = await Restaker.countDocuments({});
      const totalValidators = await Validator.countDocuments({});
      const totalRewards = await Reward.countDocuments({});
      const activeValidators = await Validator.countDocuments({
        status: "active",
      });
      const slashedValidators = await Validator.countDocuments({
        status: "slashed",
      });

      console.log("📈 Database Statistics:");
      console.log(`   - Total Restakers: ${totalRestakers}`);
      console.log(`   - Total Validators: ${totalValidators}`);
      console.log(`   - Active Validators: ${activeValidators}`);
      console.log(`   - Slashed Validators: ${slashedValidators}`);
      console.log(`   - Reward Records: ${totalRewards}`);

      // Calculate total value locked
      const totalStakeResult = await Restaker.aggregate([
        {
          $group: {
            _id: null,
            totalStake: { $sum: { $toDouble: "$amountRestakedStETH" } },
          },
        },
      ]);

      const totalStake =
        totalStakeResult.length > 0 ? totalStakeResult[0].totalStake : 0;
      console.log(`   - Total Value Locked: ${totalStake.toFixed(2)} stETH`);

      console.log("✅ Statistics updated successfully");
    } catch (error) {
      console.error("❌ Error updating statistics:", error.message);
    }
  }

  async runFullUpdate() {
    const startTime = Date.now();
    console.log("🚀 Starting full database update...");
    console.log(`🕐 Started at: ${new Date().toISOString()}`);

    try {
      // Connect to database
      await connectDB();

      // Populate all data types
      await this.populateRestakers();
      await this.populateValidators();
      await this.populateRewards();

      // Update statistics
      await this.updateStatistics();

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      console.log("🎉 Full database update completed successfully!");
      console.log(`⏱️  Total duration: ${duration.toFixed(2)} seconds`);
      console.log(`🕐 Completed at: ${new Date().toISOString()}`);
    } catch (error) {
      console.error("💥 Fatal error during database update:", error);
      process.exit(1);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "all";

  const populator = new DatabasePopulator();

  try {
    switch (command) {
      case "restakers":
        await connectDB();
        await populator.populateRestakers();
        break;
      case "validators":
        await connectDB();
        await populator.populateValidators();
        break;
      case "rewards":
        await connectDB();
        await populator.populateRewards();
        break;
      case "stats":
        await connectDB();
        await populator.updateStatistics();
        break;
      case "all":
      default:
        await populator.runFullUpdate();
        break;
    }

    console.log("✨ Script completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("💥 Script failed:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n⏹️  Graceful shutdown initiated...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n⏹️  Graceful shutdown initiated...");
  process.exit(0);
});

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = DatabasePopulator;
