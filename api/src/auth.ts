import { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs/promises";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const ENV_FILE = path.join(PROJECT_ROOT, "api/.env.local");

let cachedPassword: string | null = null;

async function loadPassword(): Promise<string | null> {
  if (cachedPassword) return cachedPassword;

  try {
    const content = await fs.readFile(ENV_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DASHBOARD_PASSWORD=")) {
        cachedPassword = trimmed.slice("DASHBOARD_PASSWORD=".length);
        return cachedPassword;
      }
    }
  } catch {
    // File doesn't exist
  }

  // Fallback to environment variable
  cachedPassword = process.env.DASHBOARD_PASSWORD || null;
  return cachedPassword;
}

export function clearPasswordCache(): void {
  cachedPassword = null;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const password = await loadPassword();

  if (!password) {
    res.status(500).json({ error: "Password not configured" });
    return;
  }

  const authHeader = req.headers["x-dashboard-auth"];

  if (authHeader === password) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

export async function verifyAuth(req: Request, res: Response): Promise<void> {
  const password = await loadPassword();

  if (!password) {
    res.status(500).json({ error: "Password not configured" });
    return;
  }

  const authHeader = req.headers["x-dashboard-auth"];

  if (authHeader === password) {
    res.json({ ok: true });
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}
