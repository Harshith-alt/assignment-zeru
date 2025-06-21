const mongoose = require("mongoose");

const slashEventSchema = new mongoose.Schema(
  {
    timestamp: {
      type: Number,
      required: [true, "Timestamp is required"],
      min: 0,
    },
    amountStETH: {
      type: String,
      required: [true, "Slashed amount is required"],
      validate: {
        validator: function (v) {
          return !isNaN(parseFloat(v)) && parseFloat(v) >= 0;
        },
        message: (props) => `${props.value} is not a valid amount!`,
      },
    },
    reason: {
      type: String,
      trim: true,
      maxlength: [500, "Reason cannot be more than 500 characters"],
    },
    transactionHash: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || /^0x[a-fA-F0-9]{64}$/.test(v);
        },
        message: (props) => `${props.value} is not a valid transaction hash!`,
      },
    },
    blockNumber: {
      type: Number,
      min: 0,
    },
  },
  { _id: false }
);

const validatorSchema = new mongoose.Schema(
  {
    operatorAddress: {
      type: String,
      required: [true, "Operator address is required"],
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
    operatorName: {
      type: String,
      trim: true,
      maxlength: [100, "Operator name cannot be more than 100 characters"],
    },
    totalDelegatedStakeStETH: {
      type: String,
      required: [true, "Total delegated stake is required"],
      default: "0",
      validate: {
        validator: function (v) {
          return !isNaN(parseFloat(v)) && parseFloat(v) >= 0;
        },
        message: (props) => `${props.value} is not a valid amount!`,
      },
    },
    slashHistory: [slashEventSchema],
    status: {
      type: String,
      enum: ["active", "jailed", "slashed", "inactive", "deregistered"],
      default: "active",
      index: true,
    },
    registrationTimestamp: {
      type: Date,
      default: Date.now,
    },
    lastActivityTimestamp: {
      type: Date,
      default: Date.now,
    },
    avsServices: [
      {
        type: String,
        trim: true,
      },
    ],
    commission: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    delegatorCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    metadata: {
      website: {
        type: String,
        trim: true,
        maxlength: [200, "Website URL cannot be more than 200 characters"],
      },
      description: {
        type: String,
        trim: true,
        maxlength: [1000, "Description cannot be more than 1000 characters"],
      },
      logo: {
        type: String,
        trim: true,
        maxlength: [500, "Logo URL cannot be more than 500 characters"],
      },
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "validators",
  }
);

// Indexes for better query performance
validatorSchema.index({ operatorAddress: 1 });
validatorSchema.index({ status: 1 });
validatorSchema.index({ totalDelegatedStakeStETH: -1 });
validatorSchema.index({ lastUpdated: -1 });
validatorSchema.index({ delegatorCount: -1 });

// Pre-save middleware to update lastUpdated
validatorSchema.pre("save", function (next) {
  this.lastUpdated = new Date();
  next();
});

// Static method to find by operator address
validatorSchema.statics.findByOperatorAddress = function (address) {
  return this.findOne({ operatorAddress: address.toLowerCase() });
};

// Static method to find active validators
validatorSchema.statics.findActiveValidators = function () {
  return this.find({ status: "active" });
};

// Static method to find validators by status
validatorSchema.statics.findByStatus = function (status) {
  return this.find({ status });
};

// Instance method to add slash event
validatorSchema.methods.addSlashEvent = function (slashData) {
  this.slashHistory.push(slashData);
  if (this.status === "active") {
    this.status = "slashed";
  }
  return this.save();
};

// Instance method to get total slashed amount
validatorSchema.methods.getTotalSlashedAmount = function () {
  return this.slashHistory
    .reduce((total, slash) => {
      return total + parseFloat(slash.amountStETH || 0);
    }, 0)
    .toString();
};

// Instance method to calculate stake in wei
validatorSchema.methods.getStakeInWei = function () {
  const { Web3 } = require("web3");
  const web3 = new Web3();
  return web3.utils.toWei(this.totalDelegatedStakeStETH, "ether");
};

// Virtual for slash count
validatorSchema.virtual("slashCount").get(function () {
  return this.slashHistory.length;
});

// Ensure virtual fields are serialized
validatorSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Validator", validatorSchema);
