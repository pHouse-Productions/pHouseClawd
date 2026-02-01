import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import cron from "node-cron";
import {
  Channel,
  ChannelDefinition,
  ChannelEvent,
  ChannelEventHandler,
  StreamHandler,
  ConcurrencyMode,
} from "./channels/index.js";
import { TelegramChannel } from "./channels/telegram.js";
import { EmailChannel } from "./channels/email.js";
import { GChatChannel } from "./channels/gchat.js";
import { DiscordChannel } from "./channels/discord.js";
import { DashboardChannel } from "./channels/dashboard.js";
import { parseCommand, supportsCommands, type ParsedCommand } from "./commands.js";
import { getLocalTimestamp } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

// Load environment variables from sibling pHouseMcp directory
config({ path: path.resolve(PROJECT_ROOT, "../pHouseMcp/.env"), override: true });

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

// Source files for CLAUDE.md generation
const SOUL_FILE = path.join(PROJECT_ROOT, "SOUL.md");
const SYSTEM_FILE = path.join(PROJECT_ROOT, "SYSTEM.md");
const CLAUDE_FILE = path.join(PROJECT_ROOT, "CLAUDE.md");

// Ensure jobs directory exists
if (!fs.existsSync(JOBS_DIR)) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

// Short-term memory
const SHORT_TERM_MEMORY_DIR = path.join(PROJECT_ROOT, "memory/short-term");
const SHORT_TERM_MEMORY_FILE = path.join(SHORT_TERM_MEMORY_DIR, "buffer.txt");
const ROLLUP_PENDING_DIR = path.join(PROJECT_ROOT, "memory/rollup-pending");

// Memory settings file
const MEMORY_SETTINGS_FILE = path.join(PROJECT_ROOT, "config/memory-settings.json");

// Memory config defaults (in bytes)
const MEMORY_CONFIG_DEFAULTS = {
  shortTermSizeThreshold: 50 * 1024,   // 50KB
  chunkSizeBytes: 25 * 1024,           // 25KB
  longTermFileMaxSize: 30 * 1024,      // 30KB
};

// Memory settings interface (matches memory-settings.json)
interface MemorySettingsFile {
  shortTermSizeThreshold: number;  // bytes
  chunkSizeBytes: number;          // bytes
  longTermFileMaxSize: number;     // bytes
}

// Get memory config from memory-settings.json (cached after first load)
let memorySettingsCache: MemorySettingsFile | null = null;
function getMemorySettings(): MemorySettingsFile {
  if (memorySettingsCache) {
    return memorySettingsCache;
  }
  try {
    const loaded = JSON.parse(fs.readFileSync(MEMORY_SETTINGS_FILE, "utf-8")) as Partial<MemorySettingsFile>;
    memorySettingsCache = {
      shortTermSizeThreshold: loaded.shortTermSizeThreshold ?? MEMORY_CONFIG_DEFAULTS.shortTermSizeThreshold,
      chunkSizeBytes: loaded.chunkSizeBytes ?? MEMORY_CONFIG_DEFAULTS.chunkSizeBytes,
      longTermFileMaxSize: loaded.longTermFileMaxSize ?? MEMORY_CONFIG_DEFAULTS.longTermFileMaxSize,
    };
  } catch {
    memorySettingsCache = { ...MEMORY_CONFIG_DEFAULTS };
  }
  return memorySettingsCache;
}

// Helper functions to get memory thresholds in bytes
function getShortTermSizeThreshold(): number {
  return getMemorySettings().shortTermSizeThreshold;
}

function getChunkSizeBytes(): number {
  return getMemorySettings().chunkSizeBytes;
}

function getLongTermFileMaxSize(): number {
  return getMemorySettings().longTermFileMaxSize;
}

// Ensure memory directories exist
if (!fs.existsSync(SHORT_TERM_MEMORY_DIR)) {
  fs.mkdirSync(SHORT_TERM_MEMORY_DIR, { recursive: true });
}
if (!fs.existsSync(ROLLUP_PENDING_DIR)) {
  fs.mkdirSync(ROLLUP_PENDING_DIR, { recursive: true });
}

