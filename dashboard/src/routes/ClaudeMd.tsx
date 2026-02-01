import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";

export default function ClaudeMd() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const res = await authFetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          setContent(data.claudeMd || "");
        }
      } catch (err) {
        console.error("Failed to fetch CLAUDE.md:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchContent();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "claudeMd", data: content }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Saved!" });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/config" className="text-zinc-400 hover:text-white text-sm">
            ← Back to Config
          </Link>
          <h2 className="text-2xl font-bold text-white">CLAUDE.md</h2>
          <p className="text-zinc-500 mt-1">System instructions</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg ${
            message.type === "success"
              ? "bg-green-600/20 text-green-400"
              : "bg-red-600/20 text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full h-[60vh] bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-zinc-100 font-mono text-sm resize-none focus:outline-none focus:border-zinc-700"
        placeholder="# CLAUDE.md content..."
      />
    </div>
  );
}
