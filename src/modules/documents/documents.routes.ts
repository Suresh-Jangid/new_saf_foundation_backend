import { Router } from "express";
import { DocumentsController } from "./documents.controller";
import { authenticate } from "../../middlewares/auth";

const router = Router();
const controller = new DocumentsController();

// Document compilation requires login
router.use(authenticate as any);

router.get("/general/:id", controller.generateGeneralPDF.bind(controller));
router.get("/mayra/:id", controller.generateMayraPDF.bind(controller));
router.get("/bond/:id", controller.generateBondPDF.bind(controller));

export default router;
