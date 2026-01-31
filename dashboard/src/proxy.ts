import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /api routes (except auth, oauth, and chat files)
  if (pathname.startsWith("/api") && !pathname.startsWith("/api/auth") && !pathname.startsWith("/api/oauth") && !pathname.startsWith("/api/chat/files")) {
    const password = request.headers.get("X-Dashboard-Auth");
    const correctPassword = process.env.DASHBOARD_PASSWORD;

    if (!correctPassword) {
      return NextResponse.json(
        { error: "Password not configured" },
        { status: 500 }
      );
    }

    if (password !== correctPassword) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
