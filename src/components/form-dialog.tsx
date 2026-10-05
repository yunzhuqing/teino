"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import type { ActionState, FormAction } from "@/lib/types";

interface Props {
  title: string;
  description?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  triggerLabel?: string;
  action: FormAction;
  submitLabel?: string;
  /** 表单内容；每次打开都会重新挂载以重置状态 */
  children: ReactNode;
  wide?: boolean;
}

export function FormDialog({ title, description, trigger, triggerClassName = "btn-primary", triggerLabel, action, submitLabel = "保存", children, wide }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [openCount, setOpenCount] = useState(0);

  const open = () => {
    setOpenCount((n) => n + 1);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button type="button" onClick={open} className={triggerClassName} aria-label={triggerLabel} title={triggerLabel}>
        {trigger}
      </button>
      <dialog
        ref={dialogRef}
        className={`glass-strong m-auto w-[calc(100%-2rem)] p-0 text-zinc-100 ${wide ? "max-w-2xl" : "max-w-lg"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        {openCount > 0 ? (
          <DialogBody key={openCount} title={title} description={description} action={action} submitLabel={submitLabel} onClose={close}>
            {children}
          </DialogBody>
        ) : null}
      </dialog>
    </>
  );
}

function DialogBody({
  title,
  description,
  action,
  submitLabel,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  action: FormAction;
  submitLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  // 成功且无需展示机密时自动关闭
  useEffect(() => {
    if (state.ok && !state.secret) onClose();
  }, [state, onClose]);

  if (state.ok && state.secret) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold">创建成功</h2>
        <p className="mt-1 text-sm text-amber-300/90">请立即复制保存，该 Key 只会显示这一次。</p>
        <SecretBox value={state.secret} />
        <div className="mt-6 flex justify-end">
          <button type="button" className="btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-zinc-400">{description}</p> : null}
        </div>
        <button type="button" onClick={onClose} className="btn-icon -mr-2" aria-label="关闭">
          <X className="size-4" />
        </button>
      </div>
      <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-5">{children}</div>
      <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
        {state.error ? <p className="mr-auto text-sm text-rose-400">{state.error}</p> : null}
        <button type="button" className="btn-ghost" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function SecretBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/10 p-3">
      <code className="flex-1 font-mono text-sm break-all text-violet-100">{value}</code>
      <button
        type="button"
        className="btn-icon"
        aria-label="复制"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
