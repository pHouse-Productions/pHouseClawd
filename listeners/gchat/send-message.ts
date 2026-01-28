#!/usr/bin/env npx tsx
/**
 * Standalone script to send a Google Chat message
 * Usage: npx tsx send-message.ts <spaceName> <text>
 */

import { google } from "googleapis";
import * as fs from "fs";

const CREDENTIALS_PATH = "/home/ubuntu/pHouseMcp/credentials/client_secret.json";
const TOKEN_PATH = "/home/ubuntu/pHouseMcp/credentials/tokens.json";

function getOAuth2Client() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const creds = credentials.installed || credentials.web;
  if (!creds) {
    throw new Error("Invalid credentials file: must contain 'installed' or 'web' key");
  }
  const { client_id, client_secret } = creds;

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

async function sendMessage(spaceName: string, text: string): Promise<string> {
  const auth = getOAuth2Client();
  const chat = google.chat({ version: "v1", auth });

  const response = await chat.spaces.messages.create({
    parent: spaceName,
    requestBody: {
      text,
    },
  });

  return response.data.name || "sent";
}

async function main() {
  const [, , spaceName, text] = process.argv;

  if (!spaceName || !text) {
    console.error("Usage: npx tsx send-message.ts <spaceName> <text>");
    process.exit(1);
  }

  try {
    const messageName = await sendMessage(spaceName, text);
    console.log(`Message sent successfully. Name: ${messageName}`);
  } catch (error) {
    console.error("Failed to send message:", error);
    process.exit(1);
  }
}

main();
