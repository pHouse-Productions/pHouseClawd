#!/usr/bin/env npx tsx
/**
 * List members of a Google Chat space to find user IDs
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

  return oauth2Client;
}

async function main() {
  const spaceName = process.argv[2] || "spaces/10n2gSAAAAE";

  const auth = getOAuth2Client();
  const chat = google.chat({ version: "v1", auth });

  console.log(`Listing members of ${spaceName}...\n`);

  try {
    const response = await chat.spaces.members.list({ parent: spaceName });

    for (const membership of response.data.memberships || []) {
      console.log("Membership:", JSON.stringify(membership, null, 2));
      console.log("---");
    }
  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

main();
