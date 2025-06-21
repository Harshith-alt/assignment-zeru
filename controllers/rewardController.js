const Reward = require("../models/Reward");
const Restaker = require("../models/Restaker");
const Validator = require("../models/Validator");
const DataFetcher = require("../utils/dataFetcher");

// Get rewards by wallet address
const getRewardsByAddress = async (req, res, next) => {
  try {
    const { address } = req.params;
    const dataFetcher = new DataFetcher();

    // Validate address format
    if (!dataFetcher.isValidAddress(address)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Ethereum address format",
      });
    }

    const reward = await Reward.findOne({
      walletAddress: address.toLowerCase(),
    }).lean();

    if (!reward) {
      return res.status(404).json({
        success: false,
        error: "No reward data found for this address",
      });
    }

    // Enrich rewards breakdown with validator information
    const enrichedBreakdown = await Promise.all(
      reward.rewardsBreakdown.map(async (breakdown) => {
        try {
          const validator = await Validator.findOne({
            operatorAddress: breakdown.operatorAddress,
          })
            .select("operatorName status commission metadata")
            .lean();

          return {
            ...breakdown,
            validator: validator
              ? {
                  operatorName: validator.operatorName,
                  status: validator.status,
                  commission: validator.commission,
                  website: validator.metadata?.website,
                }
              : null,
          };
        } catch (error) {
          console.error(`Error enriching reward breakdown: ${error.message}`);
          return breakdown;
        }
      })
    );

    // Get restaker information for additional context
    const restaker = await Restaker.findOne({
      userAddress: address.toLowerCase(),
    })
      .select("amountRestakedStETH status delegationTimestamp")
      .lean();

    const enrichedReward = {
      ...reward,
      rewardsBreakdown: enrichedBreakdown,
      restaker: restaker
        ? {
            totalStaked: restaker.amountRestakedStETH,
            status: restaker.status,
            delegationDate: restaker.delegationTimestamp,
          }
        : null,
      metrics: {
        averageRewardPerOperator:
          reward.rewardsBreakdown.length > 0
            ? (
                parseFloat(reward.totalRewardsReceivedStETH) /
                reward.rewardsBreakdown.length
              ).toFixed(4)
            : "0",
        rewardYield: restaker
          ? (
              (parseFloat(reward.totalRewardsReceivedStETH) /
                parseFloat(restaker.amountRestakedStETH)) *
              100
            ).toFixed(2)
          : "0",
      },
    };

    res.status(200).json({
      success: true,
      data: enrichedReward,
    });
  } catch (error) {
    next(error);
  }
};

