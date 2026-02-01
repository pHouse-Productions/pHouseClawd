import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";

interface LogData {
  content: string[];
  path: string;
  type: string;
}

function getLogLevel(line: string): "error" | "warn" | "info" | "debug" {
  const lower = line.toLowerCase();
  if (lower.includes("[error]") || lower.includes("error:") || lower.includes("error")) return "error";
  if (lower.includes("[warn]") || lower.includes("warning:") || lower.includes("warn")) return "warn";
  if (lower.includes("[debug]")) return "debug";
  return "info";
}

const LINE_OPTIONS = [100, 250, 500, 1000];

export default function SiteLogs() {
  const { name, type } = useParams<{ name: string; type: string }>();
  const [data, setData] = useState<LogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lines, setLines] = useState(100);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await authFetch(`/api/sites/${name}/logs/${type}?lines=${lines}`);
      if (res.ok) {
        const newData: LogData = await res.json();
        setData(newData);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [name, type, lines]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const logContent = data?.content || [];
  const logTypeLabel = type === "error" ? "stderr" : "stdout";

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
          <Link to="/sites" className="p-2 -ml-2 text-zinc-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-xl font-bold text-white truncate">{name} - {logTypeLabel}</h2>
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
        <Link to="/sites" className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white truncate">
            {name} - <span className={type === "error" ? "text-red-400" : "text-green-400"}>{logTypeLabel}</span>
          </h2>
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
        {data?.path && (
          <div className="flex-1 text-right">
            <span className="text-xs text-zinc-600 break-all">{data.path}</span>
          </div>
        )}
      </div>

      {/* Log Content - no overflow scroll, just renders all lines */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 font-mono text-xs">
        {logContent.length === 0 ? (
          <p className="text-zinc-500 text-center py-8">No log entries</p>
        ) : (
          <div className="space-y-0.5">
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
      </div>
    </div>
  );
}
