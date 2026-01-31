/**
 * Shared utilities for the pHouseClawd project
 */

// Timezone configuration via environment variable
// Default: America/Toronto (EST/EDT)
// Override with: PHOUSE_TIMEZONE=America/New_York or any valid IANA timezone
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

  // Return mapped abbreviation or derive from timezone name
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
 * Get the configured timezone string (for display/debugging)
 */
export function getConfiguredTimezone(): string {
  return TIMEZONE;
}
