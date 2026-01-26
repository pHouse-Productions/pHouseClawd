import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

const EVENTS_DIR = "/home/ubuntu/pHouseClawd/events";
const PENDING_DIR = path.join(EVENTS_DIR, "pending");
const PROCESSED_DIR = path.join(EVENTS_DIR, "processed");

export interface Event {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// Push an event to the queue
export function pushEvent(
  type: string,
  source: string,
  payload: Record<string, unknown>
): string {
  const id = randomUUID();
  const event: Event = {
    id,
    type,
    source,
    timestamp: new Date().toISOString(),
    payload,
  };

  const filePath = path.join(PENDING_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(event, null, 2));
  return id;
}

// Get all pending events (sorted by timestamp)
export function getPendingEvents(): Event[] {
  if (!fs.existsSync(PENDING_DIR)) return [];

  const files = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith(".json"));
  const events: Event[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(PENDING_DIR, file), "utf-8");
    events.push(JSON.parse(content));
  }

  return events.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

// Mark an event as processed
export function markProcessed(eventId: string): void {
  const src = path.join(PENDING_DIR, `${eventId}.json`);
  const dst = path.join(PROCESSED_DIR, `${eventId}.json`);

  if (fs.existsSync(src)) {
    fs.renameSync(src, dst);
  }
}

// Get a single pending event (oldest first)
export function popEvent(): Event | null {
  const events = getPendingEvents();
  if (events.length === 0) return null;

  const event = events[0];
  markProcessed(event.id);
  return event;
}
