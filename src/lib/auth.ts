import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export class UnauthorizedError extends Error {
  constructor() {
    super("未登录或会话已过期");
  }
}

/** 所有 Server Action / 管理页数据读取前调用 */
export async function requireAdmin(): Promise<void> {
  const store = await cookies();
  if (!(await verifySessionToken(store.get(SESSION_COOKIE)?.value))) {
    throw new UnauthorizedError();
  }
}
