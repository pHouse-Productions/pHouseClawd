import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export async function POST() {
  const projectRoot = getProjectRoot();
  const restartScript = path.join(projectRoot, "restart.sh");

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
      message: "Restart triggered. The dashboard will be unavailable briefly."
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: `Failed to trigger restart: ${error}` },
      { status: 500 }
    );
  }
}
