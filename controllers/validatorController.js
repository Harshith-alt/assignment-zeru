const Validator = require("../models/Validator");
const Restaker = require("../models/Restaker");
const DataFetcher = require("../utils/dataFetcher");

// Get all validators with filtering and pagination
const getValidators = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "totalDelegatedStakeStETH",
      sortOrder = "desc",
      status,
      minStake,
      maxStake,
      hasSlashHistory,
      search,
    } = req.query;

    // Build filter object
    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (minStake || maxStake) {
      filter.totalDelegatedStakeStETH = {};
      if (minStake) {
        filter.totalDelegatedStakeStETH.$gte = minStake;
      }
      if (maxStake) {
        filter.totalDelegatedStakeStETH.$lte = maxStake;
      }
    }

    if (hasSlashHistory === "true") {
      filter["slashHistory.0"] = { $exists: true };
    } else if (hasSlashHistory === "false") {
      filter.slashHistory = { $size: 0 };
    }

    if (search) {
      filter.$or = [
        { operatorAddress: { $regex: search, $options: "i" } },
        { operatorName: { $regex: search, $options: "i" } },
        { "metadata.description": { $regex: search, $options: "i" } },
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = {};
    sortObj[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Execute query
    const validators = await Validator.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const total = await Validator.countDocuments(filter);

    // Calculate pagination info
    const totalPages = Math.ceil(total / parseInt(limit));
    const hasNext = parseInt(page) < totalPages;
    const hasPrev = parseInt(page) > 1;

    res.status(200).json({
      success: true,
      data: validators,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        count: validators.length,
        total: total,
        hasNext: hasNext,
        hasPrev: hasPrev,
      },
      filters: {
        status,
        minStake,
        maxStake,
        hasSlashHistory,
        search,
      },
      sorting: {
        sortBy,
        sortOrder,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get validator by operator address
const getValidatorByAddress = async (req, res, next) => {
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

    const validator = await Validator.findOne({
      operatorAddress: address.toLowerCase(),
    }).lean();

    if (!validator) {
      return res.status(404).json({
        success: false,
        error: "Validator not found",
      });
    }

    // Get delegators for this validator
    const delegators = await Restaker.find({
      targetAVSOperatorAddress: address.toLowerCase(),
    })
      .sort({ delegationTimestamp: -1 })
      .limit(10)
      .lean();

    // Calculate additional metrics
    const totalSlashedAmount = validator.slashHistory.reduce(
      (sum, slash) => sum + parseFloat(slash.amountStETH || 0),
      0
    );

    const enrichedValidator = {
      ...validator,
      totalSlashedAmount: totalSlashedAmount.toFixed(2),
      recentDelegators: delegators.map((delegator) => ({
        userAddress: delegator.userAddress,
        amountRestakedStETH: delegator.amountRestakedStETH,
        delegationTimestamp: delegator.delegationTimestamp,
      })),
    };

    res.status(200).json({
      success: true,
      data: enrichedValidator,
    });
  } catch (error) {
    next(error);
  }
};

// Get validators statistics
const getValidatorsStats = async (req, res, next) => {
  try {
    // Basic counts
    const totalValidators = await Validator.countDocuments({});
    const activeValidators = await Validator.countDocuments({
      status: "active",
    });
    const jailedValidators = await Validator.countDocuments({
      status: "jailed",
    });
    const slashedValidators = await Validator.countDocuments({
      status: "slashed",
    });
    const inactiveValidators = await Validator.countDocuments({
      status: "inactive",
    });

    // Total delegated stake
    const totalStakeResult = await Validator.aggregate([
      {
        $group: {
          _id: null,
          totalStake: { $sum: { $toDouble: "$totalDelegatedStakeStETH" } },
          averageStake: { $avg: { $toDouble: "$totalDelegatedStakeStETH" } },
        },
      },
    ]);

    const totalStake =
      totalStakeResult.length > 0 ? totalStakeResult[0].totalStake : 0;
    const averageStake =
      totalStakeResult.length > 0 ? totalStakeResult[0].averageStake : 0;

    // Top validators by stake
    const topValidatorsByStake = await Validator.find({})
      .sort({ totalDelegatedStakeStETH: -1 })
      .limit(5)
      .select(
        "operatorAddress operatorName totalDelegatedStakeStETH delegatorCount status"
      )
      .lean();

    // Validators with most delegators
    const topValidatorsByDelegators = await Validator.find({})
      .sort({ delegatorCount: -1 })
      .limit(5)
      .select(
        "operatorAddress operatorName delegatorCount totalDelegatedStakeStETH status"
      )
      .lean();

    // Slash statistics
    const slashStats = await Validator.aggregate([
      { $unwind: { path: "$slashHistory", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          totalSlashEvents: {
            $sum: { $cond: [{ $ifNull: ["$slashHistory", false] }, 1, 0] },
          },
          totalSlashedAmount: {
            $sum: {
              $toDouble: { $ifNull: ["$slashHistory.amountStETH", "0"] },
            },
          },
        },
      },
    ]);

    const slashData =
      slashStats.length > 0
        ? slashStats[0]
        : { totalSlashEvents: 0, totalSlashedAmount: 0 };

    // Commission distribution
    const commissionStats = await Validator.aggregate([
      {
        $group: {
          _id: "$commission",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalValidators,
          activeValidators,
          jailedValidators,
          slashedValidators,
          inactiveValidators,
          totalDelegatedStake: totalStake.toFixed(2),
          averageDelegatedStake: averageStake.toFixed(2),
        },
        slashing: {
          totalSlashEvents: slashData.totalSlashEvents,
          totalSlashedAmount: slashData.totalSlashedAmount.toFixed(2),
          validatorsSlashed: slashedValidators,
        },
        topValidators: {
          byStake: topValidatorsByStake,
          byDelegators: topValidatorsByDelegators,
        },
        commissionDistribution: commissionStats,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get slash history across all validators
const getSlashHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get all validators with slash history
    const validatorsWithSlashes = await Validator.find({
      "slashHistory.0": { $exists: true },
    })
      .select("operatorAddress operatorName slashHistory status")
      .lean();

    // Flatten slash events with validator info
    const allSlashEvents = [];
    validatorsWithSlashes.forEach((validator) => {
      validator.slashHistory.forEach((slash) => {
        allSlashEvents.push({
          ...slash,
          validatorAddress: validator.operatorAddress,
          validatorName: validator.operatorName,
          validatorStatus: validator.status,
        });
      });
    });

    // Sort by timestamp (most recent first)
    allSlashEvents.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    const paginatedEvents = allSlashEvents.slice(skip, skip + parseInt(limit));
    const total = allSlashEvents.length;
    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(200).json({
      success: true,
      data: paginatedEvents,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        count: paginatedEvents.length,
        total: total,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get validator performance metrics
const getValidatorPerformance = async (req, res, next) => {
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

    const validator = await Validator.findOne({
      operatorAddress: address.toLowerCase(),
    }).lean();

    if (!validator) {
      return res.status(404).json({
        success: false,
        error: "Validator not found",
      });
    }

    // Calculate performance metrics
    const daysSinceRegistration =
      (Date.now() - validator.registrationTimestamp.getTime()) /
      (1000 * 60 * 60 * 24);
    const totalSlashedAmount = validator.slashHistory.reduce(
      (sum, slash) => sum + parseFloat(slash.amountStETH || 0),
      0
    );

    const slashRate =
      (totalSlashedAmount / parseFloat(validator.totalDelegatedStakeStETH)) *
      100;
    const uptime = validator.status === "active" ? 99.9 : 95.0; // Mock uptime calculation

    // Get delegation growth over time (simplified)
    const delegationHistory = await Restaker.find({
      targetAVSOperatorAddress: address.toLowerCase(),
    })
      .sort({ delegationTimestamp: 1 })
      .select("amountRestakedStETH delegationTimestamp")
      .lean();

    let cumulativeStake = 0;
    const stakeGrowth = delegationHistory.map((delegation) => {
      cumulativeStake += parseFloat(delegation.amountRestakedStETH);
      return {
        timestamp: delegation.delegationTimestamp,
        cumulativeStake: cumulativeStake.toFixed(2),
      };
    });

    const performanceMetrics = {
      validator: {
        operatorAddress: validator.operatorAddress,
        operatorName: validator.operatorName,
        status: validator.status,
      },
      metrics: {
        daysSinceRegistration: Math.floor(daysSinceRegistration),
        totalDelegatedStake: validator.totalDelegatedStakeStETH,
        delegatorCount: validator.delegatorCount,
        commission: validator.commission,
        slashCount: validator.slashHistory.length,
        totalSlashedAmount: totalSlashedAmount.toFixed(2),
        slashRate: slashRate.toFixed(4),
        estimatedUptime: uptime,
      },
      stakeGrowth: stakeGrowth.slice(-30), // Last 30 delegation events
      recentSlashes: validator.slashHistory.slice(-5), // Last 5 slash events
    };

    res.status(200).json({
      success: true,
      data: performanceMetrics,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getValidators,
  getValidatorByAddress,
  getValidatorsStats,
  getSlashHistory,
  getValidatorPerformance,
};
