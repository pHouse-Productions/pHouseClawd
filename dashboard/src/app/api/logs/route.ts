import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

const LOGS_DIR = path.join(getProjectRoot(), "logs");

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

async function getLogContent(filePath: string, lines?: number): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const allLines = content.split("\n").filter((l) => l.trim());
    // If lines param provided, return only the last N lines
    if (lines && lines > 0) {
      return allLines.slice(-lines);
    }
    return allLines;
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const fileName = searchParams.get("file");
  const linesParam = searchParams.get("lines");
  const lines = linesParam ? parseInt(linesParam, 10) : 100; // Default to last 100 lines

  const logFiles = await getLogFiles();

  if (fileName) {
    const file = logFiles.find((f) => f.name === fileName);
    if (file) {
      const content = await getLogContent(file.path, lines);
      return NextResponse.json({ files: logFiles, content, selectedFile: file.name });
    }
  }

  // Return first file's content by default
  if (logFiles.length > 0) {
    const content = await getLogContent(logFiles[0].path, lines);
    return NextResponse.json({ files: logFiles, content, selectedFile: logFiles[0].name });
  }

  return NextResponse.json({ files: [], content: [], selectedFile: null });
}
