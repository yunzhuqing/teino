import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/** 管理后台的乐观鉴权；Server Action 内部仍会再次校验 */
export async function proxy(request: NextRequest) {
  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const isLogin = request.nextUrl.pathname === "/login";

  if (!ok && !isLogin) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (ok && isLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  // 排除网关 API、静态资源
  matcher: ["/((?!api|v1|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
