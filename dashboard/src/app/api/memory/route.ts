import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "No path provided" }, { status: 400 });
  }

  // Security: ensure path is within memory directory
  const memoryDir = "/home/ubuntu/pHouseClawd/memory";
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(memoryDir)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const data = await fs.readFile(resolvedPath);
    const ext = path.extname(filePath).toLowerCase();

    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".json": "application/json",
      ".txt": "text/plain",
    };

    const contentType = mimeTypes[ext] || "application/octet-stream";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
