import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Tab = "soul" | "system";

export default function SystemInstructions() {
  const [soulMd, setSoulMd] = useState("");
  const [systemMd, setSystemMd] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("soul");

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
        console.error("Failed to fetch system instructions:", err);
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

  const tabs: { id: Tab; label: string; file: string }[] = [
    { id: "soul", label: "SOUL.md", file: "Soul / Personality" },
    { id: "system", label: "SYSTEM.md", file: "Technical Reference" },
  ];

  const content = activeTab === "soul" ? soulMd : systemMd;

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] md:h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">System Instructions</h2>
          <p className="text-zinc-500 mt-1">View Vito's configuration and personality</p>
        </div>
        <Link
          to="/config/soul-md"
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors text-sm"
        >
          Edit SOUL.md
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-zinc-800 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? "bg-zinc-800 text-white border-b-2 border-blue-500"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            }`}
          >
            <span className="font-mono text-sm">{tab.label}</span>
            <span className="text-xs text-zinc-500 ml-2 hidden sm:inline">({tab.file})</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto bg-zinc-900 border border-zinc-800 rounded-lg p-6">
        {content ? (
          <article className="prose prose-invert prose-zinc max-w-none prose-headings:border-b prose-headings:border-zinc-800 prose-headings:pb-2 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-a:text-blue-400 prose-strong:text-white prose-li:marker:text-zinc-500">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        ) : (
          <div className="text-zinc-500 text-center py-8">
            No content found for {activeTab === "soul" ? "SOUL.md" : "SYSTEM.md"}
          </div>
        )}
      </div>
    </div>
  );
}
