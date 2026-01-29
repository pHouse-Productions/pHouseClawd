"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth";

type RestartTarget = "watcher" | "dashboard" | "all";
type ActionType = RestartTarget | "fix";

interface ProcessStatus {
  running: boolean;
  pid?: number;
}

interface Status {
  watcher: ProcessStatus;
  dashboard: ProcessStatus;
}

export default function RestartButton() {
  const [isRestarting, setIsRestarting] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [fixOutput, setFixOutput] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

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

  const handleRestart = async (target: RestartTarget) => {
    setIsRestarting(true);
    setShowMenu(false);

    try {
      const res = await authFetch("/api/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();

      if (!data.success) {
        alert(`Restart failed: ${data.message || "Unknown error"}`);
        setIsRestarting(false);
      } else {
        // Show feedback
        if (target === "watcher") {
          // Watcher restart is quick, reset after a moment
          setTimeout(() => setIsRestarting(false), 3000);
        }
        // For dashboard/all, the page will become unresponsive
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      if (!errorMsg.includes("fetch")) {
        alert(`Restart error: ${errorMsg}`);
        setIsRestarting(false);
      }
    }
  };

  const handleFix = async () => {
    setIsFixing(true);
    setShowMenu(false);
    setFixOutput(null);

    try {
      const res = await authFetch("/api/watcher/fix", {
        method: "POST",
      });
      const data = await res.json();

      if (data.success) {
        setFixOutput(data.output || "Fix completed successfully!");
      } else {
        setFixOutput(`Fix failed: ${data.error || data.message || "Unknown error"}\n\nOutput:\n${data.output || "No output"}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setFixOutput(`Fix error: ${errorMsg}`);
    } finally {
      setIsFixing(false);
    }
  };

  const StatusDot = ({ running }: { running: boolean }) => (
    <span
      className={`w-2 h-2 rounded-full ${running ? "bg-green-500" : "bg-red-500"}`}
    />
  );

  const isWatcherDown = status && !status.watcher.running;

  return (
    <div className="relative">
      {/* Status indicators */}
      <div className="flex items-center gap-4 mb-2 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5">
          <StatusDot running={status?.watcher?.running ?? false} />
          <span>Watcher</span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot running={status?.dashboard?.running ?? false} />
          <span>Dashboard</span>
        </div>
      </div>

      {/* Restart button with dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          disabled={isRestarting || isFixing}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            isRestarting || isFixing
              ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
              : "bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {isRestarting ? "Restarting..." : isFixing ? "Fixing..." : "Restart"}
          <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown menu */}
        {showMenu && !isRestarting && !isFixing && (
          <div className="absolute right-0 mt-2 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-10">
            <button
              onClick={() => handleRestart("watcher")}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-zinc-700 rounded-t-lg flex items-center gap-2"
            >
              <StatusDot running={status?.watcher?.running ?? false} />
              Restart Watcher
            </button>
            <button
              onClick={() => handleRestart("dashboard")}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-zinc-700 flex items-center gap-2"
            >
              <StatusDot running={status?.dashboard?.running ?? false} />
              Restart Dashboard
            </button>
            <div className="border-t border-zinc-700" />
            <button
              onClick={() => handleRestart("all")}
              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-zinc-700"
            >
              Restart Everything
            </button>
            {isWatcherDown && (
              <>
                <div className="border-t border-zinc-700" />
                <button
                  onClick={handleFix}
                  className="w-full px-4 py-2 text-left text-sm text-orange-400 hover:bg-zinc-700 rounded-b-lg flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Emergency Fix (AI)
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Click outside to close */}
      {showMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowMenu(false)}
        />
      )}

      {/* Fix output modal */}
      {fixOutput && (
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
                onClick={() => setFixOutput(null)}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-800 p-4 rounded-lg overflow-x-auto">
                {fixOutput}
              </pre>
            </div>
            <div className="px-4 py-3 border-t border-zinc-700 flex justify-end gap-2">
              <button
                onClick={() => setFixOutput(null)}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => handleRestart("watcher")}
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
