import { Telegraf } from "telegraf";
import { config } from "dotenv";

config({ path: "/home/ubuntu/pHouseMcp/.env" });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const chatId = parseInt(process.argv[2]);

if (!chatId) {
  console.error("Usage: npx tsx typing.ts <chat_id>");
  process.exit(1);
}

bot.telegram.sendChatAction(chatId, "typing").then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
