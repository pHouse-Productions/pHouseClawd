import { useState } from "react";
import { authFetch } from "@/lib/auth";

interface McpServer {
  name: string;
  status: "connected" | "error" | "disabled" | "unknown";
  command: string;
}

export default function Mcp() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchServers = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/mcp");
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers || []);
      }
    } catch (err) {
      console.error("Failed to fetch MCP servers:", err);
    } finally {
      setLoading(false);
    }
  };

  const statusColors: Record<string, string> = {
    connected: "bg-green-500",
    error: "bg-red-500",
    disabled: "bg-zinc-500",
    unknown: "bg-yellow-500",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">MCP Servers</h2>
          <p className="text-zinc-500 mt-1">Model Context Protocol servers</p>
        </div>
        {servers !== null && (
          <button
            onClick={fetchServers}
            disabled={loading}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>

      {servers === null ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400 mb-4">MCP server status is not loaded by default to keep the page fast.</p>
          <button
            onClick={fetchServers}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load Server Status"}
          </button>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800">
          {servers.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">No MCP servers found</div>
          ) : (
            servers.map((server) => (
              <div key={server.name} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${statusColors[server.status]}`} />
                  <div>
                    <div className="font-medium text-white">{server.name}</div>
                    <div className="text-xs text-zinc-500 truncate max-w-md">{server.command}</div>
                  </div>
                </div>
                <span className="text-xs text-zinc-400 capitalize">{server.status}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
