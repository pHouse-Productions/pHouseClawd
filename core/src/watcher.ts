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

// Email security config
const EMAIL_SECURITY_CONFIG_FILE = path.join(PROJECT_ROOT, "config/email-security.json");

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
interface SessionData {
  known: string[];
  generations: Record<string, number>;
}

function loadSessionData(): SessionData {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      if (Array.isArray(data)) {
        return { known: data, generations: {} };
      }
      return data;
    }
  } catch {}
  return { known: [], generations: {} };
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

  // Generate session ID
  const generation = getSessionGeneration(sessionKey);
  const sessionId = generateSessionId(`${sessionKey}-gen${generation}`);
  const knownSessions = getKnownSessions();
  const isNewSession = !knownSessions.has(sessionId);

  // Create handler for this event
  const handler = channel.createHandler(event);

  // Spawn Claude
  return new Promise((resolve, reject) => {
    log(`[Watcher] Spawning Claude with session ${sessionId} (${isNewSession ? "new" : "resuming"})`);

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

      if (code !== 0) {
        log(`[Watcher] Claude error - stderr: ${stderr}`);
        reject(new Error(stderr));
      } else {
        log(`[Watcher] Claude finished handling event successfully`);
        if (isNewSession) {
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
  private textBuffer: string = "";
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

  // List of channels to start
  const channels: ChannelDefinition[] = [
    TelegramChannel,
    EmailChannel,
    GChatChannel,
  ];

  const stopFunctions: (() => void)[] = [];

  // Start all channel listeners
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
