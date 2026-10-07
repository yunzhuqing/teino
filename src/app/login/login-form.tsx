"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { login } from "@/lib/actions/auth";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="label">
          邮箱
        </label>
        <input id="email" name="email" type="email" required autoFocus autoComplete="username" className="input" placeholder="you@example.com" />
      </div>
      <div>
        <label htmlFor="password" className="label">
          密码
        </label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="input" placeholder="••••••••" />
      </div>
      {state.error ? <p className="text-sm text-rose-600">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="btn-primary w-full py-2.5">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        登录
      </button>
      <p className="text-center text-xs text-zinc-500">账号与密码由管理员分配</p>
    </form>
  );
}
