import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function ClaudeMd() {
  const [soulMd, setSoulMd] = useState("");
  const [systemMd, setSystemMd] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const res = await authFetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          setSoulMd(data.soulMd || "");
          setSystemMd(data.systemMd || "");
        }
      } catch (err) {
        console.error("Failed to fetch config:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchContent();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  // Generate CLAUDE.md content (same as watcher does)
  const claudeMd = `${soulMd}\n\n---\n\n${systemMd}`;

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] md:h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link to="/config" className="text-zinc-400 hover:text-white text-sm">
            ← Back to Config
          </Link>
          <h2 className="text-2xl font-bold text-white">CLAUDE.md</h2>
          <p className="text-zinc-500 mt-1">Generated from SOUL.md + SYSTEM.md (read-only)</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/config/soul-md"
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors text-sm"
          >
            Edit SOUL.md
          </Link>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-zinc-900 border border-zinc-800 rounded-lg p-6">
        <article className="prose prose-invert prose-zinc max-w-none prose-headings:border-b prose-headings:border-zinc-800 prose-headings:pb-2 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-a:text-blue-400 prose-strong:text-white prose-li:marker:text-zinc-500">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{claudeMd}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
