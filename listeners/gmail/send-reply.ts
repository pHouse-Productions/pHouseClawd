#!/usr/bin/env npx tsx
/**
 * Standalone script to send an email reply
 * Usage: npx tsx send-reply.ts <to> <subject> <body> [threadId] [inReplyToMessageId]
 */

import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = "/home/ubuntu/pHouseMcp/credentials/client_secret.json";
const TOKEN_PATH = "/home/ubuntu/pHouseMcp/credentials/tokens.json";

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

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  inReplyTo?: string
): Promise<string> {
  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
  ];

  // Add threading headers if we have the original message ID
  if (inReplyTo) {
    messageParts.push(`In-Reply-To: ${inReplyTo}`);
    messageParts.push(`References: ${inReplyTo}`);
  }

  messageParts.push(
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  );

  const message = messageParts.join("\r\n");
  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const requestBody: { raw: string; threadId?: string } = {
    raw: encodedMessage,
  };

  // If threadId provided, include it to keep the reply in the same thread
  if (threadId) {
    requestBody.threadId = threadId;
  }

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody,
  });

  return response.data.id || "sent";
}

async function main() {
  const [, , to, subject, body, threadId, inReplyTo] = process.argv;

  if (!to || !subject || !body) {
    console.error("Usage: npx tsx send-reply.ts <to> <subject> <body> [threadId] [inReplyToMessageId]");
    process.exit(1);
  }

  try {
    // Empty strings become undefined
    const tid = threadId && threadId.trim() ? threadId : undefined;
    const replyTo = inReplyTo && inReplyTo.trim() ? inReplyTo : undefined;

    const messageId = await sendEmail(to, subject, body, tid, replyTo);
    console.log(`Email sent successfully. Message ID: ${messageId}`);
  } catch (error) {
    console.error("Failed to send email:", error);
    process.exit(1);
  }
}

main();
