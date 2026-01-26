"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { authFetch } from "@/lib/auth";

interface LogFile {
  name: string;
  size: number;
  modified: string;
}

interface LogData {
  files: LogFile[];
  content: string[];
  selectedFile: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
          // Both text and tool use
          const toolNames = toolBlocks.map((t: Record<string, unknown>) => t.name).join(", ");
          return { text: `[${ts}] ${text}\n        -> Using: ${toolNames}`, level: "assistant" };
        } else if (text) {
          return { text: `[${ts}] ${text}`, level: "assistant" };
        } else if (toolBlocks.length > 0) {
          // Just tool use, no text
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
      // For other events, show a compact version
      return { text: `[${ts}] [${type}]`, level: "debug" };
  }
}

// Expandable JSONL log entry component
function JsonLogEntry({ line, index }: { line: string; index: number }) {
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
          className={`${levelColors[level]} break-all whitespace-pre-wrap cursor-pointer hover:bg-zinc-800/50 px-2 py-0.5 -mx-2 rounded flex items-start gap-2`}
        >
          <span className="text-zinc-600 opacity-0 group-hover:opacity-100 select-none flex-shrink-0">
            {expanded ? "[-]" : "[+]"}
          </span>
          <span>{text}</span>
        </div>
        {expanded && (
          <pre className="text-zinc-500 text-[10px] mt-1 ml-6 p-2 bg-zinc-800/50 rounded overflow-x-auto">
            {JSON.stringify(json, null, 2)}
          </pre>
        )}
      </div>
    );
  } catch {
    // Not valid JSON, render as-is
    return (
      <div className="text-zinc-500 break-all whitespace-pre-wrap px-2 py-0.5 -mx-2">
        {line}
      </div>
    );
  }
}

export default function LogsPage() {
  const [data, setData] = useState<LogData | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async (file?: string) => {
    try {
      const url = file ? `/api/logs?file=${encodeURIComponent(file)}` : "/api/logs";
      const res = await authFetch(url);
      const newData: LogData = await res.json();
      setData(newData);
      if (!selectedFile && newData.selectedFile) {
        setSelectedFile(newData.selectedFile);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedFile]);

  // Scroll to bottom when content changes or on initial load
  useEffect(() => {
    if (logContainerRef.current && data?.content) {
      // Use setTimeout to ensure DOM has rendered
      setTimeout(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
      }, 0);
    }
  }, [data?.content, loading]);

  // Initial load
  useEffect(() => {
    fetchLogs();
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs(selectedFile || undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedFile, fetchLogs]);

  const handleFileSelect = (fileName: string) => {
    setSelectedFile(fileName);
    setLoading(true);
    fetchLogs(fileName);
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchLogs(selectedFile || undefined);
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Server Logs</h2>
          <p className="text-zinc-500 mt-1">View application logs</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  const logFiles = data?.files || [];
  const logContent = data?.content || [];
  const currentFile = selectedFile || data?.selectedFile;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Server Logs</h2>
        <p className="text-zinc-500 mt-1">View application logs</p>
      </div>

      {logFiles.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No log files found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* File List */}
          <div className="lg:col-span-1">
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-white">Log Files</h3>
              </div>
              <div className="divide-y divide-zinc-800">
                {logFiles.map((file) => (
                  <button
                    key={file.name}
                    onClick={() => handleFileSelect(file.name)}
                    className={`block w-full text-left px-4 py-3 hover:bg-zinc-800/50 transition-colors ${
                      currentFile === file.name ? "bg-zinc-800" : ""
                    }`}
                  >
                    <div className="text-white text-sm truncate">{file.name}</div>
                    <div className="text-zinc-500 text-xs mt-1">{formatSize(file.size)}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Log Content */}
          <div className="lg:col-span-3">
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h3 className="text-sm font-semibold text-white">
                    {currentFile || "Select a log file"}
                  </h3>
                  <span className="text-xs text-zinc-500">
                    {logContent.length} lines
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
                    />
                    Auto-refresh (5s)
                  </label>
                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    <svg
                      className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Reload
                  </button>
                </div>
              </div>
              <div
                ref={logContainerRef}
                className="p-4 max-h-[600px] overflow-auto font-mono text-xs"
              >
                {logContent.length === 0 ? (
                  <p className="text-zinc-500">No log entries</p>
                ) : currentFile?.endsWith(".jsonl") ? (
                  // JSONL file - render human-readable with expandable raw JSON
                  <div className="space-y-0.5">
                    {logContent.map((line, i) => (
                      <JsonLogEntry key={i} line={line} index={i} />
                    ))}
                  </div>
                ) : (
                  // Regular log file
                  <div className="space-y-1">
                    {logContent.map((line, i) => {
                      const level = getLogLevel(line);
                      const levelColors = {
                        error: "text-red-400",
                        warn: "text-yellow-400",
                        info: "text-zinc-300",
                        debug: "text-zinc-500",
                      };
                      return (
                        <div key={i} className={`${levelColors[level]} break-all whitespace-pre-wrap`}>
                          {line}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
