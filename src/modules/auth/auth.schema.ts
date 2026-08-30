import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    mobile: z
      .string()
      .min(10, "Mobile number must be at least 10 digits")
      .max(15, "Mobile number must not exceed 15 digits")
      .regex(/^\d+$/, "Mobile number must contain digits only"),
    password: z.string().min(6, "Password must be at least 6 characters"),
  }),
});
