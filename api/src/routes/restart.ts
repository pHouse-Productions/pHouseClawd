import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

type RestartTarget = "watcher" | "dashboard" | "api" | "all";

const SCRIPTS: Record<RestartTarget, string> = {
  watcher: "watcher-restart.sh",
  dashboard: "dashboard-restart.sh",
  api: "api-restart.sh",
  all: "restart.sh",
};

const MESSAGES: Record<RestartTarget, string> = {
  watcher: "Watcher restart triggered.",
  dashboard: "Dashboard restart triggered.",
  api: "API server restart triggered.",
  all: "Full restart triggered.",
};

router.post("/", async (req: Request, res: Response) => {
  const projectRoot = getProjectRoot();

  // Get target from request body
  let target: RestartTarget = "watcher";
  try {
    const body = req.body;
    if (body.target && ["watcher", "dashboard", "api", "all"].includes(body.target)) {
      target = body.target;
    }
  } catch {
    // Default to watcher if no body
  }

  const scriptName = SCRIPTS[target];
  const restartScript = path.join(projectRoot, scriptName);

  // Check if script exists first
  if (!existsSync(restartScript)) {
    res.status(500).json({ success: false, message: `Script not found: ${restartScript}` });
    return;
  }

  try {
    // Spawn bash explicitly to run the script
    const child = spawn("/bin/bash", [restartScript], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
    });

    // Check for spawn errors
    child.on("error", (err) => {
      console.error("Spawn error:", err);
    });

    // Unref so this process can exit independently
    child.unref();

    res.json({
      success: true,
      target,
      message: MESSAGES[target],
    });
  } catch (error) {
    res.status(500).json({ success: false, message: `Failed to trigger restart: ${error}` });
  }
});

export default router;
