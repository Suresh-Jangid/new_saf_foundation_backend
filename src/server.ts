import http from "http";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

import app from "./app";

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Start Server
const startServer = () => {
  try {
    server.listen(PORT, () => {
      console.log(`=================================`);
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`=================================`);
    });
  } catch (error) {
    console.error("❌ Error starting backend server:", error);
    process.exit(1);
  }
};

// Handle process terminations
process.on("unhandledRejection", (err: any) => {
  console.error("❌ Unhandled Rejection at Promise:", err);
  // Optional: Gracefully close server
});

process.on("uncaughtException", (err: Error) => {
  console.error("❌ Uncaught Exception thrown:", err);
  process.exit(1);
});

startServer();
