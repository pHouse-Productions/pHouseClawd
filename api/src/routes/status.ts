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
  // Lightweight check - just verify ports are in use (servers are listening)
  const MCP_CONFIG_PATH = path.join(process.env.HOME || "/home/ubuntu", "pHouseMcp", "mcp-servers.json");

  try {
    const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8")) as { servers?: Record<string, { port?: number }> };
    const servers = config.servers || {};
    const ports: number[] = [];
    for (const key of Object.keys(servers)) {
      const port = servers[key]?.port;
      if (port) ports.push(port);
    }

    // Check all ports in a single lsof call (faster than per-port checks)
    let healthy = 0;

    try {
      // lsof -i:3001 -i:3002 ... returns lines with port info for ports in use
      const portArgs = ports.map(p => `-i:${p}`).join(" ");
      const output = execSync(`lsof ${portArgs} -P -n 2>/dev/null | grep LISTEN || true`, {
        encoding: "utf-8",
        timeout: 2000,
      }).trim();

      // Count which ports appear in the output
      for (const port of ports) {
        if (output.includes(`:${port}`)) {
          healthy++;
        }
      }
    } catch {
      // If lsof fails entirely, assume all down
    }

    return { total: ports.length, healthy, error: ports.length - healthy };
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
