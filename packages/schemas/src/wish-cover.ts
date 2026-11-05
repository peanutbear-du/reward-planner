import { z } from "zod";

export const wishCoverRequestSchema = z.object({ wishId: z.string().uuid().transform((id) => id.toLowerCase()) }).strict();
