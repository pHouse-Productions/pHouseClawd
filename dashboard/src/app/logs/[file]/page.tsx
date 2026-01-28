"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth";

interface LogData {
  content: string[];
  selectedFile: string | null;
}

function getLogLevel(line: string): "error" | "warn" | "info" | "debug" {
  const lower = line.toLowerCase();
  if (lower.includes("[error]") || lower.includes("error:")) return "error";
  if (lower.includes("[warn]") || lower.includes("warning:")) return "warn";
  if (lower.includes("[debug]")) return "debug";
  return "info";
}

// Format a JSONL stream event into human-readable text
function formatStreamEvent(json: Record<string, unknown>): { text: string; level: "error" | "warn" | "info" | "debug" | "assistant" | "tool" } {
  const ts = json.ts ? new Date(json.ts as string).toLocaleTimeString() : "";
  const type = json.type as string;

  switch (type) {
    case "system":
      if (json.subtype === "init") {
        const model = json.model as string || "unknown";
        return { text: `[${ts}] Session started (${model})`, level: "info" };
      }
      return { text: `[${ts}] System: ${json.message || JSON.stringify(json)}`, level: "info" };

    case "assistant":
      const content = json.message as Record<string, unknown>;
      if (content?.content && Array.isArray(content.content)) {
        const textBlocks = content.content.filter((c: Record<string, unknown>) => c.type === "text");
        const toolBlocks = content.content.filter((c: Record<string, unknown>) => c.type === "tool_use");

        const text = textBlocks.map((c: Record<string, unknown>) => c.text).join("");

        if (text && toolBlocks.length > 0) {
          const toolNames = toolBlocks.map((t: Record<string, unknown>) => t.name).join(", ");
          return { text: `[${ts}] ${text}\n-> Using: ${toolNames}`, level: "assistant" };
        } else if (text) {
          return { text: `[${ts}] ${text}`, level: "assistant" };
        } else if (toolBlocks.length > 0) {
          const toolNames = toolBlocks.map((t: Record<string, unknown>) => t.name).join(", ");
          return { text: `[${ts}] Using: ${toolNames}`, level: "tool" };
        }
      }
      return { text: `[${ts}] (empty assistant turn)`, level: "debug" };

    case "user":
      const userContent = json.message as Record<string, unknown>;
      if (userContent?.content && Array.isArray(userContent.content)) {
        const toolResults = userContent.content.filter((c: Record<string, unknown>) => c.type === "tool_result");
        if (toolResults.length > 0) {
          return { text: `[${ts}] Tool results received (${toolResults.length})`, level: "debug" };
        }
      }
      return { text: `[${ts}] User input`, level: "info" };

    case "result":
      const cost = json.total_cost_usd as number;
      const duration = json.duration_ms as number;
      const costStr = cost ? `$${cost.toFixed(4)}` : "";
      const durationStr = duration ? `${(duration / 1000).toFixed(1)}s` : "";
      return { text: `[${ts}] Done ${durationStr} ${costStr}`.trim(), level: "info" };

    case "error":
      const error = json.error as Record<string, unknown>;
      return { text: `[${ts}] Error: ${error?.message || JSON.stringify(json)}`, level: "error" };

    default:
      return { text: `[${ts}] [${type}]`, level: "debug" };
  }
}

// Expandable JSONL log entry component
function JsonLogEntry({ line }: { line: string }) {
  const [expanded, setExpanded] = useState(false);

  try {
    const json = JSON.parse(line);
    const { text, level } = formatStreamEvent(json);
    const levelColors = {
      error: "text-red-400",
      warn: "text-yellow-400",
      info: "text-zinc-400",
      debug: "text-zinc-600",
      assistant: "text-green-400",
      tool: "text-blue-400",
    };

    return (
      <div className="group">
        <div
          onClick={() => setExpanded(!expanded)}
          className={`${levelColors[level]} break-all whitespace-pre-wrap cursor-pointer active:bg-zinc-800/50 px-2 py-1 -mx-2 rounded`}
        >
          <span>{text}</span>
        </div>
        {expanded && (
          <pre className="text-zinc-500 text-[10px] mt-1 p-2 bg-zinc-800/50 rounded overflow-x-auto">
            {JSON.stringify(json, null, 2)}
          </pre>
        )}
      </div>
    );
  } catch {
    return (
      <div className="text-zinc-500 break-all whitespace-pre-wrap px-2 py-0.5 -mx-2">
        {line}
      </div>
    );
  }
}

const LINE_OPTIONS = [100, 250, 500, 1000];

export default function LogFilePage({ params }: { params: Promise<{ file: string }> }) {
  const { file } = use(params);
  const fileName = decodeURIComponent(file);
  const [data, setData] = useState<LogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lines, setLines] = useState(100);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("file", fileName);
      params.set("lines", lines.toString());
      const res = await authFetch(`/api/logs?${params.toString()}`);
      const newData: LogData = await res.json();
      setData(newData);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [fileName, lines]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Scroll to bottom when content loads
  useEffect(() => {
    if (data?.content && bottomRef.current) {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      }, 0);
    }
  }, [data?.content]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const isJsonl = fileName.endsWith(".jsonl");
  const logContent = data?.content || [];

  const levelColors = {
    error: "text-red-400",
    warn: "text-yellow-400",
    info: "text-zinc-300",
    debug: "text-zinc-500",
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link href="/logs" className="p-2 -ml-2 text-zinc-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-xl font-bold text-white truncate">{fileName}</h2>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/logs" className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white truncate">{fileName}</h2>
          <p className="text-zinc-500 text-sm">{logContent.length} lines</p>
        </div>
        <button
          onClick={() => fetchLogs()}
          className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
        >
          <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 bg-zinc-900 rounded-lg border border-zinc-800 p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400">Lines:</span>
          <select
            value={lines}
            onChange={(e) => setLines(parseInt(e.target.value, 10))}
            className="px-2 py-1 text-sm bg-zinc-800 border border-zinc-700 text-white rounded focus:outline-none"
          >
            {LINE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400">Auto-refresh</span>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              autoRefresh ? "bg-blue-600" : "bg-zinc-700"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                autoRefresh ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Log Content */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 font-mono text-xs">
        {logContent.length === 0 ? (
          <p className="text-zinc-500 text-center py-8">No log entries</p>
        ) : isJsonl ? (
          <div className="space-y-1">
            {logContent.map((line, i) => (
              <JsonLogEntry key={i} line={line} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {logContent.map((line, i) => {
              const level = getLogLevel(line);
              return (
                <div key={i} className={`${levelColors[level]} break-all whitespace-pre-wrap`}>
                  {line}
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
