import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

type RestartTarget = "watcher" | "dashboard" | "all";

const SCRIPTS: Record<RestartTarget, string> = {
  watcher: "watcher-restart.sh",
  dashboard: "dashboard-restart.sh",
  all: "restart.sh",
};

const MESSAGES: Record<RestartTarget, string> = {
  watcher: "Watcher restart triggered.",
  dashboard: "Dashboard restart triggered. The page will be unavailable briefly.",
  all: "Full restart triggered. The dashboard will be unavailable briefly.",
};

export async function POST(request: Request) {
  const projectRoot = getProjectRoot();

  // Get target from request body
  let target: RestartTarget = "watcher";
  try {
    const body = await request.json();
    if (body.target && ["watcher", "dashboard", "all"].includes(body.target)) {
      target = body.target;
    }
  } catch {
    // Default to watcher if no body
  }

  const scriptName = SCRIPTS[target];
  const restartScript = path.join(projectRoot, scriptName);

  // Check if script exists first
  if (!existsSync(restartScript)) {
    return NextResponse.json(
      { success: false, message: `Script not found: ${restartScript}` },
      { status: 500 }
    );
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

    return NextResponse.json({
      success: true,
      target,
      message: MESSAGES[target],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: `Failed to trigger restart: ${error}` },
      { status: 500 }
    );
  }
}
