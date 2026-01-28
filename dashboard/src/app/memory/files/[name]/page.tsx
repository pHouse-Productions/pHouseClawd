import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";
import MarkdownRenderer from "@/components/MarkdownRenderer";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const LONG_TERM_DIR = path.join(PROJECT_ROOT, "memory/long-term");

interface FileData {
  name: string;
  content: string;
  size: number;
  modified: Date;
}

async function getFileData(name: string): Promise<FileData | null> {
  try {
    const filePath = path.join(LONG_TERM_DIR, name);
    const stats = await fs.stat(filePath);
    const content = await fs.readFile(filePath, "utf-8");
    return {
      name,
      content,
      size: stats.size,
      modified: stats.mtime,
    };
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
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

export const dynamic = "force-dynamic";

export default async function MemoryFilePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const file = await getFileData(decodedName);

  if (!file) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link href="/memory" className="p-2 -ml-2 text-zinc-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-xl font-bold text-white">File not found</h2>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">The file "{decodedName}" was not found</p>
        </div>
      </div>
    );
  }

  const isMarkdown = file.name.endsWith(".md");

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Link href="/memory" className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white truncate">{file.name}</h2>
          <p className="text-zinc-500 text-sm">
            {formatBytes(file.size)} - {formatDate(file.modified)}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="p-4 md:p-6">
          {isMarkdown ? (
            <MarkdownRenderer content={file.content} />
          ) : (
            <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono break-words">
              {file.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
