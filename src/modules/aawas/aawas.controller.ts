import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { AawasService } from "./aawas.service";

const aawasService = new AawasService();

export class AawasController {
  /**
   * Create Registration
   */
  public async createRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const result = await aawasService.createRegistration(
        req.body,
        user.userId,
        user
      );
      res.status(201).json({
        success: true,
        message: "Aawas registration created successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get All Registrations (Paginated + Filtered)
   */
  public async getAllRegistrations(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const result = await aawasService.getRegistrations(req.query as any, user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get Single Registration by ID
   */
  public async getRegistrationById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await aawasService.getRegistrationById(id, user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update Registration
   */
  public async updateRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await aawasService.updateRegistration(id, req.body, user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Soft Delete Registration
   */
  public async softDeleteRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await aawasService.softDeleteRegistration(id, user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
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
      const result = await aawasService.addInstallment(id, req.body, user);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Pre-submission E-PIN validation
   */
  public async verifyEPin(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      const { pinCode, pinNumber } = req.body;
      const result = await aawasService.verifyEPin(pinCode || pinNumber, user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
