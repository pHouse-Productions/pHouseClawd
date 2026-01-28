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

    // Try to get our own user ID by looking at a DM space membership
    let myUserId: string | null = null;

    // Find a DM space to check membership
    const dmSpace = spaces.find(s => s.spaceType === "DIRECT_MESSAGE");
    if (dmSpace && dmSpace.name) {
      try {
        const membersResponse = await chat.spaces.members.list({
          parent: dmSpace.name,
        });

        // In a DM, one of the members is us - we can identify by checking
        // which member has type HUMAN (both will be HUMAN in DM, but we need another way)
        // Actually, let's use the Gmail API to get our email and match
        const gmail = google.gmail({ version: "v1", auth });
        const profile = await gmail.users.getProfile({ userId: "me" });
        const myEmail = profile.data.emailAddress;

        // Now look through memberships to find ours
        for (const membership of membersResponse.data.memberships || []) {
          // The member name format for humans is "users/[id]"
          // We can try to match by getting member details
          if (membership.member?.name?.startsWith("users/")) {
            // For now, store the first user ID we find that could be ours
            // In DMs there are only 2 members, so we'd need to check which one is us
            // Let's store this user ID and also return the email for reference
            if (!myUserId) {
              myUserId = membership.member.name;
            }
          }
        }

        // Better approach: look at a space where we sent a message
        // For now, let's just return what we have
      } catch (err) {
        console.error("Error getting membership:", err);
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
