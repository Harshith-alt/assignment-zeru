const mongoose = require("mongoose");

const rewardBreakdownSchema = new mongoose.Schema(
  {
    operatorAddress: {
      type: String,
      required: [true, "Operator address is required"],
      lowercase: true,
      validate: {
        validator: function (v) {
          return /^0x[a-fA-F0-9]{40}$/.test(v);
        },
        message: (props) => `${props.value} is not a valid Ethereum address!`,
      },
    },
    amountStETH: {
      type: String,
      required: [true, "Reward amount is required"],
      validate: {
        validator: function (v) {
          return !isNaN(parseFloat(v)) && parseFloat(v) >= 0;
        },
        message: (props) => `${props.value} is not a valid amount!`,
      },
    },
    timestamps: [
      {
        type: Number,
        min: 0,
      },
    ],
    transactionHashes: [
      {
        type: String,
        validate: {
          validator: function (v) {
            return !v || /^0x[a-fA-F0-9]{64}$/.test(v);
          },
          message: (props) => `${props.value} is not a valid transaction hash!`,
        },
      },
    ],
    blockNumbers: [
      {
        type: Number,
        min: 0,
      },
    ],
    rewardType: {
      type: String,
      enum: ["delegation", "validation", "slashing_protection", "other"],
      default: "delegation",
    },
  },
  { _id: false }
);

const rewardSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: [true, "Wallet address is required"],
      unique: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          return /^0x[a-fA-F0-9]{40}$/.test(v);
        },
        message: (props) => `${props.value} is not a valid Ethereum address!`,
      },
      index: true,
    },
    totalRewardsReceivedStETH: {
      type: String,
      required: [true, "Total rewards is required"],
      default: "0",
      validate: {
        validator: function (v) {
          return !isNaN(parseFloat(v)) && parseFloat(v) >= 0;
        },
        message: (props) => `${props.value} is not a valid amount!`,
      },
    },
    rewardsBreakdown: [rewardBreakdownSchema],
    firstRewardTimestamp: {
      type: Date,
      default: null,
    },
    lastRewardTimestamp: {
      type: Date,
      default: null,
    },
    totalRewardEvents: {
      type: Number,
      min: 0,
      default: 0,
    },
    averageRewardAmount: {
      type: String,
      default: "0",
    },
    rewardFrequency: {
      dailyAverage: {
        type: String,
        default: "0",
      },
      weeklyAverage: {
        type: String,
        default: "0",
      },
      monthlyAverage: {
        type: String,
        default: "0",
      },
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "rewards",
  }
);

// Indexes for better query performance
rewardSchema.index({ walletAddress: 1 });
rewardSchema.index({ totalRewardsReceivedStETH: -1 });
rewardSchema.index({ lastRewardTimestamp: -1 });
rewardSchema.index({ lastUpdated: -1 });
rewardSchema.index({ "rewardsBreakdown.operatorAddress": 1 });

// Pre-save middleware to update calculated fields
rewardSchema.pre("save", function (next) {
  this.lastUpdated = new Date();

  // Calculate total reward events
  this.totalRewardEvents = this.rewardsBreakdown.reduce((total, breakdown) => {
    return total + (breakdown.timestamps ? breakdown.timestamps.length : 0);
  }, 0);

  // Calculate average reward amount
  if (this.totalRewardEvents > 0) {
    const avgAmount =
      parseFloat(this.totalRewardsReceivedStETH) / this.totalRewardEvents;
    this.averageRewardAmount = avgAmount.toString();
  }

  // Update first and last reward timestamps
  const allTimestamps = this.rewardsBreakdown.reduce((acc, breakdown) => {
    return acc.concat(breakdown.timestamps || []);
  }, []);

  if (allTimestamps.length > 0) {
    const sortedTimestamps = allTimestamps.sort((a, b) => a - b);
    this.firstRewardTimestamp = new Date(sortedTimestamps[0] * 1000);
    this.lastRewardTimestamp = new Date(
      sortedTimestamps[sortedTimestamps.length - 1] * 1000
    );

    // Calculate reward frequency
    const daysSinceFirst =
      (Date.now() - this.firstRewardTimestamp.getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSinceFirst > 0) {
      const totalRewards = parseFloat(this.totalRewardsReceivedStETH);
      this.rewardFrequency.dailyAverage = (
        totalRewards / daysSinceFirst
      ).toString();
      this.rewardFrequency.weeklyAverage = (
        totalRewards /
        (daysSinceFirst / 7)
      ).toString();
      this.rewardFrequency.monthlyAverage = (
        totalRewards /
        (daysSinceFirst / 30)
      ).toString();
    }
  }

  next();
});

// Static method to find by wallet address
rewardSchema.statics.findByWalletAddress = function (address) {
  return this.findOne({ walletAddress: address.toLowerCase() });
};

// Static method to find top earners
rewardSchema.statics.findTopEarners = function (limit = 10) {
  return this.find({}).sort({ totalRewardsReceivedStETH: -1 }).limit(limit);
};

// Static method to find rewards by operator
rewardSchema.statics.findByOperator = function (operatorAddress) {
  return this.find({
    "rewardsBreakdown.operatorAddress": operatorAddress.toLowerCase(),
  });
};

// Instance method to add reward
rewardSchema.methods.addReward = function (
  operatorAddress,
  amount,
  timestamp,
  transactionHash,
  blockNumber
) {
  const existingBreakdown = this.rewardsBreakdown.find(
    (breakdown) => breakdown.operatorAddress === operatorAddress.toLowerCase()
  );

  if (existingBreakdown) {
    // Update existing breakdown
    const currentAmount = parseFloat(existingBreakdown.amountStETH);
    existingBreakdown.amountStETH = (
      currentAmount + parseFloat(amount)
    ).toString();
    existingBreakdown.timestamps.push(timestamp);
    if (transactionHash)
      existingBreakdown.transactionHashes.push(transactionHash);
    if (blockNumber) existingBreakdown.blockNumbers.push(blockNumber);
  } else {
    // Create new breakdown
    this.rewardsBreakdown.push({
      operatorAddress: operatorAddress.toLowerCase(),
      amountStETH: amount.toString(),
      timestamps: [timestamp],
      transactionHashes: transactionHash ? [transactionHash] : [],
      blockNumbers: blockNumber ? [blockNumber] : [],
    });
  }

  // Update total rewards
  const currentTotal = parseFloat(this.totalRewardsReceivedStETH);
  this.totalRewardsReceivedStETH = (
    currentTotal + parseFloat(amount)
  ).toString();

  return this.save();
};

// Instance method to get rewards from specific operator
rewardSchema.methods.getRewardsFromOperator = function (operatorAddress) {
  return this.rewardsBreakdown.find(
    (breakdown) => breakdown.operatorAddress === operatorAddress.toLowerCase()
  );
};

// Instance method to calculate total rewards in wei
rewardSchema.methods.getTotalRewardsInWei = function () {
  const { Web3 } = require("web3");
  const web3 = new Web3();
  return web3.utils.toWei(this.totalRewardsReceivedStETH, "ether");
};

// Virtual for active operators count
rewardSchema.virtual("activeOperatorsCount").get(function () {
  return this.rewardsBreakdown.length;
});

// Ensure virtual fields are serialized
rewardSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Reward", rewardSchema);
