import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

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

router.get("/", async (req: Request, res: Response) => {
  const filePath = req.query.path as string | undefined;

  if (!filePath) {
    res.status(400).json({ error: "Path is required" });
    return;
  }

  // Security: Ensure the path is within the allowed directory
  const normalizedPath = path.normalize(filePath);
  const normalizedFilesDir = path.normalize(FILES_DIR);

  if (!normalizedPath.startsWith(normalizedFilesDir)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  try {
    const data = await fs.readFile(normalizedPath);
    const mimeType = getMimeType(normalizedPath);

    res.set({
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=31536000", // Cache for 1 year
    });
    res.send(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.status(500).json({ error: "Failed to read file" });
  }
});

export default router;
