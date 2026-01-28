import { NextResponse } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

interface ProcessStatus {
  running: boolean;
  pid?: number;
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
  const watcher = checkProcess("tsx core/src/watcher.ts");
  const dashboard = checkPort(3000);

  return NextResponse.json({
    watcher,
    dashboard,
  });
}
