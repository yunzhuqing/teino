import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function secret(): string {
  const s = process.env.GATEWAY_SECRET;
  if (!s || s.length < 16) throw new Error("GATEWAY_SECRET 未配置或长度不足 16 位");
  return s;
}

function encKey(): Buffer {
  return createHash("sha256").update(`enc:${secret()}`).digest();
}

/** AES-256-GCM 加密，输出 base64url(iv|tag|ciphertext) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `sk-tn-${randomBytes(24).toString("base64url")}`;
  return { key, hash: sha256(key), prefix: `${key.slice(0, 10)}…${key.slice(-4)}` };
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
