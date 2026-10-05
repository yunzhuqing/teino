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
            <li>按请求中的 <code className="font-mono text-violet-200">model</code> 匹配所有供应商下同名且启用的模型，且供应商需支持该接口类型。</li>
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
      </div>
    </>
  );
}
