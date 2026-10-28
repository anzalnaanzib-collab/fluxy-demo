// Demo codes and signed session cookies. No accounts, no passwords stored.
// Codes come from the FLUXY_DEMO_CODES env var: "CODE:Label:dailyCap,CODE2:Label2:dailyCap"
// and FLUXY_OWNER_CODE for the owner page.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export type Session = { label: string; role: "viewer" | "owner"; cap: number; exp: number };
export const COOKIE = "fluxy_session";
const DAY = 24 * 3600 * 1000;

const secret = () => {
  const s = process.env.FLUXY_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("FLUXY_SESSION_SECRET must be set (32+ characters)");
  return s;
};
const sha = (s: string) => createHash("sha256").update(s).digest();
const sameText = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

type CodeEntry = { code: string; label: string; cap: number; role: Session["role"] };

export function codeList(): CodeEntry[] {
  const out: CodeEntry[] = [];
  for (const part of (process.env.FLUXY_DEMO_CODES || "").split(",")) {
    const [code, label, cap] = part.split(":").map((x) => (x || "").trim());
    if (code && code.length >= 6) out.push({ code, label: label || "Demo", cap: Number(cap) > 0 ? Number(cap) : 60, role: "viewer" });
  }
  const owner = (process.env.FLUXY_OWNER_CODE || "").trim();
  if (owner.length >= 10) out.push({ code: owner, label: "Owner", cap: 500, role: "owner" });
  return out;
}

export function checkCode(input: string): CodeEntry | null {
  const typed = input.trim().toUpperCase();
  if (!typed) return null;
  let hit: CodeEntry | null = null;
  for (const c of codeList()) if (sameText(c.code.toUpperCase(), typed)) hit = c; // check all, constant-ish time
  return hit;
}

export function sign(s: Session): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify(token: string | undefined): Session | null {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const want = createHmac("sha256", secret()).update(body).digest("base64url");
  if (!sameText(mac, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    if (!s.exp || s.exp < Date.now()) return null;
    // A code removed from the env list stops working, even with an old cookie.
    if (!codeList().some((c) => c.label === s.label && c.role === s.role)) return null;
    return s;
  } catch {
    return null;
  }
}

export const newSession = (c: CodeEntry): Session => ({ label: c.label, role: c.role, cap: c.cap, exp: Date.now() + 7 * DAY });

export function readSession(req: Request): Session | null {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return verify(m ? decodeURIComponent(m[1]) : undefined);
}

export const cookieHeader = (value: string, maxAgeSec: number) =>
  `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
