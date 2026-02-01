import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const router = Router();

// Config file location (outside repo, user-specific)
const SITES_CONFIG_PATH =
  process.env.SITES_CONFIG || `${process.env.HOME}/.claude/sites.json`;

interface SiteInfo {
  name: string;
  path: string;
  url: string;
  hasPackageJson: boolean;
  framework?: string;
  lastModified?: string;
  type: "static" | "app";
  status?: "online" | "stopped" | "errored";
  port?: number;
}

interface SitesConfig {
  baseDomain: string;
  staticSitesDir: string;
  apps: Record<
    string,
    {
      subdomain: string;
      framework: string;
      port?: number;
    }
  >;
}

// Load config from file
async function loadSitesConfig(): Promise<SitesConfig> {
  try {
    const content = await fs.readFile(SITES_CONFIG_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    // Return defaults if config doesn't exist
    return {
      baseDomain: "mike-vito.rl-quests.com",
      staticSitesDir: "/home/ubuntu/hosted-sites",
      apps: {},
    };
  }
}

// Get PM2 web apps from config (computed on each request so config changes are picked up)
async function getPm2WebApps(): Promise<
  Record<string, { url: string; framework: string }>
> {
  const config = await loadSitesConfig();
  const apps: Record<string, { url: string; framework: string }> = {};

  for (const [name, appConfig] of Object.entries(config.apps)) {
    apps[name] = {
      url: `https://${appConfig.subdomain}.${config.baseDomain}`,
      framework: appConfig.framework,
    };
  }

  return apps;
}

// Start a PM2 app
router.post("/:name/start", async (req: Request, res: Response) => {
  const name = req.params.name as string;
  const pm2WebApps = await getPm2WebApps();

  // Only allow starting apps in our whitelist
  if (!pm2WebApps[name]) {
    res.status(400).json({ error: "App not found or not managed" });
    return;
  }

  try {
    await execAsync(`pm2 start ${name}`);
    res.json({ success: true, message: `Started ${name}` });
  } catch (error) {
    res.status(500).json({ error: `Failed to start ${name}` });
  }
});

// Stop a PM2 app
router.post("/:name/stop", async (req: Request, res: Response) => {
  const name = req.params.name as string;
  const pm2WebApps = await getPm2WebApps();

  // Only allow stopping apps in our whitelist
  if (!pm2WebApps[name]) {
    res.status(400).json({ error: "App not found or not managed" });
    return;
  }

  try {
    await execAsync(`pm2 stop ${name}`);
    res.json({ success: true, message: `Stopped ${name}` });
  } catch (error) {
    res.status(500).json({ error: `Failed to stop ${name}` });
  }
});

// List available log files for a PM2 app
router.get("/:name/log-files", async (req: Request, res: Response) => {
  const name = req.params.name as string;
  const pm2WebApps = await getPm2WebApps();

  // Only allow getting logs for apps in our whitelist
  if (!pm2WebApps[name]) {
    res.status(400).json({ error: "App not found or not managed" });
    return;
  }

  try {
    // Get PM2 process info to find log paths
    const { stdout } = await execAsync(`pm2 jlist`);
    const pm2Processes = JSON.parse(stdout);
    const proc = pm2Processes.find((p: { name: string }) => p.name === name);

    if (!proc) {
      res.status(404).json({ error: "Process not found" });
      return;
    }

    const logFiles: { type: string; path: string; label: string }[] = [];

    // Check for stdout log (out)
    const outLogPath = proc.pm2_env?.pm_out_log_path;
    if (outLogPath) {
      try {
        await fs.access(outLogPath);
        const stats = await fs.stat(outLogPath);
        logFiles.push({
          type: "out",
          path: outLogPath,
          label: `stdout (${formatFileSize(stats.size)})`,
        });
      } catch {
        // File doesn't exist
      }
    }

    // Check for stderr log (error)
    const errLogPath = proc.pm2_env?.pm_err_log_path;
    if (errLogPath) {
      try {
        await fs.access(errLogPath);
        const stats = await fs.stat(errLogPath);
        logFiles.push({
          type: "error",
          path: errLogPath,
          label: `stderr (${formatFileSize(stats.size)})`,
        });
      } catch {
        // File doesn't exist
      }
    }

    res.json({ logFiles });
  } catch (error) {
    res.status(500).json({ error: `Failed to get log files for ${name}` });
  }
});

// Get specific log file content for a PM2 app
router.get("/:name/logs/:type", async (req: Request, res: Response) => {
  const name = req.params.name as string;
  const logType = req.params.type as string;
  const lines = parseInt(req.query.lines as string) || 100;
  const pm2WebApps = await getPm2WebApps();

  // Only allow getting logs for apps in our whitelist
  if (!pm2WebApps[name]) {
    res.status(400).json({ error: "App not found or not managed" });
    return;
  }

  if (!["out", "error"].includes(logType)) {
    res.status(400).json({ error: "Invalid log type. Use 'out' or 'error'" });
    return;
  }

  try {
    // Get PM2 process info to find log path
    const { stdout } = await execAsync(`pm2 jlist`);
    const pm2Processes = JSON.parse(stdout);
    const proc = pm2Processes.find((p: { name: string }) => p.name === name);

    if (!proc) {
      res.status(404).json({ error: "Process not found" });
      return;
    }

    const logPath =
      logType === "out"
        ? proc.pm2_env?.pm_out_log_path
        : proc.pm2_env?.pm_err_log_path;

    if (!logPath) {
      res.status(404).json({ error: "Log file path not found" });
      return;
    }

    // Read last N lines using tail
    const { stdout: logContent } = await execAsync(
      `tail -n ${lines} "${logPath}"`,
      { timeout: 5000, maxBuffer: 10 * 1024 * 1024 }
    );

    res.json({
      content: logContent.split("\n").filter((line) => line.trim()),
      path: logPath,
      type: logType,
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to get logs for ${name}` });
  }
});

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

router.get("/", async (_req: Request, res: Response) => {
  const sites: SiteInfo[] = [];
  const config = await loadSitesConfig();
  const pm2WebApps = await getPm2WebApps();

  // 1. Static sites from hosted-sites directory
  try {
    const folders = await fs.readdir(config.staticSitesDir);

    for (const folder of folders) {
      const sitePath = path.join(config.staticSitesDir, folder);
      const stat = await fs.stat(sitePath);

      if (!stat.isDirectory()) continue;

      const site: SiteInfo = {
        name: folder,
        path: sitePath,
        url: `https://${folder}.${config.baseDomain}`,
        hasPackageJson: false,
        lastModified: stat.mtime.toISOString(),
        type: "static",
      };

      // Check for package.json to detect framework
      try {
        const pkgPath = path.join(sitePath, "package.json");
        const pkgContent = await fs.readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent);
        site.hasPackageJson = true;

        // Detect framework from dependencies
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps["astro"]) {
          site.framework = "Astro";
        } else if (deps["next"]) {
          site.framework = "Next.js";
        } else if (deps["react"]) {
          site.framework = "React";
        } else if (deps["vue"]) {
          site.framework = "Vue";
        }
      } catch {
        // No package.json or couldn't parse
      }

      sites.push(site);
    }
  } catch {
    // hosted-sites dir might not exist
  }

  // 2. PM2 web apps
  try {
    const { stdout } = await execAsync("pm2 jlist");
    const pm2Processes = JSON.parse(stdout);

    for (const proc of pm2Processes) {
      const appConfig = pm2WebApps[proc.name];
      if (!appConfig) continue;

      const site: SiteInfo = {
        name: proc.name,
        path: proc.pm2_env?.pm_cwd || "",
        url: appConfig.url,
        hasPackageJson: true,
        framework: appConfig.framework,
        type: "app",
        status: proc.pm2_env?.status as "online" | "stopped" | "errored",
        port: proc.pm2_env?.PORT ? parseInt(proc.pm2_env.PORT) : undefined,
      };

      sites.push(site);
    }
  } catch {
    // PM2 not available or error parsing
  }

  // Sort: apps first, then static sites, then by name
  sites.sort((a, b) => {
    if (a.type !== b.type) return a.type === "app" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  res.json({ sites });
});

export default router;
