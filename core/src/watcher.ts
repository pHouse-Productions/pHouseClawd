import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import cron from "node-cron";
import {
  ChannelDefinition,
  ChannelEvent,
  ChannelEventHandler,
  ConcurrencyMode,
} from "./channels/index.js";
import { TelegramChannel } from "./channels/telegram.js";
import { EmailChannel } from "./channels/email.js";
import { GChatChannel } from "./channels/gchat.js";
import { DiscordChannel } from "./channels/discord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

// Load environment variables from sibling pHouseMcp directory
config({ path: path.resolve(PROJECT_ROOT, "../pHouseMcp/.env") });

// Generate a deterministic UUID v5 from a namespace + name
const NAMESPACE_UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
function generateSessionId(name: string): string {
  const hash = crypto.createHash("sha1");
  const namespaceBytes = Buffer.from(NAMESPACE_UUID.replace(/-/g, ""), "hex");
  hash.update(namespaceBytes);
  hash.update(name);
  const digest = hash.digest();

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  const hex = digest.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const PDF_SCRIPT = path.join(PROJECT_ROOT, "scripts/pdf-to-text.py");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const JOBS_DIR = path.join(LOGS_DIR, "jobs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");
const SESSIONS_FILE = path.join(LOGS_DIR, "sessions.json");
const CRON_CONFIG_FILE = path.join(PROJECT_ROOT, "config/cron.json");
const PID_FILE = path.join(PROJECT_ROOT, "watcher.pid");

// Ensure jobs directory exists
if (!fs.existsSync(JOBS_DIR)) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

// Short-term memory
const SHORT_TERM_MEMORY_DIR = path.join(PROJECT_ROOT, "memory/short-term");
const SHORT_TERM_MEMORY_FILE = path.join(SHORT_TERM_MEMORY_DIR, "buffer.txt");
const SHORT_TERM_SIZE_THRESHOLD = 100 * 1024; // 100KB
const SHORT_TERM_RETAIN_RATIO = 0.25; // Keep 25% of buffer after rollup

// Ensure short-term memory directory exists
if (!fs.existsSync(SHORT_TERM_MEMORY_DIR)) {
  fs.mkdirSync(SHORT_TERM_MEMORY_DIR, { recursive: true });
}

// Channel config
const CHANNELS_CONFIG_FILE = path.join(PROJECT_ROOT, "config/channels.json");

// Channel config types
interface ChannelConfig {
  enabled: boolean;
}

interface ChannelsConfig {
  channels: Record<string, ChannelConfig>;
}

function loadChannelsConfig(): ChannelsConfig {
  try {
    if (fs.existsSync(CHANNELS_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CHANNELS_CONFIG_FILE, "utf-8"));
    }
  } catch (err) {
    log(`[Channels] Failed to load channels config: ${err}`);
  }
  // Default: all channels enabled if no config exists
  return {
    channels: {
      telegram: { enabled: true },
      email: { enabled: true },
      gchat: { enabled: true },
      discord: { enabled: false },
    }
  };
}

// Cron job interface
interface CronJob {
  id: string;
  enabled: boolean;
  schedule: string;
  description: string;
  prompt: string;
  run_once?: boolean;
  run_at?: string;
}

interface CronConfig {
  jobs: CronJob[];
}

// Track active cron tasks and one-off timeouts
const activeCronTasks: Map<string, cron.ScheduledTask> = new Map();
const activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Session management
type MemoryMode = "session" | "transcript";
type QueueMode = "queue" | "interrupt";
type ResponseStyle = "streaming" | "bundled" | "final";

interface SessionData {
  known: string[];
  generations: Record<string, number>;
  modes: Record<string, MemoryMode>; // Per-channel memory mode (session vs transcript)
  queueModes: Record<string, QueueMode>; // Per-channel queue mode (queue vs interrupt)
  transcriptLines: Record<string, number>; // Per-channel transcript context lines
  responseStyles: Record<string, ResponseStyle>; // Per-channel response style (streaming, bundled, final)
}

function loadSessionData(): SessionData {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      if (Array.isArray(data)) {
        return { known: data, generations: {}, modes: {}, queueModes: {}, transcriptLines: {}, responseStyles: {} };
      }
      return {
        ...data,
        modes: data.modes || {},
        queueModes: data.queueModes || {},
        transcriptLines: data.transcriptLines || {},
        responseStyles: data.responseStyles || {},
      };
    }
  } catch {}
  return { known: [], generations: {}, modes: {}, queueModes: {}, transcriptLines: {}, responseStyles: {} };
}

// Get base channel name for settings fallback (e.g., "email-abc123" -> "email")
function getBaseChannelName(sessionKey: string): string | null {
  const match = sessionKey.match(/^(telegram|email|gchat|discord)-/);
  return match ? match[1] : null;
}

function getMemoryMode(sessionKey: string): MemoryMode {
  const data = loadSessionData();
  // Try exact key first, then fall back to base channel
  if (data.modes[sessionKey]) {
    return data.modes[sessionKey];
  }
  const baseChannel = getBaseChannelName(sessionKey);
  if (baseChannel && data.modes[baseChannel]) {
    return data.modes[baseChannel];
  }
  return "session"; // Default to session mode
}

function setMemoryMode(sessionKey: string, mode: MemoryMode): void {
  const data = loadSessionData();
  data.modes[sessionKey] = mode;
  saveSessionData(data);
}

function getQueueMode(sessionKey: string): QueueMode {
  const data = loadSessionData();
  // Try exact key first, then fall back to base channel
  if (data.queueModes[sessionKey]) {
    return data.queueModes[sessionKey];
  }
  const baseChannel = getBaseChannelName(sessionKey);
  if (baseChannel && data.queueModes[baseChannel]) {
    return data.queueModes[baseChannel];
  }
  return "queue"; // Default to queue mode
}

function setQueueMode(sessionKey: string, mode: QueueMode): void {
  const data = loadSessionData();
  data.queueModes[sessionKey] = mode;
  saveSessionData(data);
}

