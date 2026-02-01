import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";

interface ShortTermData {
  size: number;
  modified: string | null;
}

interface MemoryFile {
  name: string;
  size: number;
  modified: string;
}

const SIZE_THRESHOLD = 100 * 1024; // 100KB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFileDescription(name: string): string {
  const descriptions: Record<string, string> = {
    "journal.md": "Activity log and daily notes",
    "projects.md": "Active projects and status",
    "people.md": "Contacts and relationships",
    "fitness.md": "Fitness tracking and goals",
  };
  return descriptions[name] || "Memory file";
}

export default function Memory() {
  const [shortTerm, setShortTerm] = useState<ShortTermData | null>(null);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [shortTermRes, filesRes] = await Promise.all([
          authFetch("/api/memory/short-term"),
          authFetch("/api/memory/files"),
        ]);

        if (shortTermRes.ok) {
          const data = await shortTermRes.json();
          setShortTerm({ size: data.size, modified: data.modified });
        }

        if (filesRes.ok) {
          const data = await filesRes.json();
          setFiles(data.files || []);
        }
      } catch (err) {
        console.error("Failed to fetch memory data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const needsRollup = shortTerm && shortTerm.size >= SIZE_THRESHOLD;
  const fillPercent = shortTerm ? Math.min(100, (shortTerm.size / SIZE_THRESHOLD) * 100) : 0;

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Memory</h2>
          <p className="text-zinc-500 mt-1">Long-term and short-term memory</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Memory</h2>
        <p className="text-zinc-500 mt-1">Long-term and short-term memory</p>
      </div>

      {/* Short-term Memory Card - Clickable */}
      <Link
        to="/memory/short-term"
        className="block bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-white font-semibold">Short-term Buffer</span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`px-2 py-1 rounded text-xs font-medium ${
                needsRollup
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-green-500/20 text-green-400"
              }`}
            >
              {needsRollup ? "Roll-up Recommended" : "OK"}
            </div>
            <svg
              className="w-5 h-5 text-zinc-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
        </div>

        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-2xl font-bold text-white">
            {shortTerm ? formatBytes(shortTerm.size) : "0 B"}
          </span>
          <span className="text-sm text-zinc-500">
            / {formatBytes(SIZE_THRESHOLD)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              needsRollup ? "bg-yellow-500" : "bg-blue-500"
            }`}
            style={{ width: `${fillPercent}%` }}
          />
        </div>

        <p className="text-zinc-500 text-sm mt-2">
          Conversation logs awaiting roll-up
        </p>
      </Link>

      {/* Long-term Memory Section */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <svg
            className="w-5 h-5 text-purple-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
            />
          </svg>
          Long-term Memory
        </h3>

        {files.length === 0 ? (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
            <p className="text-zinc-500">No memory files found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file) => (
              <Link
                key={file.name}
                to={`/memory/files/${encodeURIComponent(file.name)}`}
                className="flex items-center justify-between bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <svg
                    className="w-5 h-5 text-zinc-400 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">
                      {file.name}
                    </div>
                    <div className="text-zinc-500 text-sm">
                      {getFileDescription(file.name)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-zinc-400 text-sm">
                      {formatBytes(file.size)}
                    </div>
                    <div className="text-zinc-600 text-xs">
                      {formatDate(file.modified)}
                    </div>
                  </div>
                  <svg
                    className="w-5 h-5 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
