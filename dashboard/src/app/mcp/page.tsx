"use client";

import { useState } from "react";
import { authFetch } from "@/lib/auth";

interface McpServer {
  name: string;
  status: "connected" | "error" | "disabled" | "unknown";
  command: string;
}

interface McpData {
  servers: McpServer[];
  total: number;
  healthy: number;
  disabled: number;
}

export default function McpPage() {
  const [data, setData] = useState<McpData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchData = () => {
    setLoading(true);
    setError(null);
    authFetch("/api/mcp")
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setHasFetched(true);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const toggleServer = async (name: string, currentStatus: string) => {
    const action = currentStatus === "disabled" ? "enable" : "disable";
    setToggling(name);
    try {
      const res = await authFetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to toggle server");
      }
      // Refresh the list
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to toggle server");
    } finally {
      setToggling(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "text-green-400";
      case "error":
        return "text-red-400";
      case "disabled":
        return "text-zinc-500";
      default:
        return "text-zinc-400";
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case "connected":
        return "bg-green-500/20";
      case "error":
        return "bg-red-500/20";
      case "disabled":
        return "bg-zinc-700/50";
      default:
        return "bg-zinc-500/20";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case "error":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case "disabled":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  // Initial state - haven't fetched yet
  if (!hasFetched && !loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">MCP Servers</h2>
          <p className="text-zinc-500 mt-1">Model Context Protocol integrations</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400 mb-4">Health check runs against all MCP servers and can take a moment.</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium flex items-center gap-2 mx-auto"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Fetch Status
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">MCP Servers</h2>
          <p className="text-zinc-500 mt-1">Model Context Protocol integrations</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Checking server health... (this can take a moment)</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">MCP Servers</h2>
          <p className="text-zinc-500 mt-1">Model Context Protocol integrations</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-red-400">Error: {error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold text-white">MCP Servers</h2>
          <p className="text-zinc-500 mt-1">
            {data?.healthy}/{data?.total} connected
            {data?.disabled ? ` (${data.disabled} disabled)` : ""}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-white text-sm flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      <div className="bg-zinc-900/50 rounded-lg border border-zinc-800 p-3 text-sm text-zinc-400">
        MCP servers reload with each Claude session. Toggle switches will enable/disable servers for future sessions.
      </div>

      {!data?.servers?.length ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No MCP servers found</p>
          <p className="text-zinc-600 text-sm mt-2">
            Add servers via ~/.claude.json or project .mcp.json
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.servers.map((server) => (
            <div
              key={server.name}
              className={`flex items-center gap-3 bg-zinc-900 rounded-lg border border-zinc-800 p-4 ${
                server.status === "disabled" ? "opacity-60" : ""
              }`}
            >
              <div className={`w-10 h-10 flex-shrink-0 rounded-full ${getStatusBg(server.status)} flex items-center justify-center ${getStatusColor(server.status)}`}>
                {getStatusIcon(server.status)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-white font-medium">{server.name}</div>
                <div className="text-sm text-zinc-500 break-all" title={server.command}>
                  {server.command}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`text-sm font-medium hidden sm:block ${getStatusColor(server.status)}`}>
                  {server.status}
                </span>
                {/* Toggle Switch */}
                <button
                  onClick={() => toggleServer(server.name, server.status)}
                  disabled={toggling === server.name}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900 ${
                    server.status === "disabled"
                      ? "bg-zinc-700"
                      : "bg-green-600"
                  } ${toggling === server.name ? "opacity-50 cursor-wait" : ""}`}
                  title={server.status === "disabled" ? "Enable server" : "Disable server"}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      server.status === "disabled" ? "translate-x-1" : "translate-x-6"
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
