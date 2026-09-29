import { Router } from "express";
import { DashboardController } from "./dashboard.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";

const router = Router();
const controller = new DashboardController();

router.use(authenticate as any);

router.get("/counts", checkPermission("dashboard", "view") as any, controller.getCounts.bind(controller));

export default router;
