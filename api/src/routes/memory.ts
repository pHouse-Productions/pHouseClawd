import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

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
