import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const SHORT_TERM_FILE = path.join(PROJECT_ROOT, "memory/short-term/buffer.txt");
const SIZE_THRESHOLD = 100 * 1024; // 100KB

async function getShortTermContent(): Promise<{ content: string; size: number; needsRollup: boolean }> {
  try {
    const stats = await fs.stat(SHORT_TERM_FILE);
    const content = await fs.readFile(SHORT_TERM_FILE, "utf-8");
    return {
      content,
      size: stats.size,
      needsRollup: stats.size >= SIZE_THRESHOLD,
    };
  } catch {
    return {
      content: "",
      size: 0,
      needsRollup: false,
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const dynamic = "force-dynamic";

export default async function ShortTermMemoryPage() {
  const { content, size, needsRollup } = await getShortTermContent();

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Link href="/memory" className="p-2 -ml-2 text-zinc-400 hover:text-white">
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
