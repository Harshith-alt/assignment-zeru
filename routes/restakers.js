const express = require("express");
const router = express.Router();
const {
  getRestakers,
  getRestakerByAddress,
  getRestakersByOperator,
  getRestakersStats,
} = require("../controllers/restakerController");

// @route   GET /api/restakers
// @desc    Get all restakers with filtering and pagination
// @access  Public
// @params  ?page=1&limit=10&status=active&operator=0x...&minAmount=10&maxAmount=1000&search=0x...&sortBy=amount&sortOrder=desc
router.get("/", getRestakers);

// @route   GET /api/restakers/stats
// @desc    Get restakers statistics and overview
// @access  Public
router.get("/stats", getRestakersStats);

// @route   GET /api/restakers/operator/:operatorAddress
// @desc    Get all restakers for a specific operator
// @access  Public
// @params  ?page=1&limit=10
router.get("/operator/:operatorAddress", getRestakersByOperator);

// @route   GET /api/restakers/:address
// @desc    Get restaker by user address
// @access  Public
router.get("/:address", getRestakerByAddress);

module.exports = router;
