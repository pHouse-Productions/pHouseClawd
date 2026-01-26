import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { spawn } from "child_process";
import Imap from "imap";
import { simpleParser, ParsedMail } from "mailparser";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Gmail config
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const GMAIL_POLL_INTERVAL = parseInt(process.env.GMAIL_POLL_INTERVAL || "30000", 10);
const GMAIL_STATE_FILE = path.join(__dirname, "../../gmail/.last_uid");
const MIKE_CHAT_ID = 5473044160;

const imapConfig: Imap.Config = {
  user: GMAIL_USER!,
  password: GMAIL_APP_PASSWORD!,
  host: "imap.gmail.com",
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
};

function loadLastUid(): number {
  try {
    if (fs.existsSync(GMAIL_STATE_FILE)) {
      return parseInt(fs.readFileSync(GMAIL_STATE_FILE, "utf-8").trim(), 10);
    }
  } catch {
    // Start fresh
  }
  return 0;
}

function saveLastUid(uid: number): void {
  fs.mkdirSync(path.dirname(GMAIL_STATE_FILE), { recursive: true });
  fs.writeFileSync(GMAIL_STATE_FILE, String(uid));
}

interface EmailInfo {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}

function checkForNewEmails(): Promise<EmailInfo[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);
    const lastUid = loadLastUid();
    const newEmails: EmailInfo[] = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        const searchCriteria = lastUid > 0
          ? [["UID", `${lastUid + 1}:*`], "UNSEEN"]
          : ["UNSEEN"];

        imap.search(searchCriteria, (searchErr, results) => {
          if (searchErr) {
            imap.end();
            return reject(searchErr);
          }

          if (results.length === 0) {
            imap.end();
            return resolve([]);
          }

          const newUids = results.filter(uid => uid > lastUid);

          if (newUids.length === 0) {
            imap.end();
            return resolve([]);
          }

          const fetch = imap.fetch(newUids, { bodies: "", struct: true });
          let pending = newUids.length;

          fetch.on("message", (msg, seqno) => {
            let rawEmail = "";
            let uid = 0;

            msg.on("body", (stream) => {
              stream.on("data", (chunk) => {
                rawEmail += chunk.toString("utf8");
              });
            });

            msg.once("attributes", (attrs) => {
              uid = attrs.uid;
            });

            msg.once("end", async () => {
              try {
                const parsed: ParsedMail = await simpleParser(rawEmail);
                newEmails.push({
                  uid,
                  from: parsed.from?.text || "",
                  to: Array.isArray(parsed.to)
                    ? parsed.to.map((addr) => addr.text).join(", ")
                    : parsed.to?.text || "",
                  subject: parsed.subject || "",
                  date: parsed.date?.toISOString() || new Date().toISOString(),
                  body: parsed.text || "",
                });
              } catch (parseErr) {
                console.error(`[Gmail] Failed to parse email UID ${uid}:`, parseErr);
              }

              pending--;
              if (pending === 0) {
                imap.end();
              }
            });
          });

          fetch.once("error", (fetchErr) => {
            imap.end();
            reject(fetchErr);
          });

          fetch.once("end", () => {
            setTimeout(() => {
              if (pending === 0) {
                resolve(newEmails);
              }
            }, 100);
          });
        });
      });
    });

    imap.once("error", (err: Error) => {
      reject(err);
    });

    imap.connect();
  });
}

async function handleNewEmail(email: EmailInfo): Promise<void> {
  console.log(`[Gmail] New email from ${email.from}: ${email.subject}`);

  const prompt = `You received an email.

From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}

Body:
${email.body.substring(0, 2000)}

Analyze this email and take the appropriate action:
1. If it's spam/promotional - just log it and ignore
2. If it seems important or needs Mike's attention - notify him via Telegram
3. If it needs a response - draft one and ask Mike if he wants to send it

Be concise. Use the Telegram send tool if you need to notify Mike.`;

  try {
    await askClaude(prompt);
  } catch (error) {
    console.error("[Gmail] Error processing email:", error);
  }
}

async function pollGmail(): Promise<void> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return; // Gmail not configured
  }

  try {
    const newEmails = await checkForNewEmails();

    if (newEmails.length > 0) {
      newEmails.sort((a, b) => a.uid - b.uid);

      for (const email of newEmails) {
        await handleNewEmail(email);
        saveLastUid(email.uid);
      }
    }
  } catch (error) {
    console.error("[Gmail] Poll error:", error);
  }
}

// Track ongoing conversations to prevent duplicate processing
const processing = new Set<number>();

async function askClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--dangerously-skip-permissions", prompt];

    const proc = spawn("claude", args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error("[Claude] stderr:", stderr);
        reject(new Error(`Claude exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", reject);
  });
}

bot.on(message("text"), async (ctx) => {
  const chatId = ctx.chat.id;
  const userName = ctx.from?.first_name || ctx.from?.username || "User";
  const userMessage = ctx.message.text;

  // Prevent duplicate processing
  if (processing.has(chatId)) {
    console.log(`[${chatId}] Already processing, skipping`);
    return;
  }

  processing.add(chatId);
  console.log(`[${chatId}] ${userName}: ${userMessage}`);

  try {
    // Show typing indicator
    await ctx.sendChatAction("typing");

    // Keep typing indicator alive while Claude thinks
    const typingInterval = setInterval(() => {
      ctx.sendChatAction("typing").catch(() => {});
    }, 4000);

    const prompt = `You received a Telegram message from ${userName}:

"${userMessage}"

Reply naturally and helpfully. Keep your response concise since this is a chat message. Just provide the response text, nothing else.`;

    const response = await askClaude(prompt);
    clearInterval(typingInterval);

    console.log(`[${chatId}] Claude: ${response.substring(0, 100)}...`);

    // Split long messages
    if (response.length > 4096) {
      const chunks = response.match(/.{1,4096}/gs) || [];
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error(`[${chatId}] Error:`, error);
    await ctx.reply("Sorry, I encountered an error. Please try again.");
  } finally {
    processing.delete(chatId);
  }
});

bot.launch().then(async () => {
  console.log("[Daemon] Telegram bot is running");

  // Start Gmail polling if configured
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    console.log(`[Daemon] Gmail polling enabled (every ${GMAIL_POLL_INTERVAL / 1000}s)`);
    await pollGmail(); // Initial poll
    setInterval(pollGmail, GMAIL_POLL_INTERVAL);
  } else {
    console.log("[Daemon] Gmail not configured, skipping");
  }
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
