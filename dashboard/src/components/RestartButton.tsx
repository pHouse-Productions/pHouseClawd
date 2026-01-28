"use client";

import { useState } from "react";
import { authFetch } from "@/lib/auth";

export default function RestartButton() {
  const [isRestarting, setIsRestarting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleRestart = async () => {
    setIsRestarting(true);
    setShowConfirm(false);

    try {
      const res = await authFetch("/api/restart", { method: "POST" });
      const data = await res.json();

      if (!data.success) {
        alert(`Restart failed: ${data.message || "Unknown error"}`);
        setIsRestarting(false);
      }
      // If successful, the page will become unresponsive as the server restarts
    } catch (err) {
      // Could be expected (server restarting) or an actual error
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      if (!errorMsg.includes("fetch")) {
        alert(`Restart error: ${errorMsg}`);
        setIsRestarting(false);
      }
      // If it's a fetch/network error, the server is likely restarting
    }
  };

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Restart watcher?</span>
        <button
          onClick={handleRestart}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded transition-colors"
        >
          Yes
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded transition-colors"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
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
      {isRestarting ? "Restarting..." : "Restart Watcher"}
    </button>
  );
}
