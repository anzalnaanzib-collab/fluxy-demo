import { createHash } from "node:crypto";
// Visitor key for rate limits: hashed IP, never stored raw.
export function clientKey(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(ip + (process.env.FLUXY_SESSION_SECRET || "")).digest("hex").slice(0, 24);
}
export const country = (req: Request): string | null => (req.headers.get("x-vercel-ip-country") || "").toUpperCase() || null;
