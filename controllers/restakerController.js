const Restaker = require("../models/Restaker");
const Validator = require("../models/Validator");
const DataFetcher = require("../utils/dataFetcher");

// Get all restakers with filtering and pagination
const getRestakers = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "delegationTimestamp",
      sortOrder = "desc",
      status,
      operator,
      minAmount,
      maxAmount,
      search,
    } = req.query;

    // Build filter object
    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (operator) {
      filter.targetAVSOperatorAddress = operator.toLowerCase();
    }

    if (minAmount || maxAmount) {
      filter.amountRestakedStETH = {};
      if (minAmount) {
        filter.amountRestakedStETH.$gte = minAmount;
      }
      if (maxAmount) {
        filter.amountRestakedStETH.$lte = maxAmount;
      }
    }

    if (search) {
      filter.$or = [
        { userAddress: { $regex: search, $options: "i" } },
        { targetAVSOperatorAddress: { $regex: search, $options: "i" } },
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = {};
    sortObj[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Execute query with population
    const restakers = await Restaker.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const total = await Restaker.countDocuments(filter);

    // Enrich data with validator information
    const enrichedRestakers = await Promise.all(
      restakers.map(async (restaker) => {
        try {
          const validator = await Validator.findOne({
            operatorAddress: restaker.targetAVSOperatorAddress,
          }).lean();

          return {
            ...restaker,
            validator: validator
              ? {
                  operatorName: validator.operatorName,
                  status: validator.status,
                  commission: validator.commission,
                  totalDelegatedStakeStETH: validator.totalDelegatedStakeStETH,
                }
              : null,
          };
        } catch (error) {
          console.error(`Error enriching restaker data: ${error.message}`);
          return restaker;
        }
      })
    );

    // Calculate pagination info
    const totalPages = Math.ceil(total / parseInt(limit));
    const hasNext = parseInt(page) < totalPages;
    const hasPrev = parseInt(page) > 1;

    res.status(200).json({
      success: true,
      data: enrichedRestakers,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        count: restakers.length,
        total: total,
        hasNext: hasNext,
        hasPrev: hasPrev,
      },
      filters: {
        status,
        operator,
        minAmount,
        maxAmount,
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

// Get restaker by address
const getRestakerByAddress = async (req, res, next) => {
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

    const restaker = await Restaker.findOne({
      userAddress: address.toLowerCase(),
    }).lean();

    if (!restaker) {
      return res.status(404).json({
        success: false,
        error: "Restaker not found",
      });
    }

    // Get validator information
    const validator = await Validator.findOne({
      operatorAddress: restaker.targetAVSOperatorAddress,
    }).lean();

    // Enrich restaker data
    const enrichedRestaker = {
      ...restaker,
      validator: validator
        ? {
            operatorName: validator.operatorName,
            status: validator.status,
            commission: validator.commission,
            totalDelegatedStakeStETH: validator.totalDelegatedStakeStETH,
            delegatorCount: validator.delegatorCount,
            slashHistory: validator.slashHistory,
          }
        : null,
    };

    res.status(200).json({
      success: true,
      data: enrichedRestaker,
    });
  } catch (error) {
    next(error);
  }
};

// Get restakers by operator
const getRestakersByOperator = async (req, res, next) => {
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

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const restakers = await Restaker.find({
      targetAVSOperatorAddress: operatorAddress.toLowerCase(),
    })
      .sort({ delegationTimestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Restaker.countDocuments({
      targetAVSOperatorAddress: operatorAddress.toLowerCase(),
    });

    // Get operator information
    const validator = await Validator.findOne({
      operatorAddress: operatorAddress.toLowerCase(),
    }).lean();

    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(200).json({
      success: true,
      data: restakers,
      operator: validator
        ? {
            operatorName: validator.operatorName,
            status: validator.status,
            totalDelegatedStakeStETH: validator.totalDelegatedStakeStETH,
            delegatorCount: validator.delegatorCount,
          }
        : null,
      pagination: {
        current: parseInt(page),
        pages: totalPages,
        count: restakers.length,
        total: total,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get restakers statistics
const getRestakersStats = async (req, res, next) => {
  try {
    // Basic counts
    const totalRestakers = await Restaker.countDocuments({});
    const activeRestakers = await Restaker.countDocuments({ status: "active" });
    const unstakingRestakers = await Restaker.countDocuments({
      status: "unstaking",
    });

    // Total value locked
    const totalStakeResult = await Restaker.aggregate([
      {
        $group: {
          _id: null,
          totalStake: { $sum: { $toDouble: "$amountRestakedStETH" } },
          averageStake: { $avg: { $toDouble: "$amountRestakedStETH" } },
        },
      },
    ]);

    const totalStake =
      totalStakeResult.length > 0 ? totalStakeResult[0].totalStake : 0;
    const averageStake =
      totalStakeResult.length > 0 ? totalStakeResult[0].averageStake : 0;

    // Top operators by delegated stake
    const topOperators = await Restaker.aggregate([
      {
        $group: {
          _id: "$targetAVSOperatorAddress",
          totalDelegated: { $sum: { $toDouble: "$amountRestakedStETH" } },
          delegatorCount: { $sum: 1 },
        },
      },
      { $sort: { totalDelegated: -1 } },
      { $limit: 5 },
    ]);

    // Recent activity
    const recentDelegations = await Restaker.find({})
      .sort({ delegationTimestamp: -1 })
      .limit(5)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalRestakers,
          activeRestakers,
          unstakingRestakers,
          totalValueLocked: totalStake.toFixed(2),
          averageStake: averageStake.toFixed(2),
        },
        topOperators: topOperators.map((op) => ({
          operatorAddress: op._id,
          totalDelegated: op.totalDelegated.toFixed(2),
          delegatorCount: op.delegatorCount,
        })),
        recentActivity: recentDelegations.map((delegation) => ({
          userAddress: delegation.userAddress,
          amount: delegation.amountRestakedStETH,
          operator: delegation.targetAVSOperatorAddress,
          timestamp: delegation.delegationTimestamp,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRestakers,
  getRestakerByAddress,
  getRestakersByOperator,
  getRestakersStats,
};
