import { Sparkles } from "lucide-react";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-strong w-full max-w-sm p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 shadow-lg shadow-violet-500/30">
            <Sparkles className="size-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Teino AI Gateway</h1>
            <p className="mt-1 text-sm text-zinc-500">登录管理控制台</p>
          </div>
        </div>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
