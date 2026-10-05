"use client";

import { useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";

export function ToggleSwitch({ enabled, onToggle, label }: { enabled: boolean; onToggle: (next: boolean) => Promise<void>; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={pending}
      onClick={() => startTransition(() => onToggle(!enabled))}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition disabled:opacity-60 ${
        enabled ? "border-emerald-400/40 bg-emerald-500/30" : "border-white/10 bg-white/5"
      }`}
    >
      <span className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function DeleteButton({ onDelete, confirmText }: { onDelete: () => Promise<void>; confirmText: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn-icon hover:bg-rose-500/15 hover:text-rose-300"
      aria-label="删除"
      title="删除"
      disabled={pending}
      onClick={() => {
        if (confirm(confirmText)) startTransition(() => onDelete());
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}
