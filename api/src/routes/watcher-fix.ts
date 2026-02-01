import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import fs from "fs/promises";
import * as syncFs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getProjectRoot } from "../utils.js";

const router = Router();

const JOBS_DIR = path.join(getProjectRoot(), "logs", "jobs");

interface JobData {
  id: string;
  startTime: string;
  endTime?: string;
  channel: string;
  trigger: string;
  fullPrompt?: string;
  status: "running" | "completed" | "error" | "stopped";
  pid?: number;
  model?: string;
  cost?: number;
  durationMs?: number;
  toolCount: number;
  events: any[];
}

function generateJobId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const uuid = randomUUID().slice(0, 8);
  return `${timestamp}-${uuid}`;
}

function getJobFilePath(jobId: string): string {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

function createJobFile(jobId: string, channel: string, trigger: string, pid?: number, fullPrompt?: string): void {
  const jobData: JobData = {
    id: jobId,
    startTime: new Date().toISOString(),
    channel,
    trigger,
    fullPrompt,
    status: "running",
    pid,
    toolCount: 0,
    events: [],
  };
  syncFs.writeFileSync(getJobFilePath(jobId), JSON.stringify(jobData, null, 2));
}

function appendJobEvent(jobId: string, event: any): void {
  const filePath = getJobFilePath(jobId);
  try {
    const jobData: JobData = JSON.parse(syncFs.readFileSync(filePath, "utf-8"));
    const eventWithTs = { ts: new Date().toISOString(), ...event };
    jobData.events.push(eventWithTs);

    // Count tool uses
    if (event.type === "assistant" && event.message?.content) {
      const toolUses = event.message.content.filter((c: any) => c.type === "tool_use");
      jobData.toolCount += toolUses.length;
    }

    // Capture model from init
    if (event.type === "system" && event.subtype === "init" && event.model) {
      jobData.model = event.model;
    }

    syncFs.writeFileSync(filePath, JSON.stringify(jobData, null, 2));
  } catch (err) {
    console.error(`[Fix] Error appending event to ${jobId}: ${err}`);
  }
}

function finalizeJob(jobId: string, status: "completed" | "error" | "stopped", cost?: number, durationMs?: number): void {
  const filePath = getJobFilePath(jobId);
  try {
    const jobData: JobData = JSON.parse(syncFs.readFileSync(filePath, "utf-8"));
    jobData.status = status;
    jobData.endTime = new Date().toISOString();
    if (cost !== undefined) jobData.cost = cost;
    if (durationMs !== undefined) jobData.durationMs = durationMs;
    syncFs.writeFileSync(filePath, JSON.stringify(jobData, null, 2));
  } catch (err) {
    console.error(`[Fix] Error finalizing ${jobId}: ${err}`);
  }
}

const FIX_PROMPT = `The watcher service is having trouble starting. Your job is to diagnose and fix the issue.

## Context
- The watcher is the main orchestration service that handles incoming messages from various channels (Telegram, Gmail, Google Chat, etc.)
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

router.post("/", async (_req: Request, res: Response) => {
  const projectRoot = getProjectRoot();
  const startTime = Date.now();

  try {
    // Ensure jobs directory exists
    await fs.mkdir(JOBS_DIR, { recursive: true });

    // Generate job ID and create job file (same format as watcher)
    const jobId = generateJobId();

    // Spawn Claude Code in print mode with JSON output
    const proc = spawn("claude", [
      "-p", // print mode (non-interactive)
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--model", "sonnet",
      FIX_PROMPT,
    ], {
      cwd: projectRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Create job file after we have the PID
    createJobFile(jobId, "dashboard-fix", "Emergency watcher fix triggered via dashboard", proc.pid, FIX_PROMPT);

    let finalOutput = "";
    let lineBuffer = "";

    proc.stdout?.on("data", (data) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          appendJobEvent(jobId, event);

          // Extract text output for response
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                finalOutput += block.text;
              }
            }
          }
        } catch {
          // Not JSON, just append as text
          finalOutput += line + "\n";
        }
      }
    });

    proc.stderr?.on("data", (data) => {
      // Log stderr but don't fail
      console.error(`[Fix] stderr: ${data.toString()}`);
    });

    // Wait for completion with timeout
    const result = await new Promise<{ success: boolean; output: string; error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill();
        finalizeJob(jobId, "stopped", undefined, Date.now() - startTime);
        resolve({
          success: false,
          output: finalOutput,
          error: "Fix attempt timed out after 5 minutes"
        });
      }, 5 * 60 * 1000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - startTime;
        const status = code === 0 ? "completed" : "error";
        finalizeJob(jobId, status, undefined, durationMs);
        resolve({
          success: code === 0,
          output: finalOutput,
          error: code !== 0 ? `Process exited with code ${code}` : undefined
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        finalizeJob(jobId, "error", undefined, Date.now() - startTime);
        resolve({
          success: false,
          output: finalOutput,
          error: `Failed to spawn Claude: ${err.message}`
        });
      });
    });

    res.json({
      success: result.success,
      message: result.success ? "Fix attempt completed" : "Fix attempt failed",
      output: result.output,
      error: result.error,
      jobId,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Failed to start fix: ${error}`,
      error: String(error)
    });
  }
});

// GET endpoint to check the status of the last fix attempt
router.get("/", async (_req: Request, res: Response) => {
  try {
    const files = await fs.readdir(JOBS_DIR);
    const fixJobs = files
      .filter(f => f.endsWith(".json"))
      .map(f => ({ name: f, path: path.join(JOBS_DIR, f) }));

    // Find most recent fix job
    let latestFixJob: JobData | null = null;
    for (const { path: filePath } of fixJobs) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const job: JobData = JSON.parse(content);
        if (job.channel === "dashboard-fix") {
          if (!latestFixJob || new Date(job.startTime) > new Date(latestFixJob.startTime)) {
            latestFixJob = job;
          }
        }
      } catch {
        continue;
      }
    }

    if (!latestFixJob) {
      res.json({
        exists: false,
        content: null
      });
      return;
    }

    res.json({
      exists: true,
      job: latestFixJob
    });
  } catch {
    res.json({
      exists: false,
      content: null
    });
  }
});

export default router;
