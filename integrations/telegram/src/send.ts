import { Telegraf } from "telegraf";
import { saveMessage } from "./history.js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import * as path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const chatId = parseInt(process.argv[2]);
const text = process.argv[3];

if (!chatId || !text) {
  console.error("Usage: npx tsx src/send.ts <chat_id> <message>");
  process.exit(1);
}

bot.telegram.sendMessage(chatId, text).then(() => {
  // Save to history
  saveMessage(chatId, {
    role: "assistant",
    text: text,
    timestamp: new Date().toISOString(),
  });

  console.log("sent");
  process.exit(0);
}).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
