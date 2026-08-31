import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { JanniDeliveryService } from "./janni-delivery.service";

const janniService = new JanniDeliveryService();

export class JanniDeliveryController {
  /**
   * Create Janni Delivery Registration
   */
  public async createRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const result = await janniService.createRegistration(
        req.body,
        user.userId,
        user
      );

      res.status(201).json({
        success: true,
        message: "Janni Delivery Registration created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all Janni Delivery Registrations (paginated & filtered)
   */
  public async getAllRegistrations(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const result = await janniService.getRegistrations(req.query as any, user);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single Janni Delivery Registration by ID
   */
  public async getRegistrationById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await janniService.getRegistrationById(id, user);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Janni Delivery Registration
   */
  public async updateRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await janniService.updateRegistration(id, req.body, user);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Soft Delete Janni Delivery Registration
   */
  public async softDeleteRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await janniService.softDeleteRegistration(id, user);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add Installment Payment
   */
  public async addInstallment(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await janniService.addInstallment(id, req.body, user);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify E-PIN for Janni Delivery
   */
  public async verifyEPin(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const pinCode = String(req.body.pinCode || req.body.pinNumber || "");
      const result = await janniService.verifyEPin(pinCode, user);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
