import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

// Route imports
import authRouter from "./modules/auth/auth.routes";
import agentsRouter from "./modules/agents/agents.routes";
import applicationsRouter from "./modules/applications/applications.routes";
import mayraRouter from "./modules/mayra/mayra.routes";
import schemesRouter from "./modules/schemes/schemes.routes";
import paymentsRouter from "./modules/payments/payments.routes";
import documentsRouter from "./modules/documents/documents.routes";
import dashboardRouter from "./modules/dashboard/dashboard.routes";
import compatibilityRouter from "./modules/compatibility/compatibility.routes";
import customerRouter from "./modules/customer/customer.routes";
import configurationRouter from "./modules/configuration/configuration.routes";
import epinsRouter from "./modules/epins/epins.routes";
import janniDeliveryRouter from "./modules/janni-delivery/janni-delivery.routes";
import path from "path";

import { AppError } from "./utils/errors";
import { getHealthPayload } from "./utils/environment";

const app = express();

// Security Middlewares
app.use(helmet());

// Serve static uploads BEFORE the restrictive CORS below. Uploaded photos are
// public and are fetched cross-origin by the frontend to base64-encode them for
// PDF generation, so they must be readable from any origin. We set a permissive
// Access-Control-Allow-Origin (no credentials involved for a plain image GET) and
// relax helmet's Cross-Origin-Resource-Policy. Placing this ahead of the origin-
// restricted cors() ensures image fetches never get blocked by CORS — the root
// cause of "photo not showing in PDF/bond".
app.use(
  "/uploads",
  (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "../uploads"))
);

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isLocalhost = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
      if (isLocalhost || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        callback(null, true);
      } else {
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    },
    credentials: true,
  })
);

// Request parsing Middlewares
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// Request Logging
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Root Route
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Purbiya Project Backend API is Running 🚀",
    version: "v1",
    health: "/health",
    api: "/api/v1"
  });
});


// Canonical Health Check Handler
const handleHealthCheck = (_req: Request, res: Response) => {
  res.status(200).json(getHealthPayload());
};

// Mount canonical health routes across root and API prefixes
app.get("/health", handleHealthCheck);
app.get("/api/health", handleHealthCheck);
app.get("/api/v1/health", handleHealthCheck);

// Register Module Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/agents", agentsRouter);
app.use("/api/v1/applications", applicationsRouter);
app.use("/api/v1/mayra", mayraRouter);
app.use("/api/v1/schemes", schemesRouter);
app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/documents", documentsRouter);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/config", configurationRouter);
app.use("/api/config", configurationRouter);
app.use("/api/v1/epins", epinsRouter);
app.use("/api/epins", epinsRouter);
app.use("/api/v1/janni-delivery", janniDeliveryRouter);
app.use("/api/janni-delivery", janniDeliveryRouter);

// apicall gateway (legacy PHP used /api/api.php — now /api)
app.use("/api", compatibilityRouter);
// Deprecated alias for old clients / env vars
app.use("/api/api.php", compatibilityRouter);

// Customer-facing apicall gateway (legacy PHP used
// /purbiya/api/customer_api.php?apicall=... — now /api/customer)
app.use("/api/customer", customerRouter);
app.use("/api/customer_api.php", customerRouter);

// Fallback Route for Undefined Paths
app.use((req: Request, _res: Response, next: NextFunction) => {
  const error = new AppError(`Not Found - ${req.originalUrl}`, 404);
  next(error);
});

// Global Error Handling Middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });
});

export default app;
