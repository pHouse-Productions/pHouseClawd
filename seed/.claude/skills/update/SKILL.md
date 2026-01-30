---
name: update
description: Pull the latest updates from pHouseClawd and pHouseMcp repos, then review the seed template for any new features or instructions.
---

# Update Skill

## Purpose
Update pHouseClawd and pHouseMcp to the latest versions, then review the seed template to learn about any new features, protocols, or instructions.

## When to Use
- When the owner says "update", "pull latest", "check for updates", etc.
- Periodically to stay current with new features
- After being notified of a new release

## Repositories to Update

### 1. pHouseMcp (`/home/ubuntu/pHouseMcp`)
The MCP servers repository with all the integrations (Telegram, Gmail, Calendar, etc.)

### 2. pHouseClawd (`/home/ubuntu/pHouseClawd`)
The main assistant framework with the watcher, dashboard, and configuration.

## Instructions

### Step 0: Self-Update This Skill (FIRST!)

Before doing anything else, copy the latest seed version of this skill to your local skills directory:

```bash
cp /home/ubuntu/pHouseClawd/seed/.claude/skills/update/SKILL.md /home/ubuntu/pHouseClawd/.claude/skills/update/SKILL.md
```

**Why this matters:** The update skill itself gets improved over time. By copying the seed version first, you ensure you're following the latest update procedure, not an outdated one.

### Step 1: Update pHouseMcp

```bash
cd /home/ubuntu/pHouseMcp && git fetch origin && git pull origin main
```

Check what changed:
```bash
cd /home/ubuntu/pHouseMcp && git log --oneline -5
```

If there are new changes, run `npm install` to update dependencies, then rebuild the TypeScript:
```bash
cd /home/ubuntu/pHouseMcp && npm install && npm run build
```

### Step 2: Update pHouseClawd

```bash
cd /home/ubuntu/pHouseClawd && git fetch origin && git pull origin main
```

Check what changed:
```bash
cd /home/ubuntu/pHouseClawd && git log --oneline -5
```

### Step 3: Install Dependencies (REQUIRED)

**ALWAYS run npm install in all directories after pulling, even if you don't think it's needed.** This prevents "module not found" errors from new dependencies.

```bash
# Core dependencies
cd /home/ubuntu/pHouseClawd/core && npm install

# Dashboard dependencies (frequently causes issues if skipped!)
cd /home/ubuntu/pHouseClawd/dashboard && npm install

# Listener dependencies (if any listeners have package.json)
cd /home/ubuntu/pHouseClawd/listeners/telegram && npm install
cd /home/ubuntu/pHouseClawd/listeners/discord && npm install
```

**Why this matters:** New packages are added regularly. Skipping npm install is the #1 cause of "update worked but everything is broken" issues.

### Step 4: Review the Seed Files

Read `/home/ubuntu/pHouseClawd/seed/CLAUDE.md` and compare it to your current CLAUDE.md.

Look for:
- **New sections** that don't exist in your CLAUDE.md
- **Updated protocols** or best practices
- **New safety rules** you should follow
- **New skills** or tools documented

If you find new sections that should be in your CLAUDE.md, offer to add them.

### Step 5: Report Summary

Tell the owner:
- What commits were pulled (if any) for each repo
- What new features or instructions you found in the template
- Any new MCP servers or tools available
- Whether they need to restart the assistant for changes to take effect

## Important Notes

- **NEVER run `restart.sh` yourself** - Always ask the owner to restart if needed
- If there are merge conflicts, stop and ask for help
- If npm install fails, report the error
- This skill ensures you stay current with the latest capabilities and protocols
