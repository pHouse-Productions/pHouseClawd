import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

const LOGS_DIR = path.join(getProjectRoot(), "logs");

interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

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

router.get("/", async (req: Request, res: Response) => {
  const fileName = req.query.file as string | undefined;
  const linesParam = req.query.lines as string | undefined;
  const lines = linesParam ? parseInt(linesParam, 10) : 100;

  const logFiles = await getLogFiles();

  if (fileName) {
    const file = logFiles.find((f) => f.name === fileName);
    if (file) {
      const content = await getLogContent(file.path, lines);
      res.json({ files: logFiles, content, selectedFile: file.name });
      return;
    }
  }

  // Return first file's content by default
  if (logFiles.length > 0) {
    const content = await getLogContent(logFiles[0].path, lines);
    res.json({ files: logFiles, content, selectedFile: logFiles[0].name });
    return;
  }

  res.json({ files: [], content: [], selectedFile: null });
});

export default router;