// Dashboard chat file (for command responses)
const DASHBOARD_CHAT_FILE = path.join(PROJECT_ROOT, "memory/dashboard-chat.json");

interface DashboardChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: "pending" | "streaming" | "complete" | "error";
}

interface DashboardChatData {
  messages: DashboardChatMessage[];
  activeJobId?: string;
}

function loadDashboardChatData(): DashboardChatData {
  try {
    if (fs.existsSync(DASHBOARD_CHAT_FILE)) {
      return JSON.parse(fs.readFileSync(DASHBOARD_CHAT_FILE, "utf-8"));
    }
  } catch (err) {
    log(`[Watcher] Failed to load dashboard chat data: ${err}`);
  }
  return { messages: [] };
}

function saveDashboardChatData(data: DashboardChatData): void {
  fs.writeFileSync(DASHBOARD_CHAT_FILE, JSON.stringify(data, null, 2));
}

// Helper to send a command response to dashboard chat
function sendDashboardCommandResponse(assistantMessageId: string, message: string): void {
  try {
    const chatData = loadDashboardChatData();
    const msgIdx = chatData.messages.findIndex(m => m.id === assistantMessageId);
    if (msgIdx >= 0) {
      chatData.messages[msgIdx].content = message;
      chatData.messages[msgIdx].status = "complete";
      saveDashboardChatData(chatData);
    } else {
      log(`[Watcher] Dashboard message ${assistantMessageId} not found for command response`);
    }
  } catch (err) {
    log(`[Watcher] Failed to send dashboard command response: ${err}`);
  }
}

// Channel config
const CHANNELS_CONFIG_FILE = path.join(PROJECT_ROOT, "config/channels.json");

// Channel config types
interface ChannelConfig {
  enabled: boolean;
}

interface GlobalConfig {
  maxConcurrentJobs?: number;  // Default: 2
}

