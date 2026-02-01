import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

const PROJECT_ROOT = getProjectRoot();
const SESSIONS_FILE = path.join(PROJECT_ROOT, "logs/sessions.json");

interface SessionData {
  known: string[];
  generations: Record<string, number>;
  modes: Record<string, string>;
  queueModes: Record<string, string>;
  transcriptLines: Record<string, number>;
  responseStyles: Record<string, string>;
}

async function loadSessionData(): Promise<SessionData> {
  try {
    const content = await fs.readFile(SESSIONS_FILE, "utf-8");
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      return { known: data, generations: {}, modes: {}, queueModes: {}, transcriptLines: {}, responseStyles: {} };
    }
    return {
      ...data,
      modes: data.modes || {},
      queueModes: data.queueModes || {},
      transcriptLines: data.transcriptLines || {},
      responseStyles: data.responseStyles || {},
    };
  } catch {
    return { known: [], generations: {}, modes: {}, queueModes: {}, transcriptLines: {}, responseStyles: {} };
  }
}

async function saveSessionData(data: SessionData): Promise<void> {
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await loadSessionData();
    res.json({
      modes: data.modes,
      queueModes: data.queueModes,
      transcriptLines: data.transcriptLines,
      responseStyles: data.responseStyles,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { type, channel, value } = req.body;
    const data = await loadSessionData();

    switch (type) {
      case "memoryMode": {
        if (value === "session" || value === "transcript") {
          data.modes[channel] = value;
          await saveSessionData(data);
          res.json({ success: true, message: `Memory mode set to ${value} for ${channel}` });
          return;
        }
        res.status(400).json({ error: "Invalid memory mode" });
        return;
      }

      case "queueMode": {
        if (value === "queue" || value === "interrupt") {
          data.queueModes[channel] = value;
          await saveSessionData(data);
          res.json({ success: true, message: `Queue mode set to ${value} for ${channel}` });
          return;
        }
        res.status(400).json({ error: "Invalid queue mode" });
        return;
      }

      case "transcriptLines": {
        const lines = parseInt(value, 10);
        if (isNaN(lines) || lines < 10 || lines > 500) {
          res.status(400).json({ error: "Transcript lines must be between 10 and 500" });
          return;
        }
        data.transcriptLines[channel] = lines;
        await saveSessionData(data);
        res.json({ success: true, message: `Transcript lines set to ${lines} for ${channel}` });
        return;
      }

      case "responseStyle": {
        if (value === "streaming" || value === "bundled" || value === "final") {
          data.responseStyles[channel] = value;
          await saveSessionData(data);
          res.json({ success: true, message: `Response style set to ${value} for ${channel}` });
          return;
        }
        res.status(400).json({ error: "Invalid response style" });
        return;
      }

      default:
        res.status(400).json({ error: "Unknown setting type" });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
