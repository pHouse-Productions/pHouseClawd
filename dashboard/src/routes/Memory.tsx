import { Link } from "react-router-dom";

export default function Memory() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Memory</h2>
        <p className="text-zinc-500 mt-1">Long-term and short-term memory</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          to="/memory/short-term"
          className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 hover:bg-zinc-800/50 transition-colors"
        >
          <h3 className="text-lg font-semibold text-white mb-2">Short-term Memory</h3>
          <p className="text-zinc-400 text-sm">Recent conversation buffer</p>
        </Link>

        <Link
          to="/memory/files/journal"
          className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 hover:bg-zinc-800/50 transition-colors"
        >
          <h3 className="text-lg font-semibold text-white mb-2">journal.md</h3>
          <p className="text-zinc-400 text-sm">Activity log</p>
        </Link>

        <Link
          to="/memory/files/projects"
          className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 hover:bg-zinc-800/50 transition-colors"
        >
          <h3 className="text-lg font-semibold text-white mb-2">projects.md</h3>
          <p className="text-zinc-400 text-sm">Active projects</p>
        </Link>

        <Link
          to="/memory/files/people"
          className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 hover:bg-zinc-800/50 transition-colors"
        >
          <h3 className="text-lg font-semibold text-white mb-2">people.md</h3>
          <p className="text-zinc-400 text-sm">Contacts and relationships</p>
        </Link>
      </div>
    </div>
  );
}
