import { promises as fs } from "fs";
import path from "path";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

async function getClaudeMd(): Promise<string> {
  try {
    return await fs.readFile(path.join(getProjectRoot(), "CLAUDE.md"), "utf-8");
  } catch {
    return "CLAUDE.md not found";
  }
}

async function getFileModified(filePath: string): Promise<Date | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime;
  } catch {
    return null;
  }
}

function formatDate(date: Date | null): string {
  if (!date) return "Unknown";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const claudeMd = await getClaudeMd();
  const modified = await getFileModified(path.join(getProjectRoot(), "CLAUDE.md"));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Configuration</h2>
        <p className="text-zinc-500 mt-1">Assistant settings</p>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">CLAUDE.md</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Identity and instructions</p>
            </div>
            <span className="text-xs text-zinc-500">{formatDate(modified)}</span>
          </div>
        </div>
        <div className="p-4">
          <pre className="whitespace-pre-wrap text-zinc-300 text-sm font-mono bg-zinc-950 rounded-lg p-4 break-words">
            {claudeMd}
          </pre>
        </div>
      </div>
    </div>
  );
}
