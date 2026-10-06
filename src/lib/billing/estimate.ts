/**
 * 预检用的输入 token 估算。
 *
 * 这是**近似值**，只用于「余额是否够发起这次请求」的门槛判断，不参与扣费——
 * 实际扣费一律用上游回报的 usage。项目没有 tokenizer 依赖，引入一个只为拦截阈值
 * 不划算，因此按字符数启发式估算。
 *
 * 经验系数：英文约 4 字符/token，中文与 CJK 约 1 字符/token 出头。取 3.5 偏保守，
 * 宁可在边界上少放行一点，也不放行明显超额的请求。
 */
const CHARS_PER_TOKEN = 3.5;
/** 每条消息的 role / 分隔符等结构开销 */
const PER_MESSAGE_OVERHEAD = 4;
/** 每次请求的固定开销（系统提示包装、assistant 起始标记等） */
const PER_REQUEST_OVERHEAD = 8;
/** 一张图片的粗略等价 token 数（按常见低/中细节档位估计） */
const IMAGE_TOKENS = 1100;

interface EstimateShape {
  system?: unknown;
  messages?: unknown;
  tools?: unknown;
  input?: unknown;
  instructions?: unknown;
}

function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** 递归统计任意嵌套结构里的字符串长度（覆盖 content blocks、tool_result、input 等形状） */
function deepTextTokens(value: unknown, depth = 0): number {
  if (depth > 12 || value === null || value === undefined) return 0;
  if (typeof value === "string") return textTokens(value);
  if (typeof value === "number" || typeof value === "boolean") return 1;
  if (Array.isArray(value)) return value.reduce<number>((sum, v) => sum + deepTextTokens(v, depth + 1), 0);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce<number>((sum, v) => sum + deepTextTokens(v, depth + 1), 0);
  }
  return 0;
}

/** 统计结构里出现的图片数量：OpenAI 的 image_url / image，Anthropic 的 image source */
function countImages(value: unknown, depth = 0): number {
  if (depth > 12 || !value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce<number>((sum, v) => sum + countImages(v, depth + 1), 0);
  const o = value as Record<string, unknown>;
  let n = o.type === "image" || o.type === "image_url" || o.type === "input_image" ? 1 : 0;
  for (const v of Object.values(o)) n += countImages(v, depth + 1);
  return n;
}

/**
 * 估算请求体的输入 token 数。三种协议的请求体形状都覆盖：
 * Anthropic 的 system + messages、OpenAI Chat 的 messages、Responses 的 input + instructions。
 */
export function estimateInputTokens(body: Record<string, unknown>): number {
  const b = body as EstimateShape;
  let tokens = PER_REQUEST_OVERHEAD;

  const parts: unknown[] = [b.system, b.messages, b.tools, b.instructions];
  // Responses 用 input 承载对话内容
  if (b.input !== undefined) parts.push(b.input);

  for (const p of parts) {
    if (p === undefined) continue;
    tokens += deepTextTokens(p);
    if (Array.isArray(p)) tokens += PER_MESSAGE_OVERHEAD * p.length;
  }
  tokens += IMAGE_TOKENS * countImages(parts);

  return Math.max(1, Math.round(tokens));
}

/**
 * 估算输出 token：以调用方声明的上限为准，没有则用模型/全局默认值。
 * 预检按上限估算而非期望值，避免放行后实际输出远超余额。
 */
export function estimateOutputTokens(body: Record<string, unknown>, fallbackMaxTokens: number): number {
  for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
    const v = body[field];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  }
  return Math.max(1, fallbackMaxTokens);
}
