import path from "path";
import fs from "fs/promises";

// Timezone configuration via environment variable
// Default: America/Toronto (EST/EDT)
const TIMEZONE = process.env.PHOUSE_TIMEZONE || "America/Toronto";

// Map common timezone identifiers to their abbreviations
function getTimezoneAbbreviation(timezone: string): string {
  const abbrevMap: Record<string, string> = {
    "America/Toronto": "EST",
    "America/New_York": "EST",
    "America/Chicago": "CST",
    "America/Denver": "MST",
    "America/Los_Angeles": "PST",
    "America/Vancouver": "PST",
    "Europe/London": "GMT",
    "Europe/Paris": "CET",
    "Asia/Tokyo": "JST",
    "Australia/Sydney": "AEDT",
    "UTC": "UTC",
  };

  return abbrevMap[timezone] || timezone.split("/").pop() || "LOCAL";
}

/**
 * Get a formatted timestamp in the configured timezone
 * Format: "Fri 01/31/2026, 23:33:04 EST"
 */
export function getLocalTimestamp(): string {
  const now = new Date();
  const weekday = now.toLocaleString("en-US", { timeZone: TIMEZONE, weekday: "short" });
  const date = now.toLocaleString("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const tzAbbrev = getTimezoneAbbreviation(TIMEZONE);
  return `${weekday} ${date} ${tzAbbrev}`;
}

/**
 * Get the project root path
 */
export function getProjectRoot(): string {
  return process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
}

/**
 * Parse an .env file and return key-value pairs
 */
export async function parseEnvFile(filePath: string): Promise<Record<string, string>> {
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

/**
 * Write key-value pairs to an .env file
 */
export async function writeEnvFile(filePath: string, vars: Record<string, string>): Promise<void> {
  const lines = Object.entries(vars).map(([key, value]) => `${key}=${value}`);
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}

/**
 * Read and parse a JSON file
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write data to a JSON file
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
