import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const router = Router();

const DISABLED_SERVERS_FILE = path.join(
  process.env.HOME || "/home/ubuntu",
  ".claude-disabled-mcp.json"
);

interface McpServerConfig {
  type: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface DisabledServers {
  [name: string]: McpServerConfig;
}

function getDisabledServers(): DisabledServers {
  try {
    if (fs.existsSync(DISABLED_SERVERS_FILE)) {
      return JSON.parse(fs.readFileSync(DISABLED_SERVERS_FILE, "utf-8"));
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return {};
}

function saveDisabledServers(servers: DisabledServers): void {
  fs.writeFileSync(DISABLED_SERVERS_FILE, JSON.stringify(servers, null, 2));
}

interface McpServer {
  name: string;
  status: "connected" | "error" | "disabled" | "unknown";
  command: string;
  config?: McpServerConfig;
}

function parseMcpList(): McpServer[] {
  try {
    const output = execSync("claude mcp list 2>&1", {
      encoding: "utf-8",
      timeout: 60000,
    });

    const servers: McpServer[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      // Match lines like: "cron: node /path/to/mcp.js - ✓ Connected"
      const connectedMatch = line.match(/^(\S+):\s+(.+?)\s+-\s+✓\s+Connected/);
      if (connectedMatch) {
        servers.push({
          name: connectedMatch[1],
          status: "connected",
          command: connectedMatch[2].trim(),
        });
        continue;
      }

      // Match error/failed lines
      const errorMatch = line.match(/^(\S+):\s+(.+?)\s+-\s+✗/);
      if (errorMatch) {
        servers.push({
          name: errorMatch[1],
          status: "error",
          command: errorMatch[2].trim(),
        });
      }
    }

    // Add disabled servers to the list
    const disabledServers = getDisabledServers();
    for (const [name, config] of Object.entries(disabledServers)) {
      // Only add if not already in the active list (prevents duplicates)
      if (!servers.find((s) => s.name === name)) {
        servers.push({
          name,
          status: "disabled",
          command: `${config.command} ${config.args.join(" ")}`,
          config,
        });
      }
    }

    // Sort alphabetically
    servers.sort((a, b) => a.name.localeCompare(b.name));

    return servers;
  } catch (error) {
    console.error("Failed to run claude mcp list:", error);
    return [];
  }
}

function getServerConfig(name: string): McpServerConfig | null {
  try {
    // Read from ~/.claude.json
    const claudeConfigPath = path.join(
      process.env.HOME || "/home/ubuntu",
      ".claude.json"
    );
    const config = JSON.parse(fs.readFileSync(claudeConfigPath, "utf-8"));
    return config.mcpServers?.[name] || null;
  } catch {
    return null;
  }
}

router.get("/", (_req: Request, res: Response) => {
  const servers = parseMcpList();

  res.json({
    servers,
    total: servers.length,
    healthy: servers.filter((s) => s.status === "connected").length,
    disabled: servers.filter((s) => s.status === "disabled").length,
  });
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { action, name } = req.body;

    if (action === "disable") {
      // Get current config before removing
      const config = getServerConfig(name);
      if (!config) {
        res.status(404).json({ error: `Server ${name} config not found` });
        return;
      }

      // Save to disabled servers file
      const disabled = getDisabledServers();
      disabled[name] = config;
      saveDisabledServers(disabled);

      // Remove from Claude
      execSync(`claude mcp remove "${name}" -s user`, {
        encoding: "utf-8",
        timeout: 10000,
      });

      res.json({ success: true, action: "disabled", name });
      return;
    }

    if (action === "enable") {
      // Get config from disabled servers
      const disabled = getDisabledServers();
      const config = disabled[name];
      if (!config) {
        res.status(404).json({ error: `Disabled server ${name} not found` });
        return;
      }

      // Add back to Claude using add-json
      const configJson = JSON.stringify(config);
      execSync(`claude mcp add-json "${name}" '${configJson}' -s user`, {
        encoding: "utf-8",
        timeout: 10000,
      });

      // Remove from disabled file
      delete disabled[name];
      saveDisabledServers(disabled);

      res.json({ success: true, action: "enabled", name });
      return;
    }

    if (action === "restart") {
      // Rebuild pHouseMcp and restart the systemd service
      const mcpDir = path.join(process.env.HOME || "/home/ubuntu", "pHouseMcp");

      try {
        // Step 1: Build
        execSync("npm run build", {
          cwd: mcpDir,
          encoding: "utf-8",
          timeout: 120000, // 2 minutes for build
        });

        // Step 2: Restart systemd service
        execSync("sudo systemctl restart mcp-servers", {
          encoding: "utf-8",
          timeout: 30000,
        });

        res.json({
          success: true,
          action: "restart",
          message: "MCP servers rebuilt and restarted"
        });
        return;
      } catch (err) {
        const error = err as Error & { stderr?: string };
        res.status(500).json({ error: error.stderr || error.message || "Failed to restart MCP servers" });
        return;
      }
    }

    res.status(400).json({ error: "Invalid action" });
  } catch (error) {
    console.error("MCP toggle error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

export default router;
