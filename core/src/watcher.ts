import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn } from "child_process";
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

// Load environment variables
config({ path: "/home/ubuntu/pHouseMcp/.env" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

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
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");
const STREAM_LOG = path.join(LOGS_DIR, "claude-stream.jsonl");
const SESSIONS_FILE = path.join(LOGS_DIR, "sessions.json");
const CRON_CONFIG_FILE = path.join(PROJECT_ROOT, "config/cron.json");

// Short-term memory
const SHORT_TERM_MEMORY_DIR = path.join(PROJECT_ROOT, "memory/short-term");
const SHORT_TERM_MEMORY_FILE = path.join(SHORT_TERM_MEMORY_DIR, "buffer.txt");
const SHORT_TERM_SIZE_THRESHOLD = 100 * 1024; // 100KB
const SHORT_TERM_RETAIN_RATIO = 0.25; // Keep 25% of buffer after rollup

// Ensure short-term memory directory exists
if (!fs.existsSync(SHORT_TERM_MEMORY_DIR)) {
  fs.mkdirSync(SHORT_TERM_MEMORY_DIR, { recursive: true });
}

// Email security config
const EMAIL_SECURITY_CONFIG_FILE = path.join(PROJECT_ROOT, "config/email-security.json");

// Channel config
const CHANNELS_CONFIG_FILE = path.join(PROJECT_ROOT, "config/channels.json");

interface EmailSecurityConfig {
  trustedEmailAddresses: string[];
  alertTelegramChatId: number | null;
  forwardUntrustedTo: string | null;
}

function loadEmailSecurityConfig(): EmailSecurityConfig {
  try {
    if (fs.existsSync(EMAIL_SECURITY_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(EMAIL_SECURITY_CONFIG_FILE, "utf-8"));
      return {
        trustedEmailAddresses: config.trustedEmailAddresses || [],
        alertTelegramChatId: config.alertTelegramChatId || null,
        forwardUntrustedTo: config.forwardUntrustedTo || null,
      };
    }
  } catch (err) {
    log(`[Security] Failed to load email security config: ${err}`);
  }
  return { trustedEmailAddresses: [], alertTelegramChatId: null, forwardUntrustedTo: null };
}

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
type ChannelMode = "session" | "transcript";

interface SessionData {
  known: string[];
  generations: Record<string, number>;
  modes: Record<string, ChannelMode>; // Per-channel mode (session vs transcript)
}

function loadSessionData(): SessionData {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      if (Array.isArray(data)) {
        return { known: data, generations: {}, modes: {} };
      }
      return { ...data, modes: data.modes || {} };
    }
  } catch {}
  return { known: [], generations: {}, modes: {} };
}

function getChannelMode(sessionKey: string): ChannelMode {
  return loadSessionData().modes[sessionKey] || "session"; // Default to session mode
}

