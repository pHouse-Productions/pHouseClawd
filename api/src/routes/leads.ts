import { Router, Request, Response } from "express";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const router = Router();

const SPREADSHEET_ID = "1J8tvh83y7hKlcNxY0ItUPyULOjSCGxrTJWWg55hiuKY";

// Column mapping based on spreadsheet structure
const COLUMNS = {
  businessName: 0,
  industry: 1,
  status: 2,
  googleRating: 3,
  phone: 4,
  address: 5,
  currentWebsite: 6,
  whyNeedHelp: 7,
  prdLink: 8,
  previewSite: 9,
  dateAdded: 10,
  notes: 11,
  githubRepo: 12,
  astroPreview: 13,
  astroGithub: 14,
};

interface Lead {
  id: number; // Row number (1-indexed, 0 = header)
  businessName: string;
  industry: string;
  status: string;
  googleRating: string;
  phone: string;
  address: string;
  currentWebsite: string;
  whyNeedHelp: string;
  prdLink: string;
  previewSite: string;
  dateAdded: string;
  notes: string;
  githubRepo: string;
  astroPreview: string;
  astroGithub: string;
}

function parseRow(row: string[], index: number): Lead {
  return {
    id: index + 1, // +1 because we skip header, so row 0 in data = row 2 in sheet
    businessName: row[COLUMNS.businessName] || "",
    industry: row[COLUMNS.industry] || "",
    status: row[COLUMNS.status] || "",
    googleRating: row[COLUMNS.googleRating] || "",
    phone: row[COLUMNS.phone] || "",
    address: row[COLUMNS.address] || "",
    currentWebsite: row[COLUMNS.currentWebsite] || "",
    whyNeedHelp: row[COLUMNS.whyNeedHelp] || "",
    prdLink: row[COLUMNS.prdLink] || "",
    previewSite: row[COLUMNS.previewSite] || "",
    dateAdded: row[COLUMNS.dateAdded] || "",
    notes: row[COLUMNS.notes] || "",
    githubRepo: row[COLUMNS.githubRepo] || "",
    astroPreview: row[COLUMNS.astroPreview] || "",
    astroGithub: row[COLUMNS.astroGithub] || "",
  };
}

