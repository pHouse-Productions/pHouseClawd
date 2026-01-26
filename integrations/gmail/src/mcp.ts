import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, "../client_secret.json");
const TOKEN_PATH = path.join(__dirname, "../tokens.json");

// Load credentials and tokens
function getOAuth2Client() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = credentials.installed;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "http://localhost:8080"
  );

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oauth2Client.setCredentials(tokens);

  // Auto-refresh tokens when they expire
  oauth2Client.on("tokens", (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    const updatedTokens = { ...currentTokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens, null, 2));
    fs.chmodSync(TOKEN_PATH, 0o600);
  });

  return oauth2Client;
}

const auth = getOAuth2Client();
const gmail = google.gmail({ version: "v1", auth });

interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

interface EmailFull {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  html?: string;
}

function getHeader(headers: { name: string; value: string }[], name: string): string {
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBody(payload: any): { text: string; html?: string } {
  let text = "";
  let html: string | undefined;

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") {
      html = decoded;
    } else {
      text = decoded;
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        html = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        const nested = extractBody(part);
        if (nested.text) text = nested.text;
        if (nested.html) html = nested.html;
      }
    }
  }

  return { text, html };
}

async function fetchEmails(
  folder: string,
  count: number,
  unseenOnly: boolean
): Promise<EmailSummary[]> {
  let query = "";
  if (folder.toUpperCase() !== "INBOX") {
    query = `in:${folder}`;
  }
  if (unseenOnly) {
    query = query ? `${query} is:unread` : "is:unread";
  }

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults: count,
    q: query || undefined,
  });

  const messages = response.data.messages || [];
  const emails: EmailSummary[] = [];

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    });

    const headers = detail.data.payload?.headers || [];

    emails.push({
      id: msg.id!,
      threadId: msg.threadId!,
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      date: getHeader(headers, "Date"),
      snippet: detail.data.snippet || "",
    });
  }

  return emails;
}

async function fetchEmailById(id: string): Promise<EmailFull> {
  const detail = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });

  const headers = detail.data.payload?.headers || [];
  const { text, html } = extractBody(detail.data.payload);

  return {
    id: detail.data.id!,
    threadId: detail.data.threadId!,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    body: text,
    html,
  };
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string,
  cc?: string,
  bcc?: string
): Promise<string> {
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];

  if (cc) {
    messageParts.splice(1, 0, `Cc: ${cc}`);
  }
  if (bcc) {
    messageParts.splice(cc ? 2 : 1, 0, `Bcc: ${bcc}`);
  }

  if (html) {
    const boundary = "boundary_" + Date.now();
    messageParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    messageParts.push("");
    messageParts.push(`--${boundary}`);
    messageParts.push("Content-Type: text/plain; charset=utf-8");
    messageParts.push("");
    messageParts.push(body);
    messageParts.push(`--${boundary}`);
    messageParts.push("Content-Type: text/html; charset=utf-8");
    messageParts.push("");
    messageParts.push(html);
    messageParts.push(`--${boundary}--`);
  } else {
    messageParts.push("Content-Type: text/plain; charset=utf-8");
    messageParts.push("");
    messageParts.push(body);
  }

  const message = messageParts.join("\r\n");
  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage,
    },
  });

  return response.data.id || "sent";
}

const server = new Server(
  { name: "gmail", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "fetch_emails",
      description:
        "Fetch recent emails from Gmail inbox. Returns a list of email summaries.",
      inputSchema: {
        type: "object" as const,
        properties: {
          folder: {
            type: "string",
            description: 'The mailbox folder to fetch from (default: "INBOX")',
          },
          count: {
            type: "number",
            description: "Number of recent emails to fetch (default: 10)",
          },
          unseen_only: {
            type: "boolean",
            description: "Only fetch unread emails (default: false)",
          },
        },
        required: [],
      },
    },
    {
      name: "read_email",
      description:
        "Read the full content of a specific email by its ID. Use fetch_emails first to get IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The ID of the email to read",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "send_email",
      description: "Send an email from the Gmail account.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to: {
            type: "string",
            description: "Recipient email address",
          },
          subject: {
            type: "string",
            description: "Email subject line",
          },
          body: {
            type: "string",
            description: "Plain text email body",
          },
          html: {
            type: "string",
            description: "Optional HTML email body",
          },
          cc: {
            type: "string",
            description: "CC recipient(s) - comma-separated for multiple",
          },
          bcc: {
            type: "string",
            description: "BCC recipient(s) - comma-separated for multiple",
          },
        },
        required: ["to", "subject", "body"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "fetch_emails") {
    const {
      folder = "INBOX",
      count = 10,
      unseen_only = false,
    } = (args as { folder?: string; count?: number; unseen_only?: boolean }) ||
    {};

    try {
      const emails = await fetchEmails(folder, count, unseen_only);
      return {
        content: [{ type: "text", text: JSON.stringify(emails, null, 2) }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to fetch emails: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "read_email") {
    const { id } = args as { id: string };

    try {
      const email = await fetchEmailById(id);
      return {
        content: [{ type: "text", text: JSON.stringify(email, null, 2) }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to read email: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "send_email") {
    const { to, subject, body, html, cc, bcc } = args as {
      to: string;
      subject: string;
      body: string;
      html?: string;
      cc?: string;
      bcc?: string;
    };

    try {
      const messageId = await sendEmail(to, subject, body, html, cc, bcc);
      return {
        content: [
          { type: "text", text: `Email sent successfully. Message ID: ${messageId}` },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to send email: ${errMsg}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Gmail MCP server running (Google API v2)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
