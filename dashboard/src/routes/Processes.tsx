import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth";

interface PM2Process {
  pm_id: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
}

interface ProcessesData {
  core: PM2Process[];
  mcp: PM2Process[];
  other: PM2Process[];
  total: number;
  running: number;
}

interface ProcessCounts {
  claude: number;
  node: number;
}

export default function Processes() {
  const [data, setData] = useState<ProcessesData | null>(null);
  const [counts, setCounts] = useState<ProcessCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ name: string; content: string } | null>(null);

  const fetchProcesses = async () => {
    try {
      const res = await authFetch("/api/processes");
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch processes:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCounts = async () => {
    try {
      const res = await authFetch("/api/processes/counts");
      if (res.ok) {
        setCounts(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch counts:", err);
    }
  };

  useEffect(() => {
    fetchProcesses();
    fetchCounts();
    const interval = setInterval(() => {
      fetchProcesses();
      fetchCounts();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (name: string, action: "start" | "stop" | "restart") => {
    setActionLoading(`${name}-${action}`);
    try {
      const res = await authFetch(`/api/processes/${name}/${action}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || `Failed to ${action} ${name}`);
      }
      // Refresh after action
      setTimeout(fetchProcesses, 1000);
    } catch (err) {
      console.error(`Failed to ${action} ${name}:`, err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGroupAction = async (group: string, action: "restart") => {
    setActionLoading(`group-${group}`);
    try {
      const res = await authFetch(`/api/processes/group/${group}/${action}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || `Failed to ${action} ${group}`);
      }
      setTimeout(fetchProcesses, 2000);
    } catch (err) {
      console.error(`Failed to ${action} ${group}:`, err);
    } finally {
      setActionLoading(null);
    }
  };

  const viewLogs = async (name: string) => {
    try {
      const res = await authFetch(`/api/processes/${name}/logs?lines=100`);
      if (res.ok) {
        const data = await res.json();
        setLogs({ name, content: data.logs });
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    }
  };

  const formatUptime = (timestamp: number) => {
    if (!timestamp) return "-";
    const ms = Date.now() - timestamp;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "online":
        return "bg-green-500";
      case "stopped":
        return "bg-yellow-500";
      case "errored":
        return "bg-red-500";
      default:
        return "bg-zinc-500";
    }
  };

  const ProcessRow = ({ p }: { p: PM2Process }) => (
    <tr key={p.pm_id} className="border-b border-zinc-800 hover:bg-zinc-800/50">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor(p.status)}`} />
          <span className="font-medium">{p.name}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-sm">{p.status}</td>
      <td className="py-3 px-4 text-sm text-right">{p.cpu.toFixed(0)}%</td>
      <td className="py-3 px-4 text-sm text-right">{p.memory}MB</td>
      <td className="py-3 px-4 text-sm text-right">{formatUptime(p.uptime)}</td>
      <td className="py-3 px-4 text-sm text-right">{p.restarts}</td>
      <td className="py-3 px-4">
        <div className="flex gap-1 justify-end">
          <button
            onClick={() => viewLogs(p.name)}
            className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded"
          >
            Logs
          </button>
          {p.status === "online" ? (
            <>
              <button
                onClick={() => handleAction(p.name, "restart")}
                disabled={actionLoading === `${p.name}-restart`}
                className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
              >
                {actionLoading === `${p.name}-restart` ? "..." : "Restart"}
              </button>
              {p.name !== "dashboard-api" && (
                <button
                  onClick={() => handleAction(p.name, "stop")}
                  disabled={actionLoading === `${p.name}-stop`}
                  className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 rounded disabled:opacity-50"
                >
                  {actionLoading === `${p.name}-stop` ? "..." : "Stop"}
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => handleAction(p.name, "start")}
              disabled={actionLoading === `${p.name}-start`}
              className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 rounded disabled:opacity-50"
            >
              {actionLoading === `${p.name}-start` ? "..." : "Start"}
            </button>
          )}
        </div>
      </td>
    </tr>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading processes...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Failed to load processes</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Processes</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {data.running}/{data.total} running - Managed by PM2
          </p>
        </div>
      </div>

      {/* Process Counts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-900 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${counts && counts.claude > 0 ? 'bg-green-500 animate-pulse' : 'bg-zinc-600'}`} />
            <div>
              <div className="text-2xl font-bold">{counts?.claude ?? 0}</div>
              <div className="text-zinc-500 text-sm">Claude Sessions</div>
            </div>
          </div>
        </div>
        <div className="bg-zinc-900 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${counts && counts.node > 0 ? 'bg-blue-500' : 'bg-zinc-600'}`} />
            <div>
              <div className="text-2xl font-bold">{counts?.node ?? 0}</div>
              <div className="text-zinc-500 text-sm">Node Processes</div>
            </div>
          </div>
        </div>
      </div>

      {/* Logs Modal */}
      {logs && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-lg max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <h3 className="font-medium">Logs: {logs.name}</h3>
              <button
                onClick={() => setLogs(null)}
                className="text-zinc-400 hover:text-white"
              >
                Close
              </button>
            </div>
            <pre className="p-4 overflow-auto flex-1 text-xs text-zinc-300 font-mono whitespace-pre-wrap">
              {logs.content}
            </pre>
          </div>
        </div>
      )}

      {/* Core Services */}
      <div className="bg-zinc-900 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="font-semibold">Core Services</h2>
          <button
            onClick={() => handleGroupAction("core", "restart")}
            disabled={actionLoading === "group-core"}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
          >
            {actionLoading === "group-core" ? "Restarting..." : "Restart All"}
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="text-xs text-zinc-500 uppercase">
            <tr className="border-b border-zinc-800">
              <th className="py-2 px-4 text-left">Name</th>
              <th className="py-2 px-4 text-left">Status</th>
              <th className="py-2 px-4 text-right">CPU</th>
              <th className="py-2 px-4 text-right">Memory</th>
              <th className="py-2 px-4 text-right">Uptime</th>
              <th className="py-2 px-4 text-right">Restarts</th>
              <th className="py-2 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.core.map((p) => (
              <ProcessRow key={p.pm_id} p={p} />
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* MCP Servers - only show if there are any (legacy, now in core) */}
      {data.mcp.length > 0 && (
      <div className="bg-zinc-900 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="font-semibold">MCP Servers</h2>
          <button
            onClick={() => handleGroupAction("mcp", "restart")}
            disabled={actionLoading === "group-mcp"}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
          >
            {actionLoading === "group-mcp" ? "Restarting..." : "Restart All"}
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="text-xs text-zinc-500 uppercase">
            <tr className="border-b border-zinc-800">
              <th className="py-2 px-4 text-left">Name</th>
              <th className="py-2 px-4 text-left">Status</th>
              <th className="py-2 px-4 text-right">CPU</th>
              <th className="py-2 px-4 text-right">Memory</th>
              <th className="py-2 px-4 text-right">Uptime</th>
              <th className="py-2 px-4 text-right">Restarts</th>
              <th className="py-2 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.mcp.map((p) => (
              <ProcessRow key={p.pm_id} p={p} />
            ))}
          </tbody>
        </table>
        </div>
      </div>
      )}

      {/* Other Processes (if any) */}
      {data.other.length > 0 && (
        <div className="bg-zinc-900 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h2 className="font-semibold">Other Processes</h2>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead className="text-xs text-zinc-500 uppercase">
              <tr className="border-b border-zinc-800">
                <th className="py-2 px-4 text-left">Name</th>
                <th className="py-2 px-4 text-left">Status</th>
                <th className="py-2 px-4 text-right">CPU</th>
                <th className="py-2 px-4 text-right">Memory</th>
                <th className="py-2 px-4 text-right">Uptime</th>
                <th className="py-2 px-4 text-right">Restarts</th>
                <th className="py-2 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.other.map((p) => (
                <ProcessRow key={p.pm_id} p={p} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* PM2 Info */}
      <div className="text-xs text-zinc-600 text-center">
        Managed by PM2 - Config: /home/ubuntu/ecosystem.config.cjs
      </div>
    </div>
  );
}
