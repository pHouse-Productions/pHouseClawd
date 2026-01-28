#!/usr/bin/env npx tsx
/**
 * Test script to verify Google Chat API access
 * Lists all spaces the user is a member of
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

  oauth2Client.on("tokens", (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    const updatedTokens = { ...currentTokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens, null, 2));
    fs.chmodSync(TOKEN_PATH, 0o600);
  });

  return oauth2Client;
}

async function main() {
  const auth = getOAuth2Client();
  const chat = google.chat({ version: "v1", auth });

  console.log("Fetching spaces...\n");

  try {
    const response = await chat.spaces.list({
      pageSize: 100,
    });

    const spaces = response.data.spaces || [];

    if (spaces.length === 0) {
      console.log("No spaces found. Make sure you have Google Chat conversations.");
      return;
    }

    console.log(`Found ${spaces.length} space(s):\n`);

    for (const space of spaces) {
      console.log(`Name: ${space.name}`);
      console.log(`Display Name: ${space.displayName || "(DM or unnamed)"}`);
      console.log(`Type: ${space.spaceType}`);
      console.log(`---`);
    }

    console.log("\nTo whitelist a space, add its 'name' (e.g., spaces/AAAA...) to:");
    console.log("/home/ubuntu/pHouseClawd/config/gchat-security.json");
  } catch (error: any) {
    console.error("Error fetching spaces:", error.message);
    console.error("\nFull error details:");
    console.error(JSON.stringify(error.response?.data || error, null, 2));
  }
}

main();
