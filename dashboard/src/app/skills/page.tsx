"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  content: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/skills")
      .then((res) => res.json())
      .then((data) => {
        setSkills(data.skills || []);
        if (data.skills?.length > 0) {
          setSelectedSkill(data.skills[0]);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Skills</h2>
          <p className="text-zinc-500 mt-1">Available skills and capabilities</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Skills</h2>
        <p className="text-zinc-500 mt-1">Available skills and capabilities</p>
      </div>

      {skills.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No skills found</p>
          <p className="text-zinc-600 text-sm mt-2">
            Skills are stored in .claude/skills/[skill-name]/SKILL.md
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Skill List */}
          <div className="lg:col-span-1">
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-white">
                  Available Skills ({skills.length})
                </h3>
              </div>
              <div className="divide-y divide-zinc-800">
                {skills.map((skill) => (
                  <button
                    key={skill.name}
                    onClick={() => setSelectedSkill(skill)}
                    className={`block w-full text-left px-4 py-3 hover:bg-zinc-800/50 transition-colors ${
                      selectedSkill?.name === skill.name ? "bg-zinc-800" : ""
                    }`}
                  >
                    <div className="text-white text-sm font-medium">{skill.name}</div>
                    <div className="text-zinc-500 text-xs mt-1 line-clamp-2">
                      {skill.description || "No description"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Skill Content */}
          <div className="lg:col-span-3">
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {selectedSkill?.name || "Select a skill"}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">{selectedSkill?.path}</p>
                </div>
              </div>
              <div className="p-4 max-h-[600px] overflow-auto">
                {selectedSkill ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <pre className="bg-zinc-950 p-4 rounded-lg overflow-auto text-xs text-zinc-300 whitespace-pre-wrap">
                      {selectedSkill.content}
                    </pre>
                  </div>
                ) : (
                  <p className="text-zinc-500">Select a skill to view its details</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
