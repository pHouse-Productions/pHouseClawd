import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "@/lib/auth";

type RestartTarget = "watcher" | "dashboard" | "api" | "all" | "mcp";

interface ProcessStatus {
  running: boolean;
  pid?: number;
}

interface McpStatus {
  total: number;
  healthy: number;
  error: number;
}

interface Status {
  watcher: ProcessStatus;
  dashboard: ProcessStatus;
  mcp: McpStatus;
}

interface FixResult {
  output: string;
  jobId?: string;
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ title, message, confirmText, confirmColor, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-zinc-700">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {title}
          </h3>
        </div>
        <div className="px-6 py-4">
          <p className="text-zinc-300">{message}</p>
        </div>
        <div className="px-6 py-4 border-t border-zinc-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 ${confirmColor} text-white rounded-lg transition-colors font-medium`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RestartButton() {
  const [restartingTarget, setRestartingTarget] = useState<RestartTarget | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    target: RestartTarget;
    title: string;
    message: string;
    confirmText: string;
    confirmColor: string;
  } | null>(null);
  const navigate = useNavigate();

  // Fetch status on mount and periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await authFetch("/api/status");
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {
        // Ignore errors (might be restarting)
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const showConfirmation = (target: RestartTarget) => {
    const configs: Record<RestartTarget, { title: string; message: string; confirmText: string; confirmColor: string }> = {
      watcher: {
        title: "Restart Watcher",
        message: "This will restart the watcher service. Any running jobs will be interrupted. Are you sure?",
        confirmText: "Restart Watcher",
        confirmColor: "bg-blue-600 hover:bg-blue-500",
      },
      dashboard: {
        title: "Restart Dashboard",
        message: "This will restart the frontend. The page will reload. Are you sure?",
        confirmText: "Restart Dashboard",
        confirmColor: "bg-blue-600 hover:bg-blue-500",
      },
      api: {
        title: "Restart API",
        message: "This will restart the API server. The dashboard will be briefly unresponsive. Are you sure?",
        confirmText: "Restart API",
        confirmColor: "bg-blue-600 hover:bg-blue-500",
      },
      mcp: {
        title: "Rebuild & Restart MCP",
        message: "This will rebuild pHouseMcp from source and restart all MCP servers. This may take a moment. Are you sure?",
        confirmText: "Rebuild MCP",
        confirmColor: "bg-orange-600 hover:bg-orange-500",
      },
      all: {
        title: "Restart Everything",
        message: "This will restart the watcher, API, AND rebuild MCP servers. All running jobs will be interrupted. Are you absolutely sure?",
        confirmText: "Restart All",
        confirmColor: "bg-red-600 hover:bg-red-500",
      },
    };
    setConfirmDialog({ target, ...configs[target] });
  };

  const handleRestart = async (target: RestartTarget) => {
    setConfirmDialog(null);
    setRestartingTarget(target);

    // MCP restart uses a different endpoint
    if (target === "mcp") {
      try {
        const res = await authFetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restart" }),
        });
        const data = await res.json();

        if (!data.success) {
          alert(`MCP restart failed: ${data.error || "Unknown error"}`);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        alert(`MCP restart error: ${errorMsg}`);
      } finally {
        setRestartingTarget(null);
      }
      return;
    }

    try {
      const res = await authFetch("/api/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();

      if (!data.success) {
        alert(`Restart failed: ${data.message || "Unknown error"}`);
        setRestartingTarget(null);
      } else {
        // Show feedback
        if (target === "watcher") {
          // Watcher restart is quick, reset after a moment
          setTimeout(() => setRestartingTarget(null), 3000);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      if (!errorMsg.includes("fetch")) {
        alert(`Restart error: ${errorMsg}`);
        setRestartingTarget(null);
      }
    }
  };

  const handleFix = async () => {
    setIsFixing(true);
    setFixResult(null);

    try {
      const res = await authFetch("/api/watcher/fix", {
        method: "POST",
      });
      const data = await res.json();

      if (data.success) {
        setFixResult({
          output: data.output || "Fix completed successfully!",
          jobId: data.jobId,
        });
      } else {
        setFixResult({
          output: `Fix failed: ${data.error || data.message || "Unknown error"}\n\nOutput:\n${data.output || "No output"}`,
          jobId: data.jobId,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setFixResult({ output: `Fix error: ${errorMsg}` });
    } finally {
      setIsFixing(false);
    }
  };

  const handleViewJob = (jobId: string) => {
    setFixResult(null);
    navigate(`/jobs?job=${jobId}`);
  };

  // MCP status: green if all healthy, yellow if some errors, red if all down
  const getMcpStatusInfo = () => {
    if (!status?.mcp || status.mcp.total === 0) return { color: "bg-zinc-500", text: "Unknown", textColor: "text-zinc-400" };
    if (status.mcp.error === 0) return { color: "bg-green-500", text: "All Healthy", textColor: "text-green-400" };
    if (status.mcp.healthy > 0) return { color: "bg-yellow-500", text: "Partial", textColor: "text-yellow-400" };
    return { color: "bg-red-500", text: "Down", textColor: "text-red-400" };
  };

  const isWatcherDown = status && !status.watcher.running;
  const mcpInfo = getMcpStatusInfo();

  return (
    <div className="space-y-4">
      {/* Service Status Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Watcher */}
        <div className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
          <div className={`w-2 h-2 rounded-full ${status?.watcher?.running ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-sm text-zinc-300">Watcher</span>
          {status?.watcher?.pid && (
            <span className="text-xs text-zinc-500">({status.watcher.pid})</span>
          )}
          <button
            onClick={() => showConfirmation("watcher")}
            disabled={restartingTarget === "watcher"}
            className={`ml-2 px-2 py-1 rounded text-xs font-medium transition-colors ${
              restartingTarget === "watcher"
                ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            }`}
          >
            {restartingTarget === "watcher" ? "..." : "Restart"}
          </button>
          {isWatcherDown && (
            <button
              onClick={handleFix}
              disabled={isFixing}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                isFixing
                  ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                  : "bg-orange-600/20 hover:bg-orange-600/30 text-orange-400"
              }`}
              title="Emergency AI Fix"
            >
              {isFixing ? "..." : "Fix"}
            </button>
          )}
        </div>

        {/* API */}
        <div className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
          <div className={`w-2 h-2 rounded-full ${status?.dashboard?.running ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-sm text-zinc-300">API</span>
          {status?.dashboard?.pid && (
            <span className="text-xs text-zinc-500">({status.dashboard.pid})</span>
          )}
          <button
            onClick={() => showConfirmation("api")}
            disabled={restartingTarget === "api"}
            className={`ml-2 px-2 py-1 rounded text-xs font-medium transition-colors ${
              restartingTarget === "api"
                ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            }`}
          >
            {restartingTarget === "api" ? "..." : "Restart"}
          </button>
        </div>

        {/* MCP */}
        <div className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
          <div className={`w-2 h-2 rounded-full ${mcpInfo.color}`} />
          <span className="text-sm text-zinc-300">MCP</span>
          <span className="text-xs text-zinc-500">
            {status?.mcp ? `${status.mcp.healthy}/${status.mcp.total}` : "..."}
          </span>
          <button
            onClick={() => showConfirmation("mcp")}
            disabled={restartingTarget === "mcp"}
            className={`ml-2 px-2 py-1 rounded text-xs font-medium transition-colors ${
              restartingTarget === "mcp"
                ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            }`}
          >
            {restartingTarget === "mcp" ? "..." : "Rebuild"}
          </button>
        </div>

        {/* Restart All */}
        <button
          onClick={() => showConfirmation("all")}
          disabled={restartingTarget === "all"}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
            restartingTarget === "all"
              ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
              : "bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20"
          }`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {restartingTarget === "all" ? "..." : "All"}
        </button>
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          confirmColor={confirmDialog.confirmColor}
          onConfirm={() => handleRestart(confirmDialog.target)}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Fix output modal */}
      {fixResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Emergency Fix Results
              </h3>
              <button
                onClick={() => setFixResult(null)}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-800 p-4 rounded-lg overflow-x-auto">
                {fixResult.output}
              </pre>
            </div>
            <div className="px-4 py-3 border-t border-zinc-700 flex justify-end gap-2">
              {fixResult.jobId && (
                <button
                  onClick={() => handleViewJob(fixResult.jobId!)}
                  className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View Full Job
                </button>
              )}
              <button
                onClick={() => setFixResult(null)}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => showConfirmation("watcher")}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                Try Restart Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
