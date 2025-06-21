const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error("🚨 Error:", err);

  // Mongoose bad ObjectId
  if (err.name === "CastError") {
    const message = "Resource not found";
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = "Duplicate field value entered";
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors).map((val) => val.message);
    error = { message: message.join(", "), statusCode: 400 };
  }

  // Web3 errors
  if (err.message && err.message.includes("Invalid address")) {
    error = { message: "Invalid Ethereum address format", statusCode: 400 };
  }

  // Rate limit error
  if (err.status === 429) {
    error = {
      message: "Too many requests, please try again later",
      statusCode: 429,
    };
  }

  // Network/API errors
  if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
    error = { message: "External service unavailable", statusCode: 503 };
  }

  // GraphQL errors
  if (err.response && err.response.errors) {
    const graphqlErrors = err.response.errors.map((e) => e.message).join(", ");
    error = { message: `GraphQL Error: ${graphqlErrors}`, statusCode: 400 };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

module.exports = errorHandler;
