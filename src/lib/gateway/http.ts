import "server-only";
import { decrypt } from "../crypto";
import type { ApiType } from "../db/schema";
import type { CandidateWithSecret } from "./repository";
import { buildUpstreamHeaders, buildUpstreamUrl, errorBody } from "./upstream";

const UPSTREAM_TIMEOUT_MS = Math.max(1000, Number(process.env.GATEWAY_UPSTREAM_TIMEOUT_MS) || 60_000);
const RESPONSE_HEADERS = ["content-type", "cache-control", "x-request-id", "request-id", "openai-processing-ms"];

export function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  return req.headers.get("x-api-key")?.trim() || null;
}

export function errorResponse(apiType: ApiType, status: number, message: string, extra?: Record<string, string>) {
  return new Response(errorBody(apiType, status, message), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

export function pickHeaders(src: Headers): Headers {
  const h = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const v = src.get(name);
    if (v) h.set(name, v);
  }
  return h;
}

export async function parseJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 调用单个上游；超时只作用于“等待响应头”阶段，不影响后续流式输出 */
export async function callUpstream(
  req: Request,
  apiType: ApiType,
  target: CandidateWithSecret,
  body: Record<string, unknown>,
): Promise<Response> {
  const apiKey = decrypt(target.provider.apiKeyEncrypted);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error("等待上游响应超时")), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(buildUpstreamUrl(target.provider.baseUrl, apiType), {
      method: "POST",
      headers: buildUpstreamHeaders(apiType, apiKey, req.headers, target.provider.extraHeaders),
      body: JSON.stringify({ ...body, model: target.upstreamModel }),
      signal: AbortSignal.any([req.signal, timeout.signal]),
    });
  } finally {
    clearTimeout(timer);
  }
}
