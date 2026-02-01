import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";

interface Skill {
  name: string;
  description: string;
  path: string;
}

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSkills = async () => {
      try {
        const res = await authFetch("/api/skills");
        if (res.ok) {
          const data = await res.json();
          setSkills(data.skills || []);
        }
      } catch (err) {
        console.error("Failed to fetch skills:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchSkills();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading skills...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Skills</h2>
        <p className="text-zinc-500 mt-1">Available slash commands</p>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800">
        {skills.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">No skills found</div>
        ) : (
          skills.map((skill) => (
            <Link
              key={skill.name}
              to={`/skills/${encodeURIComponent(skill.name)}`}
              className="block p-4 hover:bg-zinc-800/50 transition-colors"
            >
              <div className="font-medium text-white">/{skill.name}</div>
              <div className="text-sm text-zinc-400 mt-1">{skill.description}</div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
