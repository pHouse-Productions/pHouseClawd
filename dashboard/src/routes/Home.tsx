import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth";
import RestartButton from "@/components/RestartButton";

interface SystemStats {
  uptime: string;
  memory: {
    used: string;
    total: string;
    percent: string;
  };
  cpu: {
    cores: number;
    load: string;
  };
  disk: {
    used: string;
    total: string;
    percent: string;
  };
}

interface ServiceStatus {
  watcher: { running: boolean; pid?: number };
  dashboard: { running: boolean; pid?: number };
  mcp: { total: number; healthy: number; error: number };
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

function StatusDot({ running }: { running: boolean }) {
  return (
    <span
      className={`w-2 h-2 rounded-full ${running ? "bg-green-500" : "bg-red-500"}`}
    />
  );
}

export default function Home() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [statsRes, statusRes] = await Promise.all([
        authFetch("/api/system"),
        authFetch("/api/status"),
      ]);

      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (statusRes.ok) {
        setStatus(await statusRes.json());
      }
    } catch (err) {
      console.error("Failed to fetch system stats:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">System</h2>
          <p className="text-zinc-500 mt-1">pHouseClawd overview</p>
        </div>
      </div>

      <RestartButton />

      {/* Service Status */}
      {status && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Services</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <StatusDot running={status.watcher.running} />
              <span className="text-sm text-zinc-400">Watcher</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot running={status.dashboard.running} />
              <span className="text-sm text-zinc-400">API</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot running={status.mcp.healthy === status.mcp.total} />
              <span className="text-sm text-zinc-400">
                MCP {status.mcp.healthy}/{status.mcp.total}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid - 2x2 on mobile */}
      {stats && (
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
      )}
    </div>
  );
}
