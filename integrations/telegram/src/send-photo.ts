import { Telegraf } from "telegraf";
import { saveMessage } from "./history.js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const chatId = parseInt(process.argv[2]);
const photoPath = process.argv[3];
const caption = process.argv[4] || "";

if (!chatId || !photoPath) {
  console.error("Usage: npx tsx src/send-photo.ts <chat_id> <photo_path> [caption]");
  process.exit(1);
}

if (!fs.existsSync(photoPath)) {
  console.error(`Photo not found: ${photoPath}`);
  process.exit(1);
}

bot.telegram.sendPhoto(chatId, { source: photoPath }, { caption }).then(() => {
  // Save to history
  saveMessage(chatId, {
    role: "assistant",
    text: caption ? `[Photo] ${caption}` : "[Photo sent]",
    timestamp: new Date().toISOString(),
  });

  console.log("sent");
  process.exit(0);
}).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