interface ChannelsConfig {
  channels: Record<string, ChannelConfig>;
  global?: GlobalConfig;
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
  const match = sessionKey.match(/^(telegram|email|gchat|discord|dashboard)-/);
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
  dashboard: "streaming",
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

// Global job queue - wait when too many jobs are running
const globalJobQueue: Array<{ resolve: () => void; event: ChannelEvent }> = [];
let maxConcurrentJobs = 2; // Will be overwritten by config

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

// Merge SOUL.md + SYSTEM.md into CLAUDE.md before each job
// This ensures Claude Code always sees the latest combined context
function refreshClaudeMd(): void {
  try {
    let content = "";

    // Read SOUL.md (identity/personality)
    if (fs.existsSync(SOUL_FILE)) {
      content += fs.readFileSync(SOUL_FILE, "utf-8").trim();
    } else {
      log("[Watcher] Warning: SOUL.md not found");
    }

    // Add separator and SYSTEM.md (technical reference)
    if (fs.existsSync(SYSTEM_FILE)) {
      if (content) content += "\n\n---\n\n";
      content += fs.readFileSync(SYSTEM_FILE, "utf-8").trim();
    } else {
      log("[Watcher] Warning: SYSTEM.md not found");
    }

    // Write merged content to CLAUDE.md
    if (content) {
      fs.writeFileSync(CLAUDE_FILE, content + "\n");
    }
  } catch (err) {
    log(`[Watcher] Error refreshing CLAUDE.md: ${err}`);
  }
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

// Global concurrency control
function getRunningJobCount(): number {
  return runningJobs.size;
}

async function waitForGlobalSlot(event: ChannelEvent): Promise<void> {
  if (getRunningJobCount() < maxConcurrentJobs) {
    return; // Slot available
  }

  log(`[Jobs] At capacity (${getRunningJobCount()}/${maxConcurrentJobs}). Queuing event from ${event.sessionKey}...`);

  return new Promise((resolve) => {
    globalJobQueue.push({ resolve, event });
  });
}

function releaseGlobalSlot(): void {
  // Check if anyone is waiting in the global queue
  if (globalJobQueue.length > 0) {
    const next = globalJobQueue.shift()!;
    log(`[Jobs] Slot freed. Releasing queued event from ${next.event.sessionKey} (${globalJobQueue.length} still waiting)`);
    next.resolve();
  }
}

// Short-term memory logging
function logToShortTermMemory(channel: string, direction: "in" | "out", content: string): void {
  const timestamp = getLocalTimestamp();
  // Collapse multi-line content to single line for cleaner buffer
  const singleLine = content.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const line = `[${timestamp}] [${channel}] [${direction}] ${singleLine}\n`;
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

// File-based lock to prevent concurrent rollup jobs
// Uses a lock file instead of just in-memory flag for extra safety
const ROLLUP_LOCK_FILE = path.join(ROLLUP_PENDING_DIR, ".rollup.lock");
const ROLLUP_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes - stale lock threshold

function acquireRollupLock(): boolean {
  try {
    // Check if lock exists and is recent
    if (fs.existsSync(ROLLUP_LOCK_FILE)) {
      const stats = fs.statSync(ROLLUP_LOCK_FILE);
      const lockAge = Date.now() - stats.mtimeMs;

      if (lockAge < ROLLUP_LOCK_TIMEOUT_MS) {
        // Lock is fresh - another process is running
        return false;
      }
      // Lock is stale - previous process died, we can take over
      log(`[Memory] Found stale rollup lock (${Math.round(lockAge / 1000)}s old), taking over`);
    }

    // Create lock file with our PID
    fs.writeFileSync(ROLLUP_LOCK_FILE, `${process.pid}\n${new Date().toISOString()}`);
    return true;
  } catch (err) {
    log(`[Memory] Failed to acquire rollup lock: ${err}`);
    return false;
  }
}

function releaseRollupLock(): void {
  try {
    if (fs.existsSync(ROLLUP_LOCK_FILE)) {
      fs.unlinkSync(ROLLUP_LOCK_FILE);
    }
  } catch (err) {
    log(`[Memory] Failed to release rollup lock: ${err}`);
  }
}

// Extract a chunk from the beginning of the short-term buffer
// Returns the path to the chunk file, or null if buffer is too small
function extractChunkFromBuffer(): string | null {
  if (!fs.existsSync(SHORT_TERM_MEMORY_FILE)) {
    return null;
  }

  const content = fs.readFileSync(SHORT_TERM_MEMORY_FILE, "utf-8");
  const chunkSizeBytes = getChunkSizeBytes();
  if (content.length < chunkSizeBytes) {
    return null;
  }

  const lines = content.split("\n");
  let chunkContent = "";
  let chunkLineCount = 0;

  // Accumulate lines until we hit the chunk size
  for (const line of lines) {
    if (chunkContent.length + line.length + 1 > chunkSizeBytes) {
      break;
    }
    chunkContent += line + "\n";
    chunkLineCount++;
  }

  if (chunkLineCount === 0) {
    return null;
  }

  // Write chunk to pending directory
  const timestamp = Date.now();
  const chunkFile = path.join(ROLLUP_PENDING_DIR, `chunk-${timestamp}.txt`);
  fs.writeFileSync(chunkFile, chunkContent);

  // Remove extracted lines from buffer (keep the rest)
  const remainingLines = lines.slice(chunkLineCount);
  fs.writeFileSync(SHORT_TERM_MEMORY_FILE, remainingLines.join("\n"));

  const chunkSizeKB = Math.round(chunkContent.length / 1024);
  const remainingSizeKB = Math.round(remainingLines.join("\n").length / 1024);
  log(`[Memory] Extracted ${chunkSizeKB}KB chunk (${chunkLineCount} lines) -> ${chunkFile}. Buffer now ${remainingSizeKB}KB.`);

  return chunkFile;
}

// Get all pending chunk files, sorted oldest first
function getPendingChunks(): string[] {
  if (!fs.existsSync(ROLLUP_PENDING_DIR)) {
    return [];
  }
  return fs.readdirSync(ROLLUP_PENDING_DIR)
    .filter(f => f.startsWith("chunk-") && f.endsWith(".txt"))
    .map(f => path.join(ROLLUP_PENDING_DIR, f))
    .sort(); // Oldest first (timestamp in filename)
}

async function checkAndTriggerRollup(): Promise<void> {
  const size = getShortTermMemorySize();

  // First, extract chunks if buffer is over threshold
  // This happens synchronously and immediately, before any Claude job
  const sizeThreshold = getShortTermSizeThreshold();
  if (size >= sizeThreshold) {
    log(`[Memory] Short-term buffer at ${Math.round(size / 1024)}KB (threshold: ${Math.round(sizeThreshold / 1024)}KB). Extracting chunks...`);

    // Extract chunks until we're under threshold
    let currentSize = size;
    while (currentSize >= sizeThreshold) {
      const chunkFile = extractChunkFromBuffer();
      if (!chunkFile) break; // Buffer too small to extract more
      currentSize = getShortTermMemorySize();
    }
  }

  // Now process any pending chunks
  const pendingChunks = getPendingChunks();
  if (pendingChunks.length === 0) {
    return;
  }

  // Try to acquire file-based lock (prevents concurrent rollups even across processes)
  if (!acquireRollupLock()) {
    log(`[Memory] Rollup already in progress (lock held), ${pendingChunks.length} chunks waiting.`);
    return;
  }

  try {
    // Process chunks one at a time
    for (const chunkFile of pendingChunks) {
      log(`[Memory] Processing chunk: ${path.basename(chunkFile)}`);
      await performRollup(chunkFile);
      // Delete chunk after successful processing
      fs.unlinkSync(chunkFile);
      log(`[Memory] Chunk processed and deleted: ${path.basename(chunkFile)}`);
    }
    log(`[Memory] All ${pendingChunks.length} chunks processed successfully.`);
  } catch (err) {
    log(`[Memory] Rollup failed: ${err}`);
  } finally {
    releaseRollupLock();
  }
}

async function performRollup(chunkFile: string): Promise<void> {
  const chunkContent = fs.readFileSync(chunkFile, "utf-8");
  if (!chunkContent.trim()) {
    log(`[Memory] Chunk file is empty, skipping.`);
    return;
  }

  const chunkSizeKB = Math.round(chunkContent.length / 1024);
  const lineCount = chunkContent.trim().split("\n").length;

  // Lightweight prompt - points to file instead of embedding content
  const rollupPrompt = `MEMORY ROLLUP TASK

A chunk of conversation history needs to be processed into long-term memory.

**Chunk file:** ${chunkFile}
**Size:** ${chunkSizeKB}KB (${lineCount} lines)

## Instructions

1. **Read the chunk file** using the Read tool
2. **List existing memory files** using recall() with no args
3. **Read each relevant long-term file** to see current contents
4. **UPDATE (not append!)** files with new information from the chunk

## CRITICAL RULES

- **MERGE, don't append** - If info already exists, update it in place
- **Remove duplicates** - Don't create redundant entries
- **Add dates** - Every entry should have a date prefix like [2026-01-31]
- **Be selective** - Only save info useful for future recall (decisions, learnings, project status, important context)
- **Split large files** - If a file would exceed 30KB, split it (e.g., journal-2026-01.md, journal-2026-02.md)

## File Guidelines

- **journal.md** - Activity log with dates. Summarize old entries, keep recent ones detailed.
- **projects.md** - Active project status. Update existing entries, don't duplicate.
- **people.md** - Contact info and relationship notes.
- **Create new files** as needed for distinct topics.

## Example Workflow

1. Read chunk: \`Read tool on ${chunkFile}\`
2. Check files: \`recall()\` → see journal.md, projects.md exist
3. Read current: \`recall(file="journal.md")\` → see what's there
4. Identify NEW info in chunk that's not already in journal.md
5. Rewrite with merged content: \`remember(file="journal.md", content="[merged content]", mode="replace")\`
6. Repeat for other relevant files

DO NOT try to clear or modify the chunk file - the watcher handles cleanup.`;

  const jobId = generateJobId();

  // Wait for a global slot if we're at capacity
  const dummyEvent: ChannelEvent = { sessionKey: "memory-rollup", prompt: "", payload: {}, message: { isMessage: false, text: "" } };
  await waitForGlobalSlot(dummyEvent);

  return new Promise((resolve, reject) => {
    // Refresh CLAUDE.md from SOUL.md + SYSTEM.md before each job
    refreshClaudeMd();

    log(`[Memory] Starting rollup job ${jobId} for chunk ${path.basename(chunkFile)} (${chunkSizeKB}KB, ${lineCount} lines)`);

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
    createJobFile(jobId, "memory-rollup", `[Rollup] ${path.basename(chunkFile)} (${chunkSizeKB}KB)`, proc.pid, rollupPrompt);
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

      // Release global slot so queued jobs can run
      releaseGlobalSlot();

      if (code === 0) {
        log(`[Memory] Rollup job ${jobId} completed successfully.`);
        resolve();
      } else {
        reject(new Error(`Rollup process exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      finalizeJob(jobId, "error");
      releaseGlobalSlot();
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

  // Note: All commands (/stop, /new, /memory, /queue, /restart) are now handled with priority
  // in processEvent() before queueing, so they bypass both session and global queues.

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

  // In session mode (resuming), prefix with timestamp so Claude knows when this message arrived
  // Transcript mode already has timestamps in the injected history
  const useNewSession = isNewSession || isTranscriptMode;
  if (!useNewSession && !isTranscriptMode) {
    const timestamp = getLocalTimestamp();
    finalPrompt = `[${timestamp}]\n${finalPrompt}`;
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

  // Wait for a global slot if we're at capacity
  await waitForGlobalSlot(event);

  // Signal work is starting (typing indicator, reaction, etc.)
  handler.onWorkStarted?.();

  // Spawn Claude
  // In transcript mode: always new session. In session mode: resume if exists.
  // (useNewSession already defined above when adding timestamp prefix)

  // Create a job file for this invocation
  const jobId = generateJobId();

  return new Promise((resolve, reject) => {
    // Refresh CLAUDE.md from SOUL.md + SYSTEM.md before each job
    refreshClaudeMd();

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
      // Signal work is complete (remove typing indicator, reaction, etc.)
      handler.onWorkComplete?.();
      handler.onComplete(code || 0);

      // Determine status: stopped if killed by signal, otherwise completed/error
      const wasKilled = signal === "SIGTERM" || signal === "SIGKILL";
      const status = wasKilled ? "stopped" : (code === 0 ? "completed" : "error");
      finalizeJob(jobId, status, lastCost, lastDurationMs);

      // Release global slot so queued jobs can run
      releaseGlobalSlot();

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
      handler.onWorkComplete?.();
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

  // PRIORITY: Handle control commands immediately, before queueing
  // This ensures /stop, /new, /memory, /queue bypass all queues
  if (supportsCommands(channel.name) && event.message?.isMessage) {
    const cmd = parseCommand(event.message.text);

    if (cmd) {
      // Helper to send a quick response - works for all channels
      const sendQuickReply = (message: string) => {
        if (channel.name === "dashboard") {
          const assistantMessageId = payload.assistantMessageId;
          if (assistantMessageId) {
            sendDashboardCommandResponse(assistantMessageId, message);
          }
        } else {
          const handler = channel.createHandler(event);
          handler.onStreamEvent({
            type: "assistant",
            message: { content: [{ type: "text", text: message }] }
          });
          handler.onComplete(0);
        }
      };

      // Handle all control commands with priority (bypass queues)
      switch (cmd.type) {
        case "stop":
        case "stop_job":
          log(`[Watcher] Processing /stop command with priority (bypassing queue)`);
          if (cmd.type === "stop_job" && cmd.args?.jobId) {
            const killed = killJob(cmd.args.jobId);
            if (killed) {
              log(`[Watcher] Stopped job ${cmd.args.jobId} via /stop command`);
              sendQuickReply(`Done. Killed job ${cmd.args.jobId}.`);
            } else {
              sendQuickReply(`Couldn't find running job ${cmd.args.jobId}. It might have already finished.`);
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
          return;

        case "new":
          log(`[Watcher] Processing /new command with priority (bypassing queue)`);
          clearSession(sessionKey);
          sendQuickReply("Fresh start, boss. New session is ready.");
          return;

        case "restart":
          log(`[Watcher] Processing /restart command with priority (bypassing queue)`);
          sendQuickReply("Restarting... Back in a few seconds.");
          spawn(path.join(PROJECT_ROOT, "restart.sh"), [], {
            cwd: PROJECT_ROOT,
            stdio: ["ignore", "ignore", "ignore"],
            detached: true,
          }).unref();
          return;

        case "memory_session":
          log(`[Watcher] Processing /memory session command with priority (bypassing queue)`);
          setMemoryMode(sessionKey, "session");
          sendQuickReply("Switched to session memory. I'll remember our conversation within this session.");
          return;

        case "memory_transcript": {
          log(`[Watcher] Processing /memory transcript command with priority (bypassing queue)`);
          setMemoryMode(sessionKey, "transcript");
          if (cmd.args?.lines !== undefined) {
            setTranscriptLines(sessionKey, cmd.args.lines);
          }
          const currentLines = getTranscriptLines(sessionKey);
          sendQuickReply(`Switched to transcript memory. Each message is a fresh session, but I'll see the last ${currentLines} messages from all channels.`);
          return;
        }

        case "memory_status": {
          log(`[Watcher] Processing /memory command with priority (bypassing queue)`);
          const currentMode = getMemoryMode(sessionKey);
          if (currentMode === "transcript") {
            const currentLines = getTranscriptLines(sessionKey);
            sendQuickReply(`Memory mode: transcript (${currentLines} lines)\n\nUse /memory session or /memory transcript [lines] to switch.`);
          } else {
            sendQuickReply(`Memory mode: ${currentMode}\n\nUse /memory session or /memory transcript [lines] to switch.`);
          }
          return;
        }

        case "queue_on":
          log(`[Watcher] Processing /queue on command with priority (bypassing queue)`);
          setQueueMode(sessionKey, "queue");
          sendQuickReply("Queue mode ON. Messages will pile up and process after the current job finishes.");
          return;

        case "queue_off":
          log(`[Watcher] Processing /queue off command with priority (bypassing queue)`);
          setQueueMode(sessionKey, "interrupt");
          sendQuickReply("Queue mode OFF (interrupt). New messages will kill the current job and start fresh.");
          return;

        case "queue_status": {
          log(`[Watcher] Processing /queue command with priority (bypassing queue)`);
          const currentMode = getQueueMode(sessionKey);
          const status = currentMode === "queue" ? "ON (messages queue up)" : "OFF (messages interrupt)";
          sendQuickReply(`Queue mode: ${status}\n\nUse /queue on or /queue off to switch.`);
          return;
        }

        default:
          // Unknown command - let it go through normal processing
          break;
      }
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

  // Wait for a global slot if we're at capacity
  const dummyEvent: ChannelEvent = { sessionKey, prompt, payload: {}, message: { isMessage: false, text: "" } };
  await waitForGlobalSlot(dummyEvent);

  // Create a job file for this cron execution
  const jobFileId = generateJobId();

  return new Promise((resolve, reject) => {
    // Refresh CLAUDE.md from SOUL.md + SYSTEM.md before each job
    refreshClaudeMd();

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

      // Release global slot so queued jobs can run
      releaseGlobalSlot();

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
      releaseGlobalSlot();
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

  // Apply global settings
  if (channelsConfig.global?.maxConcurrentJobs !== undefined) {
    maxConcurrentJobs = channelsConfig.global.maxConcurrentJobs;
  }
  log(`[Watcher] Max concurrent jobs: ${maxConcurrentJobs}`);

  // All available channels
  const allChannels: ChannelDefinition[] = [
    TelegramChannel,
    EmailChannel,
    GChatChannel,
    DiscordChannel,
    DashboardChannel,
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
