import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { users } from "./db/schema";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export class UnauthorizedError extends Error {
  constructor() {
    super("未登录或会话已过期");
  }
}

const getSession = cache(async () => {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
});

/** 所有管理端 Server Action / 管理页数据读取前调用。普通用户会话一律拒绝 */
export async function requireAdmin(): Promise<void> {
  const session = await getSession();
  if (session?.role !== "admin") throw new UnauthorizedError();
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string | null;
}

/**
 * 用户控制台的鉴权入口：每次都回库确认用户仍存在且启用，
 * 这样停用 / 删除用户后其已签发的会话立即失效。
 */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const session = await getSession();
  if (session?.role !== "user") throw new UnauthorizedError();
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, enabled: users.enabled, hasPassword: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!row?.enabled || !row.hasPassword) throw new UnauthorizedError();
  return { id: row.id, name: row.name, email: row.email };
});

/**
 * 控制台页面用：会话失效时跳到清理会话的路由。
 * 不能直接跳 /login —— Cookie 签名仍有效，Proxy 会把人再送回 /console，形成循环。
 */
export async function requireUserPage(): Promise<CurrentUser> {
  try {
    return await requireUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/api/session/end");
    throw err;
  }
}
