import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const LONG_TERM_DIR = path.join(PROJECT_ROOT, "memory/long-term");
const SHORT_TERM_FILE = path.join(PROJECT_ROOT, "memory/short-term/buffer.txt");
const SIZE_THRESHOLD = 100 * 1024; // 100KB

interface MemoryFile {
  name: string;
  size: number;
  modified: Date;
}

interface ShortTermStatus {
  exists: boolean;
  size: number;
  needsRollup: boolean;
}

async function getLongTermFiles(): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];
  try {
    const entries = await fs.readdir(LONG_TERM_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith(".")) {
        const fullPath = path.join(LONG_TERM_DIR, entry.name);
        const stats = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }
  } catch {
    // Directory doesn't exist yet
  }
  return files.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

async function getShortTermStatus(): Promise<ShortTermStatus> {
  try {
    const stats = await fs.stat(SHORT_TERM_FILE);
    return {
      exists: true,
      size: stats.size,
      needsRollup: stats.size >= SIZE_THRESHOLD,
    };
  } catch {
    return {
      exists: false,
      size: 0,
      needsRollup: false,
    };
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const longTermFiles = await getLongTermFiles();
  const shortTerm = await getShortTermStatus();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Memory</h2>
        <p className="text-zinc-500 mt-1">Short-term buffer and long-term storage</p>
      </div>

      {/* Short-term Memory Card */}
      <Link
        href="/memory/short-term"
        className="block bg-zinc-900 rounded-lg border border-zinc-800 p-4 active:bg-zinc-800"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">Short-term Buffer</span>
                {shortTerm.needsRollup && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-400 rounded font-medium">
                    Roll-up needed
                  </span>
                )}
              </div>
              <div className="text-sm text-zinc-500">
                {formatBytes(shortTerm.size)} / {formatBytes(SIZE_THRESHOLD)}
              </div>
            </div>
          </div>
          <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${shortTerm.needsRollup ? "bg-yellow-500" : "bg-green-500"}`}
            style={{ width: `${Math.min(100, (shortTerm.size / SIZE_THRESHOLD) * 100)}%` }}
          />
        </div>
      </Link>

      {/* Long-term Memory Section */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-400 px-1">Long-term Memory ({longTermFiles.length} files)</h3>

        {longTermFiles.length === 0 ? (
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 text-center">
            <p className="text-zinc-500">No long-term memory files</p>
          </div>
        ) : (
          longTermFiles.map((file) => (
            <Link
              key={file.name}
              href={`/memory/files/${encodeURIComponent(file.name)}`}
              className="flex items-center justify-between bg-zinc-900 rounded-lg border border-zinc-800 p-4 active:bg-zinc-800"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-white font-medium">{file.name}</div>
                  <div className="text-sm text-zinc-500">
                    {formatBytes(file.size)} - {formatDate(file.modified)}
                  </div>
                </div>
              </div>
              <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
