"use server";

import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, verifyPassword } from "../crypto";
import { db } from "../db";
import { users } from "../db/schema";
import { canAccessPath, checkPassword, createSessionToken, homeFor, SESSION_COOKIE, type Session } from "../session";
import type { ActionState } from "../types";

// 账号不存在时也跑一次 scrypt，避免通过响应耗时探测邮箱是否注册
const DUMMY_HASH = hashPassword("teino-dummy-password");

async function authenticate(fd: FormData): Promise<Session | { error: string }> {
  const password = String(fd.get("password") ?? "");
  if (fd.get("mode") === "admin") {
    if (!process.env.ADMIN_PASSWORD) return { error: "服务器未配置 ADMIN_PASSWORD" };
    return checkPassword(password) ? { role: "admin" } : { error: "密码错误" };
  }

  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email || !password) return { error: "请输入邮箱和密码" };
  const [user] = await db
    .select({ id: users.id, enabled: users.enabled, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !ok) return { error: "邮箱或密码错误" };
  if (!user.enabled) return { error: "账号已停用，请联系管理员" };
  return { role: "user", userId: user.id };
}

export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await authenticate(fd);
  if ("error" in result) return { error: result.error };

  const { token, expires } = await createSessionToken(result);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });

  // next 来自登录前被拦下的页面；角色不能访问的页面一律回到自己的首页
  const next = String(fd.get("next") ?? "");
  const safe = next.startsWith("/") && !next.startsWith("//") && canAccessPath(result, next);
  redirect(safe ? next : homeFor(result));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
