import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn } from "child_process";
import cron from "node-cron";
import { getPendingEvents, markProcessed, Event, pushEvent } from "./events.js";

// Generate a deterministic UUID v5 from a namespace + name
const NAMESPACE_UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // DNS namespace
function generateSessionId(name: string): string {
  const hash = crypto.createHash("sha1");
  // Parse namespace UUID to bytes
  const namespaceBytes = Buffer.from(NAMESPACE_UUID.replace(/-/g, ""), "hex");
  hash.update(namespaceBytes);
  hash.update(name);
  const digest = hash.digest();

  // Set version (5) and variant bits
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  // Format as UUID
  const hex = digest.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const PENDING_DIR = "/home/ubuntu/pHouseClawd/events/pending";
const SEND_SCRIPT = "/home/ubuntu/pHouseClawd/integrations/telegram/src/send.ts";
const LOGS_DIR = "/home/ubuntu/pHouseClawd/logs";
const LOG_FILE = path.join(LOGS_DIR, "claude.log");
const SESSIONS_FILE = path.join(LOGS_DIR, "sessions.json");
const CRON_CONFIG_FILE = "/home/ubuntu/pHouseClawd/config/cron.json";
const POLL_INTERVAL = 1000; // Check every second

// Cron job interface
interface CronJob {
  id: string;
  enabled: boolean;
  schedule: string;
  description: string;
  prompt: string;
}

interface CronConfig {
  jobs: CronJob[];
}

// Track active cron tasks
const activeCronTasks: Map<string, cron.ScheduledTask> = new Map();

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Track known sessions
function getKnownSessions(): Set<string> {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      return new Set(data);
    }
  } catch {}
  return new Set();
}

function markSessionKnown(sessionId: string): void {
  const sessions = getKnownSessions();
  sessions.add(sessionId);
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions], null, 2));
}

// Lock to prevent concurrent processing
let isProcessing = false;
let pendingPoll = false;

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

function logSection(title: string, content: string) {
  const divider = "=".repeat(60);
  const section = `\n${divider}\n${title}\n${divider}\n${content}\n`;
  fs.appendFileSync(LOG_FILE, section);
  process.stdout.write(section);
}

