import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/** 清除失效会话（如用户被停用）后回到登录页 */
export function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
