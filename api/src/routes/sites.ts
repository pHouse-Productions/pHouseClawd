import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const router = Router();

const HOSTED_SITES_DIR = "/home/ubuntu/hosted-sites";
const BASE_DOMAIN = "mike-vito.rl-quests.com";

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

// PM2 apps that are web-facing (have subdomains configured)
const PM2_WEB_APPS: Record<string, { url: string; framework: string }> = {
  "vito-leads": {
    url: "https://leads.mike-vito.rl-quests.com",
    framework: "Astro SSR",
  },
};

// Start a PM2 app
router.post("/:name/start", async (req: Request, res: Response) => {
  const name = req.params.name as string;

  // Only allow starting apps in our whitelist
  if (!PM2_WEB_APPS[name]) {
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

  // Only allow stopping apps in our whitelist
  if (!PM2_WEB_APPS[name]) {
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

router.get("/", async (_req: Request, res: Response) => {
  const sites: SiteInfo[] = [];

  // 1. Static sites from hosted-sites directory
  try {
    const folders = await fs.readdir(HOSTED_SITES_DIR);

    for (const folder of folders) {
      const sitePath = path.join(HOSTED_SITES_DIR, folder);
      const stat = await fs.stat(sitePath);

      if (!stat.isDirectory()) continue;

      const site: SiteInfo = {
        name: folder,
        path: sitePath,
        url: `https://${folder}.${BASE_DOMAIN}`,
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
      const appConfig = PM2_WEB_APPS[proc.name];
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
