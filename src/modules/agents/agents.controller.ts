import { Request, Response, NextFunction } from "express";
import { AgentsService } from "./agents.service";

const agentsService = new AgentsService();

export class AgentsController {
  /**
   * Register a new agent profile
   */
  public async createAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agentsService.createAgent(req.body);
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
   * Retrieve all agents
   */
  public async getAllAgents(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agentsService.getAllAgents();
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
      const result = await agentsService.updateAgent(id, req.body);
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
