import { Router } from "express";
import { AgentsController } from "./agents.controller";
import { authenticate, authorizeRoles } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import { createAgentSchema, updateAgentSchema, updatePermissionsSchema } from "./agents.schema";

const router = Router();
const controller = new AgentsController();

// All agent routes require authentication
router.use(authenticate as any);

// Retrieve all agents
router.get("/", controller.getAllAgents.bind(controller));

// Retrieve eligible Senior Agents for dropdown
router.get("/seniors/eligible", controller.getEligibleSeniors.bind(controller));
router.get("/eligible-seniors", controller.getEligibleSeniors.bind(controller));

// Retrieve single agent
router.get("/:id", controller.getAgentById.bind(controller));

// Register a new agent (Admin or Authorized Agent with agent_registration create permission)
router.post(
  "/",
  checkPermission("agent_registration", "create") as any,
  validateRequest(createAgentSchema),
  controller.createAgent.bind(controller)
);

// Update agent profile (Admin or Agent)
router.put(
  "/:id",
  validateRequest(updateAgentSchema),
  controller.updateAgent.bind(controller)
);

// Toggle agent status (Admin Only)
router.post(
  "/:id/toggle-status",
  authorizeRoles("ADMIN") as any,
  controller.toggleAgentStatus.bind(controller)
);

// Soft Delete agent (Admin Only)
router.delete(
  "/:id",
  authorizeRoles("ADMIN") as any,
  controller.softDeleteAgent.bind(controller)
);

// Get agent permissions
router.get("/:id/permissions", controller.getAgentPermissions.bind(controller));

// Update agent permissions (Admin Only)
router.put(
  "/:id/permissions",
  authorizeRoles("ADMIN") as any,
  validateRequest(updatePermissionsSchema),
  controller.updateAgentPermissions.bind(controller)
);

export default router;
