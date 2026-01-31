"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth";
import MarkdownRenderer from "@/components/MarkdownRenderer";

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  content: string;
}

export default function SkillDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const skillName = decodeURIComponent(name);
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/skills")
      .then((res) => res.json())
      .then((data) => {
        const found = (data.skills || []).find((s: SkillInfo) => s.name === skillName);
        setSkill(found || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [skillName]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link href="/skills" className="p-2 -ml-2 text-zinc-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-xl font-bold text-white">Loading...</h2>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link href="/skills" className="p-2 -ml-2 text-zinc-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-xl font-bold text-white">Skill not found</h2>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">The skill "{skillName}" was not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/skills" className="p-2 -ml-2 text-zinc-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0 overflow-hidden">
          <h2 className="text-xl font-bold text-white truncate">{skill.name}</h2>
          <p className="text-zinc-500 text-sm truncate">{skill.path}</p>
        </div>
      </div>

      {/* Description Card */}
      {skill.description && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 overflow-hidden">
          <p className="text-zinc-300 break-words">{skill.description}</p>
        </div>
      )}

      {/* Content */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">SKILL.md</h3>
        </div>
        <div className="p-4 md:p-6 overflow-hidden">
          <MarkdownRenderer content={skill.content} />
        </div>
      </div>
    </div>
  );
}
