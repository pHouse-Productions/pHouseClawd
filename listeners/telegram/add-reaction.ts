import { Telegraf } from "telegraf";
import { config } from "dotenv";

config({ path: "/home/ubuntu/pHouseMcp/.env" });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const chatId = parseInt(process.argv[2]);
const messageId = parseInt(process.argv[3]);
const emoji = process.argv[4] || "👀";

if (!chatId || !messageId) {
  console.error("Usage: npx tsx add-reaction.ts <chat_id> <message_id> [emoji]");
  process.exit(1);
}

bot.telegram.setMessageReaction(chatId, messageId, [
  { type: "emoji", emoji } as any,
]).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
