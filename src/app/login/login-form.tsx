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
        <label htmlFor="password" className="label">
          管理员密码
        </label>
        <input id="password" name="password" type="password" required autoFocus autoComplete="current-password" className="input" placeholder="••••••••" />
      </div>
      {state.error ? <p className="text-sm text-rose-400">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="btn-primary w-full py-2.5">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        登录
      </button>
    </form>
  );
}
