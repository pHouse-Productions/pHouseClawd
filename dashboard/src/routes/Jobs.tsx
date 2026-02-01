import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authFetch } from "@/lib/auth";

interface Job {
  id: string;
  startTime: string;
  endTime?: string;
  channel: string;
  status: "running" | "completed" | "error" | "stopped";
  triggerText?: string;
  toolCount: number;
  cost?: number;
  durationMs?: number;
}

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const selectedJobId = searchParams.get("job");

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const res = await authFetch("/api/jobs?limit=50");
        if (res.ok) {
          const data = await res.json();
          setJobs(data.jobs || []);
        }
      } catch (err) {
        console.error("Failed to fetch jobs:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString();
  };

  const statusColors: Record<string, string> = {
    running: "bg-blue-500",
    completed: "bg-green-500",
    error: "bg-red-500",
    stopped: "bg-yellow-500",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading jobs...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Jobs</h2>
        <p className="text-zinc-500 mt-1">Recent job history</p>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800">
        {jobs.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">No jobs yet</div>
        ) : (
          jobs.map((job) => (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className={`block p-4 hover:bg-zinc-800/50 transition-colors ${
                selectedJobId === job.id ? "bg-zinc-800/50" : ""
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full ${statusColors[job.status]}`} />
                    <span className="text-sm font-medium text-white">{job.channel}</span>
                    <span className="text-xs text-zinc-500">{job.status}</span>
                  </div>
                  <p className="text-sm text-zinc-400 truncate">{job.triggerText || "No trigger text"}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
                    <span>{formatTime(job.startTime)}</span>
                    <span>{job.toolCount} tools</span>
                    {job.cost && <span>${job.cost.toFixed(4)}</span>}
                    {job.durationMs && <span>{(job.durationMs / 1000).toFixed(1)}s</span>}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
