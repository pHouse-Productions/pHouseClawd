import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

const JOBS_DIR = path.join(getProjectRoot(), "logs", "jobs");

interface JobFile {
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
  events: Array<{
    ts: string;
    type: string;
    [key: string]: unknown;
  }>;
}

interface JobStep {
  ts: string;
  type: "text" | "tool_call" | "tool_result" | "system" | "result" | "error";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
}

interface Job {
  id: string;
  startTime: string;
  endTime?: string;
  channel: string;
  model?: string;
  cost?: number;
  durationMs?: number;
  steps: JobStep[];
  status: "running" | "completed" | "error" | "stopped";
  triggerText?: string;
  fullPrompt?: string;
  toolCount: number;
}

function truncate(str: string, maxLen: number = 200): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

function extractTextFromContent(message: any): string {
  if (!message?.content) return "";
  const textBlocks = message.content.filter((c: any) => c.type === "text");
  return textBlocks.map((c: any) => c.text || "").join("");
}

function extractToolCalls(message: any): Array<{ name: string; input: Record<string, unknown> }> {
  if (!message?.content) return [];
  return message.content
    .filter((c: any) => c.type === "tool_use")
    .map((c: any) => ({ name: c.name || "unknown", input: c.input || {} }));
}

function extractToolResults(message: any): Array<{ toolId: string; content: string; isError: boolean }> {
  if (!message?.content) return [];
  return message.content
    .filter((c: any) => c.type === "tool_result")
    .map((c: any) => {
      let resultContent = "";
      if (typeof c.content === "string") {
        resultContent = c.content;
      } else if (Array.isArray(c.content)) {
        resultContent = c.content.map((item: any) => item.text || "").join("");
      }
      return {
        toolId: c.tool_use_id || "",
        content: resultContent,
        isError: c.is_error || false,
      };
    });
}

async function readJobFile(filePath: string): Promise<JobFile | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildJobFromFile(jobFile: JobFile, truncateContent: boolean): Job {
  const steps: JobStep[] = [];

  // Add trigger as first step
  steps.push({
    ts: jobFile.startTime,
    type: "system",
    content: `Triggered via ${jobFile.channel}: ${truncateContent ? truncate(jobFile.trigger, 200) : jobFile.trigger}`,
  });

  // Process events
  for (const event of jobFile.events) {
    switch (event.type) {
      case "system":
        if (event.subtype === "init") {
          steps.push({
            ts: event.ts,
            type: "system",
            content: `Session started (${event.model || "unknown"})`,
          });
        }
        break;

      case "assistant": {
        const text = extractTextFromContent(event.message);
        const toolCalls = extractToolCalls(event.message);

        if (text) {
          steps.push({
            ts: event.ts,
            type: "text",
            content: truncateContent ? truncate(text, 300) : text,
          });
        }

        for (const tool of toolCalls) {
          steps.push({
            ts: event.ts,
            type: "tool_call",
            content: truncateContent ? truncate(JSON.stringify(tool.input), 200) : JSON.stringify(tool.input, null, 2),
            toolName: tool.name,
            toolInput: tool.input,
          });
        }
        break;
      }

      case "user": {
        const toolResults = extractToolResults(event.message);

        for (const result of toolResults) {
          steps.push({
            ts: event.ts,
            type: "tool_result",
            content: truncateContent ? truncate(result.content, 200) : result.content,
            isError: result.isError,
          });
        }
        break;
      }

      case "result": {
        const costNum = event.total_cost_usd as number | undefined;
        const durationNum = event.duration_ms as number | undefined;
        const costStr = costNum ? `$${costNum.toFixed(4)}` : "";
        const durationStr = durationNum ? `${(durationNum / 1000).toFixed(1)}s` : "";
        steps.push({
          ts: event.ts,
          type: "result",
          content: `Done ${durationStr} ${costStr}`.trim(),
        });
        break;
      }

      case "error":
        steps.push({
          ts: event.ts,
          type: "error",
          content: (event.error as any)?.message || "Unknown error",
          isError: true,
        });
        break;
    }
  }

  return {
    id: jobFile.id,
    startTime: jobFile.startTime,
    endTime: jobFile.endTime,
    channel: jobFile.channel,
    model: jobFile.model,
    cost: jobFile.cost,
    durationMs: jobFile.durationMs,
    steps,
    status: jobFile.status,
    triggerText: truncateContent ? truncate(jobFile.trigger, 100) : jobFile.trigger,
    fullPrompt: truncateContent ? undefined : jobFile.fullPrompt,
    toolCount: jobFile.toolCount,
  };
}

