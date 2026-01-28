"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth";

type RestartTarget = "watcher" | "dashboard" | "all";

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

  const StatusDot = ({ running }: { running: boolean }) => (
    <span
      className={`w-2 h-2 rounded-full ${running ? "bg-green-500" : "bg-red-500"}`}
    />
  );

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
          disabled={isRestarting}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            isRestarting
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
          {isRestarting ? "Restarting..." : "Restart"}
          <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown menu */}
        {showMenu && !isRestarting && (
          <div className="absolute right-0 mt-2 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-10">
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
              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-zinc-700 rounded-b-lg"
            >
              Restart Everything
            </button>
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
    </div>
  );
}
