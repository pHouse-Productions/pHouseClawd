import { NextResponse } from "next/server";
import { google } from "googleapis";
import { promises as fs } from "fs";
import path from "path";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const MCP_ROOT = path.resolve(PROJECT_ROOT, "../pHouseMcp");
const CREDENTIALS_PATH = path.join(MCP_ROOT, "credentials/client_secret.json");
const TOKEN_PATH = path.join(MCP_ROOT, "credentials/tokens.json");

async function getOAuth2Client() {
  const credentialsRaw = await fs.readFile(CREDENTIALS_PATH, "utf-8");
  const credentials = JSON.parse(credentialsRaw);
  const creds = credentials.installed || credentials.web;
  if (!creds) {
    throw new Error("Invalid credentials file");
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:8080"
  );

  const tokensRaw = await fs.readFile(TOKEN_PATH, "utf-8");
  const tokens = JSON.parse(tokensRaw);
  oauth2Client.setCredentials(tokens);

  return oauth2Client;
}

export async function GET() {
  try {
    const auth = await getOAuth2Client();
    const chat = google.chat({ version: "v1", auth });

    // Get list of spaces
    const spacesResponse = await chat.spaces.list({ pageSize: 100 });
    const spaces = spacesResponse.data.spaces || [];

    // Try to get our own user ID by sending a test message and checking the sender
    // This is the most reliable way since the sender ID on sent messages is what we need to filter
    let myUserId: string | null = null;

    // Find any space we can send a message to
    const targetSpace = spaces.find(s => s.spaceType === "SPACE" || s.spaceType === "DIRECT_MESSAGE");
    if (targetSpace && targetSpace.name) {
      try {
        // Send a test message and immediately delete it to get our user ID
        const testMessage = await chat.spaces.messages.create({
          parent: targetSpace.name,
          requestBody: {
            text: "🔧 Auto-detecting user ID (this message will be deleted)",
          },
        });

        // The sender of this message is us - this is the ID we need
        if (testMessage.data.sender?.name) {
          myUserId = testMessage.data.sender.name;
        }

        // Delete the test message
        if (testMessage.data.name) {
          try {
            await chat.spaces.messages.delete({
              name: testMessage.data.name,
            });
          } catch (deleteErr) {
            // Deletion might fail if we don't have permission, that's OK
            console.log("Could not delete test message:", deleteErr);
          }
        }
      } catch (err) {
        console.error("Error detecting user ID:", err);
      }
    }

    // Format spaces for UI
    const formattedSpaces = spaces.map(space => ({
      name: space.name,
      displayName: space.displayName || "(Direct Message)",
      type: space.spaceType,
    }));

    return NextResponse.json({
      spaces: formattedSpaces,
      myUserId,
    });
  } catch (error: any) {
    console.error("Error fetching spaces:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch spaces" },
      { status: 500 }
    );
  }
}
