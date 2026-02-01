import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth";

interface CronJob {
  id: string;
  schedule: string;
  description: string;
  prompt: string;
  enabled: boolean;
  nextRun?: string;
  lastRun?: string;
}

export default function Cron() {
  const [jobs, setJobs] = useState<CronJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/cron");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to load jobs");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleJob = async (job: CronJob) => {
    try {
      const res = await authFetch(`/api/cron/${job.id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      if (res.ok) {
        fetchJobs();
      }
    } catch (err) {
      console.error("Failed to toggle job:", err);
    }
  };

  const deleteJob = async (id: string) => {
    if (!confirm("Delete this cron job?")) return;
    try {
      const res = await authFetch(`/api/cron/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchJobs();
      }
    } catch (err) {
      console.error("Failed to delete job:", err);
    }
  };

  const saveJob = async (job: Partial<CronJob> & { id?: string }) => {
    setSaving(true);
    try {
      const isEdit = !!job.id;
      const res = await authFetch(isEdit ? `/api/cron/${job.id}` : "/api/cron", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      if (res.ok) {
        setEditingJob(null);
        setShowCreate(false);
        fetchJobs();
      }
    } catch (err) {
      console.error("Failed to save job:", err);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Cron Jobs</h2>
          <p className="text-zinc-500 mt-1">Scheduled tasks</p>
        </div>
        <div className="flex gap-2">
          {jobs !== null && (
            <button
              onClick={fetchJobs}
              disabled={loading}
              className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            + New Job
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-600/20 border border-red-600/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {jobs === null ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load Cron Jobs"}
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center text-zinc-500">
          No cron jobs configured
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800">
          {jobs.map((job) => (
            <div key={job.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${job.enabled ? "bg-green-500" : "bg-zinc-500"}`} />
                    <span className="font-medium text-white truncate">{job.description}</span>
                  </div>
                  <div className="text-sm text-zinc-400 mb-2">
                    <code className="bg-zinc-800 px-2 py-0.5 rounded text-xs">{job.schedule}</code>
                    {job.nextRun && (
                      <span className="ml-2 text-zinc-500">
                        Next: {new Date(job.nextRun).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-500 line-clamp-2">{job.prompt}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleJob(job)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      job.enabled
                        ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                        : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
                    }`}
                  >
                    {job.enabled ? "On" : "Off"}
                  </button>
                  <button
                    onClick={() => setEditingJob(job)}
                    className="p-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteJob(job.id)}
                    className="p-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit/Create Modal */}
      {(editingJob || showCreate) && (
        <JobEditor
          job={editingJob}
          onSave={saveJob}
          onCancel={() => {
            setEditingJob(null);
            setShowCreate(false);
          }}
          saving={saving}
        />
      )}
    </div>
  );
}

function JobEditor({
  job,
  onSave,
  onCancel,
  saving,
}: {
  job: CronJob | null;
  onSave: (job: Partial<CronJob>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [schedule, setSchedule] = useState(job?.schedule || "");
  const [description, setDescription] = useState(job?.description || "");
  const [prompt, setPrompt] = useState(job?.prompt || "");
  const [enabled, setEnabled] = useState(job?.enabled ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: job?.id,
      schedule,
      description,
      prompt,
      enabled,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 w-full max-w-lg max-h-[90vh] overflow-auto">
        <form onSubmit={handleSubmit}>
          <div className="p-4 border-b border-zinc-800">
            <h3 className="text-lg font-semibold text-white">
              {job ? "Edit Job" : "New Cron Job"}
            </h3>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label className="text-sm text-zinc-400 block mb-2">Schedule</label>
              <input
                type="text"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="every hour, daily at 9am, 0 9 * * *, etc."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
                required
              />
              <p className="text-xs text-zinc-500 mt-1">
                Human-readable or cron syntax
              </p>
            </div>

            <div>
              <label className="text-sm text-zinc-400 block mb-2">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this job does"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
                required
              />
            </div>

            <div>
              <label className="text-sm text-zinc-400 block mb-2">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Instructions for what to do when this job runs..."
                rows={6}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600 resize-none"
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  enabled ? "bg-green-600" : "bg-zinc-700"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="text-sm text-zinc-400">Enabled</span>
            </div>
          </div>

          <div className="p-4 border-t border-zinc-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
