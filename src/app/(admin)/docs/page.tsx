import { headers } from "next/headers";
import { PageHeader } from "@/components/ui";

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs leading-relaxed text-zinc-300">{children}</pre>;
}

export default async function DocsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}/v1`;

  const endpoints = [
    ["POST", "/v1/chat/completions", "OpenAI Chat Completions"],
    ["POST", "/v1/responses", "OpenAI Responses API"],
    ["POST", "/v1/messages", "Anthropic Messages API"],
    ["GET", "/v1/models", "可用模型列表"],
  ];

  return (
    <>
      <PageHeader title="接入文档" description="网关完全兼容官方协议，只需替换 Base URL 与 API Key" />
      <div className="space-y-5">
        <section className="glass p-5">
          <h2 className="mb-3 text-sm font-semibold">端点</h2>
          <div className="space-y-2">
            {endpoints.map(([m, p, d]) => (
              <div key={p} className="flex items-center gap-3 text-sm">
                <span className="w-12 rounded-md bg-violet-500/15 py-0.5 text-center font-mono text-[11px] font-semibold text-violet-200">{m}</span>
                <code className="font-mono text-zinc-200">{p}</code>
                <span className="text-xs text-zinc-500">{d}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Base URL：<code className="font-mono text-zinc-300">{base}</code>
          </p>
        </section>

        <section className="glass space-y-3 p-5">
          <h2 className="text-sm font-semibold">OpenAI SDK</h2>
          <Code>{`import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}", apiKey: "sk-tn-..." });
const res = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});`}</Code>
        </section>

        <section className="glass space-y-3 p-5">
          <h2 className="text-sm font-semibold">Anthropic SDK</h2>
          <Code>{`import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ baseURL: "${base.replace(/\/v1$/, "")}", apiKey: "sk-tn-..." });
const msg = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});`}</Code>
        </section>

        <section className="glass space-y-3 p-5">
          <h2 className="text-sm font-semibold">cURL · 指定路由标签</h2>
          <Code>{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer sk-tn-..." \\
  -H "X-Gateway-Tags: cn,fast" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"Hi"}]}'`}</Code>
        </section>

        <section className="glass p-5">
          <h2 className="mb-3 text-sm font-semibold">路由规则</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
            <li>
              按请求中的 <code className="font-mono text-violet-200">model</code> 匹配所有供应商下同名且启用的模型。模型设置了<b>上游协议</b>时，供应商需支持该协议；未设置时沿用请求协议。
            </li>
            <li>
              <b>标签过滤</b>：调用方标签 = API Key 标签 ∪ 用户标签。若调用方有标签，上游（供应商标签 ∪ 模型标签）需至少命中其中一个；调用方无标签则可访问全部上游。
            </li>
            <li>
              请求头 <code className="font-mono text-violet-200">X-Gateway-Tags</code>（逗号分隔）进一步要求上游<b>同时具备</b>这些标签。
            </li>
            <li>按 <b>优先级</b> 从高到低分层；同层内按 <b>权重</b> 加权随机选择，实现流量配比。</li>
            <li>上游返回 429 / 5xx / 网络错误时自动故障转移到下一个候选（同层其余 → 低优先级层），最多尝试 GATEWAY_MAX_ATTEMPTS 次。</li>
            <li>响应头 <code className="font-mono text-violet-200">x-gateway-provider</code>、<code className="font-mono text-violet-200">x-gateway-attempts</code> 标明实际命中的供应商与尝试次数。</li>
          </ol>
        </section>

        <section className="glass space-y-3 p-5">
          <h2 className="text-sm font-semibold">协议转换</h2>
          <p className="text-sm text-zinc-300">
            模型设置了<b>上游协议</b>且与请求协议不同时，网关会将请求转换为中间格式，再转换为上游协议；响应（含 SSE 流式与工具调用）按相反方向转换回来。例如用 Responses API 调用上游协议为 Anthropic Messages 的
            <code className="mx-1 font-mono text-violet-200">claude-opus-5-5</code>。同协议请求仍为原样透传。
          </p>
          <Code>{`const client = new OpenAI({ baseURL: "${base}", apiKey: "sk-tn-..." });
const res = await client.responses.create({
  model: "claude-opus-5-5",          // 上游协议 = Anthropic Messages
  input: "北京天气怎么样？",
  tools: [{ type: "function", name: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } }],
  store: false,
});`}</Code>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-300">
            <li>支持：文本、图片、system / instructions、函数工具及 tool_choice、工具结果、temperature / top_p、停止词、max_tokens、流式。</li>
            <li>
              转换为 Anthropic 时若未传 max_tokens，使用模型的「默认 max_tokens」，否则用 <code className="font-mono text-violet-200">GATEWAY_DEFAULT_MAX_TOKENS</code>（默认 4096）。
            </li>
            <li>推理内容（thinking / reasoning）跨协议时丢弃；同协议透传不受影响。</li>
            <li>
              以下字段跨协议时<b>直接返回 400</b>：previous_response_id、conversation、store: true、background、include（除 reasoning.encrypted_content）、text.format 结构化输出、内置工具（web_search、file_search、MCP 等）、response_format、logprobs、logit_bias、n &gt; 1、presence / frequency_penalty、top_k、音频与文件输入。Responses 上游不支持停止词。
            </li>
            <li>
              响应头 <code className="font-mono text-violet-200">x-gateway-upstream-api</code> 标明转换后的上游协议，请求日志「接口」列显示转换方向。
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
