import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const PROJECT_ROOT =
  process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const MCP_ROOT = path.resolve(PROJECT_ROOT, "../pHouseMcp");
const DASHBOARD_ENV_FILE = path.join(PROJECT_ROOT, "dashboard/.env.local");
const GOOGLE_TOKEN_FILE = path.join(MCP_ROOT, "credentials/tokens.json");

async function parseEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex);
          const value = trimmed.slice(eqIndex + 1);
          vars[key] = value;
        }
      }
    }
    return vars;
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const encodedTokens = searchParams.get("tokens");
  const error = searchParams.get("error");

  const dashboardEnv = await parseEnvFile(DASHBOARD_ENV_FILE);
  const baseUrl = dashboardEnv.DASHBOARD_URL
    ? `https://${dashboardEnv.DASHBOARD_URL}`
    : "http://localhost:3000";

  if (error) {
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", error);
    return NextResponse.redirect(errorUrl.toString());
  }

  if (!encodedTokens) {
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", "No tokens received");
    return NextResponse.redirect(errorUrl.toString());
  }

  try {
    // Decode tokens
    const tokens = JSON.parse(
      Buffer.from(encodedTokens, "base64url").toString("utf-8")
    );

    // Ensure credentials directory exists
    const credentialsDir = path.dirname(GOOGLE_TOKEN_FILE);
    await fs.mkdir(credentialsDir, { recursive: true });

    // Save tokens
    await fs.writeFile(
      GOOGLE_TOKEN_FILE,
      JSON.stringify(tokens, null, 2) + "\n",
      "utf-8"
    );

    // Redirect back to config with success
    const successUrl = new URL("/config", baseUrl);
    successUrl.searchParams.set(
      "oauth_success",
      "Google account connected successfully"
    );
    return NextResponse.redirect(successUrl.toString());
  } catch (err) {
    console.error("Error saving tokens:", err);
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", String(err));
    return NextResponse.redirect(errorUrl.toString());
  }
}
