const mongoose = require("mongoose");

const restakerSchema = new mongoose.Schema(
  {
    userAddress: {
      type: String,
      required: [true, "User address is required"],
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
    amountRestakedStETH: {
      type: String,
      required: [true, "Amount restaked is required"],
      validate: {
        validator: function (v) {
          return !isNaN(parseFloat(v)) && parseFloat(v) >= 0;
        },
        message: (props) => `${props.value} is not a valid amount!`,
      },
    },
    targetAVSOperatorAddress: {
      type: String,
      required: [true, "Target AVS operator address is required"],
      lowercase: true,
      validate: {
        validator: function (v) {
          return /^0x[a-fA-F0-9]{40}$/.test(v);
        },
        message: (props) => `${props.value} is not a valid Ethereum address!`,
      },
      index: true,
    },
    delegationTimestamp: {
      type: Date,
      default: Date.now,
    },
    transactionHash: {
      type: String,
      sparse: true,
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
    status: {
      type: String,
      enum: ["active", "unstaking", "withdrawn"],
      default: "active",
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "restakers",
  }
);

// Indexes for better query performance
restakerSchema.index({ userAddress: 1 });
restakerSchema.index({ targetAVSOperatorAddress: 1 });
restakerSchema.index({ status: 1 });
restakerSchema.index({ lastUpdated: -1 });

// Pre-save middleware to update lastUpdated
restakerSchema.pre("save", function (next) {
  this.lastUpdated = new Date();
  next();
});

// Static method to find by user address
restakerSchema.statics.findByUserAddress = function (address) {
  return this.findOne({ userAddress: address.toLowerCase() });
};

// Static method to find by operator
restakerSchema.statics.findByOperator = function (operatorAddress) {
  return this.find({ targetAVSOperatorAddress: operatorAddress.toLowerCase() });
};

// Instance method to calculate restaked amount in wei
restakerSchema.methods.getAmountInWei = function () {
  const { Web3 } = require("web3");
  const web3 = new Web3();
  return web3.utils.toWei(this.amountRestakedStETH, "ether");
};

module.exports = mongoose.model("Restaker", restakerSchema);
