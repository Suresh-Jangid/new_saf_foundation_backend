import { Router } from "express";
import { AuthController } from "./auth.controller";
import { validateRequest } from "../../middlewares/validation";
import { loginSchema } from "./auth.schema";

const router = Router();
const controller = new AuthController();

// Admin Login
router.post(
  "/login/admin",
  validateRequest(loginSchema),
  controller.loginAdmin.bind(controller)
);

// Agent Login
router.post(
  "/login/agent",
  validateRequest(loginSchema),
  controller.loginAgent.bind(controller)
);

// Refresh Access Token
router.post("/refresh", controller.refreshToken.bind(controller));

// Logout User
router.post("/logout", controller.logout.bind(controller));

export default router;