function setChannelMode(sessionKey: string, mode: ChannelMode): void {
  const data = loadSessionData();
  data.modes[sessionKey] = mode;
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
const globalLocks: Map<string, boolean> = new Map();
const eventQueues: Map<string, ChannelEvent[]> = new Map();

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

function logStreamEvent(event: any) {
  const entry = {
    ts: new Date().toISOString(),
    ...event
  };
  fs.appendFileSync(STREAM_LOG, JSON.stringify(entry) + "\n");
}

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
const TRANSCRIPT_CONTEXT_LINES = 30; // Last 30 messages

function getRecentTranscriptContext(): string {
  try {
    if (!fs.existsSync(SHORT_TERM_MEMORY_FILE)) {
      return "";
    }
    const content = fs.readFileSync(SHORT_TERM_MEMORY_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(l => l.trim());
    const recentLines = lines.slice(-TRANSCRIPT_CONTEXT_LINES);
    if (recentLines.length === 0) {
      return "";
    }
    return `\n\n--- RECENT CONVERSATION HISTORY (from all channels) ---\n${recentLines.join("\n")}\n--- END HISTORY ---\n\n`;
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

  const rollupPrompt = `You need to perform a memory rollup. Here is the short-term memory buffer containing recent conversations:

---
${shortTermContent}
---

Please:
1. Review the conversations above
2. Extract important information worth remembering long-term (decisions made, learnings, project updates, personal info, preferences, etc.)
3. Use the 'remember' tool to save important memories to appropriate files in long-term memory (e.g., journal.md for activity log, projects.md for project updates, etc.)
4. Do NOT call the rollup tool with clear=true - the watcher will handle trimming the buffer.

Be selective - not everything needs to be saved. Focus on information that would be useful to recall in future sessions.`;

  return new Promise((resolve, reject) => {
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

    let stderr = "";

    proc.stdout.on("data", (data) => {
      // Just consume stdout, we don't need to process it
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        // Trim buffer to keep only the most recent 25%
        const linesToKeep = Math.ceil(totalLines * SHORT_TERM_RETAIN_RATIO);
        const retainedLines = lines.slice(-linesToKeep);
        fs.writeFileSync(SHORT_TERM_MEMORY_FILE, retainedLines.join("\n") + "\n");
        log(`[Memory] Trimmed buffer from ${totalLines} to ${linesToKeep} lines (kept ${Math.round(SHORT_TERM_RETAIN_RATIO * 100)}%)`);
        resolve();
      } else {
        reject(new Error(`Rollup process exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
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

// Send email (used for forwarding untrusted emails)
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const args = ["tsx", path.join(PROJECT_ROOT, "listeners/gmail/send-reply.ts"), to, subject, body, "", ""];

  try {
    const proc = spawn("npx", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    proc.unref();
    log(`[Email] Sent to ${to}: ${subject}`);
  } catch (err) {
    log(`[Email] Failed to send: ${err}`);
  }
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
  }

  if (incomingContent) {
    logToShortTermMemory(channel.name, "in", incomingContent);
  }

  // Handle special commands for interactive channels (telegram, gchat)
  if ((channel.name === "telegram" || channel.name === "gchat") && payload.type === "message") {
    const text = payload.text?.trim().toLowerCase();

    // Helper to send a message back to the channel
    const sendReply = (message: string) => {
      if (channel.name === "telegram") {
        const sendScript = path.join(PROJECT_ROOT, "listeners/telegram/send.ts");
        spawn("npx", ["tsx", sendScript, String(payload.chat_id), message], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        }).unref();
      } else if (channel.name === "gchat") {
        const sendScript = path.join(PROJECT_ROOT, "listeners/gchat/send-message.ts");
        spawn("npx", ["tsx", sendScript, payload.space_name, message], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        }).unref();
      }
    };

    if (text === "/new") {
      clearSession(sessionKey);
      log(`[Watcher] Session cleared for ${sessionKey} via /new command`);
      const handler = channel.createHandler(event);
      handler.onComplete(0);
      sendReply("Fresh start, boss. New session is ready.");
      return;
    }

    if (text === "/restart") {
      log(`[Watcher] Restart requested via /restart command`);
      const handler = channel.createHandler(event);
      handler.onComplete(0);
      sendReply("Restarting... Back in a few seconds.");
      spawn(path.join(PROJECT_ROOT, "restart.sh"), [], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      }).unref();
      return;
    }

    // Mode switching commands
    if (text === "/mode session" || text === "/mode transcript") {
      const newMode = text === "/mode session" ? "session" : "transcript";
      setChannelMode(sessionKey, newMode);
      log(`[Watcher] Mode changed to ${newMode} for ${sessionKey}`);
      const handler = channel.createHandler(event);
      handler.onComplete(0);
      if (newMode === "session") {
        sendReply("Switched to session mode. I'll remember our conversation within this session.");
      } else {
        sendReply("Switched to transcript mode. Each message is a fresh session, but I'll see recent history from all channels.");
      }
      return;
    }

    if (text === "/mode") {
      const currentMode = getChannelMode(sessionKey);
      const handler = channel.createHandler(event);
      handler.onComplete(0);
      sendReply(`Current mode: ${currentMode}\n\nUse /mode session or /mode transcript to switch.`);
      return;
    }
  }

  // Email security check
  if (channel.name === "email") {
    const emailSecurityConfig = loadEmailSecurityConfig();
    const emailAddress = payload.from.match(/<(.+)>/)?.[1] || payload.from;
    const isTrustedSender = emailSecurityConfig.trustedEmailAddresses.some(
      (trusted: string) => trusted.toLowerCase() === emailAddress.toLowerCase()
    );

    if (!isTrustedSender) {
      log(`[Security] Untrusted email sender: ${payload.from} - blocking auto-reply`);
      if (emailSecurityConfig.forwardUntrustedTo) {
        const forwardSubject = `Fwd: ${payload.subject}`;
        const forwardBody = `---------- Forwarded message ----------\nFrom: ${payload.from}\nDate: ${payload.date}\nSubject: ${payload.subject}\n\n${payload.body}`;
        await sendEmail(emailSecurityConfig.forwardUntrustedTo, forwardSubject, forwardBody);
        log(`[Security] Forwarded untrusted email to ${emailSecurityConfig.forwardUntrustedTo}`);
      }
      return;
    }
  }

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

  // Check channel mode
  const channelMode = getChannelMode(sessionKey);
  const isTranscriptMode = channelMode === "transcript";

  // Generate session ID
  const generation = getSessionGeneration(sessionKey);
  const sessionId = generateSessionId(`${sessionKey}-gen${generation}`);
  const knownSessions = getKnownSessions();
  const isNewSession = !knownSessions.has(sessionId);

  // In transcript mode, inject recent history into the prompt
  if (isTranscriptMode) {
    const recentHistory = getRecentTranscriptContext();
    if (recentHistory) {
      finalPrompt = recentHistory + finalPrompt;
    }
  }

  // Create handler for this event
  const handler = channel.createHandler(event);

  // Spawn Claude
  // In transcript mode: always new session. In session mode: resume if exists.
  const useNewSession = isTranscriptMode || isNewSession;

  return new Promise((resolve, reject) => {
    log(`[Watcher] Spawning Claude with session ${sessionId} (mode: ${channelMode}, ${useNewSession ? "new" : "resuming"})`);

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

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let outgoingTextBuffer = ""; // Buffer for short-term memory logging

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
          logStreamEvent(streamEvent);
          handler.onStreamEvent(streamEvent);

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

    proc.on("close", (code) => {
      log(`[Watcher] Claude exited with code ${code}`);
      handler.onComplete(code || 0);

      // Log outgoing response to short-term memory
      if (outgoingTextBuffer.trim()) {
        logToShortTermMemory(channel.name, "out", `Assistant: ${outgoingTextBuffer.trim()}`);
        // Check if we need to trigger auto-rollup (async, don't block)
        checkAndTriggerRollup().catch(err => log(`[Memory] Rollup error: ${err}`));
      }

      if (code !== 0) {
        log(`[Watcher] Claude error - stderr: ${stderr}`);
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
      reject(err);
    });
  });
}

// Process event with concurrency control
async function processEvent(channel: ChannelDefinition, event: ChannelEvent): Promise<void> {
  const { sessionKey } = event;
  const lockKey = channel.concurrency === "global" ? channel.name : sessionKey;

  // Check concurrency
  if (channel.concurrency === "session" || channel.concurrency === "global") {
    if (activeSessions.has(lockKey)) {
      // Queue this event
      if (!eventQueues.has(lockKey)) {
        eventQueues.set(lockKey, []);
      }
      eventQueues.get(lockKey)!.push(event);
      log(`[Watcher] Queued event for ${lockKey} (${eventQueues.get(lockKey)!.length} in queue)`);
      return;
    }
    activeSessions.add(lockKey);
  }

  try {
    await handleChannelEvent(channel, event);
  } finally {
    if (channel.concurrency === "session" || channel.concurrency === "global") {
      activeSessions.delete(lockKey);

      // Process next queued event if any
      const queue = eventQueues.get(lockKey);
      if (queue && queue.length > 0) {
        const nextEvent = queue.shift()!;
        log(`[Watcher] Processing next queued event for ${lockKey}`);
        setImmediate(() => processEvent(channel, nextEvent));
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
  const prompt = `[Scheduled Task: ${job.description}]\n\n${job.prompt}`;

  const generation = getSessionGeneration(sessionKey);
  const sessionId = generateSessionId(`${sessionKey}-gen${generation}`);
  const knownSessions = getKnownSessions();
  const isNewSession = !knownSessions.has(sessionId);

  const handler = new CronEventHandler(job.id);

  return new Promise((resolve, reject) => {
    log(`[Cron] Running job ${job.id}: ${job.description}`);

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

    let lineBuffer = "";

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      lineBuffer += chunk;

      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const streamEvent = JSON.parse(line);
          logStreamEvent(streamEvent);
          handler.onStreamEvent(streamEvent);
        } catch {}
      }
    });

    proc.on("close", (code) => {
      handler.onComplete(code || 0);
      if (isNewSession) {
        markSessionKnown(sessionId);
      }

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

  // Load channel config
  const channelsConfig = loadChannelsConfig();

  // All available channels
  const allChannels: ChannelDefinition[] = [
    TelegramChannel,
    EmailChannel,
    GChatChannel,
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
        processEvent(channel, event);
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
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

watch().catch((err) => {
  log(`[Watcher] Fatal error: ${err}`);
  process.exit(1);
});
