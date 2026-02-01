import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";
import MarkdownRenderer from "@/components/MarkdownRenderer";

interface FileData {
  name: string;
  content: string;
  size: number;
  modified: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MemoryFile() {
  const { name } = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(name || "");
  const [file, setFile] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFile = async () => {
      try {
        const res = await authFetch(`/api/memory?path=long-term/${decodedName}`);
        if (res.ok) {
          const data = await res.json();
          setFile({
            name: decodedName,
            content: data.content || "",
            size: data.size || 0,
            modified: data.modified || new Date().toISOString(),
          });
        } else {
          setError("File not found");
        }
      } catch (err) {
        console.error("Failed to fetch file:", err);
        setError("Failed to load file");
      } finally {
        setLoading(false);
      }
    };
    fetchFile();
  }, [decodedName]);

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

  if (error || !file) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link to="/memory" className="p-2 -ml-2 text-zinc-400 hover:text-white">
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
        <Link to="/memory" className="p-2 -ml-2 text-zinc-400 hover:text-white">
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
