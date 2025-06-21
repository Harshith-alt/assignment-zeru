const express = require("express");
const router = express.Router();
const {
  getValidators,
  getValidatorByAddress,
  getValidatorsStats,
  getSlashHistory,
  getValidatorPerformance,
} = require("../controllers/validatorController");

// @route   GET /api/validators
// @desc    Get all validators with filtering and pagination
// @access  Public
// @params  ?page=1&limit=10&status=active&minStake=100&maxStake=10000&hasSlashHistory=true&search=0x...&sortBy=totalDelegatedStakeStETH&sortOrder=desc
router.get("/", getValidators);

// @route   GET /api/validators/stats
// @desc    Get validators statistics and overview
// @access  Public
router.get("/stats", getValidatorsStats);

// @route   GET /api/validators/slashes
// @desc    Get slash history across all validators
// @access  Public
// @params  ?page=1&limit=20
router.get("/slashes", getSlashHistory);

// @route   GET /api/validators/:address/performance
// @desc    Get detailed performance metrics for a validator
// @access  Public
router.get("/:address/performance", getValidatorPerformance);

// @route   GET /api/validators/:address
// @desc    Get validator by operator address
// @access  Public
router.get("/:address", getValidatorByAddress);

module.exports = router;
