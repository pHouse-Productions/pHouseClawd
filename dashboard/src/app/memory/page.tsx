import { promises as fs } from "fs";
import path from "path";
import MarkdownRenderer from "../../components/MarkdownRenderer";

const LONG_TERM_DIR = "/home/ubuntu/pHouseClawd/memory/long-term";
const SHORT_TERM_FILE = "/home/ubuntu/pHouseClawd/memory/short-term/buffer.txt";
const SIZE_THRESHOLD = 10 * 1024; // 10KB

interface MemoryFile {
  name: string;
  path: string;
  size: number;
  modified: Date;
  content: string;
}

interface ShortTermStatus {
  exists: boolean;
  size: number;
  needsRollup: boolean;
  content: string;
}

async function getLongTermMemory(): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];

  try {
    const entries = await fs.readdir(LONG_TERM_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith(".")) {
        const fullPath = path.join(LONG_TERM_DIR, entry.name);
        const stats = await fs.stat(fullPath);
        const content = await fs.readFile(fullPath, "utf-8");
        files.push({
          name: entry.name,
          path: fullPath,
          size: stats.size,
          modified: stats.mtime,
          content,
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
    const content = await fs.readFile(SHORT_TERM_FILE, "utf-8");
    return {
      exists: true,
      size: stats.size,
      needsRollup: stats.size >= SIZE_THRESHOLD,
      content,
    };
  } catch {
    return {
      exists: false,
      size: 0,
      needsRollup: false,
      content: "",
    };
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const dynamic = "force-dynamic";

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string; view?: string }>;
}) {
  const params = await searchParams;
  const longTermFiles = await getLongTermMemory();
  const shortTerm = await getShortTermStatus();

  const activeView = params.view || "long-term";
  const selectedFile = params.file
    ? longTermFiles.find((f) => f.name === params.file)
    : longTermFiles[0];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Memory</h2>
        <p className="text-zinc-500 mt-1">Short-term buffer and long-term storage</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2">
        <a
          href="/memory?view=long-term"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === "long-term"
              ? "bg-zinc-800 text-white"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
          }`}
        >
          Long-term Memory
        </a>
        <a
          href="/memory?view=short-term"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeView === "short-term"
              ? "bg-zinc-800 text-white"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
          }`}
        >
          Short-term Buffer
          {shortTerm.needsRollup && (
            <span className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
              Roll-up needed
            </span>
          )}
        </a>
      </div>

      {activeView === "short-term" ? (
        /* Short-term Memory View */
        <div className="space-y-4">
          {/* Status Card */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Buffer Status</h3>
                <p className="text-zinc-500 text-sm mt-1">
                  {formatBytes(shortTerm.size)} / {formatBytes(SIZE_THRESHOLD)} threshold
                </p>
              </div>
              <div
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  shortTerm.needsRollup
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-green-500/20 text-green-400"
                }`}
              >
                {shortTerm.needsRollup ? "Roll-up Recommended" : "OK"}
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-3 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  shortTerm.needsRollup ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{
                  width: `${Math.min(100, (shortTerm.size / SIZE_THRESHOLD) * 100)}%`,
                }}
              />
            </div>
          </div>

          {/* Buffer Content */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-white">Conversation Buffer</h3>
              <p className="text-zinc-500 text-xs mt-1">
                Recent conversations auto-logged for roll-up
              </p>
            </div>
            <div className="p-4 max-h-[600px] overflow-y-auto">
              {shortTerm.content ? (
                <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">
                  {shortTerm.content}
                </pre>
              ) : (
                <p className="text-zinc-500 text-center py-8">
                  Short-term memory is empty
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Long-term Memory View */
        <div>
          {longTermFiles.length === 0 ? (
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
              <p className="text-zinc-500">No long-term memory files found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* File List */}
              <div className="lg:col-span-1">
                <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800">
                    <h3 className="text-sm font-semibold text-white">Files</h3>
                    <p className="text-zinc-500 text-xs mt-1">
                      {longTermFiles.length} file{longTermFiles.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="divide-y divide-zinc-800">
                    {longTermFiles.map((file) => (
                      <a
                        key={file.name}
                        href={`/memory?view=long-term&file=${encodeURIComponent(file.name)}`}
                        className={`block px-4 py-3 hover:bg-zinc-800/50 transition-colors ${
                          selectedFile?.name === file.name ? "bg-zinc-800" : ""
                        }`}
                      >
                        <div className="text-white text-sm">{file.name}</div>
                        <div className="text-zinc-500 text-xs mt-1 flex justify-between">
                          <span>{formatDate(file.modified)}</span>
                          <span>{formatBytes(file.size)}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              {/* File Content */}
              <div className="lg:col-span-3">
                <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800">
                    <h3 className="text-sm font-semibold text-white">
                      {selectedFile?.name || "Select a file"}
                    </h3>
                  </div>
                  <div className="p-6 max-h-[600px] overflow-y-auto">
                    {selectedFile ? (
                      selectedFile.name.endsWith(".md") ? (
                        <MarkdownRenderer content={selectedFile.content} />
                      ) : (
                        <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">
                          {selectedFile.content}
                        </pre>
                      )
                    ) : (
                      <p className="text-zinc-500">Select a file to view</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
