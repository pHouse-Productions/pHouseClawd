import { Telegraf } from "telegraf";
import { saveMessage } from "./history.js";
import { pushEvent } from "../../../core/src/events.js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const IMAGES_DIR = "/home/ubuntu/pHouseClawd/memory/telegram/images";

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

async function downloadFile(fileId: string, destPath: string): Promise<void> {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const url = fileLink.href;

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// Mode: "once" (default) or "daemon"
const mode = process.argv[2] || "once";

bot.on("message", async (ctx) => {
  const chatId = ctx.chat.id;
  const from = ctx.from?.first_name || ctx.from?.username || String(chatId);

  // Handle text messages
  if ("text" in ctx.message) {
    const text = ctx.message.text;

    // Save to history
    saveMessage(chatId, {
      role: "user",
      name: from,
      text: text,
      timestamp: new Date().toISOString(),
    });

    // Push to event queue with streaming verbosity by default
    const eventId = pushEvent("telegram:message", "telegram", {
      chat_id: chatId,
      from,
      text,
      verbosity: "streaming",
    });

    console.log(JSON.stringify({ chat_id: chatId, from, text, event_id: eventId }, null, 2));

    if (mode === "once") {
      bot.stop();
      process.exit(0);
    }
  }

  // Handle photo messages
  if ("photo" in ctx.message) {
    const photo = ctx.message.photo;
    // Get the largest photo (last in array)
    const largestPhoto = photo[photo.length - 1];
    const caption = ctx.message.caption || "";
    const timestamp = Date.now();
    const filename = `${chatId}_${timestamp}.jpg`;
    const imagePath = path.join(IMAGES_DIR, filename);

    try {
      await downloadFile(largestPhoto.file_id, imagePath);

      // Save to history
      saveMessage(chatId, {
        role: "user",
        name: from,
        text: caption ? `[Photo] ${caption}` : "[Photo]",
        timestamp: new Date().toISOString(),
      });

      // Push to event queue with image path and streaming verbosity
      const eventId = pushEvent("telegram:photo", "telegram", {
        chat_id: chatId,
        from,
        caption,
        image_path: imagePath,
        verbosity: "streaming",
      });

      console.log(JSON.stringify({ chat_id: chatId, from, caption, image_path: imagePath, event_id: eventId }, null, 2));

      if (mode === "once") {
        bot.stop();
        process.exit(0);
      }
    } catch (err) {
      console.error(`Failed to download photo: ${err}`);
    }
  }
});

bot.launch().then(() => {
  console.error(`[Telegram] Bot running in ${mode} mode`);
});

if (mode === "once") {
  // Timeout after 60 seconds in once mode
  setTimeout(() => {
    console.log(JSON.stringify({ error: "timeout" }));
    bot.stop();
    process.exit(1);
  }, 60000);
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
