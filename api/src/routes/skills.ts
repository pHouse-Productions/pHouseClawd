import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "../utils.js";

const router = Router();

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  content: string;
}

router.get("/", async (_req: Request, res: Response) => {
  const skillsDir = path.join(getProjectRoot(), ".claude/skills");
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

    res.json({ skills });
  } catch (error) {
    res.json({ skills: [], error: String(error) });
  }
});

export default router;
