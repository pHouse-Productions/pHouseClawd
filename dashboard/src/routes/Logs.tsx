import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth";

interface LogFile {
  name: string;
  size: number;
  modified: string;
}

export default function Logs() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [content, setContent] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await authFetch("/api/logs");
        if (res.ok) {
          const data = await res.json();
          setFiles(data.files || []);
          setContent(data.content || []);
          setSelectedFile(data.selectedFile);
        }
      } catch (err) {
        console.error("Failed to fetch logs:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectFile = async (fileName: string) => {
    try {
      const res = await authFetch(`/api/logs?file=${encodeURIComponent(fileName)}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content || []);
        setSelectedFile(fileName);
      }
    } catch (err) {
      console.error("Failed to fetch log file:", err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading logs...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Logs</h2>
        <p className="text-zinc-500 mt-1">System logs</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {files.map((file) => (
          <button
            key={file.name}
            onClick={() => handleSelectFile(file.name)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              selectedFile === file.name
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {file.name} ({formatBytes(file.size)})
          </button>
        ))}
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <pre className="text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words">
          {content.length > 0 ? content.join("\n") : "No log content"}
        </pre>
      </div>
    </div>
  );
}
