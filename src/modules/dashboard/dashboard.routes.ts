import { Router } from "express";
import { DashboardController } from "./dashboard.controller";
import { authenticate } from "../../middlewares/auth";

const router = Router();
const controller = new DashboardController();

router.use(authenticate as any);

router.get("/counts", controller.getCounts.bind(controller));

export default router;
