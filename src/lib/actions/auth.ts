"use server";

import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, verifyPassword } from "../crypto";
import { db } from "../db";
import { users } from "../db/schema";
import { getAdminLoginPath, SESSION_COOKIE, verifySessionToken } from "../session";
import { startSession } from "../session-cookie";
import type { ActionState } from "../types";

// 账号不存在时也跑一次 scrypt，避免通过响应耗时探测邮箱是否注册
const DUMMY_HASH = hashPassword("teino-dummy-password");

/** 普通用户登录（邮箱 + 密码）。管理员登录在 admin-auth.ts，入口不对外公开 */
export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "请输入邮箱和密码" };

  const [user] = await db
    .select({ id: users.id, enabled: users.enabled, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !ok) return { error: "邮箱或密码错误" };
  if (!user.enabled) return { error: "账号已停用，请联系管理员" };

  return startSession({ role: "user", userId: user.id }, String(fd.get("next") ?? ""));
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  // 管理员回到自己的登录入口，普通用户回到公开登录页
  redirect((session?.role === "admin" && getAdminLoginPath()) || "/login");
}
