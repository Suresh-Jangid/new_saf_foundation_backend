import { Request, Response, NextFunction } from "express";
import { AgentsService } from "./agents.service";

const agentsService = new AgentsService();

export class AgentsController {
  /**
   * Register a new agent profile
   */
  public async createAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const creatorId = (req as any).user?.id || (req as any).user?.userId;
      const result = await agentsService.createAgent(req.body, creatorId);
      res.status(201).json({
        success: true,
        message: "Agent registered successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieve eligible Senior Agents for dropdown (LEVEL-1 only)
   */
  public async getEligibleSeniors(req: Request, res: Response, next: NextFunction) {
    try {
      const excludeId = (req.query.excludeId || req.query.exclude_id || req.query.id) as string | undefined;
      const result = await agentsService.getEligibleSeniors(excludeId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieve all agents
   */
  public async getAllAgents(req: Request, res: Response, next: NextFunction) {
    try {
      const gender = req.query.gender as string | undefined;
      const village = req.query.village as string | undefined;
      const search = (req.query.search || req.query.q) as string | undefined;
      const result = await agentsService.getAllAgents({ gender, village, search });
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single agent profile
   */
  public async getAgentById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await agentsService.getAgentById(id);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update agent profile properties
   */
  public async updateAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const modifierId = (req as any).user?.id || (req as any).user?.userId;
      const result = await agentsService.updateAgent(id, req.body, modifierId);
      res.status(200).json({
        success: true,
        message: "Agent profile updated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Toggle agent active state
   */
  public async toggleAgentStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await agentsService.toggleAgentStatus(id);
      res.status(200).json({
        success: true,
        message: `Agent ${result.isActive ? "activated" : "deactivated"} successfully`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Soft delete agent
   */
  public async softDeleteAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await agentsService.softDeleteAgent(id);
      res.status(200).json({
        success: true,
        message: "Agent profile deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get agent permissions
   */
  public async getAgentPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await agentsService.getAgentPermissions(id);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update agent permissions
   */
  public async updateAgentPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { permissions } = req.body;
      const result = await agentsService.updateAgentPermissions(id, permissions);
      res.status(200).json({
        success: true,
        message: "Agent permissions updated successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
