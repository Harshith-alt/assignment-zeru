const express = require("express");
const router = express.Router();
const {
  getRewardsByAddress,
  getTopEarners,
  getRewardsStats,
  getRewardsByOperator,
} = require("../controllers/rewardController");

// @route   GET /api/rewards/stats
// @desc    Get rewards statistics and overview
// @access  Public
router.get("/stats", getRewardsStats);

// @route   GET /api/rewards/top-earners
// @desc    Get top reward earners with filtering
// @access  Public
// @params  ?page=1&limit=10&minRewards=1&period=30d
router.get("/top-earners", getTopEarners);

// @route   GET /api/rewards/operator/:operatorAddress
// @desc    Get rewards distributed by a specific operator
// @access  Public
// @params  ?page=1&limit=10
router.get("/operator/:operatorAddress", getRewardsByOperator);

// @route   GET /api/rewards/:address
// @desc    Get reward information for a specific wallet address
// @access  Public
router.get("/:address", getRewardsByAddress);

module.exports = router;
