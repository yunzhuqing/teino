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
        enabled ? "border-emerald-500/40 bg-emerald-500/25" : "border-zinc-900/10 bg-zinc-900/10"
      }`}
    >
      <span className={`inline-block size-3.5 rounded-full bg-white shadow-sm ring-1 ring-zinc-900/10 transition-transform ${enabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function DeleteButton({ onDelete, confirmText }: { onDelete: () => Promise<void>; confirmText: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn-icon hover:bg-rose-500/10 hover:text-rose-600"
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
