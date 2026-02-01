import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

// List all long-term memory files
router.get("/files", async (_req: Request, res: Response) => {
  try {
    const memoryDir = path.join(getProjectRoot(), "memory", "long-term");
    const files = await fs.readdir(memoryDir);

    const fileList = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map(async (name) => {
          const filePath = path.join(memoryDir, name);
          const stats = await fs.stat(filePath);
          return {
            name,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          };
        })
    );

    // Sort by modified date, newest first
    fileList.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    res.json({ files: fileList });
  } catch {
    res.status(500).json({ error: "Failed to list files" });
  }
});

// Get short-term memory status
router.get("/short-term", async (_req: Request, res: Response) => {
  try {
    const bufferPath = path.join(getProjectRoot(), "memory", "short-term", "buffer.txt");
    const stats = await fs.stat(bufferPath);
    const content = await fs.readFile(bufferPath, "utf-8");

    res.json({
      size: stats.size,
      modified: stats.mtime.toISOString(),
      content,
    });
  } catch {
    res.json({ size: 0, modified: null, content: "" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  const filePath = req.query.path as string | undefined;

  if (!filePath) {
    res.status(400).json({ error: "No path provided" });
    return;
  }

  // Security: ensure path is within memory directory
  const memoryDir = path.join(getProjectRoot(), "memory");
  const resolvedPath = path.resolve(memoryDir, filePath);

  if (!resolvedPath.startsWith(memoryDir)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  try {
    const stats = await fs.stat(resolvedPath);
    const ext = path.extname(filePath).toLowerCase();

    // For images, return binary
    const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    if (imageExts.includes(ext)) {
      const data = await fs.readFile(resolvedPath);
      const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };
      res.set({
        "Content-Type": mimeTypes[ext] || "image/png",
        "Cache-Control": "public, max-age=3600",
      });
      res.send(data);
      return;
    }

    // For text files, return JSON with metadata
    const content = await fs.readFile(resolvedPath, "utf-8");
    res.json({
      content,
      size: stats.size,
      modified: stats.mtime.toISOString(),
    });
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

export default router;
