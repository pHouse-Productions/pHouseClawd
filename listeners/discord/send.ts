import { Client, GatewayIntentBits, TextChannel, DMChannel, NewsChannel } from "discord.js";
import { config } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

// Load environment variables from sibling pHouseMcp directory
config({ path: path.resolve(PROJECT_ROOT, "../pHouseMcp/.env") });

const channelId = process.argv[2];
const message = process.argv[3];

if (!channelId || !message) {
  console.error("Usage: send.ts <channel_id> <message>");
  process.exit(1);
}

const botToken = process.env.DISCORD_BOT_TOKEN;
if (!botToken) {
  console.error("DISCORD_BOT_TOKEN not set");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once("ready", async () => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel)) {
      await channel.send(message);
      console.log("Message sent");
    } else {
      console.error("Channel not found or not a text channel");
    }
  } catch (error) {
    console.error("Failed to send message:", error);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(botToken).catch((err) => {
  console.error("Failed to login:", err);
  process.exit(1);
});
