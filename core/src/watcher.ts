import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import cron from "node-cron";
import { getPendingEvents, markProcessed, Event, pushEvent } from "./events.js";
import { Channel, TelegramChannel, EmailChannel } from "./channels/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

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

const PENDING_DIR = path.join(PROJECT_ROOT, "events/pending");
const PDF_SCRIPT = path.join(PROJECT_ROOT, "scripts/pdf-to-text.py");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");  // Watcher operational logs
const STREAM_LOG = path.join(LOGS_DIR, "claude-stream.jsonl");  // Raw Claude stream events
const SESSIONS_FILE = path.join(LOGS_DIR, "sessions.json");
const CRON_CONFIG_FILE = path.join(PROJECT_ROOT, "config/cron.json");
const POLL_INTERVAL = 1000; // Check every second

// Email security config - loaded from config/email-security.json
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
  // Default: no trusted addresses (all emails forwarded if configured)
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

// Track known sessions and their generations
interface SessionData {
  known: string[];
  generations: Record<string, number>;  // sessionKey -> generation counter
}

function loadSessionData(): SessionData {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      // Handle legacy format (just an array of session IDs)
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
  // Get the current generation's session ID before incrementing
  const currentGen = data.generations[sessionKey] || 0;
  const oldSessionId = generateSessionId(`${sessionKey}-gen${currentGen}`);
  // Remove old session ID from known list
  data.known = data.known.filter(id => id !== oldSessionId);
  // Increment generation so next session gets a new ID
  data.generations[sessionKey] = currentGen + 1;
  saveSessionData(data);
}

