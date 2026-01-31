/**
 * Unified command parser for all chat channels
 *
 * Supports: /new, /restart, /memory, /queue, /stop
 * Works across: telegram, gchat, discord, dashboard
 */

export type CommandType =
  | "new"
  | "restart"
  | "memory_session"
  | "memory_transcript"
  | "memory_status"
  | "queue_on"
  | "queue_off"
  | "queue_status"
  | "stop"
  | "stop_job";

export interface ParsedCommand {
  type: CommandType;
  args?: {
    jobId?: string;        // For /stop <job-id>
    lines?: number;        // For /memory transcript <lines>
  };
  raw: string;             // Original text
}

/**
 * Parse a message to check if it's a slash command
 * Returns null if not a command
 */
export function parseCommand(text: string | undefined): ParsedCommand | null {
  if (!text) return null;

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Not a command
  if (!lower.startsWith("/")) return null;

  // /new - Clear session
  if (lower === "/new") {
    return { type: "new", raw: trimmed };
  }

  // /restart - Restart watcher
  if (lower === "/restart") {
    return { type: "restart", raw: trimmed };
  }

  // /memory session - Switch to session memory
  if (lower === "/memory session") {
    return { type: "memory_session", raw: trimmed };
  }

  // /memory transcript [lines] - Switch to transcript memory
  const transcriptMatch = lower.match(/^\/memory transcript(?:\s+(\d+))?$/);
  if (transcriptMatch) {
    const lines = transcriptMatch[1] ? parseInt(transcriptMatch[1], 10) : undefined;
    return {
      type: "memory_transcript",
      args: lines !== undefined ? { lines } : undefined,
      raw: trimmed
    };
  }

  // /memory - Show current memory mode
  if (lower === "/memory") {
    return { type: "memory_status", raw: trimmed };
  }

  // /queue on - Enable queue mode
  if (lower === "/queue on") {
    return { type: "queue_on", raw: trimmed };
  }

  // /queue off - Disable queue mode (interrupt mode)
  if (lower === "/queue off") {
    return { type: "queue_off", raw: trimmed };
  }

  // /queue - Show current queue mode
  if (lower === "/queue") {
    return { type: "queue_status", raw: trimmed };
  }

  // /stop [job-id] - Stop running job (optionally specific job)
  if (lower === "/stop" || lower.startsWith("/stop ")) {
    const parts = trimmed.split(/\s+/);
    const jobId = parts.length > 1 ? parts[1] : undefined;
    return {
      type: jobId ? "stop_job" : "stop",
      args: jobId ? { jobId } : undefined,
      raw: trimmed
    };
  }

  // Not a recognized command
  return null;
}

/**
 * Get a human-readable description of a command
 */
export function getCommandDescription(cmd: ParsedCommand): string {
  switch (cmd.type) {
    case "new":
      return "Clear session and start fresh";
    case "restart":
      return "Restart the watcher service";
    case "memory_session":
      return "Switch to session memory mode";
    case "memory_transcript":
      return `Switch to transcript memory mode${cmd.args?.lines ? ` (${cmd.args.lines} lines)` : ""}`;
    case "memory_status":
      return "Show current memory mode";
    case "queue_on":
      return "Enable queue mode";
    case "queue_off":
      return "Disable queue mode (interrupt mode)";
    case "queue_status":
      return "Show current queue mode";
    case "stop":
      return "Stop the currently running job";
    case "stop_job":
      return `Stop job ${cmd.args?.jobId}`;
    default:
      return "Unknown command";
  }
}

/**
 * Check if a channel supports interactive commands
 */
export function supportsCommands(channelName: string): boolean {
  return ["telegram", "gchat", "discord", "dashboard", "email"].includes(channelName);
}
