import { Router, Request, Response } from "express";
import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

const PROJECT_ROOT = getProjectRoot();
const MCP_ROOT = path.resolve(PROJECT_ROOT, "../pHouseMcp");
const CREDENTIALS_PATH = path.join(MCP_ROOT, "credentials/client_secret.json");
const TOKEN_PATH = path.join(MCP_ROOT, "credentials/tokens.json");
const GCHAT_SECURITY_CONFIG = path.join(PROJECT_ROOT, "config/gchat-security.json");

interface GChatSecurityConfig {
  allowedSpaces: string[];
  myUserId?: string;
}

async function loadSecurityConfig(): Promise<GChatSecurityConfig> {
  try {
    const data = await fs.readFile(GCHAT_SECURITY_CONFIG, "utf-8");
    return JSON.parse(data);
  } catch {
    return { allowedSpaces: [] };
  }
}

async function saveSecurityConfig(config: GChatSecurityConfig): Promise<void> {
  await fs.writeFile(GCHAT_SECURITY_CONFIG, JSON.stringify(config, null, 2) + "\n");
}

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

router.get("/spaces", async (_req: Request, res: Response) => {
  try {
    const auth = await getOAuth2Client();
    const chat = google.chat({ version: "v1", auth });

    // Load existing config
    const securityConfig = await loadSecurityConfig();

    // Get list of spaces
    const spacesResponse = await chat.spaces.list({ pageSize: 100 });
    const spaces = spacesResponse.data.spaces || [];

    // Only auto-detect user ID if not already configured
    let myUserId: string | null = securityConfig.myUserId || null;

    if (!myUserId) {
      // Find any space we can send a message to
      const targetSpace = spaces.find(s => s.spaceType === "SPACE" || s.spaceType === "DIRECT_MESSAGE");
      if (targetSpace && targetSpace.name) {
        try {
          // Send a test message and immediately delete it to get our user ID
          const testMessage = await chat.spaces.messages.create({
            parent: targetSpace.name,
            requestBody: {
              text: "Auto-detecting user ID (this message will be deleted)",
            },
          });

          // The sender of this message is us - this is the ID we need
          if (testMessage.data.sender?.name) {
            myUserId = testMessage.data.sender.name;
            // Save to config so we don't do this again
            securityConfig.myUserId = myUserId;
            await saveSecurityConfig(securityConfig);
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
    }

    // Format spaces for UI
    const formattedSpaces = spaces.map(space => ({
      name: space.name,
      displayName: space.displayName || "(Direct Message)",
      type: space.spaceType,
    }));

    res.json({
      spaces: formattedSpaces,
      myUserId,
    });
  } catch (error: any) {
    console.error("Error fetching spaces:", error);
    res.status(500).json({ error: error.message || "Failed to fetch spaces" });
  }
});

export default router;
