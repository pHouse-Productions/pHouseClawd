import { promises as fs } from "fs";
import path from "path";
import os from "os";
import RestartButton from "@/components/RestartButton";

async function getSystemStats() {
  const uptime = os.uptime();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = ((usedMem / totalMem) * 100).toFixed(1);
  const loadAvg = os.loadavg();
  const cpus = os.cpus().length;

  // Get disk usage
  let diskInfo = { used: "N/A", total: "N/A", percent: "N/A" };
  try {
    const { execSync } = await import("child_process");
    const dfOutput = execSync("df -h / | tail -1").toString();
    const parts = dfOutput.split(/\s+/);
    diskInfo = {
      total: parts[1],
      used: parts[2],
      percent: parts[4],
    };
  } catch {
    // Ignore disk errors
  }

  return {
    uptime: formatUptime(uptime),
    memory: {
      used: formatBytes(usedMem),
      total: formatBytes(totalMem),
      percent: memPercent,
    },
    cpu: {
      cores: cpus,
      load: loadAvg[0].toFixed(2),
    },
    disk: diskInfo,
  };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

async function getRecentActivity() {
  const baseDir = getProjectRoot();
  const activities: { type: string; message: string; time: string }[] = [];

  // Check for recent telegram images
  const imagesDir = path.join(baseDir, "memory", "telegram", "images");
  try {
    const files = await fs.readdir(imagesDir);
    const imageFiles = files.filter((f) => f.endsWith(".jpg") || f.endsWith(".png"));
    if (imageFiles.length > 0) {
      activities.push({
        type: "image",
        message: `${imageFiles.length} images in telegram memory`,
        time: "recent",
      });
    }
  } catch {
    // Directory might not exist
  }

  // Check for cron jobs
  const cronPath = path.join(baseDir, "config", "cron.json");
  try {
    const cronData = await fs.readFile(cronPath, "utf-8");
    const cron = JSON.parse(cronData);
    const activeJobs = cron.jobs?.filter((j: { enabled: boolean }) => j.enabled)?.length || 0;
    activities.push({
      type: "cron",
      message: `${activeJobs} active cron jobs`,
      time: "now",
    });
  } catch {
    // Cron file might not exist
  }

  return activities;
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const stats = await getSystemStats();
  const activities = await getRecentActivity();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">System</h2>
          <p className="text-zinc-500 mt-1">pHouseClawd overview</p>
        </div>
        <RestartButton />
      </div>

      {/* Stats Grid - 2x2 on mobile */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          title="Uptime"
          value={stats.uptime}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Memory"
          value={`${stats.memory.percent}%`}
          subtitle={`${stats.memory.used} / ${stats.memory.total}`}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          }
        />
        <StatCard
          title="CPU Load"
          value={stats.cpu.load}
          subtitle={`${stats.cpu.cores} cores`}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
        <StatCard
          title="Disk"
          value={stats.disk.percent}
          subtitle={`${stats.disk.used} / ${stats.disk.total}`}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
          }
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Activity</h3>
        {activities.length > 0 ? (
          <ul className="space-y-2">
            {activities.map((activity, i) => (
              <li key={i} className="flex items-center gap-3 text-sm text-zinc-400">
                <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></span>
                {activity.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-zinc-500 text-sm">No recent activity</p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
      <div className="flex items-center gap-2 text-zinc-400 mb-2">
        {icon}
        <span className="text-xs font-medium">{title}</span>
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {subtitle && <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>}
    </div>
  );
}
