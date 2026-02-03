import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

const PROJECT_ROOT = getProjectRoot();
const PID_FILE = path.join(PROJECT_ROOT, "watcher.pid");

interface ProcessStatus {
  running: boolean;
  pid?: number;
}

interface McpStatus {
  total: number;
  healthy: number;
  error: number;
}

function checkWatcherByPidFile(): ProcessStatus {
  try {
    if (!fs.existsSync(PID_FILE)) {
      return { running: false };
    }

    const pidStr = fs.readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return { running: false };
    }

    // Check if the process is actually running
    try {
      // Sending signal 0 checks if process exists without actually sending a signal
      process.kill(pid, 0);
      return { running: true, pid };
    } catch {
      // Process doesn't exist - stale PID file
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

function checkPort(port: number): ProcessStatus {
  try {
    const output = execSync(`fuser ${port}/tcp 2>/dev/null || true`, {
      encoding: "utf-8",
    }).trim();

    if (output) {
      const pid = parseInt(output.split(/\s+/).pop() || "", 10);
      if (!isNaN(pid)) {
        return { running: true, pid };
      }
    }
    return { running: false };
  } catch {
    return { running: false };
  }
}

function getMcpStatus(): McpStatus {
  // Check the MCP gateway health endpoint (single server on port 3000)
  try {
    const output = execSync("curl -s --connect-timeout 2 http://127.0.0.1:3000/health 2>/dev/null || echo '{}'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    const health = JSON.parse(output);
    if (health.status === "ok") {
      // Gateway is healthy - count servers from Claude config
      const claudeConfigPath = path.join(process.env.HOME || "/home/ubuntu", ".claude.json");
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, "utf-8"));
      const mcpServers = config.mcpServers || {};
      // Count HTTP servers pointing to gateway (exclude stdio like playwright)
      const gatewayServers = Object.values(mcpServers).filter(
        (s: any) => s.type === "http" && s.url?.includes("127.0.0.1:3000")
      ).length;
      return { total: gatewayServers, healthy: gatewayServers, error: 0 };
    }
    return { total: 0, healthy: 0, error: 0 };
  } catch {
    return { total: 0, healthy: 0, error: 0 };
  }
}

router.get("/", (_req: Request, res: Response) => {
  // Use PID file for watcher (more reliable than pgrep pattern matching)
  const watcher = checkWatcherByPidFile();
  const dashboard = checkPort(3100); // API server port
  const mcp = getMcpStatus();

  res.json({
    watcher,
    dashboard,
    mcp,
  });
});

export default router;