const DEFAULT_TRANSCRIPT_LINES = 100;

function getTranscriptLines(sessionKey: string): number {
  const data = loadSessionData();
  // Try exact key first, then fall back to base channel
  if (data.transcriptLines[sessionKey]) {
    return data.transcriptLines[sessionKey];
  }
  const baseChannel = getBaseChannelName(sessionKey);
  if (baseChannel && data.transcriptLines[baseChannel]) {
    return data.transcriptLines[baseChannel];
  }
  return DEFAULT_TRANSCRIPT_LINES;
}

function setTranscriptLines(sessionKey: string, lines: number): void {
  const data = loadSessionData();
  data.transcriptLines[sessionKey] = lines;
  saveSessionData(data);
}

// Default response styles per channel type
const DEFAULT_RESPONSE_STYLES: Record<string, ResponseStyle> = {
  telegram: "streaming",
  gchat: "streaming",
  discord: "streaming",
  email: "final",
};

function getResponseStyle(sessionKey: string): ResponseStyle {
  const data = loadSessionData();
  // Try exact key first, then fall back to base channel
  if (data.responseStyles[sessionKey]) {
    return data.responseStyles[sessionKey];
  }
  const baseChannel = getBaseChannelName(sessionKey);
  if (baseChannel && data.responseStyles[baseChannel]) {
    return data.responseStyles[baseChannel];
  }
  // Return channel-specific default
  if (baseChannel && DEFAULT_RESPONSE_STYLES[baseChannel]) {
    return DEFAULT_RESPONSE_STYLES[baseChannel];
  }
  return "streaming"; // Fallback default
}

function setResponseStyle(sessionKey: string, style: ResponseStyle): void {
  const data = loadSessionData();
  data.responseStyles[sessionKey] = style;
  saveSessionData(data);
}

function saveSessionData(data: SessionData): void {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

function getKnownSessions(): Set<string> {
  return new Set(loadSessionData().known);
}

function markSessionKnown(sessionId: string): void {
  const data = loadSessionData();
  if (!data.known.includes(sessionId)) {
    data.known.push(sessionId);
  }
  saveSessionData(data);
}

function clearSession(sessionKey: string): void {
  const data = loadSessionData();
  const currentGen = data.generations[sessionKey] || 0;
  const oldSessionId = generateSessionId(`${sessionKey}-gen${currentGen}`);
  data.known = data.known.filter(id => id !== oldSessionId);
  data.generations[sessionKey] = currentGen + 1;
  saveSessionData(data);
}

function getSessionGeneration(sessionKey: string): number {
  return loadSessionData().generations[sessionKey] || 0;
}

// Concurrency tracking
const activeSessions: Set<string> = new Set();
// Track which job ID currently owns each session lock
const sessionOwners: Map<string, string> = new Map();
const globalLocks: Map<string, boolean> = new Map();
const eventQueues: Map<string, ChannelEvent[]> = new Map();
// Mutex locks to prevent race conditions when checking/modifying activeSessions
const sessionMutexes: Map<string, Promise<void>> = new Map();

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

// Job file management
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

// Track running Claude processes for kill capability
const runningJobs: Map<string, ChildProcess> = new Map();
// Track which session each job belongs to (for interrupt mode)
const jobToSession: Map<string, string> = new Map();

function generateJobId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const uuid = crypto.randomUUID().slice(0, 8);
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
  fs.writeFileSync(getJobFilePath(jobId), JSON.stringify(jobData, null, 2));
}

function appendJobEvent(jobId: string, event: any): void {
  const filePath = getJobFilePath(jobId);
  try {
    const jobData: JobData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
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

    fs.writeFileSync(filePath, JSON.stringify(jobData, null, 2));
  } catch (err) {
    log(`[Jobs] Error appending event to ${jobId}: ${err}`);
  }
}

function finalizeJob(jobId: string, status: "completed" | "error" | "stopped", cost?: number, durationMs?: number): void {
  const filePath = getJobFilePath(jobId);
  try {
    const jobData: JobData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    jobData.status = status;
    jobData.endTime = new Date().toISOString();
    if (cost !== undefined) jobData.cost = cost;
    if (durationMs !== undefined) jobData.durationMs = durationMs;
    fs.writeFileSync(filePath, JSON.stringify(jobData, null, 2));
  } catch (err) {
    log(`[Jobs] Error finalizing ${jobId}: ${err}`);
  }
  // Clean up from running jobs map and session tracking
  runningJobs.delete(jobId);
  jobToSession.delete(jobId);
}

// Kill a running job by ID
function killJob(jobId: string): boolean {
  // Try in-memory process first (preferred)
  const proc = runningJobs.get(jobId);
  if (proc) {
    log(`[Jobs] Killing job ${jobId} via in-memory process reference`);
    proc.kill("SIGTERM");
    finalizeJob(jobId, "stopped");
    return true;
  }

  // Fallback: try to kill by PID from job file
  const filePath = getJobFilePath(jobId);
  try {
    if (fs.existsSync(filePath)) {
      const jobData: JobData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (jobData.status === "running" && jobData.pid) {
        log(`[Jobs] Killing job ${jobId} via PID ${jobData.pid} (fallback)`);
        process.kill(jobData.pid, "SIGTERM");
        finalizeJob(jobId, "stopped");
        return true;
      }
    }
  } catch (err) {
    log(`[Jobs] Error killing job ${jobId}: ${err}`);
  }
  return false;
}

// Get the currently running job ID (if any)
function getRunningJobId(): string | null {
  for (const [jobId] of runningJobs) {
    return jobId;
  }
  return null;
}

// Get the running job ID for a specific session (for interrupt mode)
function getRunningJobForSession(sessionKey: string): string | null {
  for (const [jobId, sessKey] of jobToSession) {
    if (sessKey === sessionKey && runningJobs.has(jobId)) {
      return jobId;
    }
  }
  return null;
}

// Export for API access
export { killJob, getRunningJobId };

