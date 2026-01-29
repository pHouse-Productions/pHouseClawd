import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const SESSIONS_FILE = path.join(PROJECT_ROOT, "logs/sessions.json");

interface SessionData {
  known: string[];
  generations: Record<string, number>;
  modes: Record<string, string>; // "session" | "transcript"
  queueModes: Record<string, string>; // "queue" | "interrupt"
  transcriptLines: Record<string, number>;
}

async function loadSessionData(): Promise<SessionData> {
  try {
    const content = await fs.readFile(SESSIONS_FILE, "utf-8");
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      return { known: data, generations: {}, modes: {}, queueModes: {}, transcriptLines: {} };
    }
    return {
      ...data,
      modes: data.modes || {},
      queueModes: data.queueModes || {},
      transcriptLines: data.transcriptLines || {},
    };
  } catch {
    return { known: [], generations: {}, modes: {}, queueModes: {}, transcriptLines: {} };
  }
}

async function saveSessionData(data: SessionData): Promise<void> {
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

export async function GET() {
  try {
    const data = await loadSessionData();

    // Return just the settings we care about for the UI
    return NextResponse.json({
      modes: data.modes,
      queueModes: data.queueModes,
      transcriptLines: data.transcriptLines,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, channel, value } = body;

    const data = await loadSessionData();

    switch (type) {
      case "memoryMode": {
        if (value === "session" || value === "transcript") {
          data.modes[channel] = value;
          await saveSessionData(data);
          return NextResponse.json({ success: true, message: `Memory mode set to ${value} for ${channel}` });
        }
        return NextResponse.json({ error: "Invalid memory mode" }, { status: 400 });
      }

      case "queueMode": {
        if (value === "queue" || value === "interrupt") {
          data.queueModes[channel] = value;
          await saveSessionData(data);
          return NextResponse.json({ success: true, message: `Queue mode set to ${value} for ${channel}` });
        }
        return NextResponse.json({ error: "Invalid queue mode" }, { status: 400 });
      }

      case "transcriptLines": {
        const lines = parseInt(value, 10);
        if (isNaN(lines) || lines < 10 || lines > 500) {
          return NextResponse.json({ error: "Transcript lines must be between 10 and 500" }, { status: 400 });
        }
        data.transcriptLines[channel] = lines;
        await saveSessionData(data);
        return NextResponse.json({ success: true, message: `Transcript lines set to ${lines} for ${channel}` });
      }

      default:
        return NextResponse.json({ error: "Unknown setting type" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
