"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth";

interface JobStep {
  ts: string;
  type: "text" | "tool_call" | "tool_result" | "system" | "result" | "error";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
}

interface Job {
  id: string;
  startTime: string;
  endTime?: string;
  channel: string;
  model?: string;
  cost?: number;
  durationMs?: number;
  steps: JobStep[];
  status: "running" | "completed" | "error";
  triggerText?: string;
  fullPrompt?: string;
  toolCount: number;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${colors[status]}`}>
      {status}
    </span>
  );
}

function StepIcon({ type, isError }: { type: JobStep["type"]; isError?: boolean }) {
  if (isError) {
    return (
      <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }

  const configs = {
    text: { bg: "bg-green-500/20", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z", color: "text-green-400" },
    tool_call: { bg: "bg-blue-500/20", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z", color: "text-blue-400" },
    tool_result: { bg: "bg-purple-500/20", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", color: "text-purple-400" },
    system: { bg: "bg-zinc-500/20", icon: "M13 10V3L4 14h7v7l9-11h-7z", color: "text-zinc-400" },
    result: { bg: "bg-green-500/20", icon: "M5 13l4 4L19 7", color: "text-green-400" },
    error: { bg: "bg-red-500/20", icon: "M6 18L18 6M6 6l12 12", color: "text-red-400" },
  };

  const config = configs[type] || { bg: "bg-zinc-500/20", icon: "", color: "text-zinc-400" };

  return (
    <div className={`w-6 h-6 rounded-full ${config.bg} flex items-center justify-center flex-shrink-0`}>
      {config.icon ? (
        <svg className={`w-3 h-3 ${config.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={config.icon} />
        </svg>
      ) : (
        <div className="w-2 h-2 rounded-full bg-zinc-500" />
      )}
    </div>
  );
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);

  const fetchJob = useCallback(async () => {
    try {
      const res = await authFetch(`/api/jobs?job_id=${jobId}`);
      const data = await res.json();
      if (data.job) {
        setJob(data.job);
        // Auto-enable refresh if job is still running
        if (data.job.status === "running" && !autoRefresh) {
          setAutoRefresh(true);
        }
        // Disable refresh if job completed
        if (data.job.status !== "running" && autoRefresh) {
          setAutoRefresh(false);
        }
      }
    } catch (err) {
      console.error("Failed to fetch job:", err);
    } finally {
      setLoading(false);
    }
  }, [jobId, autoRefresh]);

  useEffect(() => {
    fetchJob();
  }, []);

  // Auto-refresh for running jobs
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchJob, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchJob]);

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Link href="/jobs" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Jobs
        </Link>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-4">
        <Link href="/jobs" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Jobs
        </Link>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Job not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/jobs" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        {job.status === "running" && (
          <div className="flex items-center gap-2 text-sm text-blue-400">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            Live
          </div>
        )}
      </div>

      {/* Job Summary Card */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={job.status} />
              <span className="text-sm text-zinc-400">{job.model || "unknown"}</span>
              <span className="text-sm text-zinc-600">{job.channel}</span>
            </div>
            {job.triggerText && (
              <p className="text-white mt-2">{job.triggerText}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm text-zinc-500">
              <span>{formatDateTime(job.startTime)}</span>
              <span>{formatDuration(job.durationMs)}</span>
              <span>{formatCost(job.cost)}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <p className="text-xs text-zinc-600 font-mono break-all">{job.id}</p>
        </div>
      </div>

      {/* Full Prompt (collapsible) */}
      {job.fullPrompt && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800">
          <button
            onClick={() => setShowFullPrompt(!showFullPrompt)}
            className="w-full px-4 py-3 flex items-center justify-between text-left"
          >
            <h3 className="text-sm font-semibold text-white">
              Full Prompt Sent to Claude
            </h3>
            <svg
              className={`w-4 h-4 text-zinc-400 transition-transform ${showFullPrompt ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showFullPrompt && (
            <div className="px-4 pb-4">
              <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap break-all bg-zinc-800/50 rounded p-3 max-h-96 overflow-auto">
                {job.fullPrompt}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            Steps ({job.steps.length})
          </h3>
          <span className="text-xs text-zinc-500">
            {job.toolCount} tool{job.toolCount !== 1 ? "s" : ""} used
          </span>
        </div>
        <div className="p-4 space-y-3">
          {job.steps.map((step, index) => (
            <div key={index} className="flex gap-3">
              <div className="flex flex-col items-center">
                <StepIcon type={step.type} isError={step.isError} />
                {index < job.steps.length - 1 && (
                  <div className="w-px flex-1 bg-zinc-800 my-1 min-h-[8px]" />
                )}
              </div>
              <div className="flex-1 min-w-0 pb-2">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs text-zinc-500">{formatTime(step.ts)}</span>
                  {step.toolName && (
                    <span className="text-xs font-medium text-blue-400">{step.toolName}</span>
                  )}
                  {step.type === "text" && (
                    <span className="text-xs text-green-400">Response</span>
                  )}
                </div>
                <div
                  onClick={() => toggleStep(index)}
                  className={`text-sm cursor-pointer rounded p-2 -ml-2 ${
                    step.isError
                      ? "bg-red-500/10 text-red-300"
                      : step.type === "tool_call"
                      ? "bg-blue-500/5 text-zinc-400 active:bg-blue-500/10"
                      : step.type === "tool_result"
                      ? "bg-purple-500/5 text-zinc-500 active:bg-purple-500/10"
                      : step.type === "text"
                      ? "bg-green-500/5 text-zinc-300 active:bg-green-500/10"
                      : "bg-zinc-800/50 text-zinc-400 active:bg-zinc-800"
                  }`}
                >
                  <pre className={`font-mono text-xs whitespace-pre-wrap break-all ${
                    expandedSteps.has(index) ? "" : "line-clamp-4"
                  }`}>
                    {step.content}
                  </pre>
                  {step.content.length > 200 && (
                    <span className="text-xs text-zinc-600 mt-1 block">
                      {expandedSteps.has(index) ? "Tap to collapse" : "Tap to expand"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
