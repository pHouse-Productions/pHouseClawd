import { NextResponse } from "next/server";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const PID_FILE = path.join(PROJECT_ROOT, "watcher.pid");

interface ProcessStatus {
  running: boolean;
  pid?: number;
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

function checkProcess(pattern: string): ProcessStatus {
  try {
    const output = execSync(`pgrep -f "${pattern}" 2>/dev/null || true`, {
      encoding: "utf-8",
    }).trim();

    if (output) {
      const pids = output.split("\n").map(p => parseInt(p, 10)).filter(p => !isNaN(p));
      if (pids.length > 0) {
        return { running: true, pid: pids[0] };
      }
    }
    return { running: false };
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

export async function GET() {
  // Use PID file for watcher (more reliable than pgrep pattern matching)
  const watcher = checkWatcherByPidFile();
  const dashboard = checkPort(3000);

  return NextResponse.json({
    watcher,
    dashboard,
  });
}
