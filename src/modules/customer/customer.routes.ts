import { Router, Request, Response } from "express";
import multer from "multer";
import { verifyCustomerAccessToken } from "../../utils/jwt";
import { CustomerService } from "./customer.service";

const router = Router();
const customerService = new CustomerService();
// The spec sheet's curl examples send fields as multipart/form-data
// (--form), which express.json()/express.urlencoded() in app.ts don't parse
// — same reason compatibility.routes.ts runs upload.any() on its gateway.
// No file fields are expected here today, just form fields via req.body.
const upload = multer();

// Same shape as compatibility.routes.ts's legacy apicall gateway: a single
// endpoint dispatching on `?apicall=`, ported from the legacy PHP
// `customer_api.php?apicall=...` contract described in the spec sheet this
// module implements.
const PUBLIC_ACTIONS = ["customerRequestOtp", "customerVerifyOtp", "customerCreatePassword", "customerLogin"];

router.all("/", upload.any(), async (req: Request, res: Response) => {
  const apicall = String(req.query.apicall || req.body.apicall || "");
  if (!apicall) {
    return res.status(400).json({ status: false, message: "Missing apicall parameter" });
  }

  const payload: Record<string, any> = { ...req.query, ...req.body };
  delete payload.apicall;

  let customer: { customer_auth_id: string; application_id: string; mobile: string } | null = null;
  if (!PUBLIC_ACTIONS.includes(apicall)) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(200).json({ status: false, error: true, message: "Unauthorized - Token missing" });
    }
    try {
      customer = verifyCustomerAccessToken(authHeader.split(" ")[1]);
    } catch (err: any) {
      return res.status(200).json({ status: false, error: true, message: `Unauthorized - Invalid token: ${err.message}` });
    }
  }

  try {
    switch (apicall) {
      case "customerRequestOtp": {
        return res.json(await customerService.requestOtp(payload.mobile));
      }

      case "customerVerifyOtp": {
        return res.json(await customerService.verifyOtp(payload.mobile, payload.otp));
      }

      case "customerCreatePassword": {
        return res.json(await customerService.createPassword(payload.mobile, payload.password));
      }

      case "customerLogin": {
        return res.json(await customerService.login(payload.mobile, payload.password));
      }

      case "customerProfile": {
        return res.json(await customerService.getProfile(customer!.mobile, customer!.application_id));
      }

      case "customerLogout": {
        return res.json(await customerService.logout());
      }

      case "getAllApplicationsByMobile": {
        return res.json(await customerService.getAllApplicationsByMobile(customer!.mobile));
      }

      case "getUserBulkData": {
        return res.json(await customerService.getUserBulkData(customer!.mobile));
      }

      case "createPaymentOrder": {
        return res.json(
          await customerService.createPaymentOrder(customer!.mobile, payload.module_type, payload.entity_id)
        );
      }

      case "verifyPaymentTransaction": {
        return res.json(
          await customerService.verifyPaymentTransaction(
            payload.razorpay_order_id,
            payload.razorpay_payment_id,
            payload.razorpay_signature
          )
        );
      }

      case "getPaymentTransactionHistory": {
        return res.json(
          await customerService.getPaymentTransactionHistory(customer!.mobile, payload.module_type, payload.entity_id)
        );
      }

      case "getAllModuleMemberCounts": {
        return res.json(await customerService.getAllModuleMemberCounts());
      }

      case "getLatestAnnouncements": {
        return res.json(await customerService.getLatestAnnouncements(payload.application_type));
      }

      case "getAnnouncementDetails": {
        return res.json(await customerService.getAnnouncementDetails(payload.id));
      }

      default:
        return res.status(200).json({ status: false, error: true, message: `Unsupported apicall: ${apicall}` });
    }
  } catch (err: any) {
    // Matches compatibility.routes.ts's convention: legacy clients check the
    // body's status/error field rather than the HTTP status code, so every
    // error here — including 404/400 AppErrors — comes back as HTTP 200.
    console.error(`Error in customer API handler for [${apicall}]:`, err);
    return res.status(200).json({ status: false, error: true, message: err.message || "Internal server error" });
  }
});

export default router;
