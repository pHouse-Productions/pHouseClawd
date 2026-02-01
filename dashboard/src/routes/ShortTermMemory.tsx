import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";
import MarkdownRenderer from "@/components/MarkdownRenderer";

const SIZE_THRESHOLD = 100 * 1024; // 100KB

interface MemoryEntry {
  ts: string;
  ch: string;
  dir: "in" | "out";
  from?: string;
  msg: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function parseJSONL(content: string): MemoryEntry[] {
  const lines = content.trim().split("\n").filter(l => l.trim());
  const entries: MemoryEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function ChannelBadge({ channel }: { channel: string }) {
  const colors: Record<string, string> = {
    telegram: "bg-blue-500/20 text-blue-400",
    discord: "bg-indigo-500/20 text-indigo-400",
    dashboard: "bg-zinc-500/20 text-zinc-400",
    email: "bg-green-500/20 text-green-400",
    gchat: "bg-yellow-500/20 text-yellow-400",
    cron: "bg-purple-500/20 text-purple-400",
  };

  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[channel] || "bg-zinc-700 text-zinc-300"}`}>
      {channel}
    </span>
  );
}

function MessageEntry({ entry }: { entry: MemoryEntry }) {
  const isIncoming = entry.dir === "in";

  return (
    <div className={`py-2 px-3 rounded-lg ${isIncoming ? "bg-zinc-800/50" : "bg-zinc-800/30 border-l-2 border-zinc-600"}`}>
      <div className="flex items-center gap-2 mb-1">
        <ChannelBadge channel={entry.ch} />
        <span className="text-xs text-zinc-500">{formatTime(entry.ts)}</span>
        {isIncoming && entry.from && (
          <span className="text-xs font-medium text-zinc-300">{entry.from}</span>
        )}
        {!isIncoming && (
          <span className="text-xs font-medium text-emerald-400">Assistant</span>
        )}
      </div>
      <div className="text-sm">
        <MarkdownRenderer content={entry.msg} />
      </div>
    </div>
  );
}

export default function ShortTermMemory() {
  const [content, setContent] = useState("");
  const [size, setSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const fetchShortTerm = async () => {
      try {
        const res = await authFetch("/api/memory?path=short-term/buffer.txt");
        if (res.ok) {
          const data = await res.json();
          setContent(data.content || "");
          setSize(data.size || 0);
        }
      } catch (err) {
        console.error("Failed to fetch short-term memory:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchShortTerm();
  }, []);

  const entries = parseJSONL(content);
  const channels = [...new Set(entries.map(e => e.ch))];
  const filteredEntries = filter === "all"
    ? entries
    : entries.filter(e => e.ch === filter);

  // Group entries by date
  const groupedByDate: Record<string, MemoryEntry[]> = {};
  for (const entry of filteredEntries) {
    const date = formatDate(entry.ts);
    if (!groupedByDate[date]) {
      groupedByDate[date] = [];
    }
    groupedByDate[date].push(entry);
  }

  const needsRollup = size >= SIZE_THRESHOLD;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link to="/memory" className="p-2 -ml-2 text-zinc-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-xl font-bold text-white">Loading...</h2>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Link to="/memory" className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h2 className="text-xl font-bold text-white">Short-term Buffer</h2>
          <p className="text-zinc-500 text-sm">{entries.length} messages across {channels.length} channels</p>
        </div>
      </div>

      {/* Status Card */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-zinc-400">Buffer Size</span>
          <div className={`px-2 py-1 rounded text-xs font-medium ${
            needsRollup
              ? "bg-yellow-500/20 text-yellow-400"
              : "bg-green-500/20 text-green-400"
          }`}>
            {needsRollup ? "Roll-up Recommended" : "OK"}
          </div>
        </div>
        <div className="text-2xl font-bold text-white mb-1">
          {formatBytes(size)}
        </div>
        <div className="text-sm text-zinc-500">
          of {formatBytes(SIZE_THRESHOLD)} threshold
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${needsRollup ? "bg-yellow-500" : "bg-green-500"}`}
            style={{ width: `${Math.min(100, (size / SIZE_THRESHOLD) * 100)}%` }}
          />
        </div>
      </div>

      {/* Filter */}
      {channels.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-500">Filter:</span>
          <button
            onClick={() => setFilter("all")}
            className={`px-2 py-1 rounded text-xs font-medium transition ${
              filter === "all"
                ? "bg-white text-black"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            All
          </button>
          {channels.map(ch => (
            <button
              key={ch}
              onClick={() => setFilter(ch)}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                filter === ch
                  ? "bg-white text-black"
                  : "bg-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              {ch}
            </button>
          ))}
        </div>
      )}

      {/* Content grouped by date */}
      {Object.entries(groupedByDate).reverse().map(([date, dateEntries]) => (
        <div key={date} className="bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-white">{date}</h3>
          </div>
          <div className="p-3 space-y-2">
            {dateEntries.map((entry, i) => (
              <MessageEntry key={`${entry.ts}-${i}`} entry={entry} />
            ))}
          </div>
        </div>
      ))}

      {entries.length === 0 && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Short-term memory is empty</p>
        </div>
      )}
    </div>
  );
}
