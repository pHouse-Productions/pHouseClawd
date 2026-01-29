import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limitParam = searchParams.get("limit");
  const jobIdParam = searchParams.get("job_id");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  try {
    // Ensure jobs directory exists
    try {
      await fs.access(JOBS_DIR);
    } catch {
      return NextResponse.json({ jobs: [], total: 0 });
    }

    // If requesting a specific job, return just that one with full details
    if (jobIdParam) {
      const jobFile = await readJobFile(path.join(JOBS_DIR, `${jobIdParam}.json`));
      if (!jobFile) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      const job = buildJobFromFile(jobFile, false); // full details
      return NextResponse.json({ job });
    }

    // List all job files
    const files = await fs.readdir(JOBS_DIR);
    const jsonFiles = files.filter(f => f.endsWith(".json"));

    // Read all job files and build job list
    const jobs: Job[] = [];
    for (const file of jsonFiles) {
      const jobFile = await readJobFile(path.join(JOBS_DIR, file));
      if (jobFile) {
        const job = buildJobFromFile(jobFile, true); // truncated for list
        jobs.push(job);
      }
    }

    // Sort by start time descending (newest first) and limit
    jobs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const limitedJobs = jobs.slice(0, limit);

    return NextResponse.json({ jobs: limitedJobs, total: jobs.length });
  } catch (err) {
    return NextResponse.json({ error: "Failed to read jobs", details: String(err) }, { status: 500 });
  }
}
