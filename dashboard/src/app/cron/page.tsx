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
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Cron Jobs</h2>
        <p className="text-zinc-500 mt-1">Scheduled tasks</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <div className="text-xl font-bold text-green-500">{activeJobs.length}</div>
          <div className="text-xs text-zinc-500">Active</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <div className="text-xl font-bold text-yellow-500">{oneOffJobs.length}</div>
          <div className="text-xs text-zinc-500">One-offs</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <div className="text-xl font-bold text-zinc-500">{disabledJobs.length}</div>
          <div className="text-xs text-zinc-500">Disabled</div>
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
        <div className="space-y-4">
          {/* Active Jobs */}
          {activeJobs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-400 px-1">Active Jobs</h3>
              {activeJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}

          {/* One-off Jobs */}
          {oneOffJobs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-400 px-1">Pending One-offs</h3>
              {oneOffJobs.map((job) => (
                <JobCard key={job.id} job={job} isOneOff />
              ))}
            </div>
          )}

          {/* Disabled Jobs */}
          {disabledJobs.length > 0 && (
            <div className="space-y-2 opacity-60">
              <h3 className="text-sm font-semibold text-zinc-500 px-1">Disabled</h3>
              {disabledJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, isOneOff = false }: { job: CronJob; isOneOff?: boolean }) {
  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium">{job.description}</span>
            {isOneOff && (
              <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-500 rounded font-medium">
                One-off
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2 text-sm text-zinc-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{formatSchedule(job)}</span>
          </div>
          <p className="text-zinc-500 text-sm mt-2 line-clamp-2">{job.prompt}</p>
          <p className="text-zinc-600 font-mono text-xs mt-2">{job.id}</p>
        </div>
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${job.enabled ? "bg-green-500" : "bg-zinc-600"}`} />
      </div>
    </div>
  );
}