// Get top reward earners
const getTopEarners = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      minRewards = 0,
      period, // '7d', '30d', '90d', 'all'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
    const filter = {
      totalRewardsReceivedStETH: { $gte: minRewards.toString() },
    };

    // Add time-based filtering if period is specified
    if (period && period !== "all") {
      const now = new Date();
      let startDate = new Date();

      switch (period) {
        case "7d":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30d":
          startDate.setDate(now.getDate() - 30);
          break;
        case "90d":
          startDate.setDate(now.getDate() - 90);
          break;
        default:
          startDate = null;
      }

      if (startDate) {
        filter.lastRewardTimestamp = { $gte: startDate };
      }
    }

    const topEarners = await Reward.find(filter)
      .sort({ totalRewardsReceivedStETH: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Reward.countDocuments(filter);

    // Enrich with restaker information
    const enrichedEarners = await Promise.all(
      topEarners.map(async (earner, index) => {
        try {
          const restaker = await Restaker.findOne({
            userAddress: earner.walletAddress,
          })
            .select("amountRestakedStETH targetAVSOperatorAddress status")
            .lean();

          return {
            rank: skip + index + 1,
            walletAddress: earner.walletAddress,
            totalRewardsReceivedStETH: earner.totalRewardsReceivedStETH,
            activeOperatorsCount: earner.activeOperatorsCount,
            totalRewardEvents: earner.totalRewardEvents,
            averageRewardAmount: earner.averageRewardAmount,
            lastRewardTimestamp: earner.lastRewardTimestamp,
            restaker: restaker
              ? {
                  totalStaked: restaker.amountRestakedStETH,
                  primaryOperator: restaker.targetAVSOperatorAddress,
                  status: restaker.status,
                }
              : null,
            rewardYield: restaker
              ? (
                  (parseFloat(earner.totalRewardsReceivedStETH) /
                    parseFloat(restaker.amountRestakedStETH)) *
                  100
                ).toFixed(2)
              : "0",
          };
        } catch (error) {
          console.error(`Error enriching top earner data: ${error.message}`);
          return {
            rank: skip + index + 1,
            ...earner,
          };
        }
      })
    );

    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(200).json({
      success: true,
      data: enrichedEarners,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        count: topEarners.length,
        total: total,
      },
      filters: {
        minRewards,
        period,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get rewards statistics
const getRewardsStats = async (req, res, next) => {
  try {
    // Basic counts and totals
    const totalRewardRecords = await Reward.countDocuments({});
    const activeRewardEarners = await Reward.countDocuments({
      totalRewardsReceivedStETH: { $gt: "0" },
    });

    // Total rewards distributed
    const totalRewardsResult = await Reward.aggregate([
      {
        $group: {
          _id: null,
          totalDistributed: {
            $sum: { $toDouble: "$totalRewardsReceivedStETH" },
          },
          averageReward: { $avg: { $toDouble: "$totalRewardsReceivedStETH" } },
        },
      },
    ]);

    const totalDistributed =
      totalRewardsResult.length > 0
        ? totalRewardsResult[0].totalDistributed
        : 0;
    const averageReward =
      totalRewardsResult.length > 0 ? totalRewardsResult[0].averageReward : 0;

    // Reward distribution by operator
    const operatorRewards = await Reward.aggregate([
      { $unwind: "$rewardsBreakdown" },
      {
        $group: {
          _id: "$rewardsBreakdown.operatorAddress",
          totalRewards: {
            $sum: { $toDouble: "$rewardsBreakdown.amountStETH" },
          },
          uniqueEarners: { $addToSet: "$walletAddress" },
        },
      },
      { $addFields: { uniqueEarnersCount: { $size: "$uniqueEarners" } } },
      { $sort: { totalRewards: -1 } },
      { $limit: 10 },
    ]);

    // Get validator names for top operators
    const enrichedOperatorRewards = await Promise.all(
      operatorRewards.map(async (op) => {
        try {
          const validator = await Validator.findOne({
            operatorAddress: op._id,
          })
            .select("operatorName status")
            .lean();

          return {
            operatorAddress: op._id,
            operatorName: validator?.operatorName || "Unknown",
            status: validator?.status || "unknown",
            totalRewards: op.totalRewards.toFixed(2),
            uniqueEarnersCount: op.uniqueEarnersCount,
          };
        } catch (error) {
          return {
            operatorAddress: op._id,
            operatorName: "Unknown",
            totalRewards: op.totalRewards.toFixed(2),
            uniqueEarnersCount: op.uniqueEarnersCount,
          };
        }
      })
    );

    // Recent reward activity
    const recentRewards = await Reward.find({
      lastRewardTimestamp: { $exists: true },
    })
      .sort({ lastRewardTimestamp: -1 })
      .limit(10)
      .select("walletAddress totalRewardsReceivedStETH lastRewardTimestamp")
      .lean();

    // Reward frequency analysis
    const rewardFrequency = await Reward.aggregate([
      {
        $group: {
          _id: null,
          totalEvents: { $sum: "$totalRewardEvents" },
          averageEventsPerUser: { $avg: "$totalRewardEvents" },
          averageDailyReward: {
            $avg: { $toDouble: "$rewardFrequency.dailyAverage" },
          },
        },
      },
    ]);

    const frequencyData =
      rewardFrequency.length > 0
        ? rewardFrequency[0]
        : {
            totalEvents: 0,
            averageEventsPerUser: 0,
            averageDailyReward: 0,
          };

    // Yield distribution
    const yieldDistribution = await Reward.aggregate([
      {
        $lookup: {
          from: "restakers",
          localField: "walletAddress",
          foreignField: "userAddress",
          as: "restaker",
        },
      },
      { $unwind: { path: "$restaker", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          yieldPercentage: {
            $cond: {
              if: { $gt: [{ $toDouble: "$restaker.amountRestakedStETH" }, 0] },
              then: {
                $multiply: [
                  {
                    $divide: [
                      { $toDouble: "$totalRewardsReceivedStETH" },
                      { $toDouble: "$restaker.amountRestakedStETH" },
                    ],
                  },
                  100,
                ],
              },
              else: 0,
            },
          },
        },
      },
      {
        $bucket: {
          groupBy: "$yieldPercentage",
          boundaries: [0, 1, 5, 10, 20, 50, 100],
          default: "Other",
          output: {
            count: { $sum: 1 },
            averageYield: { $avg: "$yieldPercentage" },
          },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalRewardRecords,
          activeRewardEarners,
          totalRewardsDistributed: totalDistributed.toFixed(2),
          averageRewardPerUser: averageReward.toFixed(2),
        },
        activity: {
          totalRewardEvents: frequencyData.totalEvents,
          averageEventsPerUser: frequencyData.averageEventsPerUser.toFixed(2),
          averageDailyReward: frequencyData.averageDailyReward.toFixed(4),
        },
        topOperatorsByRewards: enrichedOperatorRewards,
        recentActivity: recentRewards.map((reward) => ({
          walletAddress: reward.walletAddress,
          totalRewards: reward.totalRewardsReceivedStETH,
          lastRewardDate: reward.lastRewardTimestamp,
        })),
        yieldDistribution: yieldDistribution,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get rewards by operator
const getRewardsByOperator = async (req, res, next) => {
  try {
    const { operatorAddress } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const dataFetcher = new DataFetcher();

    // Validate address format
    if (!dataFetcher.isValidAddress(operatorAddress)) {
      return res.status(400).json({
        success: false,
        error: "Invalid operator address format",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Find rewards that include this operator
    const rewards = await Reward.find({
      "rewardsBreakdown.operatorAddress": operatorAddress.toLowerCase(),
    })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Reward.countDocuments({
      "rewardsBreakdown.operatorAddress": operatorAddress.toLowerCase(),
    });

    // Get operator information
    const validator = await Validator.findOne({
      operatorAddress: operatorAddress.toLowerCase(),
    })
      .select("operatorName status totalDelegatedStakeStETH delegatorCount")
      .lean();

    // Calculate operator-specific metrics
    const operatorStats = await Reward.aggregate([
      { $unwind: "$rewardsBreakdown" },
      {
        $match: {
          "rewardsBreakdown.operatorAddress": operatorAddress.toLowerCase(),
        },
      },
      {
        $group: {
          _id: null,
          totalRewardsDistributed: {
            $sum: { $toDouble: "$rewardsBreakdown.amountStETH" },
          },
          uniqueBeneficiaries: { $addToSet: "$walletAddress" },
          averageRewardPerUser: {
            $avg: { $toDouble: "$rewardsBreakdown.amountStETH" },
          },
        },
      },
    ]);

    const stats =
      operatorStats.length > 0
        ? operatorStats[0]
        : {
            totalRewardsDistributed: 0,
            uniqueBeneficiaries: [],
            averageRewardPerUser: 0,
          };

    // Extract operator-specific rewards from each record
    const operatorRewards = rewards.map((reward) => {
      const operatorBreakdown = reward.rewardsBreakdown.find(
        (breakdown) =>
          breakdown.operatorAddress === operatorAddress.toLowerCase()
      );

      return {
        walletAddress: reward.walletAddress,
        totalUserRewards: reward.totalRewardsReceivedStETH,
        operatorRewards: operatorBreakdown
          ? operatorBreakdown.amountStETH
          : "0",
        rewardEvents: operatorBreakdown
          ? operatorBreakdown.timestamps.length
          : 0,
        lastRewardTimestamp:
          operatorBreakdown && operatorBreakdown.timestamps.length > 0
            ? new Date(Math.max(...operatorBreakdown.timestamps) * 1000)
            : null,
      };
    });

    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(200).json({
      success: true,
      data: operatorRewards,
      operator: validator
        ? {
            operatorAddress: operatorAddress.toLowerCase(),
            operatorName: validator.operatorName,
            status: validator.status,
            totalDelegatedStake: validator.totalDelegatedStakeStETH,
            delegatorCount: validator.delegatorCount,
          }
        : null,
      statistics: {
        totalRewardsDistributed: stats.totalRewardsDistributed.toFixed(2),
        uniqueBeneficiaries: stats.uniqueBeneficiaries.length,
        averageRewardPerUser: stats.averageRewardPerUser.toFixed(4),
      },
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        count: rewards.length,
        total: total,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRewardsByAddress,
  getTopEarners,
  getRewardsStats,
  getRewardsByOperator,
};