// GET /api/leads - List all leads
router.get("/", async (_req: Request, res: Response) => {
  try {
    // Use the MCP tool to read the spreadsheet
    const mcpCmd = `curl -s -X POST http://localhost:3014/tools/read_spreadsheet -H "Content-Type: application/json" -d '{"spreadsheet_id": "${SPREADSHEET_ID}", "range": "A1:O100"}'`;
    const { stdout } = await execAsync(mcpCmd);
    const result = JSON.parse(stdout);

    if (!result.values || !Array.isArray(result.values)) {
      return res.json({ leads: [], total: 0 });
    }

    // Skip header row
    const dataRows = result.values.slice(1);
    const leads = dataRows.map((row: string[], index: number) => parseRow(row, index));

    res.json({ leads, total: leads.length });
  } catch (err) {
    console.error("Failed to fetch leads:", err);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// GET /api/leads/:id - Get single lead
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const idParam = req.params.id as string;
    const leadId = parseInt(idParam);
    if (isNaN(leadId)) {
      return res.status(400).json({ error: "Invalid lead ID" });
    }

    const mcpCmd = `curl -s -X POST http://localhost:3014/tools/read_spreadsheet -H "Content-Type: application/json" -d '{"spreadsheet_id": "${SPREADSHEET_ID}", "range": "A1:O100"}'`;
    const { stdout } = await execAsync(mcpCmd);
    const result = JSON.parse(stdout);

    if (!result.values || !Array.isArray(result.values)) {
      return res.status(404).json({ error: "Lead not found" });
    }

    // leadId is 1-indexed, so leadId 1 = row 2 (after header)
    const rowIndex = leadId; // Array index in dataRows
    const dataRows = result.values.slice(1);

    if (rowIndex < 1 || rowIndex > dataRows.length) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const lead = parseRow(dataRows[rowIndex - 1], rowIndex - 1);
    res.json(lead);
  } catch (err) {
    console.error("Failed to fetch lead:", err);
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

// POST /api/leads/find - Trigger lead finder skill
router.post("/find", async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    const fullPrompt = prompt
      ? `/lead-finder ${prompt}`
      : "/lead-finder";

    // Trigger the skill via the watcher chat endpoint
    // This will spawn a new Claude session to run the lead finder
    const chatPayload = {
      message: fullPrompt,
      channel: "dashboard",
    };

    const chatCmd = `curl -s -X POST http://localhost:3100/api/chat -H "Content-Type: application/json" -H "Authorization: Bearer $(cat /home/ubuntu/.vito-session 2>/dev/null || echo '')" -d '${JSON.stringify(chatPayload)}'`;
    const { stdout } = await execAsync(chatCmd, { timeout: 10000 });

    res.json({
      success: true,
      message: "Lead finder started",
      prompt: fullPrompt,
    });
  } catch (err) {
    console.error("Failed to start lead finder:", err);
    res.status(500).json({ error: "Failed to start lead finder" });
  }
});

// POST /api/leads/:id/build - Trigger website builder for a lead
router.post("/:id/build", async (req: Request, res: Response) => {
  try {
    const idParam = req.params.id as string;
    const leadId = parseInt(idParam);
    if (isNaN(leadId)) {
      return res.status(400).json({ error: "Invalid lead ID" });
    }

    // First fetch the lead to get the business name
    const mcpCmd = `curl -s -X POST http://localhost:3014/tools/read_spreadsheet -H "Content-Type: application/json" -d '{"spreadsheet_id": "${SPREADSHEET_ID}", "range": "A1:O100"}'`;
    const { stdout: sheetData } = await execAsync(mcpCmd);
    const result = JSON.parse(sheetData);

    if (!result.values || !Array.isArray(result.values)) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const dataRows = result.values.slice(1);
    if (leadId < 1 || leadId > dataRows.length) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const lead = parseRow(dataRows[leadId - 1], leadId - 1);

    // Trigger the website builder skill
    const fullPrompt = `/website-builder for ${lead.businessName}`;

    const chatPayload = {
      message: fullPrompt,
      channel: "dashboard",
    };

    const chatCmd = `curl -s -X POST http://localhost:3100/api/chat -H "Content-Type: application/json" -H "Authorization: Bearer $(cat /home/ubuntu/.vito-session 2>/dev/null || echo '')" -d '${JSON.stringify(chatPayload)}'`;
    await execAsync(chatCmd, { timeout: 10000 });

    res.json({
      success: true,
      message: "Website builder started",
      businessName: lead.businessName,
    });
  } catch (err) {
    console.error("Failed to start website builder:", err);
    res.status(500).json({ error: "Failed to start website builder" });
  }
});

// POST /api/leads/:id/outreach - Trigger outreach email for a lead
router.post("/:id/outreach", async (req: Request, res: Response) => {
  try {
    const idParam = req.params.id as string;
    const leadId = parseInt(idParam);
    if (isNaN(leadId)) {
      return res.status(400).json({ error: "Invalid lead ID" });
    }

    // First fetch the lead to get the business name
    const mcpCmd = `curl -s -X POST http://localhost:3014/tools/read_spreadsheet -H "Content-Type: application/json" -d '{"spreadsheet_id": "${SPREADSHEET_ID}", "range": "A1:O100"}'`;
    const { stdout: sheetData } = await execAsync(mcpCmd);
    const result = JSON.parse(sheetData);

    if (!result.values || !Array.isArray(result.values)) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const dataRows = result.values.slice(1);
    if (leadId < 1 || leadId > dataRows.length) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const lead = parseRow(dataRows[leadId - 1], leadId - 1);

    // Check if lead has a website built
    if (!lead.astroPreview && !lead.previewSite) {
      return res.status(400).json({ error: "Lead doesn't have a website built yet" });
    }

    // Trigger the outreach skill
    const fullPrompt = `/lead-outreach for ${lead.businessName}`;

    const chatPayload = {
      message: fullPrompt,
      channel: "dashboard",
    };

    const chatCmd = `curl -s -X POST http://localhost:3100/api/chat -H "Content-Type: application/json" -H "Authorization: Bearer $(cat /home/ubuntu/.vito-session 2>/dev/null || echo '')" -d '${JSON.stringify(chatPayload)}'`;
    await execAsync(chatCmd, { timeout: 10000 });

    res.json({
      success: true,
      message: "Outreach email started",
      businessName: lead.businessName,
    });
  } catch (err) {
    console.error("Failed to start outreach:", err);
    res.status(500).json({ error: "Failed to start outreach" });
  }
});

export default router;
