"use client";

import { useState } from "react";
import type { TagLite } from "@/components/tag-badge";
import { TagPicker } from "@/components/tag-picker";
import { API_TYPES, BILLING_MODES, CURRENCY_CODES, type ApiType, type BillingMode, type CurrencyCode } from "@/lib/db/schema";
import { API_TYPE_LABELS } from "@/lib/gateway/upstream";
import { PriceTiersEditor, type PriceTierValue } from "./price-tiers-editor";
import { PriorityMultipliersEditor } from "./priority-multipliers-editor";

const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  token: "按 token 计费（真实货币）",
  credit: "按积分计费",
};

const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  USD: "USD（美元）",
  CNY: "CNY（人民币）",
};

const API_TYPE_HINTS: Record<ApiType, string> = {
  openai_chat: "POST {base}/chat/completions",
  openai_responses: "POST {base}/responses",
  anthropic_messages: "POST {base}/messages",
};

interface ProviderValue {
  name: string;
  baseUrl: string;
  apiKeyHint: string;
  apiTypes: ApiType[];
  extraHeaders: Record<string, string>;
  enabled: boolean;
  tagIds: string[];
}

export function ProviderFields({ provider, tags }: { provider?: ProviderValue; tags: TagLite[] }) {
  const headers = provider && Object.keys(provider.extraHeaders).length ? JSON.stringify(provider.extraHeaders, null, 2) : "";
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="p-name">
            名称
          </label>
          <input id="p-name" name="name" required defaultValue={provider?.name} className="input" placeholder="如 OpenAI 官方" />
        </div>
        <div>
          <label className="label" htmlFor="p-url">
            Base URL
          </label>
          <input id="p-url" name="baseUrl" required type="url" defaultValue={provider?.baseUrl} className="input font-mono" placeholder="https://api.openai.com/v1" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="p-key">
          API Key {provider ? <span className="text-zinc-500">（当前 {provider.apiKeyHint}，留空则不修改）</span> : null}
        </label>
        <input id="p-key" name="apiKey" type="password" autoComplete="off" required={!provider} className="input font-mono" placeholder="sk-..." />
      </div>
      <div>
        <span className="label">支持的 API 类型</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {API_TYPES.map((t) => (
            <label key={t} className="flex cursor-pointer flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition has-checked:border-violet-400/50 has-checked:bg-violet-500/10">
              <span className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="apiTypes" value={t} defaultChecked={provider ? provider.apiTypes.includes(t) : t === "openai_chat"} className="size-4 accent-violet-500" />
                {API_TYPE_LABELS[t]}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{API_TYPE_HINTS[t]}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="p-headers">
          附加请求头（JSON，可选）
        </label>
        <textarea id="p-headers" name="extraHeaders" rows={3} defaultValue={headers} className="input font-mono text-xs" placeholder='{"OpenAI-Organization": "org-xxx"}' />
      </div>
      <div>
        <span className="label">标签</span>
        <TagPicker tags={tags} defaultValue={provider?.tagIds} />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" name="enabled" defaultChecked={provider?.enabled ?? true} className="size-4 accent-violet-500" />
        启用
      </label>
    </>
  );
}

interface ModelValue {
  name: string;
  upstreamModel: string | null;
  apiType: ApiType | null;
  defaultMaxTokens: number | null;
  priority: number;
  weight: number;
  billingMode: BillingMode;
  currency: CurrencyCode | null;
  priorityMultipliers: Record<string, number>;
  enabled: boolean;
  tagIds: string[];
  /** 数据库行：金额是 numeric 字符串，区间是整数 */
  prices: Array<{
    contextMin: number;
    contextMax: number | null;
    period: string;
    inputPrice: string;
    outputPrice: string;
    cacheWritePrice: string;
    cacheReadPrice: string;
  }>;
}

export function ModelFields({
  providerId,
  providerApiTypes,
  model,
  tags,
}: {
  providerId: string;
  providerApiTypes: readonly ApiType[];
  model?: ModelValue;
  tags: TagLite[];
}) {
  // 计费模式是纯客户端联动：credit 模式下币种无意义，选择框随之禁用
  const [billingMode, setBillingMode] = useState<BillingMode>(model?.billingMode ?? "token");

  return (
    <>
      <input type="hidden" name="providerId" value={providerId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="m-name">
            模型名（对外）
          </label>
          <input id="m-name" name="name" required defaultValue={model?.name} className="input font-mono" placeholder="gpt-4o" />
        </div>
        <div>
          <label className="label" htmlFor="m-up">
            上游模型名（可选）
          </label>
          <input id="m-up" name="upstreamModel" defaultValue={model?.upstreamModel ?? ""} className="input font-mono" placeholder="默认与模型名相同" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="m-api">
            上游协议
          </label>
          <select id="m-api" name="apiType" defaultValue={model?.apiType ?? ""} className="input">
            <option value="">沿用请求协议（透传）</option>
            {API_TYPES.map((t) => (
              <option key={t} value={t} disabled={!providerApiTypes.includes(t) && model?.apiType !== t}>
                {API_TYPE_LABELS[t]}
                {providerApiTypes.includes(t) ? "" : "（供应商未声明）"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="m-max">
            默认 max_tokens（可选）
          </label>
          <input id="m-max" name="defaultMaxTokens" type="number" step={1} min={1} defaultValue={model?.defaultMaxTokens ?? ""} className="input tabular-nums" placeholder="4096" />
        </div>
      </div>
      <p className="-mt-2 text-xs text-zinc-500">
        设置上游协议后，其他协议的请求（如 Responses → Anthropic）会自动转换后发往上游。默认 max_tokens 仅在转换为 Anthropic Messages 且调用方未传时使用。
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="m-pri">
            优先级（越大越优先）
          </label>
          <input id="m-pri" name="priority" type="number" step={1} min={-1000} max={1000} required defaultValue={model?.priority ?? 0} className="input tabular-nums" />
        </div>
        <div>
          <label className="label" htmlFor="m-w">
            流量权重（同优先级内按比例）
          </label>
          <input id="m-w" name="weight" type="number" step={1} min={0} max={10000} required defaultValue={model?.weight ?? 100} className="input tabular-nums" />
        </div>
      </div>
      <p className="-mt-2 text-xs text-zinc-500">权重为 0 表示仅在同层其他上游都失败时兜底使用。</p>
      <div className="rounded-xl border border-white/10 bg-white/2 p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-200">计费</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="m-billing">
              计费模式
            </label>
            <select
              id="m-billing"
              name="billingMode"
              value={billingMode}
              onChange={(e) => setBillingMode(e.target.value as BillingMode)}
              className="input"
            >
              {BILLING_MODES.map((m) => (
                <option key={m} value={m}>
                  {BILLING_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="m-currency">
              结算币种 {billingMode === "credit" ? <span className="text-zinc-500">（积分模式不需要）</span> : null}
            </label>
            <select id="m-currency" name="currency" defaultValue={model?.currency ?? ""} className="input" disabled={billingMode === "credit"}>
              <option value="">请选择</option>
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-4">
          <PriceTiersEditor
            defaultValue={model?.prices?.map((p) => ({
              contextMin: String(p.contextMin),
              contextMax: p.contextMax === null ? "" : String(p.contextMax),
              period: p.period,
              inputPrice: p.inputPrice,
              outputPrice: p.outputPrice,
              cacheWritePrice: p.cacheWritePrice,
              cacheReadPrice: p.cacheReadPrice,
            }))}
          />
          <PriorityMultipliersEditor defaultValue={model?.priorityMultipliers} />
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          单价的单位是「每 100 万 token」，按 {billingMode === "credit" ? "积分" : "所选币种"} 填写；四个维度分别乘以各自 token 数后求和，再乘优先级倍率。
          请求实际用量由上游回报，预检时按上下文长度估算。
        </p>
      </div>
      <div>
        <span className="label">标签</span>
        <TagPicker tags={tags} defaultValue={model?.tagIds} />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" name="enabled" defaultChecked={model?.enabled ?? true} className="size-4 accent-violet-500" />
        启用
      </label>
    </>
  );
}
