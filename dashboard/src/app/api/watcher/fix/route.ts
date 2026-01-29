import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

const FIX_PROMPT = `You are Vito, Mike's personal AI assistant. The watcher service is having trouble starting. Your job is to diagnose and fix the issue.

## Context
- The watcher is the main orchestration service that handles incoming messages from Telegram, Gmail, and Google Chat
- It runs from: /home/ubuntu/pHouseClawd/core/src/watcher.ts
- Started via: tsx core/src/watcher.ts
- The dashboard is calling you because the user clicked "Emergency Fix" - meaning the watcher won't start

## Diagnostic Steps
1. First, check what's in the watcher logs: /home/ubuntu/pHouseClawd/logs/watcher.log (tail the last 100 lines)
2. Check if any processes are already running that might conflict: pgrep -f "tsx.*watcher"
3. Look for common issues:
   - Missing npm dependencies (npm install not run in core/)
   - TypeScript compilation errors
   - Missing environment variables
   - Port conflicts
   - MCP server startup failures

## Common Fixes
- If missing dependencies: cd /home/ubuntu/pHouseClawd/core && npm install
- If TypeScript errors: Check the specific file mentioned and fix the issue
- If environment issues: Check .env files exist and have required values
- If port conflicts: Kill the conflicting process

## After Fixing
1. Try to start the watcher: cd /home/ubuntu/pHouseClawd && ./watcher-restart.sh
2. Wait 5 seconds, then check if it's running: pgrep -f "tsx.*watcher"
3. Check the logs again to confirm it started successfully

## Output Format
Provide a clear summary of:
1. What was wrong
2. What you did to fix it
3. Whether the watcher is now running

Be concise but thorough. This output will be shown to the user in the dashboard.`;

export async function POST() {
  const projectRoot = getProjectRoot();
  const logsDir = path.join(projectRoot, "logs");
  const fixLogPath = path.join(logsDir, "watcher-fix.log");

  try {
    // Ensure logs directory exists
    await fs.mkdir(logsDir, { recursive: true });

    // Create a timestamp for this fix attempt
    const timestamp = new Date().toISOString();

    // Write initial log entry
    await fs.writeFile(fixLogPath, `[${timestamp}] Starting watcher fix attempt...\n`);

    // Spawn Claude Code in print mode to diagnose and fix
    const child = spawn("claude", [
      "-p", // print mode (non-interactive)
      "--dangerously-skip-permissions", // allow all operations
      "--model", "sonnet", // use sonnet for faster response
      FIX_PROMPT
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        // Ensure Claude has the right environment
        HOME: process.env.HOME || "/home/ubuntu",
        PATH: process.env.PATH,
      },
    });

    let output = "";
    let errorOutput = "";

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    // Wait for the process to complete (with timeout)
    const result = await new Promise<{ success: boolean; output: string; error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve({
          success: false,
          output: output,
          error: "Fix attempt timed out after 5 minutes"
        });
      }, 5 * 60 * 1000); // 5 minute timeout

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({
          success: code === 0,
          output: output,
          error: code !== 0 ? errorOutput || `Process exited with code ${code}` : undefined
        });
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          output: output,
          error: `Failed to spawn Claude: ${err.message}`
        });
      });
    });

    // Write the result to the log file
    const endTimestamp = new Date().toISOString();
    await fs.appendFile(fixLogPath, `[${endTimestamp}] Fix attempt completed.\n\nOutput:\n${result.output}\n`);
    if (result.error) {
      await fs.appendFile(fixLogPath, `\nError:\n${result.error}\n`);
    }

    return NextResponse.json({
      success: result.success,
      message: result.success ? "Fix attempt completed" : "Fix attempt failed",
      output: result.output,
      error: result.error,
      logFile: fixLogPath
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      message: `Failed to start fix: ${error}`,
      error: String(error)
    }, { status: 500 });
  }
}

// Also allow GET to check the status/log of the last fix attempt
export async function GET() {
  const projectRoot = getProjectRoot();
  const fixLogPath = path.join(projectRoot, "logs", "watcher-fix.log");

  try {
    const content = await fs.readFile(fixLogPath, "utf-8");
    return NextResponse.json({
      exists: true,
      content
    });
  } catch {
    return NextResponse.json({
      exists: false,
      content: null
    });
  }
}
