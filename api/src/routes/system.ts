import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import os from "os";

const router = Router();

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

router.get("/", (_req: Request, res: Response) => {
  try {
    // Uptime
    const uptime = os.uptime();

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);

    // CPU
    const cpus = os.cpus();
    const loadAvg = os.loadavg()[0]; // 1 minute average

    // Disk - use df command
    let diskUsed = "N/A";
    let diskTotal = "N/A";
    let diskPercent = "N/A";
    try {
      const dfOutput = execSync("df -h / | tail -1", { encoding: "utf-8" });
      const parts = dfOutput.trim().split(/\s+/);
      if (parts.length >= 5) {
        diskTotal = parts[1];
        diskUsed = parts[2];
        diskPercent = parts[4];
      }
    } catch {
      // df failed, leave as N/A
    }

    res.json({
      uptime: formatUptime(uptime),
      memory: {
        used: formatBytes(usedMem),
        total: formatBytes(totalMem),
        percent: memPercent.toString(),
      },
      cpu: {
        cores: cpus.length,
        load: loadAvg.toFixed(2),
      },
      disk: {
        used: diskUsed,
        total: diskTotal,
        percent: diskPercent,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
