/**
 * 会话：HMAC 签名 Cookie（Web Crypto，可在 Proxy 与 Node 中共用）
 * 格式：<expiresAtMs>.<subject>.<base64url(hmac)>
 * subject 为 `admin`（管理员）或 `u_<userId>`（普通用户控制台）
 */
export const SESSION_COOKIE = "tn_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Session = { role: "admin" } | { role: "user"; userId: string };

const encoder = new TextEncoder();
const USER_PREFIX = "u_";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toSubject(session: Session): string {
  return session.role === "admin" ? "admin" : `${USER_PREFIX}${session.userId}`;
}

function fromSubject(subject: string): Session | null {
  if (subject === "admin") return { role: "admin" };
  if (subject.startsWith(USER_PREFIX)) {
    const userId = subject.slice(USER_PREFIX.length);
    if (UUID_RE.test(userId)) return { role: "user", userId };
  }
  return null;
}

export async function createSessionToken(session: Session, now = Date.now()): Promise<{ token: string; expires: Date }> {
  const exp = now + SESSION_TTL_MS;
  const payload = `${exp}.${toSubject(session)}`;
  return { token: `${payload}.${await hmac(payload)}`, expires: new Date(exp) };
}

/** 只校验签名与过期；普通用户是否仍启用由 requireUser 查库确认 */
export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [exp, subject, sig] = token.split(".");
  if (!exp || !subject || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  try {
    if (!safeEqual(sig, await hmac(`${exp}.${subject}`))) return null;
  } catch {
    return null;
  }
  return fromSubject(subject);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(input, expected);
}

/** 登录后的落地页 */
export function homeFor(session: Session): string {
  return session.role === "admin" ? "/" : "/console";
}

/** 普通用户只能访问 /console 下的页面；管理员不进入用户控制台 */
export function canAccessPath(session: Session, pathname: string): boolean {
  const isConsole = pathname === "/console" || pathname.startsWith("/console/");
  return session.role === "admin" ? !isConsole : isConsole;
}
