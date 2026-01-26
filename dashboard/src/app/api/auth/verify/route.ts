import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const password = request.headers.get("X-Dashboard-Auth");
  const correctPassword = process.env.DASHBOARD_PASSWORD;

  if (!correctPassword) {
    return NextResponse.json(
      { error: "Password not configured" },
      { status: 500 }
    );
  }

  if (password === correctPassword) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
