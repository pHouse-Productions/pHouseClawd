import { promises as fs } from "fs";
import path from "path";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

interface MemoryFile {
  name: string;
  path: string;
  type: "image" | "text" | "json";
  size: number;
  modified: Date;
}

async function getMemoryFiles(): Promise<{ category: string; files: MemoryFile[] }[]> {
  const baseDir = path.join(getProjectRoot(), "memory");
  const categories: { category: string; files: MemoryFile[] }[] = [];

  async function scanDir(dir: string, category: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files: MemoryFile[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          const ext = path.extname(entry.name).toLowerCase();
          let type: "image" | "text" | "json" = "text";
          if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
            type = "image";
          } else if (ext === ".json") {
            type = "json";
          }
          files.push({
            name: entry.name,
            path: fullPath,
            type,
            size: stats.size,
            modified: stats.mtime,
          });
        } else if (entry.isDirectory()) {
          await scanDir(fullPath, `${category}/${entry.name}`);
        }
      }

      if (files.length > 0) {
        categories.push({ category, files: files.sort((a, b) => b.modified.getTime() - a.modified.getTime()) });
      }
    } catch {
      // Directory doesn't exist
    }
  }

  try {
    const topLevel = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of topLevel) {
      if (entry.isDirectory()) {
        await scanDir(path.join(baseDir, entry.name), entry.name);
      }
    }
  } catch {
    // Memory directory doesn't exist
  }

  return categories;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const dynamic = "force-dynamic";

export default async function MemoriesPage() {
  const categories = await getMemoryFiles();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Memories</h2>
        <p className="text-zinc-500 mt-1">Browse stored files and data</p>
      </div>

      {categories.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No memories stored yet</p>
        </div>
      ) : (
        categories.map(({ category, files }) => (
          <div key={category} className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-800">
              <h3 className="text-lg font-semibold text-white capitalize">{category.replace(/\//g, " / ")}</h3>
              <p className="text-sm text-zinc-500">{files.length} file{files.length !== 1 ? "s" : ""}</p>
            </div>

            {files.some((f) => f.type === "image") ? (
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {files.filter((f) => f.type === "image").map((file) => (
                  <div key={file.name} className="group relative aspect-square bg-zinc-800 rounded-lg overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/memory?path=${encodeURIComponent(file.path)}`}
                      alt={file.name}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                      <div className="text-xs text-white truncate">{file.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {files.some((f) => f.type !== "image") && (
              <div className="divide-y divide-zinc-800">
                {files.filter((f) => f.type !== "image").map((file) => (
                  <div key={file.name} className="px-6 py-3 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded flex items-center justify-center ${
                        file.type === "json" ? "bg-yellow-500/20 text-yellow-500" : "bg-blue-500/20 text-blue-500"
                      }`}>
                        {file.type === "json" ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <div className="text-white text-sm">{file.name}</div>
                        <div className="text-zinc-500 text-xs">{formatSize(file.size)}</div>
                      </div>
                    </div>
                    <div className="text-zinc-500 text-xs">{formatDate(file.modified)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
