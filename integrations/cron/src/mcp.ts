import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

const CRON_CONFIG_FILE = "/home/ubuntu/pHouseClawd/config/cron.json";

// Cron job interface
interface CronJob {
  id: string;
  enabled: boolean;
  schedule: string;
  description: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

interface CronConfig {
  jobs: CronJob[];
}

function loadConfig(): CronConfig {
  try {
    if (fs.existsSync(CRON_CONFIG_FILE)) {
      const content = fs.readFileSync(CRON_CONFIG_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error loading config: ${err}`);
  }
  return { jobs: [] };
}

function saveConfig(config: CronConfig): void {
  const dir = path.dirname(CRON_CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CRON_CONFIG_FILE, JSON.stringify(config, null, 2));
}

const server = new Server(
  { name: "cron", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_jobs",
      description: "List all scheduled cron jobs",
      inputSchema: {
        type: "object" as const,
        properties: {
          include_disabled: {
            type: "boolean",
            description: "Include disabled jobs in the list (default: true)",
          },
        },
        required: [],
      },
    },
    {
      name: "create_job",
      description: "Create a new scheduled cron job. Schedule can be human-readable (e.g., 'every hour', 'daily at 9am', 'every 30 minutes') or cron syntax (e.g., '0 9 * * *'). The prompt can be as detailed as needed - multiple paragraphs of instructions are supported.",
      inputSchema: {
        type: "object" as const,
        properties: {
          schedule: {
            type: "string",
            description: "When to run the job. Supports: 'every minute', 'every X minutes', 'every hour', 'every X hours', 'daily', 'daily at Xam/pm', 'weekly', or cron syntax like '0 9 * * *'",
          },
          description: {
            type: "string",
            description: "Short description of what this job does (shown in job list)",
          },
          prompt: {
            type: "string",
            description: "The full instructions for what to do when this job runs. Can be detailed multi-paragraph instructions.",
          },
          enabled: {
            type: "boolean",
            description: "Whether the job should be enabled immediately (default: true)",
          },
        },
        required: ["schedule", "description", "prompt"],
      },
    },
    {
      name: "edit_job",
      description: "Edit an existing cron job. Only provide the fields you want to change.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The job ID to edit",
          },
          schedule: {
            type: "string",
            description: "New schedule for the job",
          },
          description: {
            type: "string",
            description: "New description for the job",
          },
          prompt: {
            type: "string",
            description: "New prompt/instructions for the job",
          },
          enabled: {
            type: "boolean",
            description: "Enable or disable the job",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_job",
      description: "Delete a scheduled cron job",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The job ID to delete",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "toggle_job",
      description: "Enable or disable a cron job without deleting it",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The job ID to toggle",
          },
          enabled: {
            type: "boolean",
            description: "Set to true to enable, false to disable",
          },
        },
        required: ["id", "enabled"],
      },
    },
    {
      name: "get_job",
      description: "Get detailed information about a specific job including its full prompt",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "The job ID to retrieve",
          },
        },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_jobs") {
    const { include_disabled = true } = args as { include_disabled?: boolean };
    const config = loadConfig();

    let jobs = config.jobs;
    if (!include_disabled) {
      jobs = jobs.filter((j) => j.enabled);
    }

    if (jobs.length === 0) {
      return {
        content: [{ type: "text", text: "No scheduled jobs found." }],
      };
    }

    const jobList = jobs.map((job) => {
      const status = job.enabled ? "✓ enabled" : "✗ disabled";
      return `• ${job.id}\n  Schedule: ${job.schedule}\n  Description: ${job.description}\n  Status: ${status}`;
    }).join("\n\n");

    return {
      content: [{ type: "text", text: `Scheduled Jobs:\n\n${jobList}` }],
    };
  }

  if (name === "create_job") {
    const { schedule, description, prompt, enabled = true } = args as {
      schedule: string;
      description: string;
      prompt: string;
      enabled?: boolean;
    };

    const config = loadConfig();
    const now = new Date().toISOString();

    const newJob: CronJob = {
      id: randomUUID().slice(0, 8),
      enabled,
      schedule,
      description,
      prompt,
      created_at: now,
      updated_at: now,
    };

    config.jobs.push(newJob);
    saveConfig(config);

    return {
      content: [
        {
          type: "text",
          text: `Created job "${newJob.id}":\n• Schedule: ${schedule}\n• Description: ${description}\n• Status: ${enabled ? "enabled" : "disabled"}\n\nThe watcher will automatically pick up this new job.`,
        },
      ],
    };
  }

  if (name === "edit_job") {
    const { id, schedule, description, prompt, enabled } = args as {
      id: string;
      schedule?: string;
      description?: string;
      prompt?: string;
      enabled?: boolean;
    };

    const config = loadConfig();
    const jobIndex = config.jobs.findIndex((j) => j.id === id);

    if (jobIndex === -1) {
      return {
        content: [{ type: "text", text: `Job not found: ${id}` }],
        isError: true,
      };
    }

    const job = config.jobs[jobIndex];

    if (schedule !== undefined) job.schedule = schedule;
    if (description !== undefined) job.description = description;
    if (prompt !== undefined) job.prompt = prompt;
    if (enabled !== undefined) job.enabled = enabled;
    job.updated_at = new Date().toISOString();

    saveConfig(config);

    return {
      content: [
        {
          type: "text",
          text: `Updated job "${id}":\n• Schedule: ${job.schedule}\n• Description: ${job.description}\n• Status: ${job.enabled ? "enabled" : "disabled"}`,
        },
      ],
    };
  }

  if (name === "delete_job") {
    const { id } = args as { id: string };

    const config = loadConfig();
    const jobIndex = config.jobs.findIndex((j) => j.id === id);

    if (jobIndex === -1) {
      return {
        content: [{ type: "text", text: `Job not found: ${id}` }],
        isError: true,
      };
    }

    const deleted = config.jobs.splice(jobIndex, 1)[0];
    saveConfig(config);

    return {
      content: [
        {
          type: "text",
          text: `Deleted job "${id}" (${deleted.description})`,
        },
      ],
    };
  }

  if (name === "toggle_job") {
    const { id, enabled } = args as { id: string; enabled: boolean };

    const config = loadConfig();
    const job = config.jobs.find((j) => j.id === id);

    if (!job) {
      return {
        content: [{ type: "text", text: `Job not found: ${id}` }],
        isError: true,
      };
    }

    job.enabled = enabled;
    job.updated_at = new Date().toISOString();
    saveConfig(config);

    return {
      content: [
        {
          type: "text",
          text: `Job "${id}" is now ${enabled ? "enabled" : "disabled"}`,
        },
      ],
    };
  }

  if (name === "get_job") {
    const { id } = args as { id: string };

    const config = loadConfig();
    const job = config.jobs.find((j) => j.id === id);

    if (!job) {
      return {
        content: [{ type: "text", text: `Job not found: ${id}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Job: ${job.id}\n\nSchedule: ${job.schedule}\nDescription: ${job.description}\nStatus: ${job.enabled ? "enabled" : "disabled"}\nCreated: ${job.created_at}\nUpdated: ${job.updated_at}\n\nPrompt:\n${job.prompt}`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Cron MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