// Send status update to Telegram
async function relayStatus(chatId: number, message: string): Promise<void> {
  if (!message) return;

  try {
    const proc = spawn("npx", ["tsx", SEND_SCRIPT, String(chatId), message], {
      cwd: "/home/ubuntu/pHouseClawd",
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    proc.unref();
  } catch (err) {
    log(`[Watcher] Failed to relay status: ${err}`);
  }
}

function formatStreamEvent(event: any): string | null {
  const ts = new Date().toISOString().slice(11, 19);

  switch (event.type) {
    case "assistant":
      // Assistant text output
      if (event.message?.content) {
        const text = event.message.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("");
        if (text) return `[${ts}] 🤖 ${text}`;
      }
      return null;

    case "content_block_start":
      if (event.content_block?.type === "tool_use") {
        return `[${ts}] 🔧 Tool: ${event.content_block.name}`;
      }
      if (event.content_block?.type === "thinking") {
        return `[${ts}] 💭 Thinking...`;
      }
      return null;

    case "content_block_delta":
      if (event.delta?.type === "thinking_delta") {
        return `[${ts}] 💭 ${event.delta.thinking}`;
      }
      if (event.delta?.type === "text_delta") {
        return `[${ts}] 📝 ${event.delta.text}`;
      }
      if (event.delta?.type === "input_json_delta") {
        return null; // Skip raw JSON deltas, too noisy
      }
      return null;

    case "content_block_stop":
      return null; // Skip these

    case "result":
      // Final result
      if (event.result) {
        return `[${ts}] ✅ Result: ${event.result.slice(0, 200)}${event.result.length > 200 ? "..." : ""}`;
      }
      return null;

    case "error":
      return `[${ts}] ❌ Error: ${event.error?.message || JSON.stringify(event)}`;

    case "system":
      return `[${ts}] ℹ️ ${event.message || JSON.stringify(event)}`;

    default:
      // Log unknown event types for debugging
      return `[${ts}] [${event.type}] ${JSON.stringify(event).slice(0, 100)}`;
  }
}

async function handleEvent(event: Event): Promise<void> {
  log(`[Watcher] Processing event: ${event.type} from ${event.source}`);

  // Build prompt and session key based on event type
  let prompt: string;
  let sessionKey: string;

  // Track if we need to pass an image to Claude
  let imagePath: string | null = null;

  switch (event.type) {
    case "telegram:message":
      const { chat_id, from, text } = event.payload as {
        chat_id: number;
        from: string;
        text: string;
      };

      sessionKey = `telegram-${chat_id}`;
      prompt = `[Telegram from ${from}]: ${text}`;
      break;

    case "telegram:photo":
      const { chat_id: photoChatId, from: photoFrom, caption, image_path } = event.payload as {
        chat_id: number;
        from: string;
        caption: string;
        image_path: string;
      };

      sessionKey = `telegram-${photoChatId}`;
      imagePath = image_path;
      prompt = caption
        ? `[Telegram photo from ${photoFrom}]: ${caption}\n\nIMPORTANT: User sent an image. Use the Read tool to view the image at: ${image_path}`
        : `[Telegram photo from ${photoFrom}]: User sent an image with no caption.\n\nIMPORTANT: Use the Read tool to view the image at: ${image_path}`;
      break;

    case "gmail:email":
      const { uid, from: emailFrom, to, subject, date, body, thread_id } = event.payload as {
        uid: number;
        from: string;
        to: string;
        subject: string;
        date: string;
        body: string;
        thread_id?: string;
      };

      // Use thread_id if available, otherwise use subject as session key
      sessionKey = `email-${thread_id || subject.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 50)}`;
      prompt = `[Email from ${emailFrom}]
Subject: ${subject}
Date: ${date}

${body}`;
      break;

    case "cron:job":
      const { job_id, job_description, job_prompt } = event.payload as {
        job_id: string;
        job_description: string;
        job_prompt: string;
      };

      sessionKey = `cron-${job_id}`;
      prompt = `[Scheduled Task: ${job_description}]\n\n${job_prompt}`;
      break;

    default:
      sessionKey = `event-${event.type}`;
      prompt = `[Event: ${event.type}] ${JSON.stringify(event.payload)}`;
  }

  // Generate deterministic UUID for this session
  const sessionId = generateSessionId(sessionKey);
  const knownSessions = getKnownSessions();
  const isNewSession = !knownSessions.has(sessionId);

  // Extract telegram chat_id for relaying responses
  const telegramChatId = event.type === "telegram:message"
    ? (event.payload as { chat_id: number }).chat_id
    : null;

  // Spawn Claude to handle the event
  return new Promise((resolve, reject) => {
    log(`[Watcher] Spawning Claude for event: ${event.type}`);
    logSection("PROMPT", prompt);

    // Use --session-id for new sessions, --resume for existing
    const sessionArg = isNewSession
      ? ["--session-id", sessionId]
      : ["--resume", sessionId];

    log(`[Watcher] Session ${sessionId} (${isNewSession ? "new" : "resuming"})`);

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
        cwd: "/home/ubuntu/pHouseClawd",
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

      // Process complete lines (streaming JSON is newline-delimited)
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const streamEvent = JSON.parse(line);
          const formatted = formatStreamEvent(streamEvent);
          if (formatted) {
            fs.appendFileSync(LOG_FILE, formatted + "\n");
            process.stdout.write(formatted + "\n");
          }
        } catch {
          // Not JSON, output as-is
          fs.appendFileSync(LOG_FILE, line + "\n");
          process.stdout.write(line + "\n");
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
      logSection("CLAUDE OUTPUT COMPLETE", `Exit code: ${code}`);

      if (code !== 0) {
        log(`[Watcher] Claude exited with code ${code}`);
        if (stderr) {
          logSection("STDERR", stderr);
        }
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
      reject(err);
    });
  });
}

async function pollOnce(): Promise<void> {
  // If already processing, mark that we need to poll again when done
  if (isProcessing) {
    pendingPoll = true;
    log("[Watcher] Already processing, will poll again when done");
    return;
  }

  isProcessing = true;
  pendingPoll = false;

  try {
    const events = getPendingEvents();

    for (const event of events) {
      try {
        markProcessed(event.id); // Mark first to prevent re-processing
        await handleEvent(event);
      } catch (error) {
        log(`[Watcher] Error handling event ${event.id}: ${error}`);
      }
    }
  } finally {
    isProcessing = false;

    // If new events came in while processing, poll again
    if (pendingPoll) {
      log("[Watcher] Processing queued poll...");
      setImmediate(() => pollOnce());
    }
  }
}

// Parse human-readable schedules to cron expressions
function parseSchedule(schedule: string): string {
  const lower = schedule.toLowerCase().trim();

  // Already a cron expression (contains spaces and looks like cron)
  if (/^[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+$/.test(schedule)) {
    return schedule;
  }

  // Human-readable patterns
  if (lower === "every minute") return "* * * * *";
  if (lower === "every hour") return "0 * * * *";
  if (lower === "every day" || lower === "daily") return "0 9 * * *";
  if (lower === "every week" || lower === "weekly") return "0 9 * * 1";

  // "every X minutes"
  const minMatch = lower.match(/^every (\d+) minutes?$/);
  if (minMatch) return `*/${minMatch[1]} * * * *`;

  // "every X hours"
  const hourMatch = lower.match(/^every (\d+) hours?$/);
  if (hourMatch) return `0 */${hourMatch[1]} * * *`;

  // "daily at Xam/pm" or "every day at X"
  const dailyAtMatch = lower.match(/(?:daily|every day) at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (dailyAtMatch) {
    let hour = parseInt(dailyAtMatch[1]);
    const minute = dailyAtMatch[2] ? parseInt(dailyAtMatch[2]) : 0;
    const ampm = dailyAtMatch[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  // "at Xam/pm" (daily)
  const atMatch = lower.match(/^at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (atMatch) {
    let hour = parseInt(atMatch[1]);
    const minute = atMatch[2] ? parseInt(atMatch[2]) : 0;
    const ampm = atMatch[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  // Return as-is if no match (assume it's a cron expression)
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

function scheduleCronJobs(): void {
  // Stop all existing cron tasks
  for (const [id, task] of activeCronTasks) {
    task.stop();
    log(`[Cron] Stopped job: ${id}`);
  }
  activeCronTasks.clear();

  const config = loadCronConfig();

  for (const job of config.jobs) {
    if (!job.enabled) {
      log(`[Cron] Skipping disabled job: ${job.id}`);
      continue;
    }

    const cronExpression = parseSchedule(job.schedule);

    if (!cron.validate(cronExpression)) {
      log(`[Cron] Invalid schedule for job ${job.id}: ${job.schedule} -> ${cronExpression}`);
      continue;
    }

    const task = cron.schedule(cronExpression, () => {
      log(`[Cron] Triggering job: ${job.id} (${job.description})`);
      pushEvent("cron:job", "cron", {
        job_id: job.id,
        job_description: job.description,
        job_prompt: job.prompt,
      });
    });

    activeCronTasks.set(job.id, task);
    log(`[Cron] Scheduled job: ${job.id} with schedule "${job.schedule}" -> "${cronExpression}"`);
  }

  log(`[Cron] ${activeCronTasks.size} jobs scheduled`);
}

async function watch(): Promise<void> {
  log("[Watcher] Starting event watcher...");
  log(`[Watcher] Monitoring: ${PENDING_DIR}`);
  log(`[Watcher] Logging to: ${LOG_FILE}`);

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

  // Initial poll
  await pollOnce();

  // Watch for new files
  fs.watch(PENDING_DIR, async (eventType, filename) => {
    if (filename?.endsWith(".json")) {
      // Small delay to ensure file is fully written
      await new Promise((r) => setTimeout(r, 100));
      await pollOnce();
    }
  });

  // Backup polling in case fs.watch misses something
  setInterval(pollOnce, POLL_INTERVAL * 10);

  log("[Watcher] Ready and waiting for events...");
}

watch().catch((err) => {
  log(`[Watcher] Fatal error: ${err}`);
  process.exit(1);
});
