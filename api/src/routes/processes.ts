import { Router, Request, Response } from "express";
import { exec, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JOBS_DIR = path.join(__dirname, "../../../logs/jobs");

interface PM2Process {
  pm_id: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
}

// Get list of all PM2 processes
function getPM2Processes(): PM2Process[] {
  try {
    const output = execSync("pm2 jlist", {
      encoding: "utf-8",
      timeout: 5000,
    });

    const processes = JSON.parse(output);
    return processes.map((p: Record<string, unknown>) => ({
      pm_id: p.pm_id as number,
      name: p.name as string,
      status: (p.pm2_env as Record<string, unknown>)?.status as string || "unknown",
      cpu: (p.monit as Record<string, unknown>)?.cpu as number || 0,
      memory: Math.round(((p.monit as Record<string, unknown>)?.memory as number || 0) / 1024 / 1024), // MB
      uptime: (p.pm2_env as Record<string, unknown>)?.pm_uptime as number || 0,
      restarts: (p.pm2_env as Record<string, unknown>)?.restart_time as number || 0,
    }));
  } catch (error) {
    console.error("Failed to get PM2 processes:", error);
    return [];
  }
}

// List all processes
router.get("/", (_req: Request, res: Response) => {
  const processes = getPM2Processes();

  // Group processes
  const core = processes.filter(p => ["watcher", "dashboard-api"].includes(p.name));
  const mcp = processes.filter(p => p.name.startsWith("mcp-"));
  const other = processes.filter(p => !["watcher", "dashboard-api"].includes(p.name) && !p.name.startsWith("mcp-"));

  res.json({
    core,
    mcp,
    other,
    total: processes.length,
    running: processes.filter(p => p.status === "online").length,
  });
});

// Restart a process
router.post("/:name/restart", (req: Request, res: Response) => {
  const { name } = req.params;

  // Safety check - don't allow restarting the dashboard while we're serving from it
  if (name === "dashboard-api") {
    // Still allow it, but warn
    console.log("Warning: Restarting dashboard-api");
  }

  exec(`pm2 restart ${name}`, { timeout: 10000 }, (error, stdout, stderr) => {
    if (error) {
      res.status(500).json({ error: `Failed to restart ${name}`, details: stderr });
    } else {
      res.json({ success: true, message: `Restarted ${name}` });
    }
  });
});

// Stop a process
router.post("/:name/stop", (req: Request, res: Response) => {
  const { name } = req.params;

  // Don't allow stopping dashboard while we're running
  if (name === "dashboard-api") {
    res.status(400).json({ error: "Cannot stop dashboard-api from the dashboard" });
    return;
  }

  exec(`pm2 stop ${name}`, { timeout: 10000 }, (error, stdout, stderr) => {
    if (error) {
      res.status(500).json({ error: `Failed to stop ${name}`, details: stderr });
    } else {
      res.json({ success: true, message: `Stopped ${name}` });
    }
  });
});

// Start a process
router.post("/:name/start", (req: Request, res: Response) => {
  const { name } = req.params;

  exec(`pm2 start ${name}`, { timeout: 10000 }, (error, stdout, stderr) => {
    if (error) {
      res.status(500).json({ error: `Failed to start ${name}`, details: stderr });
    } else {
      res.json({ success: true, message: `Started ${name}` });
    }
  });
});

// Get logs for a process
router.get("/:name/logs", (req: Request, res: Response) => {
  const { name } = req.params;
  const lines = parseInt(req.query.lines as string) || 50;

  try {
    const output = execSync(`pm2 logs ${name} --lines ${lines} --nostream 2>&1`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    res.json({ logs: output });
  } catch (error) {
    res.status(500).json({ error: `Failed to get logs for ${name}` });
  }
});

// Get process counts using actual system processes
interface ProcessCounts {
  claude: number;
  node: number;
}

function getProcessCounts(): ProcessCounts {
  let claudeCount = 0;
  let nodeCount = 0;

  try {
    // Count only actual Claude CLI processes (not bash shells with claude in their path)
    // pgrep -c without -f matches only the process name, not the full command line
    const claudeOutput = execSync("pgrep -xc claude || echo 0", {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    claudeCount = parseInt(claudeOutput) || 0;
  } catch {
    claudeCount = 0;
  }

  try {
    // Count all node processes
    const nodeOutput = execSync("pgrep -c node || echo 0", {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    nodeCount = parseInt(nodeOutput) || 0;
  } catch {
    nodeCount = 0;
  }

  return { claude: claudeCount, node: nodeCount };
}

router.get("/counts", (_req: Request, res: Response) => {
  const counts = getProcessCounts();
  res.json(counts);
});

// Restart all processes in a group
router.post("/group/:group/restart", (req: Request, res: Response) => {
  const { group } = req.params;

  let pattern: string;
  if (group === "core") {
    pattern = "watcher dashboard-api";
  } else if (group === "mcp") {
    pattern = "mcp-*";
  } else {
    res.status(400).json({ error: "Invalid group" });
    return;
  }

  exec(`pm2 restart ${pattern}`, { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      res.status(500).json({ error: `Failed to restart ${group}`, details: stderr });
    } else {
      res.json({ success: true, message: `Restarted ${group}` });
    }
  });
});

export default router;