// Short-term memory logging
function getTorontoTimestamp(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function logToShortTermMemory(channel: string, direction: "in" | "out", content: string): void {
  const timestamp = getTorontoTimestamp();
  const line = `[${timestamp}] [${channel}] [${direction}] ${content}\n`;
  fs.appendFileSync(SHORT_TERM_MEMORY_FILE, line);
}

function getShortTermMemorySize(): number {
  try {
    if (fs.existsSync(SHORT_TERM_MEMORY_FILE)) {
      return fs.statSync(SHORT_TERM_MEMORY_FILE).size;
    }
  } catch {}
  return 0;
}

// Get recent messages from short-term memory for transcript mode injection
const LONG_TERM_MEMORY_DIR = path.join(PROJECT_ROOT, "memory/long-term");

function getMemoryFilesInfo(): string {
  try {
    const files: string[] = [];
    if (fs.existsSync(LONG_TERM_MEMORY_DIR)) {
      for (const file of fs.readdirSync(LONG_TERM_MEMORY_DIR)) {
        if (file.endsWith(".md")) {
          files.push(file);
        }
      }
    }
    if (files.length === 0) {
      return "";
    }
    return `## Memory Available
**Long-term memory files:** ${files.join(", ")}
Use the \`recall\` MCP tool to read any of these (e.g., \`recall(file="journal.md")\`).

**Short-term memory:** More conversation history is available in the buffer.
Use \`read_short_term\` to see it, or \`search_memory\` to search across all memory.

`;
  } catch {
    return "";
  }
}

function getRecentTranscriptContext(sessionKey?: string): string {
  try {
    const memoryInfo = getMemoryFilesInfo();
    const contextLines = sessionKey ? getTranscriptLines(sessionKey) : DEFAULT_TRANSCRIPT_LINES;

    if (!fs.existsSync(SHORT_TERM_MEMORY_FILE)) {
      return memoryInfo ? `\n\n${memoryInfo}` : "";
    }
    const content = fs.readFileSync(SHORT_TERM_MEMORY_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(l => l.trim());
    const recentLines = lines.slice(-contextLines);
    if (recentLines.length === 0) {
      return memoryInfo ? `\n\n${memoryInfo}` : "";
    }
    return `\n\n${memoryInfo}--- RECENT CONVERSATION HISTORY (from all channels) ---\n${recentLines.join("\n")}\n--- END HISTORY ---\n\n`;
  } catch {
    return "";
  }
}

// Track if rollup is in progress to avoid concurrent rollups
let rollupInProgress = false;

async function checkAndTriggerRollup(): Promise<void> {
  const size = getShortTermMemorySize();
  if (size < SHORT_TERM_SIZE_THRESHOLD) {
    return;
  }

  if (rollupInProgress) {
    log(`[Memory] Rollup already in progress, skipping.`);
    return;
  }

  log(`[Memory] Short-term memory at ${size} bytes (threshold: ${SHORT_TERM_SIZE_THRESHOLD}). Triggering auto-rollup...`);
  rollupInProgress = true;

  try {
    await performRollup();
    log(`[Memory] Auto-rollup completed successfully.`);
  } catch (err) {
    log(`[Memory] Auto-rollup failed: ${err}`);
  } finally {
    rollupInProgress = false;
  }
}

async function performRollup(): Promise<void> {
  // Read the short-term buffer
  const shortTermContent = fs.readFileSync(SHORT_TERM_MEMORY_FILE, "utf-8");
  if (!shortTermContent.trim()) {
    log(`[Memory] Short-term buffer is empty, nothing to roll up.`);
    return;
  }

  const lines = shortTermContent.trim().split("\n");
  const totalLines = lines.length;
  const bufferSizeKB = Math.round(shortTermContent.length / 1024);

  const rollupPrompt = `You need to perform a memory rollup. Here is the short-term memory buffer containing recent conversations:

---
${shortTermContent}
---

CRITICAL: This is a CONSOLIDATION task, not an append task. You must:

1. First use 'recall' (no args) to see all existing long-term memory files
2. For each relevant file (journal.md, projects.md, etc.), use 'recall' to read its CURRENT content
3. Identify NEW information from the buffer that isn't already captured
4. REWRITE each file with the updated/consolidated content using 'remember' with mode='replace'

RULES:
- DO NOT just append to files - that creates redundancy
- MERGE new info into existing sections where relevant
- REMOVE redundant/duplicate information
- Keep files well-organized with clear sections
- For journal.md: Summarize older entries, keep recent ones detailed
- For projects.md: Update status, don't duplicate what's already there
- Be VERY selective - only save info useful for future recall

Example workflow:
1. recall() → see files exist
2. recall(file="journal.md") → read current content
3. Identify what's NEW in the buffer vs what's already in journal.md
4. remember(file="journal.md", content="[consolidated content]", mode="replace")
5. Repeat for other files as needed

Do NOT call any tools to trim or clear the buffer - the watcher handles that.`;

  // Create a job file so this shows in the dashboard
  const jobId = generateJobId();

  return new Promise((resolve, reject) => {
    log(`[Memory] Starting rollup job ${jobId} (buffer: ${bufferSizeKB}KB, ${totalLines} lines)`);

    const proc = spawn(
      "claude",
      [
        "-p",
        "--verbose",
        "--output-format", "stream-json",
        "--dangerously-skip-permissions",
        rollupPrompt
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Track in job system
    createJobFile(jobId, "memory-rollup", `[Auto-Rollup] Buffer at ${bufferSizeKB}KB (${totalLines} lines)`, proc.pid, rollupPrompt);
    runningJobs.set(jobId, proc);

    let stderr = "";
    let lineBuffer = "";
    let lastCost: number | undefined;
    let lastDurationMs: number | undefined;

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      lineBuffer += chunk;

      const outputLines = lineBuffer.split("\n");
      lineBuffer = outputLines.pop() || "";

      for (const line of outputLines) {
        if (!line.trim()) continue;
        try {
          const streamEvent = JSON.parse(line);
          appendJobEvent(jobId, streamEvent);

          // Capture cost/duration from result events
          if (streamEvent.type === "result") {
            lastCost = streamEvent.total_cost_usd;
            lastDurationMs = streamEvent.duration_ms;
          }
        } catch {}
      }
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code, signal) => {
      const wasKilled = signal === "SIGTERM" || signal === "SIGKILL";
      const status = wasKilled ? "stopped" : (code === 0 ? "completed" : "error");
      finalizeJob(jobId, status, lastCost, lastDurationMs);

      if (code === 0) {
        // Trim buffer to keep only the most recent 25%
        const linesToKeep = Math.ceil(totalLines * SHORT_TERM_RETAIN_RATIO);
        const retainedLines = lines.slice(-linesToKeep);
        fs.writeFileSync(SHORT_TERM_MEMORY_FILE, retainedLines.join("\n") + "\n");
        log(`[Memory] Rollup job ${jobId} completed. Trimmed buffer from ${totalLines} to ${linesToKeep} lines (kept ${Math.round(SHORT_TERM_RETAIN_RATIO * 100)}%)`);
        resolve();
      } else {
        reject(new Error(`Rollup process exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      finalizeJob(jobId, "error");
      reject(err);
    });
  });
}

// Extract text from stream event for logging (always at streaming level)
function extractTextFromStreamEvent(event: any): string | null {
  switch (event.type) {
    case "assistant":
      if (event.message?.content) {
        const text = event.message.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("");
        if (text) return text;
      }
      break;

    case "content_block_delta":
      if (event.delta?.type === "text_delta") {
        return event.delta.text;
      }
      break;

    case "content_block_start":
      if (event.content_block?.type === "tool_use") {
        return `[Using ${event.content_block.name}...]`;
      }
      break;
  }
  return null;
}

// Convert PDF to markdown text file using PyMuPDF
async function convertPdfToText(pdfPath: string): Promise<string> {
  const outputPath = pdfPath.replace(/\.pdf$/i, ".md");

  return new Promise((resolve, reject) => {
    const proc = spawn("uvx", ["--from", "pymupdf", "python3", PDF_SCRIPT, pdfPath, outputPath], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        log(`[PDF] Converted ${pdfPath} -> ${stdout.trim()}`);
        resolve(stdout.trim());
      } else {
        log(`[PDF] Failed to convert ${pdfPath}: ${stderr}`);
        reject(new Error(stderr || "PDF conversion failed"));
      }
    });

    proc.on("error", (err) => {
      log(`[PDF] Spawn error: ${err.message}`);
      reject(err);
    });
  });
}

// Handle a single channel event
async function handleChannelEvent(
  channel: ChannelDefinition,
  event: ChannelEvent
): Promise<void> {
  const { sessionKey, prompt, payload } = event;

  log(`[Watcher] Processing event from ${channel.name}: ${sessionKey}`);
  log(`[Watcher] Prompt: ${prompt.slice(0, 100)}...`);

  // Log incoming event to short-term memory
  // Format depends on channel type
  let incomingContent = "";
  if (channel.name === "telegram") {
    const from = payload.from || "Unknown";
    if (payload.type === "message") {
      incomingContent = `${from}: ${payload.text}`;
    } else if (payload.type === "photo") {
      incomingContent = `${from}: [Photo] ${payload.caption || ""}`;
    } else if (payload.type === "document") {
      incomingContent = `${from}: [Document: ${payload.file_name}] ${payload.caption || ""}`;
    }
  } else if (channel.name === "email") {
    incomingContent = `From: ${payload.from}\nSubject: ${payload.subject}\n\n${payload.body}`;
  } else if (channel.name === "gchat") {
    const from = payload.sender_name || "Unknown";
    incomingContent = `${from}: ${payload.text}`;
  } else if (channel.name === "discord") {
    const from = payload.from || "Unknown";
    incomingContent = `${from}: ${payload.text}`;
  }

  if (incomingContent) {
    logToShortTermMemory(channel.name, "in", incomingContent);
  }

  // Handle special commands for interactive channels (telegram, gchat)
  if ((channel.name === "telegram" || channel.name === "gchat" || channel.name === "discord") && payload.type === "message") {
    const text = payload.text?.trim().toLowerCase();

    // Helper to send a quick response via synthesized stream event
    const sendQuickReply = (message: string) => {
      const handler = channel.createHandler(event);
      handler.onStreamEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: message }] }
      });
      handler.onComplete(0);
    };

    if (text === "/new") {
      clearSession(sessionKey);
      log(`[Watcher] Session cleared for ${sessionKey} via /new command`);
      sendQuickReply("Fresh start, boss. New session is ready.");
      return;
    }

    if (text === "/restart") {
      log(`[Watcher] Restart requested via /restart command`);
      sendQuickReply("Restarting... Back in a few seconds.");
      spawn(path.join(PROJECT_ROOT, "restart.sh"), [], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      }).unref();
      return;
    }

    // Memory mode commands (session vs transcript)
    if (text === "/memory session") {
      setMemoryMode(sessionKey, "session");
      log(`[Watcher] Memory mode changed to session for ${sessionKey}`);
      sendQuickReply("Switched to session memory. I'll remember our conversation within this session.");
      return;
    }

    // /memory transcript [optional lines count]
    const transcriptMatch = text.match(/^\/memory transcript(?:\s+(\d+))?$/);
    if (transcriptMatch) {
      setMemoryMode(sessionKey, "transcript");
      const lines = transcriptMatch[1] ? parseInt(transcriptMatch[1], 10) : null;
      if (lines !== null) {
        setTranscriptLines(sessionKey, lines);
      }
      const currentLines = getTranscriptLines(sessionKey);
      log(`[Watcher] Memory mode changed to transcript for ${sessionKey} (${currentLines} lines)`);
      sendQuickReply(`Switched to transcript memory. Each message is a fresh session, but I'll see the last ${currentLines} messages from all channels.`);
      return;
    }

    if (text === "/memory") {
      const currentMode = getMemoryMode(sessionKey);
      if (currentMode === "transcript") {
        const currentLines = getTranscriptLines(sessionKey);
        sendQuickReply(`Memory mode: transcript (${currentLines} lines)\n\nUse /memory session or /memory transcript [lines] to switch.`);
      } else {
        sendQuickReply(`Memory mode: ${currentMode}\n\nUse /memory session or /memory transcript [lines] to switch.`);
      }
      return;
    }

    // Queue mode commands (queue vs interrupt)
    if (text === "/queue on" || text === "/queue off") {
      const newMode = text === "/queue on" ? "queue" : "interrupt";
      setQueueMode(sessionKey, newMode);
      log(`[Watcher] Queue mode changed to ${newMode} for ${sessionKey}`);
      if (newMode === "queue") {
        sendQuickReply("Queue mode ON. Messages will pile up and process after the current job finishes.");
      } else {
        sendQuickReply("Queue mode OFF (interrupt). New messages will kill the current job and start fresh.");
      }
      return;
    }

    if (text === "/queue") {
      const currentMode = getQueueMode(sessionKey);
      const status = currentMode === "queue" ? "ON (messages queue up)" : "OFF (messages interrupt)";
      sendQuickReply(`Queue mode: ${status}\n\nUse /queue on or /queue off to switch.`);
      return;
    }

    // Note: /stop is handled with priority in processEvent() before queueing
  }

  // Note: Email security filtering is now handled by the email channel itself

  // Handle PDF conversion for documents
  let finalPrompt = prompt;
  if (channel.name === "telegram" && payload.type === "document") {
    const mimeType = payload.mime_type || "";
    const fileName = payload.file_name || "";
    if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
      try {
        const textPath = await convertPdfToText(payload.file_path);
        finalPrompt = prompt.replace(
          `The file has been saved to: ${payload.file_path}`,
          `The PDF has been converted to text. Use the Read tool to view it at: ${textPath}`
        );
      } catch (err) {
        log(`[PDF] Conversion failed, using raw path: ${err}`);
      }
    }
  }

  // Check memory mode
  const memoryMode = getMemoryMode(sessionKey);
  const isTranscriptMode = memoryMode === "transcript";

  // Generate session ID
  const generation = getSessionGeneration(sessionKey);
  const sessionId = generateSessionId(`${sessionKey}-gen${generation}`);
  const knownSessions = getKnownSessions();
  const isNewSession = !knownSessions.has(sessionId);

  // In transcript mode, inject recent history into the prompt
  if (isTranscriptMode) {
    const recentHistory = getRecentTranscriptContext(sessionKey);
    if (recentHistory) {
      finalPrompt = recentHistory + finalPrompt;
    }
  }

  // Inject channel-specific context (tool instructions, capabilities)
  const channelContext = channel.getChannelContext?.();
  if (channelContext) {
    finalPrompt = finalPrompt + `\n\n${channelContext}`;
  }

  // Inject response style from session settings into event payload
  // This overrides any hardcoded verbosity in the channel
  const responseStyle = getResponseStyle(sessionKey);
  event.payload.verbosity = responseStyle;

  // Create handler for this event
  const handler = channel.createHandler(event);

  // Spawn Claude
  // In transcript mode: always new session. In session mode: resume if exists.
  const useNewSession = isTranscriptMode || isNewSession;

  // Create a job file for this invocation
  const jobId = generateJobId();

  return new Promise((resolve, reject) => {
    log(`[Watcher] Spawning Claude with session ${sessionId} (mode: ${memoryMode}, ${useNewSession ? "new" : "resuming"}) [job: ${jobId}]`);

    const sessionArg = useNewSession
      ? ["--session-id", isTranscriptMode ? generateSessionId(`${sessionKey}-transcript-${Date.now()}`) : sessionId]
      : ["--resume", sessionId];

    const proc = spawn(
      "claude",
      [
        ...sessionArg,
        "-p",
        "--verbose",
        "--output-format", "stream-json",
        "--dangerously-skip-permissions",
        finalPrompt
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Track PID in job file and in-memory map, plus session mapping
    createJobFile(jobId, channel.name, prompt.slice(0, 500), proc.pid, finalPrompt);
    runningJobs.set(jobId, proc);
    jobToSession.set(jobId, sessionKey);

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let outgoingTextBuffer = ""; // Buffer for short-term memory logging
    let lastCost: number | undefined;
    let lastDurationMs: number | undefined;

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      lineBuffer += chunk;

      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const streamEvent = JSON.parse(line);
          appendJobEvent(jobId, streamEvent);

          // Capture cost/duration from result events
          if (streamEvent.type === "result") {
            lastCost = streamEvent.total_cost_usd;
            lastDurationMs = streamEvent.duration_ms;
          }

          try {
            handler.onStreamEvent(streamEvent);
          } catch (handlerErr) {
            log(`[Stream] Handler error: ${handlerErr}`);
          }

          // Accumulate text for short-term memory (at streaming level)
          const text = extractTextFromStreamEvent(streamEvent);
          if (text) {
            outgoingTextBuffer += text;
          }
        } catch {
          log(`[Stream] Non-JSON: ${line}`);
        }
      }
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      fs.appendFileSync(LOG_FILE, "[stderr] " + chunk);
      process.stderr.write(chunk);
    });

    proc.on("close", (code, signal) => {
      log(`[Watcher] Claude exited with code ${code}, signal ${signal} [job: ${jobId}]`);
      handler.onComplete(code || 0);

      // Determine status: stopped if killed by signal, otherwise completed/error
      const wasKilled = signal === "SIGTERM" || signal === "SIGKILL";
      const status = wasKilled ? "stopped" : (code === 0 ? "completed" : "error");
      finalizeJob(jobId, status, lastCost, lastDurationMs);

      // Log outgoing response to short-term memory
      if (outgoingTextBuffer.trim()) {
        logToShortTermMemory(channel.name, "out", `Assistant: ${outgoingTextBuffer.trim()}`);
        // Check if we need to trigger auto-rollup (async, don't block)
        checkAndTriggerRollup().catch(err => log(`[Memory] Rollup error: ${err}`));
      }

      if (code !== 0) {
        log(`[Watcher] Claude error - stderr: ${stderr}`);
        // Check if this looks like an API error (corrupted session)
        // If so, clear the session so the next message starts fresh
        if (stdout.includes("invalid_request_error") || stdout.includes("Could not process")) {
          log(`[Watcher] Detected API error - clearing corrupted session ${sessionKey}`);
          clearSession(sessionKey);
        }
        reject(new Error(stderr));
      } else {
        log(`[Watcher] Claude finished handling event successfully`);
        // Only track session mode sessions, not transcript mode (those are one-off)
        if (isNewSession && !isTranscriptMode) {
          markSessionKnown(sessionId);
          log(`[Watcher] Marked session ${sessionId} as known`);
        }
        resolve();
      }
    });

    proc.on("error", (err) => {
      log(`[Watcher] Claude spawn error: ${err.message}`);
      handler.onComplete(1);
      finalizeJob(jobId, "error");
      reject(err);
    });
  });
}

// Helper to acquire a mutex for a session key
async function acquireSessionMutex(lockKey: string): Promise<() => void> {
  // Wait for any existing operation on this session to complete
  while (sessionMutexes.has(lockKey)) {
    await sessionMutexes.get(lockKey);
  }

  // Create a new mutex for this operation
  let releaseMutex: () => void;
  const mutexPromise = new Promise<void>((resolve) => {
    releaseMutex = resolve;
  });
  sessionMutexes.set(lockKey, mutexPromise);

  return () => {
    sessionMutexes.delete(lockKey);
    releaseMutex!();
  };
}

// Process event with concurrency control
async function processEvent(channel: ChannelDefinition, event: ChannelEvent): Promise<void> {
  const { sessionKey, payload } = event;
  const lockKey = channel.concurrency === "global" ? channel.name : sessionKey;

  // PRIORITY: Handle /stop command immediately, before queueing
  // This ensures stop commands can interrupt running jobs
  if ((channel.name === "telegram" || channel.name === "gchat" || channel.name === "discord") && payload.type === "message") {
    const text = payload.text?.trim().toLowerCase();
    if (text === "/stop" || text?.startsWith("/stop ")) {
      log(`[Watcher] Processing /stop command with priority (bypassing queue)`);

      // Helper to send a quick response via synthesized stream event
      const sendQuickReply = (message: string) => {
        const handler = channel.createHandler(event);
        handler.onStreamEvent({
          type: "assistant",
          message: { content: [{ type: "text", text: message }] }
        });
        handler.onComplete(0);
      };

      // Check if a specific job ID was provided
      const parts = payload.text?.trim().split(/\s+/);
      const specificJobId = parts && parts.length > 1 ? parts[1] : null;

      if (specificJobId) {
        const killed = killJob(specificJobId);
        if (killed) {
          log(`[Watcher] Stopped job ${specificJobId} via /stop command`);
          sendQuickReply(`Done. Killed job ${specificJobId}.`);
        } else {
          sendQuickReply(`Couldn't find running job ${specificJobId}. It might have already finished.`);
        }
      } else {
        const runningJobId = getRunningJobId();
        if (runningJobId) {
          killJob(runningJobId);
          log(`[Watcher] Stopped running job ${runningJobId} via /stop command`);
          sendQuickReply(`Done. Killed the running job.`);
        } else {
          sendQuickReply(`Nothing running right now, boss.`);
        }
      }
      return; // Don't queue or process further
    }
  }

  // Check concurrency - use mutex to prevent race conditions when two messages arrive simultaneously
  if (channel.concurrency === "session" || channel.concurrency === "global") {
    // Acquire mutex before checking/modifying session state
    const releaseMutex = await acquireSessionMutex(lockKey);

    try {
      if (activeSessions.has(lockKey)) {
        // Check queue mode for this session
        const queueMode = getQueueMode(sessionKey);

        if (queueMode === "interrupt") {
          // Interrupt mode: kill current job, clear queue, process this one
          log(`[Watcher] Interrupt mode: killing running job for ${lockKey}`);

          // Kill the running job for this session and wait for it to fully terminate
          const runningJobId = getRunningJobForSession(sessionKey);
          if (runningJobId) {
            const proc = runningJobs.get(runningJobId);
            if (proc) {
              // Create a promise that resolves when the process actually exits
              const exitPromise = new Promise<void>((resolve) => {
                const onExit = () => {
                  proc.removeListener("close", onExit);
                  proc.removeListener("exit", onExit);
                  resolve();
                };
                proc.once("close", onExit);
                proc.once("exit", onExit);

                // Timeout fallback - don't wait forever
                setTimeout(() => {
                  proc.removeListener("close", onExit);
                  proc.removeListener("exit", onExit);
                  resolve();
                }, 2000);
              });

              proc.kill("SIGTERM");
              log(`[Watcher] Sent SIGTERM to job ${runningJobId}, waiting for exit...`);

              await exitPromise;
              log(`[Watcher] Job ${runningJobId} terminated`);

              // Now finalize the job if it hasn't been already
              if (runningJobs.has(runningJobId)) {
                finalizeJob(runningJobId, "stopped");
              }
            }
          }

          // Clear any queued events for this session
          const queue = eventQueues.get(lockKey);
          if (queue && queue.length > 0) {
            log(`[Watcher] Clearing ${queue.length} queued events due to interrupt mode`);
            eventQueues.delete(lockKey);
          }

          // Force clear the session lock since we're taking over
          activeSessions.delete(lockKey);
          sessionOwners.delete(lockKey);
        } else {
          // Queue mode: queue this event
          if (!eventQueues.has(lockKey)) {
            eventQueues.set(lockKey, []);
          }
          eventQueues.get(lockKey)!.push(event);
          log(`[Watcher] Queued event for ${lockKey} (${eventQueues.get(lockKey)!.length} in queue)`);
          releaseMutex();
          return;
        }
      }
      activeSessions.add(lockKey);
    } finally {
      releaseMutex();
    }
  }

  // Generate a unique ownership token for this invocation
  const ownershipToken = crypto.randomUUID();
  sessionOwners.set(lockKey, ownershipToken);

  try {
    await handleChannelEvent(channel, event);
  } finally {
    if (channel.concurrency === "session" || channel.concurrency === "global") {
      // Only release the lock if we still own it
      // This prevents a killed job from releasing the lock that a new job now owns
      if (sessionOwners.get(lockKey) === ownershipToken) {
        activeSessions.delete(lockKey);
        sessionOwners.delete(lockKey);

        // Process next queued event if any
        const queue = eventQueues.get(lockKey);
        if (queue && queue.length > 0) {
          const nextEvent = queue.shift()!;
          log(`[Watcher] Processing next queued event for ${lockKey}`);
          setImmediate(() => processEvent(channel, nextEvent));
        }
      } else {
        log(`[Watcher] Skipping cleanup - lock ownership transferred (was killed by interrupt)`);
      }
    }
  }
}

// Cron job management
function parseSchedule(schedule: string): string {
  const lower = schedule.toLowerCase().trim();

  if (/^[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+$/.test(schedule)) {
    return schedule;
  }

  if (lower === "every minute") return "* * * * *";
  if (lower === "every hour") return "0 * * * *";
  if (lower === "every day" || lower === "daily") return "0 9 * * *";
  if (lower === "every week" || lower === "weekly") return "0 9 * * 1";

  const minMatch = lower.match(/^every (\d+) minutes?$/);
  if (minMatch) return `*/${minMatch[1]} * * * *`;

  const hourMatch = lower.match(/^every (\d+) hours?$/);
  if (hourMatch) return `0 */${hourMatch[1]} * * *`;

  const dailyAtMatch = lower.match(/(?:daily|every day) at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (dailyAtMatch) {
    let hour = parseInt(dailyAtMatch[1]);
    const minute = dailyAtMatch[2] ? parseInt(dailyAtMatch[2]) : 0;
    const ampm = dailyAtMatch[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  const atMatch = lower.match(/^at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (atMatch) {
    let hour = parseInt(atMatch[1]);
    const minute = atMatch[2] ? parseInt(atMatch[2]) : 0;
    const ampm = atMatch[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  return schedule;
}

function loadCronConfig(): CronConfig {
  try {
    if (fs.existsSync(CRON_CONFIG_FILE)) {
      const content = fs.readFileSync(CRON_CONFIG_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    log(`[Cron] Error loading config: ${err}`);
  }
  return { jobs: [] };
}

function saveCronConfig(config: CronConfig): void {
  fs.writeFileSync(CRON_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function deleteJob(jobId: string): void {
  const config = loadCronConfig();
  const index = config.jobs.findIndex((j) => j.id === jobId);
  if (index !== -1) {
    config.jobs.splice(index, 1);
    saveCronConfig(config);
    log(`[Cron] Deleted one-off job: ${jobId}`);
  }
}

// Simple cron event handler (no typing, just accumulate and log)
class CronEventHandler implements ChannelEventHandler {
  private jobId: string;
  public textBuffer: string = "";
  private isComplete: boolean = false;

  constructor(jobId: string) {
    this.jobId = jobId;
  }

  onStreamEvent(event: any): void {
    if (event.type === "result") {
      this.onComplete(event.subtype === "success" ? 0 : 1);
      return;
    }

    if (event.type === "assistant" && event.message?.content) {
      const text = event.message.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      if (text) this.textBuffer += text;
    }
  }

  onComplete(code: number): void {
    if (this.isComplete) return;
    this.isComplete = true;
    log(`[Cron] Job ${this.jobId} complete (code ${code}): ${this.textBuffer.slice(0, 200)}...`);
  }
}

async function handleCronJob(job: CronJob): Promise<void> {
  const sessionKey = `cron-${job.id}`;

  // Add reminder to log outbound messages for visibility
  const loggingReminder = `IMPORTANT: Before calling send_message or send_email, always output the message content as text first. This ensures the message gets logged. Example: "Sending message: [your message here]" then call the MCP tool.`;

  // Inject memory context so cron jobs have the same awareness as interactive sessions
  const memoryContext = getRecentTranscriptContext();

  const prompt = `[Scheduled Task: ${job.description}]\n\n${loggingReminder}${memoryContext}\n${job.prompt}`;

  const generation = getSessionGeneration(sessionKey);
  const sessionId = generateSessionId(`${sessionKey}-gen${generation}`);
  const knownSessions = getKnownSessions();
  const isNewSession = !knownSessions.has(sessionId);

  const handler = new CronEventHandler(job.id);

  // Create a job file for this cron execution
  const jobFileId = generateJobId();

  return new Promise((resolve, reject) => {
    log(`[Cron] Running job ${job.id}: ${job.description} [job: ${jobFileId}]`);

    const sessionArg = isNewSession
      ? ["--session-id", sessionId]
      : ["--resume", sessionId];

    const proc = spawn(
      "claude",
      [
        ...sessionArg,
        "-p",
        "--verbose",
        "--output-format", "stream-json",
        "--dangerously-skip-permissions",
        prompt
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Track PID in job file and in-memory map
    createJobFile(jobFileId, "cron", `[${job.description}] ${prompt.slice(0, 400)}`, proc.pid, prompt);
    runningJobs.set(jobFileId, proc);

    let lineBuffer = "";
    let lastCost: number | undefined;
    let lastDurationMs: number | undefined;

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      lineBuffer += chunk;

      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const streamEvent = JSON.parse(line);
          appendJobEvent(jobFileId, streamEvent);
          handler.onStreamEvent(streamEvent);

          // Capture cost/duration from result events
          if (streamEvent.type === "result") {
            lastCost = streamEvent.total_cost_usd;
            lastDurationMs = streamEvent.duration_ms;
          }
        } catch {}
      }
    });

    proc.on("close", (code, signal) => {
      handler.onComplete(code || 0);
      if (isNewSession) {
        markSessionKnown(sessionId);
      }

      // Determine status: stopped if killed by signal, otherwise completed/error
      const wasKilled = signal === "SIGTERM" || signal === "SIGKILL";
      const status = wasKilled ? "stopped" : (code === 0 ? "completed" : "error");
      finalizeJob(jobFileId, status, lastCost, lastDurationMs);

      // Log cron output to short-term memory
      if (handler.textBuffer.trim()) {
        logToShortTermMemory("cron", "in", `[${job.description}] ${job.prompt}`);
        logToShortTermMemory("cron", "out", `Assistant: ${handler.textBuffer.trim()}`);
        checkAndTriggerRollup().catch(err => log(`[Memory] Rollup error: ${err}`));
      }

      resolve();
    });

    proc.on("error", (err) => {
      handler.onComplete(1);
      finalizeJob(jobFileId, "error");
      reject(err);
    });
  });
}

function scheduleCronJobs(): void {
  for (const [id, task] of activeCronTasks) {
    task.stop();
    log(`[Cron] Stopped job: ${id}`);
  }
  activeCronTasks.clear();

  for (const [id, timeout] of activeTimeouts) {
    clearTimeout(timeout);
    log(`[Cron] Cleared timeout: ${id}`);
  }
  activeTimeouts.clear();

  const config = loadCronConfig();
  let recurringCount = 0;
  let oneOffCount = 0;

  for (const job of config.jobs) {
    if (!job.enabled) {
      log(`[Cron] Skipping disabled job: ${job.id}`);
      continue;
    }

    if (job.run_once && job.run_at) {
      const runAt = new Date(job.run_at);
      const now = new Date();
      const delayMs = runAt.getTime() - now.getTime();

      if (delayMs <= 0) {
        log(`[Cron] One-off job ${job.id} is past due, running now`);
        handleCronJob(job).then(() => deleteJob(job.id));
      } else {
        const timeout = setTimeout(() => {
          log(`[Cron] Triggering one-off job: ${job.id} (${job.description})`);
          handleCronJob(job).then(() => deleteJob(job.id));
          activeTimeouts.delete(job.id);
        }, delayMs);

        activeTimeouts.set(job.id, timeout);
        const mins = Math.round(delayMs / 60000);
        log(`[Cron] Scheduled one-off job: ${job.id} to run in ${mins} minutes`);
        oneOffCount++;
      }
      continue;
    }

    const cronExpression = parseSchedule(job.schedule);

    if (!cron.validate(cronExpression)) {
      log(`[Cron] Invalid schedule for job ${job.id}: ${job.schedule} -> ${cronExpression}`);
      continue;
    }

    const task = cron.schedule(cronExpression, () => {
      log(`[Cron] Triggering job: ${job.id} (${job.description})`);
      handleCronJob(job);
    }, { timezone: "America/Toronto" });

    activeCronTasks.set(job.id, task);
    log(`[Cron] Scheduled job: ${job.id} with schedule "${job.schedule}" -> "${cronExpression}"`);
    recurringCount++;
  }

  log(`[Cron] ${recurringCount} recurring jobs, ${oneOffCount} one-off tasks scheduled`);
}

// Main watcher function
async function watch(): Promise<void> {
  log("[Watcher] Starting unified watcher...");

  // Write PID file
  fs.writeFileSync(PID_FILE, process.pid.toString(), "utf-8");
  log(`[Watcher] PID file written: ${PID_FILE} (PID: ${process.pid})`);

  // Load channel config
  const channelsConfig = loadChannelsConfig();

  // All available channels
  const allChannels: ChannelDefinition[] = [
    TelegramChannel,
    EmailChannel,
    GChatChannel,
    DiscordChannel,
  ];

  // Filter to only enabled channels
  const channels = allChannels.filter(channel => {
    const config = channelsConfig.channels[channel.name];
    const enabled = config?.enabled !== false; // Default to enabled if not specified
    if (!enabled) {
      log(`[Watcher] Skipping ${channel.name} (disabled in config)`);
    }
    return enabled;
  });

  const stopFunctions: (() => void)[] = [];

  // Start enabled channel listeners
  for (const channel of channels) {
    try {
      log(`[Watcher] Starting ${channel.name} listener...`);
      const stop = await channel.startListener((event) => {
        processEvent(channel, event).catch((err) => {
          log(`[Watcher] Error processing ${channel.name} event: ${err}`);
          // Don't rethrow - the watcher should keep running
        });
      });
      stopFunctions.push(stop);
      log(`[Watcher] ${channel.name} listener started`);
    } catch (err) {
      log(`[Watcher] Failed to start ${channel.name} listener: ${err}`);
    }
  }

  // Initialize cron jobs
  scheduleCronJobs();

  // Watch cron config for changes
  if (fs.existsSync(CRON_CONFIG_FILE)) {
    fs.watch(path.dirname(CRON_CONFIG_FILE), (eventType, filename) => {
      if (filename === "cron.json") {
        log("[Cron] Config file changed, reloading...");
        scheduleCronJobs();
      }
    });
  }

  log("[Watcher] Ready and waiting for events...");

  // Handle shutdown
  const shutdown = () => {
    log("[Watcher] Shutting down...");
    for (const stop of stopFunctions) {
      stop();
    }
    for (const [, task] of activeCronTasks) {
      task.stop();
    }
    for (const [, timeout] of activeTimeouts) {
      clearTimeout(timeout);
    }
    // Remove PID file
    try {
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
        log("[Watcher] PID file removed");
      }
    } catch (err) {
      log(`[Watcher] Failed to remove PID file: ${err}`);
    }
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

// Global error handlers to prevent crashes from unhandled errors
process.on("uncaughtException", (err) => {
  log(`[Watcher] Uncaught exception (non-fatal): ${err}`);
  // Don't exit - keep the watcher running
});

process.on("unhandledRejection", (reason, promise) => {
  log(`[Watcher] Unhandled rejection (non-fatal): ${reason}`);
  // Don't exit - keep the watcher running
});

watch().catch((err) => {
  log(`[Watcher] Fatal error during startup: ${err}`);
  process.exit(1);
});
