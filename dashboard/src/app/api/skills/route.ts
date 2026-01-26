import { promises as fs } from "fs";
import path from "path";

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  content: string;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const skillsDir = "/home/ubuntu/pHouseClawd/.claude/skills";
  const skills: SkillInfo[] = [];

  try {
    const folders = await fs.readdir(skillsDir);

    for (const folder of folders) {
      const skillPath = path.join(skillsDir, folder, "SKILL.md");
      try {
        const content = await fs.readFile(skillPath, "utf-8");

        // Parse YAML frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let name = folder;
        let description = "";

        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
          const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
          if (nameMatch) name = nameMatch[1].trim();
          if (descMatch) description = descMatch[1].trim();
        }

        skills.push({
          name,
          description,
          path: skillPath,
          content,
        });
      } catch {
        // Skip folders without SKILL.md
      }
    }

    return Response.json({ skills });
  } catch (error) {
    return Response.json({ skills: [], error: String(error) });
  }
}
