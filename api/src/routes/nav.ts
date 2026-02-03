import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";

const router = Router();

// File paths
const DATA_DIR = process.env.NAV_DATA_DIR || path.join(process.env.HOME || "", ".claude");
const CLICKS_FILE = path.join(DATA_DIR, "nav-clicks.json");
const CONFIG_FILE = path.join(DATA_DIR, "nav-config.json");

// All available nav items with their metadata
const ALL_NAV_ITEMS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/jobs", label: "Jobs", icon: "briefcase" },
  { href: "/memory", label: "Memory", icon: "brain" },
  { href: "/system", label: "System", icon: "book" },
  { href: "/skills", label: "Skills", icon: "bolt" },
  { href: "/config", label: "Config", icon: "cog" },
  { href: "/sites", label: "Sites", icon: "globe" },
  { href: "/processes", label: "Processes", icon: "server" },
  { href: "/channels", label: "Channels", icon: "channels" },
  { href: "/mcp", label: "MCP", icon: "plug" },
  { href: "/logs", label: "Logs", icon: "file-text" },
  { href: "/cron", label: "Cron", icon: "clock" },
];

interface ClickEvent {
  page: string;
  ts: number;
}

interface NavConfig {
  primary: string[];  // hrefs for primary nav
  secondary: string[]; // hrefs for "More" section
  lastUpdated: string;
}

// Default config - everything in primary
function getDefaultConfig(): NavConfig {
  return {
    primary: ALL_NAV_ITEMS.map(i => i.href),
    secondary: [],
    lastUpdated: new Date().toISOString(),
  };
}

// Load click history
async function loadClicks(): Promise<ClickEvent[]> {
  try {
    const content = await fs.readFile(CLICKS_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

// Save click history
async function saveClicks(clicks: ClickEvent[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CLICKS_FILE, JSON.stringify(clicks, null, 2));
}

// Load nav config
async function loadConfig(): Promise<NavConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return getDefaultConfig();
  }
}

// Save nav config
async function saveConfig(config: NavConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// POST /api/nav/click - Log a nav click
router.post("/click", async (req: Request, res: Response) => {
  const { page } = req.body;

  if (!page || typeof page !== "string") {
    res.status(400).json({ error: "page is required" });
    return;
  }

  try {
    const clicks = await loadClicks();
    clicks.push({ page, ts: Date.now() });

    // Keep only last 30 days of clicks
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentClicks = clicks.filter(c => c.ts > thirtyDaysAgo);

    await saveClicks(recentClicks);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to log nav click:", error);
    res.status(500).json({ error: "Failed to log click" });
  }
});

// GET /api/nav/config - Get current nav configuration
router.get("/config", async (_req: Request, res: Response) => {
  try {
    const config = await loadConfig();

    // Build full nav items from config
    const primaryItems = config.primary
      .map(href => ALL_NAV_ITEMS.find(i => i.href === href))
      .filter(Boolean);

    const secondaryItems = config.secondary
      .map(href => ALL_NAV_ITEMS.find(i => i.href === href))
      .filter(Boolean);

    res.json({
      primary: primaryItems,
      secondary: secondaryItems,
      lastUpdated: config.lastUpdated,
    });
  } catch (error) {
    console.error("Failed to load nav config:", error);
    res.status(500).json({ error: "Failed to load config" });
  }
});

// GET /api/nav/stats - Get click statistics (for debugging/viewing)
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const clicks = await loadClicks();
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const recentClicks = clicks.filter(c => c.ts > sevenDaysAgo);

    // Count clicks per page
    const counts: Record<string, number> = {};
    for (const click of recentClicks) {
      counts[click.page] = (counts[click.page] || 0) + 1;
    }

    // Sort by count
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([page, count]) => ({ page, count }));

    res.json({
      totalClicks: recentClicks.length,
      period: "7 days",
      breakdown: sorted,
    });
  } catch (error) {
    console.error("Failed to get nav stats:", error);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// POST /api/nav/analyze - Manually trigger analysis (also called by cron)
router.post("/analyze", async (_req: Request, res: Response) => {
  try {
    const result = await analyzeAndUpdateNav();
    res.json(result);
  } catch (error) {
    console.error("Failed to analyze nav:", error);
    res.status(500).json({ error: "Failed to analyze" });
  }
});

// Analysis function - exported for cron job use
export async function analyzeAndUpdateNav(): Promise<{
  primary: string[];
  secondary: string[];
  changes: string[];
}> {
  const clicks = await loadClicks();
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recentClicks = clicks.filter(c => c.ts > sevenDaysAgo);

  // Count clicks per page with recency weighting
  const scores: Record<string, number> = {};
  const now = Date.now();

  for (const click of recentClicks) {
    // More recent clicks get higher weight (1.0 to 0.5 over 7 days)
    const ageInDays = (now - click.ts) / (24 * 60 * 60 * 1000);
    const weight = 1 - (ageInDays / 14); // Linear decay over 2 weeks
    scores[click.page] = (scores[click.page] || 0) + Math.max(0.5, weight);
  }

  // Ensure all pages have a score (0 for unvisited)
  for (const item of ALL_NAV_ITEMS) {
    if (!(item.href in scores)) {
      scores[item.href] = 0;
    }
  }

  // Sort by score
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([href]) => href);

  // Home always stays in primary
  const homeIndex = sorted.indexOf("/");
  if (homeIndex > 0) {
    sorted.splice(homeIndex, 1);
    sorted.unshift("/");
  }

  // Calculate threshold: if total clicks > 20, bottom 30% goes to secondary
  const totalClicks = recentClicks.length;
  let primary: string[];
  let secondary: string[];

  if (totalClicks < 20) {
    // Not enough data yet, keep everything in primary
    primary = sorted;
    secondary = [];
  } else {
    // Top 70% in primary, bottom 30% in secondary
    const cutoff = Math.ceil(sorted.length * 0.7);
    primary = sorted.slice(0, cutoff);
    secondary = sorted.slice(cutoff);
  }

  // Load old config to detect changes
  const oldConfig = await loadConfig();
  const changes: string[] = [];

  for (const href of primary) {
    if (oldConfig.secondary.includes(href)) {
      const item = ALL_NAV_ITEMS.find(i => i.href === href);
      changes.push(`Promoted "${item?.label}" to primary nav`);
    }
  }

  for (const href of secondary) {
    if (oldConfig.primary.includes(href)) {
      const item = ALL_NAV_ITEMS.find(i => i.href === href);
      changes.push(`Moved "${item?.label}" to secondary nav`);
    }
  }

  // Save new config
  const newConfig: NavConfig = {
    primary,
    secondary,
    lastUpdated: new Date().toISOString(),
  };
  await saveConfig(newConfig);

  return { primary, secondary, changes };
}

export default router;