router.get("/", async (req: Request, res: Response) => {
  const limitParam = req.query.limit as string | undefined;
  const offsetParam = req.query.offset as string | undefined;
  const jobIdParam = req.query.job_id as string | undefined;
  const limit = limitParam ? parseInt(limitParam, 10) : 20;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  try {
    // Ensure jobs directory exists
    try {
      await fs.access(JOBS_DIR);
    } catch {
      res.json({ jobs: [], total: 0, hasMore: false });
      return;
    }

    // If requesting a specific job, return just that one with full details
    if (jobIdParam) {
      const jobFile = await readJobFile(path.join(JOBS_DIR, `${jobIdParam}.json`));
      if (!jobFile) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      const job = buildJobFromFile(jobFile, false); // full details
      res.json({ job });
      return;
    }

    // List all job files with their modification times
    const files = await fs.readdir(JOBS_DIR);
    const jsonFiles = files.filter(f => f.endsWith(".json"));

    // Get file stats to sort by mtime (faster than reading/parsing each file)
    const fileStats = await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = path.join(JOBS_DIR, file);
        const stat = await fs.stat(filePath);
        return { file, mtime: stat.mtime.getTime() };
      })
    );

    // Sort by modification time descending (newest first)
    fileStats.sort((a, b) => b.mtime - a.mtime);

    const total = fileStats.length;

    // Only read the files we need for this page
    const pageFiles = fileStats.slice(offset, offset + limit);

    const jobs: Job[] = [];
    for (const { file } of pageFiles) {
      const jobFile = await readJobFile(path.join(JOBS_DIR, file));
      if (jobFile) {
        const job = buildJobFromFile(jobFile, true); // truncated for list
        jobs.push(job);
      }
    }

    // Sort jobs by startTime in case mtime differs from startTime
    jobs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    res.json({
      jobs,
      total,
      hasMore: offset + limit < total,
      offset,
      limit
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read jobs", details: String(err) });
  }
});

// Stop a job
router.post("/:id/stop", async (req: Request, res: Response) => {
  const jobId = req.params.id;

  try {
    // Read the job file to get the PID
    const jobPath = path.join(JOBS_DIR, `${jobId}.json`);

    let jobFile: JobFile;
    try {
      const content = await fs.readFile(jobPath, "utf-8");
      jobFile = JSON.parse(content);
    } catch {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    // Check if job is already stopped/completed
    if (jobFile.status !== "running") {
      res.status(400).json({ error: `Job is already ${jobFile.status}` });
      return;
    }

    // Try to kill by PID
    if (!jobFile.pid) {
      res.status(400).json({ error: "Job has no PID recorded" });
      return;
    }

    try {
      process.kill(jobFile.pid, "SIGTERM");

      // Update job file to stopped status
      const fullJobContent = await fs.readFile(jobPath, "utf-8");
      const fullJob = JSON.parse(fullJobContent);
      fullJob.status = "stopped";
      fullJob.endTime = new Date().toISOString();
      await fs.writeFile(jobPath, JSON.stringify(fullJob, null, 2));

      res.json({ success: true, message: `Job ${jobId} stopped` });
    } catch (killError: any) {
      // ESRCH means process doesn't exist (already finished)
      if (killError.code === "ESRCH") {
        res.status(400).json({ error: "Process not found (may have already finished)" });
        return;
      }
      // EPERM means we don't have permission
      if (killError.code === "EPERM") {
        res.status(403).json({ error: "Permission denied to kill process" });
        return;
      }
      throw killError;
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to stop job", details: String(err) });
  }
});

export default router;
