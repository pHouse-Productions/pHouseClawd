import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";
import MarkdownRenderer from "@/components/MarkdownRenderer";

const COLLAPSE_THRESHOLD = 300; // characters - keeps the page scannable

function CollapsibleContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = content.length > COLLAPSE_THRESHOLD;

  if (!shouldCollapse) {
    return (
      <div className="overflow-x-auto">
        <pre className="text-sm text-zinc-400 whitespace-pre-wrap break-words">{content}</pre>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <pre className="text-sm text-zinc-400 whitespace-pre-wrap break-words">
          {expanded ? content : content.slice(0, COLLAPSE_THRESHOLD) + "..."}
        </pre>
      </div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        {expanded ? "Show less" : `Show more (${(content.length / 1024).toFixed(1)}KB)`}
      </button>
    </div>
  );
}

interface JobStep {
  ts: string;
  type: "text" | "tool_call" | "tool_result" | "system" | "result" | "error";
  content: string;
  toolName?: string;
  isError?: boolean;
}

interface Job {
  id: string;
  startTime: string;
  endTime?: string;
  channel: string;
  status: string;
  triggerText?: string;
  fullPrompt?: string;
  steps: JobStep[];
  toolCount: number;
  cost?: number;
  durationMs?: number;
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const res = await authFetch(`/api/jobs?job_id=${id}`);
        if (res.ok) {
          const data = await res.json();
          setJob(data.job);
        }
      } catch (err) {
        console.error("Failed to fetch job:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchJob();
    const interval = setInterval(fetchJob, 2000);
    return () => clearInterval(interval);
  }, [id]);

  const handleStop = async () => {
    if (!job) return;
    setStopping(true);
    try {
      await authFetch(`/api/jobs/${job.id}/stop`, { method: "POST" });
    } catch (err) {
      console.error("Failed to stop job:", err);
    } finally {
      setStopping(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading job...</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-8">
        <p className="text-zinc-500">Job not found</p>
        <Link to="/jobs" className="text-blue-400 hover:underline mt-2 inline-block">
          Back to jobs
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/jobs" className="text-zinc-400 hover:text-white text-sm mb-2 inline-block">
            ← Back to Jobs
          </Link>
          <h2 className="text-2xl font-bold text-white">{job.channel}</h2>
          <p className="text-zinc-500 text-sm">{new Date(job.startTime).toLocaleString()}</p>
        </div>
        {job.status === "running" && (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {stopping ? "Stopping..." : "Stop"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-400">
        <span className="px-2 py-1 bg-zinc-800 rounded">{job.status}</span>
        <span>{job.toolCount} tools</span>
        {job.cost && <span>${job.cost.toFixed(4)}</span>}
        {job.durationMs && <span>{(job.durationMs / 1000).toFixed(1)}s</span>}
      </div>

      {job.fullPrompt && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h3 className="text-sm font-semibold text-white mb-2">Full Prompt</h3>
          <CollapsibleContent content={job.fullPrompt} />
        </div>
      )}

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800">
        <h3 className="text-sm font-semibold text-white p-4">Steps</h3>
        {job.steps.map((step, i) => (
          <div key={i} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-0.5 rounded ${
                step.type === "error" ? "bg-red-600/20 text-red-400" :
                step.type === "tool_call" ? "bg-blue-600/20 text-blue-400" :
                step.type === "tool_result" ? "bg-green-600/20 text-green-400" :
                "bg-zinc-700 text-zinc-400"
              }`}>
                {step.toolName || step.type}
              </span>
              <span className="text-xs text-zinc-500">{new Date(step.ts).toLocaleTimeString()}</span>
            </div>
            {step.type === "text" ? (
              <MarkdownRenderer content={step.content} />
            ) : (
              <CollapsibleContent content={step.content} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
