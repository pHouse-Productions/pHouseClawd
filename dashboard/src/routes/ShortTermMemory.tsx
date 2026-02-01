import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";

const SIZE_THRESHOLD = 100 * 1024; // 100KB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function ShortTermMemory() {
  const [content, setContent] = useState("");
  const [size, setSize] = useState(0);
  const [loading, setLoading] = useState(true);

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
          <p className="text-zinc-500 text-sm">Conversation logs awaiting roll-up</p>
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

      {/* Content */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">Buffer Content</h3>
        </div>
        <div className="p-4">
          {content ? (
            <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono break-words">
              {content}
            </pre>
          ) : (
            <p className="text-zinc-500 text-center py-8">
              Short-term memory is empty
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
