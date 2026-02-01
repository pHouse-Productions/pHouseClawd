import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";

const router = Router();

const HOSTED_SITES_DIR = "/home/ubuntu/hosted-sites";
const BASE_URL = "https://mike-vito.rl-quests.com";

interface SiteInfo {
  name: string;
  path: string;
  url: string;
  hasPackageJson: boolean;
  framework?: string;
  lastModified?: string;
}

router.get("/", async (_req: Request, res: Response) => {
  const sites: SiteInfo[] = [];

  try {
    const folders = await fs.readdir(HOSTED_SITES_DIR);

    for (const folder of folders) {
      const sitePath = path.join(HOSTED_SITES_DIR, folder);
      const stat = await fs.stat(sitePath);

      if (!stat.isDirectory()) continue;

      const site: SiteInfo = {
        name: folder,
        path: sitePath,
        url: `${BASE_URL}/${folder}/`,
        hasPackageJson: false,
        lastModified: stat.mtime.toISOString(),
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

    // Sort by name
    sites.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ sites });
  } catch (error) {
    res.json({ sites: [], error: String(error) });
  }
});

export default router;
