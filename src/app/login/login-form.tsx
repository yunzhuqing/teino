"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { login } from "@/lib/actions/auth";

type Mode = "user" | "admin";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, {});
  const [mode, setMode] = useState<Mode>("user");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="mode" value={mode} />
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-900/10 bg-white/60 p-1 text-sm">
        {(
          [
            ["user", "用户登录"],
            ["admin", "管理员"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded-lg py-1.5 transition ${mode === value ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/10" : "text-zinc-500 hover:text-zinc-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "user" ? (
        <div>
          <label htmlFor="email" className="label">
            邮箱
          </label>
          <input id="email" name="email" type="email" required autoFocus autoComplete="username" className="input" placeholder="you@example.com" />
        </div>
      ) : null}
      <div>
        <label htmlFor="password" className="label">
          {mode === "admin" ? "管理员密码" : "密码"}
        </label>
        <input id="password" name="password" type="password" required autoFocus={mode === "admin"} autoComplete="current-password" className="input" placeholder="••••••••" />
      </div>
      {state.error ? <p className="text-sm text-rose-600">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="btn-primary w-full py-2.5">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        登录
      </button>
      {mode === "user" ? <p className="text-center text-xs text-zinc-500">账号与密码由管理员分配</p> : null}
    </form>
  );
}
