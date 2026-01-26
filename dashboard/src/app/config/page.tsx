import { promises as fs } from "fs";

async function getClaudeMd(): Promise<string> {
  try {
    return await fs.readFile("/home/ubuntu/pHouseClawd/CLAUDE.md", "utf-8");
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
  const modified = await getFileModified("/home/ubuntu/pHouseClawd/CLAUDE.md");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Configuration</h2>
        <p className="text-zinc-500 mt-1">View assistant configuration</p>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">CLAUDE.md</h3>
            <p className="text-sm text-zinc-500">Assistant identity and instructions</p>
          </div>
          <div className="text-xs text-zinc-500">
            Last modified: {formatDate(modified)}
          </div>
        </div>
        <div className="p-6">
          <pre className="whitespace-pre-wrap text-zinc-300 text-sm font-mono bg-zinc-950 rounded-lg p-4 overflow-auto max-h-[600px]">
            {claudeMd}
          </pre>
        </div>
      </div>
    </div>
  );
}
