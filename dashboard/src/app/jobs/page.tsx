"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth";

interface Job {
  id: string;
  startTime: string;
  endTime?: string;
  channel: string;
  model?: string;
  cost?: number;
  durationMs?: number;
  status: "running" | "completed" | "error" | "stopped";
  triggerText?: string;
  toolCount: number;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms?: number): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatCost(cost?: number): string {
  if (!cost) return "-";
  return `$${cost.toFixed(4)}`;
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const colors = {
    running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    completed: "bg-green-500/20 text-green-400 border-green-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
    stopped: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${colors[status]}`}>
      {status}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const colors: Record<string, string> = {
    telegram: "bg-sky-500/20 text-sky-400",
    email: "bg-amber-500/20 text-amber-400",
    cron: "bg-violet-500/20 text-violet-400",
    dashboard: "bg-emerald-500/20 text-emerald-400",
    gchat: "bg-green-500/20 text-green-400",
    discord: "bg-indigo-500/20 text-indigo-400",
  };
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${colors[channel] || "bg-zinc-700 text-zinc-400"}`}>
      {channel}
    </span>
  );
}

const PAGE_SIZE = 10;

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [stoppingJobs, setStoppingJobs] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const stopJob = async (jobId: string, e: React.MouseEvent) => {
    e.preventDefault(); // Don't navigate to job detail
    e.stopPropagation();

    if (stoppingJobs.has(jobId)) return;

    setStoppingJobs((prev) => new Set(prev).add(jobId));

    try {
      const res = await authFetch(`/api/jobs/${jobId}/stop`, { method: "POST" });
      if (res.ok) {
        // Refresh job list
        await fetchJobs();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to stop job");
      }
    } catch (err) {
      console.error("Failed to stop job:", err);
      alert("Failed to stop job");
    } finally {
      setStoppingJobs((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const fetchJobs = useCallback(async (reset = true) => {
    try {
      const offset = reset ? 0 : jobs.length;
      if (!reset) setLoadingMore(true);

      const res = await authFetch(`/api/jobs?limit=${PAGE_SIZE}&offset=${offset}`);
      const data = await res.json();

      if (reset) {
        setJobs(data.jobs || []);
      } else {
        setJobs(prev => [...prev, ...(data.jobs || [])]);
      }

      setTotal(data.total || 0);
      setHasMore(data.hasMore || false);

      // Auto-enable refresh if any jobs are running
      const hasRunning = (data.jobs || []).some((j: Job) => j.status === "running");
      if (hasRunning && !autoRefresh) {
        setAutoRefresh(true);
      }
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [autoRefresh, jobs.length]);

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchJobs]);

  const runningJobs = jobs.filter((j) => j.status === "running");
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const errorJobs = jobs.filter((j) => j.status === "error");
  const stoppedJobs = jobs.filter((j) => j.status === "stopped");

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Jobs</h2>
          <p className="text-zinc-500 mt-1">Task execution history</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Jobs</h2>
          <p className="text-zinc-500 mt-1">Task execution history</p>
        </div>
        <button
          onClick={() => fetchJobs()}
          className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <div className="text-xl font-bold text-blue-500">{runningJobs.length}</div>
          <div className="text-xs text-zinc-500">Running</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <div className="text-xl font-bold text-green-500">{completedJobs.length}</div>
          <div className="text-xs text-zinc-500">Completed</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <div className="text-xl font-bold text-orange-500">{stoppedJobs.length}</div>
          <div className="text-xs text-zinc-500">Stopped</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <div className="text-xl font-bold text-red-500">{errorJobs.length}</div>
          <div className="text-xs text-zinc-500">Errors</div>
        </div>
      </div>

      {/* Auto-refresh toggle */}
      <div className="flex items-center justify-between bg-zinc-900 rounded-lg border border-zinc-800 px-4 py-3">
        <span className="text-sm text-zinc-400">Auto-refresh</span>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            autoRefresh ? "bg-blue-600" : "bg-zinc-700"
          }`}
        >
          <div
            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
              autoRefresh ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Job List */}
      {jobs.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No jobs found</p>
          <p className="text-zinc-600 text-sm mt-2">
            Jobs will appear here as messages are processed
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500 text-right">
            Showing {jobs.length} of {total} jobs
          </div>
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="block bg-zinc-900 rounded-lg border border-zinc-800 p-4 active:bg-zinc-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={job.status} />
                    <ChannelBadge channel={job.channel} />
                    <span className="text-xs text-zinc-500">{formatDateTime(job.startTime)}</span>
                  </div>
                  <p className="text-sm text-zinc-300 mt-2 line-clamp-2">
                    {job.triggerText || "(no trigger text)"}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                    <span>{job.toolCount} tool{job.toolCount !== 1 ? "s" : ""}</span>
                    <span>{formatDuration(job.durationMs)}</span>
                    <span>{formatCost(job.cost)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {job.status === "running" && (
                    <button
                      onClick={(e) => stopJob(job.id, e)}
                      disabled={stoppingJobs.has(job.id)}
                      className="px-3 py-1.5 text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded transition-colors disabled:opacity-50"
                    >
                      {stoppingJobs.has(job.id) ? "Stopping..." : "Stop"}
                    </button>
                  )}
                  <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}

          {/* Load More Button */}
          {hasMore && (
            <button
              onClick={() => fetchJobs(false)}
              disabled={loadingMore}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : `Load More (${total - jobs.length} remaining)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
