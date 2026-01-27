import { promises as fs } from "fs";
import path from "path";

interface NoteFile {
  name: string;
  path: string;
  size: number;
  modified: Date;
  content: string;
}

async function getNotes(): Promise<NoteFile[]> {
  // Memory MCP stores notes in pHouseMcp/notes
  const notesDir = "/home/ubuntu/pHouseMcp/notes";
  const notes: NoteFile[] = [];

  try {
    const entries = await fs.readdir(notesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".txt"))) {
        const fullPath = path.join(notesDir, entry.name);
        const stats = await fs.stat(fullPath);
        const content = await fs.readFile(fullPath, "utf-8");
        notes.push({
          name: entry.name.replace(/\.(md|txt)$/, ""),
          path: fullPath,
          size: stats.size,
          modified: stats.mtime,
          content,
        });
      }
    }
  } catch {
    // Notes directory doesn't exist
  }

  return notes.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const dynamic = "force-dynamic";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }>;
}) {
  const params = await searchParams;
  const notes = await getNotes();
  const selectedNote = params.note ? notes.find((n) => n.name === params.note) : notes[0];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Notes</h2>
        <p className="text-zinc-500 mt-1">Personal notes and documentation</p>
      </div>

      {notes.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No notes found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Note List */}
          <div className="lg:col-span-1">
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-white">Files</h3>
              </div>
              <div className="divide-y divide-zinc-800">
                {notes.map((note) => (
                  <a
                    key={note.name}
                    href={`/notes?note=${encodeURIComponent(note.name)}`}
                    className={`block px-4 py-3 hover:bg-zinc-800/50 transition-colors ${
                      selectedNote?.name === note.name ? "bg-zinc-800" : ""
                    }`}
                  >
                    <div className="text-white text-sm capitalize">{note.name}</div>
                    <div className="text-zinc-500 text-xs mt-1">{formatDate(note.modified)}</div>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Note Content */}
          <div className="lg:col-span-3">
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-white capitalize">
                  {selectedNote?.name || "Select a note"}
                </h3>
              </div>
              <div className="p-6 prose prose-invert prose-sm max-w-none">
                {selectedNote ? (
                  <pre className="whitespace-pre-wrap text-zinc-300 text-sm font-mono bg-transparent p-0 m-0">
                    {selectedNote.content}
                  </pre>
                ) : (
                  <p className="text-zinc-500">Select a note to view</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