function getSessionGeneration(sessionKey: string): number {
  return loadSessionData().generations[sessionKey] || 0;
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

// Log a raw stream event to JSONL (adds timestamp wrapper)
function logStreamEvent(event: any) {
  const entry = {
    ts: new Date().toISOString(),
    ...event
  };
  fs.appendFileSync(STREAM_LOG, JSON.stringify(entry) + "\n");
}

// Verbosity levels for chat surfaces
type Verbosity = "streaming" | "progress" | "final";

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

// Send email reply via Gmail MCP script (used for forwarding untrusted emails)
async function sendEmailReply(to: string, subject: string, body: string, threadId?: string, messageId?: string): Promise<void> {
  if (!body || !body.trim()) return;

  // Ensure subject has Re: prefix
  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

  // Build args - threadId and messageId are optional
  const args = ["tsx", path.join(PROJECT_ROOT, "listeners/gmail/send-reply.ts"), to, replySubject, body];
  args.push(threadId || "");  // 4th arg: threadId (empty string if none)
  args.push(messageId || ""); // 5th arg: messageId for In-Reply-To header

  try {
    const proc = spawn("npx", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    proc.unref();
    log(`[Relay] Sent email reply to ${to} (thread: ${threadId || 'new'}, inReplyTo: ${messageId || 'none'}): ${body.slice(0, 100)}${body.length > 100 ? '...' : ''}`);
  } catch (err) {
    log(`[Relay] Failed to send email reply: ${err}`);
  }
}

async function handleEvent(event: Event): Promise<void> {
  log(`[Watcher] Processing: ${event.type} from ${event.source}`);
  log(`[Watcher] Payload: ${JSON.stringify(event.payload)}`);

  // Build prompt and session key based on event type
  let prompt: string;
  let sessionKey: string;

  // Track if we need to pass an image to Claude
  let imagePath: string | null = null;

  // Check for /new command to start fresh session
  let forceNewSession = false;

  // Channel for handling stream events (Telegram, Email, etc.)
  let channel: Channel | null = null;

  switch (event.type) {
    case "telegram:message":
      const { chat_id, from, text, verbosity: msgVerbosity } = event.payload as {
        chat_id: number;
        from: string;
        text: string;
        verbosity?: Verbosity;
      };

      // Create telegram channel (handles typing indicators and message relay)
      channel = new TelegramChannel(chat_id, msgVerbosity || "streaming");

      sessionKey = `telegram-${chat_id}`;

      // Handle /new command
      if (text.trim().toLowerCase() === "/new") {
        clearSession(sessionKey);
        log(`[Watcher] Session cleared for ${sessionKey} via /new command`);
        // Stop typing and send confirmation
        channel.onComplete(0);
        const sendScript = path.join(PROJECT_ROOT, "listeners/telegram/send.ts");
        spawn("npx", ["tsx", sendScript, String(chat_id), "Fresh start, boss. New session is ready."], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        }).unref();
        return;
      }

      // Handle /restart command
      if (text.trim().toLowerCase() === "/restart") {
        log(`[Watcher] Restart requested via /restart command`);
        // Stop typing and send confirmation
        channel.onComplete(0);
        const sendScript = path.join(PROJECT_ROOT, "listeners/telegram/send.ts");
        spawn("npx", ["tsx", sendScript, String(chat_id), "Restarting... Back in a few seconds."], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        }).unref();
        // Trigger restart script in background (detached so it survives our death)
        spawn(path.join(PROJECT_ROOT, "restart.sh"), [], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        }).unref();
        return;
      }

      prompt = `[Telegram from ${from}]: ${text}`;
      break;

    case "telegram:photo":
      const { chat_id: photoChatId, from: photoFrom, caption, image_path, verbosity: photoVerbosity } = event.payload as {
        chat_id: number;
        from: string;
        caption: string;
        image_path: string;
        verbosity?: Verbosity;
      };

      sessionKey = `telegram-${photoChatId}`;
      channel = new TelegramChannel(photoChatId, photoVerbosity || "streaming");
      imagePath = image_path;
      prompt = caption
        ? `[Telegram photo from ${photoFrom}]: ${caption}\n\nIMPORTANT: User sent an image. Use the Read tool to view the image at: ${image_path}`
        : `[Telegram photo from ${photoFrom}]: User sent an image with no caption.\n\nIMPORTANT: Use the Read tool to view the image at: ${image_path}`;
      break;

    case "telegram:document":
      const { chat_id: docChatId, from: docFrom, caption: docCaption, file_path, file_name, mime_type, verbosity: docVerbosity } = event.payload as {
        chat_id: number;
        from: string;
        caption: string;
        file_path: string;
        file_name: string;
        mime_type: string;
        verbosity?: Verbosity;
      };

      sessionKey = `telegram-${docChatId}`;
      channel = new TelegramChannel(docChatId, docVerbosity || "streaming");

      // Provide appropriate instructions based on file type
      let fileInstructions: string;
      let fileToRead = file_path;

      if (mime_type === "application/pdf" || file_name.toLowerCase().endsWith(".pdf")) {
        // Convert PDF to text first
        try {
          const textPath = await convertPdfToText(file_path);
          fileToRead = textPath;
          fileInstructions = `The PDF has been converted to text. Use the Read tool to view it at: ${textPath}`;
        } catch (err) {
          log(`[PDF] Conversion failed, falling back to raw path: ${err}`);
          fileInstructions = `PDF conversion failed. The raw PDF is at: ${file_path}`;
        }
      } else if (mime_type.startsWith("image/")) {
        fileInstructions = `Use the Read tool to view the image at: ${file_path}`;
      } else {
        fileInstructions = `The file has been saved to: ${file_path}`;
      }

      prompt = docCaption
        ? `[Telegram document from ${docFrom}]: ${docCaption}\n\nFile: ${file_name} (${mime_type})\n\nIMPORTANT: ${fileInstructions}`
        : `[Telegram document from ${docFrom}]: User sent a file.\n\nFile: ${file_name} (${mime_type})\n\nIMPORTANT: ${fileInstructions}`;
      break;

    case "gmail:email":
      const { uid, from: emailFrom, to, subject, date, body, thread_id, message_id } = event.payload as {
        uid: number;
        from: string;
        to: string;
        subject: string;
        date: string;
        body: string;
        thread_id?: string;
        message_id?: string;
      };

      // SECURITY CHECK: Load config and check if sender is trusted
      const emailSecurityConfig = loadEmailSecurityConfig();
      const emailAddress = emailFrom.match(/<(.+)>/)?.[1] || emailFrom;
      const isTrustedSender = emailSecurityConfig.trustedEmailAddresses.some(
        (trusted) => trusted.toLowerCase() === emailAddress.toLowerCase()
      );

      if (!isTrustedSender) {
        // Untrusted sender - forward to Mike's email if configured, do NOT reply directly
        log(`[Security] Untrusted email sender: ${emailFrom} - blocking auto-reply`);

        if (emailSecurityConfig.forwardUntrustedTo) {
          const forwardSubject = `Fwd: ${subject}`;
          const forwardBody = `---------- Forwarded message ----------\nFrom: ${emailFrom}\nDate: ${date}\nSubject: ${subject}\n\n${body}`;
          await sendEmailReply(emailSecurityConfig.forwardUntrustedTo, forwardSubject, forwardBody);
          log(`[Security] Forwarded untrusted email to ${emailSecurityConfig.forwardUntrustedTo}`);
        }
        return; // Skip Claude invocation entirely
      }

      // Use thread_id if available, otherwise use subject as session key
      sessionKey = `email-${thread_id || subject.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 50)}`;

      // Create email channel
      channel = new EmailChannel({
        replyTo: emailFrom,
        subject: subject,
        threadId: thread_id,
        messageId: message_id,
      });

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

  // Generate deterministic UUID for this session (including generation counter)
  const generation = getSessionGeneration(sessionKey);
  const sessionId = generateSessionId(`${sessionKey}-gen${generation}`);
  const knownSessions = getKnownSessions();
  const isNewSession = !knownSessions.has(sessionId);

  // Extract telegram chat_id for relaying responses
  const telegramChatId = event.type === "telegram:message"
    ? (event.payload as { chat_id: number }).chat_id
    : null;

  // Spawn Claude to handle the event
  return new Promise((resolve, reject) => {
    log(`[Watcher] Spawning Claude with prompt: ${prompt.slice(0, 100)}...`);

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

      // Process complete lines (streaming JSON is newline-delimited)
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const streamEvent = JSON.parse(line);

          // Log every event to JSONL
          logStreamEvent(streamEvent);

          // Pass stream event to channel for handling
          if (channel) {
            channel.onStreamEvent(streamEvent);
          }
        } catch {
          // Not JSON, log raw line
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

      // Notify channel that we're done
      if (channel) {
        channel.onComplete(code || 0);
      }

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
      // Notify channel of error
      if (channel) {
        channel.onComplete(1);
      }
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

function scheduleCronJobs(): void {
  // Stop all existing cron tasks
  for (const [id, task] of activeCronTasks) {
    task.stop();
    log(`[Cron] Stopped job: ${id}`);
  }
  activeCronTasks.clear();

  // Clear all existing timeouts
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

    // Handle one-off tasks with run_at
    if (job.run_once && job.run_at) {
      const runAt = new Date(job.run_at);
      const now = new Date();
      const delayMs = runAt.getTime() - now.getTime();

      if (delayMs <= 0) {
        // Already past, run immediately and delete
        log(`[Cron] One-off job ${job.id} is past due, running now`);
        pushEvent("cron:job", "cron", {
          job_id: job.id,
          job_description: job.description,
          job_prompt: job.prompt,
          run_once: true,
        });
        deleteJob(job.id);
      } else {
        // Schedule for future
        const timeout = setTimeout(() => {
          log(`[Cron] Triggering one-off job: ${job.id} (${job.description})`);
          pushEvent("cron:job", "cron", {
            job_id: job.id,
            job_description: job.description,
            job_prompt: job.prompt,
            run_once: true,
          });
          deleteJob(job.id);
          activeTimeouts.delete(job.id);
        }, delayMs);

        activeTimeouts.set(job.id, timeout);
        const mins = Math.round(delayMs / 60000);
        log(`[Cron] Scheduled one-off job: ${job.id} to run in ${mins} minutes`);
        oneOffCount++;
      }
      continue;
    }

    // Handle recurring cron jobs
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
    }, { timezone: "America/Toronto" });

    activeCronTasks.set(job.id, task);
    log(`[Cron] Scheduled job: ${job.id} with schedule "${job.schedule}" -> "${cronExpression}"`);
    recurringCount++;
  }

  log(`[Cron] ${recurringCount} recurring jobs, ${oneOffCount} one-off tasks scheduled`);
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
