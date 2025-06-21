const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/database");
const restakerRoutes = require("./routes/restakers");
const validatorRoutes = require("./routes/validators");
const rewardRoutes = require("./routes/rewards");
const errorHandler = require("./middleware/errorHandler");
require("dotenv").config();

const app = express();

// Connect to Database
connectDB();

// Security Middleware
app.use(helmet());
app.use(cors());

// Rate Limiting
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX_REQUESTS || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
});
app.use("/api/", limiter);

// Body Parser Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

// Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "EigenLayer Restaking API",
    version: "1.0.0",
  });
});

// API Routes
app.use("/api/restakers", restakerRoutes);
app.use("/api/validators", validatorRoutes);
app.use("/api/rewards", rewardRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to EigenLayer Restaking API",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      restakers: "/api/restakers",
      validators: "/api/validators",
      rewards: "/api/rewards/:address",
    },
    documentation: "See README.md for detailed API documentation",
  });
});

// Error Handling Middleware
app.use(errorHandler);

// 404 Handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(` EigenLayer Restaking API Server running on port ${PORT}`);
  console.log(` Health check available at http://localhost:${PORT}/health`);
  console.log(` API endpoints available at http://localhost:${PORT}/api`);
});
