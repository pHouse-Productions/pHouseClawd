import { promises as fs } from "fs";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

const FILES_DIR = path.join(getProjectRoot(), "memory", "dashboard", "files");

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  // Documents
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  // Office
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Default
  bin: "application/octet-stream",
};

function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "bin";
  return MIME_TYPES[ext] || "application/octet-stream";
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "Path is required" }, { status: 400 });
  }

  // Security: Ensure the path is within the allowed directory
  const normalizedPath = path.normalize(filePath);
  const normalizedFilesDir = path.normalize(FILES_DIR);

  // Log for debugging
  console.log("[files API] Request path:", filePath);
  console.log("[files API] Normalized path:", normalizedPath);
  console.log("[files API] FILES_DIR:", normalizedFilesDir);

  if (!normalizedPath.startsWith(normalizedFilesDir)) {
    console.log("[files API] Access denied - path not in FILES_DIR");
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const data = await fs.readFile(normalizedPath);
    const mimeType = getMimeType(normalizedPath);

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000", // Cache for 1 year
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}
