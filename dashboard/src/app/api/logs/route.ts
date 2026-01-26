import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

const LOGS_DIR = "/home/ubuntu/pHouseClawd/logs";

async function getLogFiles(): Promise<LogFile[]> {
  const files: LogFile[] = [];

  try {
    const entries = await fs.readdir(LOGS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      // Include both .log and .jsonl files
      if (entry.isFile() && (entry.name.endsWith(".log") || entry.name.endsWith(".jsonl"))) {
        const fullPath = path.join(LOGS_DIR, entry.name);
        const stats = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        });
      }
    }
  } catch {
    // Logs directory doesn't exist
  }

  return files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
}

async function getLogContent(filePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.split("\n").filter((l) => l.trim());
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const fileName = searchParams.get("file");

  const logFiles = await getLogFiles();

  if (fileName) {
    const file = logFiles.find((f) => f.name === fileName);
    if (file) {
      const content = await getLogContent(file.path);
      return NextResponse.json({ files: logFiles, content, selectedFile: file.name });
    }
  }

  // Return first file's content by default
  if (logFiles.length > 0) {
    const content = await getLogContent(logFiles[0].path);
    return NextResponse.json({ files: logFiles, content, selectedFile: logFiles[0].name });
  }

  return NextResponse.json({ files: [], content: [], selectedFile: null });
}
