import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShieldCheck } from "lucide-react";
import { getAdminLoginPath } from "@/lib/session";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** 只能经 Proxy 从 ADMIN_LOGIN_PATH 改写进来；未配置入口时视为不存在 */
export default async function AdminLoginPage() {
  // 入口配置在运行时读取，不能在构建时预渲染
  await connection();
  if (!getAdminLoginPath()) notFound();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-strong w-full max-w-sm p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-700 to-zinc-900 shadow-lg shadow-zinc-900/30">
            <ShieldCheck className="size-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Teino AI Gateway</h1>
            <p className="mt-1 text-sm text-zinc-500">管理员登录</p>
          </div>
        </div>
        <AdminLoginForm />
      </div>
    </main>
  );
}
