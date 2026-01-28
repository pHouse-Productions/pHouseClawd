"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth";

interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/skills")
      .then((res) => res.json())
      .then((data) => {
        setSkills(data.skills || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Skills</h2>
          <p className="text-zinc-500 mt-1">Available capabilities</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Skills</h2>
        <p className="text-zinc-500 mt-1">Available capabilities ({skills.length})</p>
      </div>

      {skills.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No skills found</p>
          <p className="text-zinc-600 text-sm mt-2">
            Skills are stored in .claude/skills/[skill-name]/SKILL.md
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <Link
              key={skill.name}
              href={`/skills/${encodeURIComponent(skill.name)}`}
              className="flex items-center justify-between bg-zinc-900 rounded-lg border border-zinc-800 p-4 active:bg-zinc-800"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <div className="text-white font-medium">{skill.name}</div>
                  <div className="text-sm text-zinc-500 line-clamp-1">
                    {skill.description || "No description"}
                  </div>
                </div>
              </div>
              <svg className="w-5 h-5 text-zinc-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
