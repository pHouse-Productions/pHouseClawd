import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Telegraf } from "telegraf";
import "dotenv/config";

// Message queue to store incoming messages
interface TelegramMessage {
  chatId: number;
  username?: string;
  firstName?: string;
  text: string;
  timestamp: Date;
}

const messageQueue: TelegramMessage[] = [];

// Initialize Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Listen for incoming messages and queue them
bot.on("message", (ctx) => {
  if ("text" in ctx.message) {
    const msg: TelegramMessage = {
      chatId: ctx.chat.id,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      text: ctx.message.text,
      timestamp: new Date(),
    };
    messageQueue.push(msg);
    console.error(`[Telegram] Received: "${msg.text}" from ${msg.firstName || msg.username || msg.chatId}`);
  }
});

// Start Telegram bot
bot.launch().then(() => {
  console.error("[Telegram] Bot connected and listening for messages");
});

// Create MCP server
const server = new Server(
  { name: "telegram", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_messages",
      description: "Get pending messages from Telegram. Returns and clears the message queue.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "send_message",
      description: "Send a message to a Telegram chat",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "number",
            description: "The Telegram chat ID to send the message to",
          },
          text: {
            type: "string",
            description: "The message text to send",
          },
        },
        required: ["chat_id", "text"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_messages") {
    const messages = [...messageQueue];
    messageQueue.length = 0; // Clear the queue

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: "No new messages" }],
      };
    }

    const formatted = messages.map((m) => ({
      chat_id: m.chatId,
      from: m.firstName || m.username || String(m.chatId),
      text: m.text,
      time: m.timestamp.toISOString(),
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
    };
  }

  if (name === "send_message") {
    const { chat_id, text } = args as { chat_id: number; text: string };

    try {
      await bot.telegram.sendMessage(chat_id, text);
      console.error(`[Telegram] Sent message to ${chat_id}: "${text.substring(0, 50)}..."`);
      return {
        content: [{ type: "text", text: `Message sent to ${chat_id}` }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send message: ${errMsg}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// Start MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Telegram MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  bot.stop("SIGINT");
  process.exit(0);
});
process.on("SIGTERM", () => {
  bot.stop("SIGTERM");
  process.exit(0);
});
