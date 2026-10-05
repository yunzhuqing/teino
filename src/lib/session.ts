/**
 * 管理后台会话：HMAC 签名 Cookie（Web Crypto，可在 Proxy 与 Node 中共用）
 * 格式：<expiresAtMs>.<base64url(hmac)>
 */
export const SESSION_COOKIE = "tn_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function toBase64Url(buf: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const secret = process.env.GATEWAY_SECRET;
  if (!secret) throw new Error("GATEWAY_SECRET 未配置");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`session:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(now = Date.now()): Promise<{ token: string; expires: Date }> {
  const exp = now + SESSION_TTL_MS;
  return { token: `${exp}.${await hmac(String(exp))}`, expires: new Date(exp) };
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  try {
    return safeEqual(sig, await hmac(exp));
  } catch {
    return false;
  }
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(input, expected);
}
