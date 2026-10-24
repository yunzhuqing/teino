"use client";

import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/types";

export function ApiKeyCopyButton({ available, getSecret }: { available: boolean; getSecret: () => Promise<ActionState> }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const copied = message === "已复制";
  const label = available ? "复制 API Key" : "历史 Key 未保存完整密钥，无法复制";

  async function copy() {
    setPending(true);
    setMessage("");
    try {
      const result = await getSecret();
      if (!result.secret) {
        setMessage(result.error ?? "无法获取密钥");
        return;
      }
      await navigator.clipboard.writeText(result.secret);
      setMessage("已复制");
    } catch {
      setMessage("复制失败，请检查浏览器剪贴板权限后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button type="button" className="btn-icon" disabled={!available || pending} aria-label={label} title={label} onClick={copy}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
      <span role="status" className={`text-xs ${copied ? "text-emerald-600" : "text-rose-600"}`}>{message}</span>
    </div>
  );
}
