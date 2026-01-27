import { promises as fs } from "fs";
import path from "path";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

interface CronJob {
  id: string;
  schedule: string;
  description: string;
  prompt: string;
  enabled: boolean;
  lastRun?: string;
  run_at?: string;
  run_once?: boolean;
}

interface CronConfig {
  jobs: CronJob[];
}

async function getCronJobs(): Promise<CronJob[]> {
  const cronPath = path.join(getProjectRoot(), "config/cron.json");
  try {
    const content = await fs.readFile(cronPath, "utf-8");
    const config: CronConfig = JSON.parse(content);
    return config.jobs || [];
  } catch {
    return [];
  }
}

function formatSchedule(job: CronJob): string {
  if (job.run_once && job.run_at) {
    const date = new Date(job.run_at);
    return `Once at ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Toronto" })}`;
  }
  return job.schedule;
}

export const dynamic = "force-dynamic";

export default async function CronPage() {
  const jobs = await getCronJobs();
  const activeJobs = jobs.filter((j) => j.enabled && !j.run_once);
  const oneOffJobs = jobs.filter((j) => j.run_once);
  const disabledJobs = jobs.filter((j) => !j.enabled && !j.run_once);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Cron Jobs</h2>
        <p className="text-zinc-500 mt-1">Manage scheduled tasks</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="text-2xl font-bold text-green-500">{activeJobs.length}</div>
          <div className="text-sm text-zinc-500">Active Jobs</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="text-2xl font-bold text-yellow-500">{oneOffJobs.length}</div>
          <div className="text-sm text-zinc-500">Pending One-offs</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="text-2xl font-bold text-zinc-500">{disabledJobs.length}</div>
          <div className="text-sm text-zinc-500">Disabled</div>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No cron jobs configured</p>
          <p className="text-zinc-600 text-sm mt-2">
            Use the cron MCP tools to create jobs
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Jobs */}
          {activeJobs.length > 0 && (
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800">
                <h3 className="text-lg font-semibold text-white">Active Jobs</h3>
              </div>
              <div className="divide-y divide-zinc-800">
                {activeJobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </div>
            </div>
          )}

          {/* One-off Jobs */}
          {oneOffJobs.length > 0 && (
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800">
                <h3 className="text-lg font-semibold text-white">Pending One-off Tasks</h3>
              </div>
              <div className="divide-y divide-zinc-800">
                {oneOffJobs.map((job) => (
                  <JobRow key={job.id} job={job} isOneOff />
                ))}
              </div>
            </div>
          )}

          {/* Disabled Jobs */}
          {disabledJobs.length > 0 && (
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800">
                <h3 className="text-lg font-semibold text-zinc-400">Disabled Jobs</h3>
              </div>
              <div className="divide-y divide-zinc-800 opacity-60">
                {disabledJobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JobRow({ job, isOneOff = false }: { job: CronJob; isOneOff?: boolean }) {
  return (
    <div className="px-6 py-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h4 className="text-white font-medium truncate">{job.description}</h4>
            {isOneOff && (
              <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-500 rounded">
                One-off
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatSchedule(job)}
            </span>
            <span className="text-zinc-600 font-mono text-xs">{job.id}</span>
          </div>
          <p className="text-zinc-500 text-sm mt-2 line-clamp-2">{job.prompt}</p>
        </div>
        <div className={`w-3 h-3 rounded-full ${job.enabled ? "bg-green-500" : "bg-zinc-600"}`} />
      </div>
    </div>
  );
}
