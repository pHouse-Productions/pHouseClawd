import { Telegraf } from "telegraf";
import { config } from "dotenv";

config({ path: "/home/ubuntu/pHouseMcp/.env" });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const chatId = parseInt(process.argv[2]);
const messageId = parseInt(process.argv[3]);

if (!chatId || !messageId) {
  console.error("Usage: npx tsx remove-reaction.ts <chat_id> <message_id>");
  process.exit(1);
}

// Pass empty array to remove all reactions
bot.telegram.setMessageReaction(chatId, messageId, []).then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
