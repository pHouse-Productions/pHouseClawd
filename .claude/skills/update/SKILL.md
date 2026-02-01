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

### 1. pHouseMcp (`../pHouseMcp` relative to pHouseClawd)
The MCP servers repository with all the integrations (Telegram, Gmail, Calendar, etc.)

### 2. pHouseClawd (this repo)
The main assistant framework with the watcher, dashboard, and configuration.

## Instructions

### Step 0: Self-Update This Skill (FIRST!)

Before doing anything else, copy the latest seed version of this skill to your local skills directory:

```bash
cp seed/.claude/skills/update/SKILL.md .claude/skills/update/SKILL.md
```

**Why this matters:** The update skill itself gets improved over time. By copying the seed version first, you ensure you're following the latest update procedure, not an outdated one.

### Step 1: Update pHouseMcp

```bash
cd ../pHouseMcp && git fetch origin && git pull origin main
```

Check what changed:
```bash
cd ../pHouseMcp && git log --oneline -5
```

If there are new changes, rebuild:
```bash
cd ../pHouseMcp && npm install && npm run build
```

Then restart the MCP servers:
```bash
sudo systemctl restart mcp-servers
```

### Step 2: Update pHouseClawd

```bash
git fetch origin && git pull origin main
```

Check what changed:
```bash
git log --oneline -5
```

### Step 3: Install Dependencies & Build (REQUIRED)

**ALWAYS run these after pulling, even if you don't think it's needed.** This prevents "module not found" errors from new dependencies.

```bash
# Core watcher
cd core && npm install && cd ..

# API server
cd api && npm install && npm run build && cd ..

# Dashboard
cd dashboard && npm install && npm run build && cd ..
```

**Why this matters:** New packages are added regularly. Skipping npm install/build is the #1 cause of "update worked but everything is broken" issues.

### Step 4: Review the Seed Files

Read `seed/CLAUDE.md` and compare it to your current setup:
- **SOUL.md** - Your personality/preferences (instance-specific, not updated)
- **SYSTEM.md** - Technical reference (tracked, may have updates)

Look for:
- **New sections** in SYSTEM.md
- **Updated protocols** or best practices
- **New safety rules** you should follow
- **New skills** documented

If SYSTEM.md has significant changes, let the owner know what's new.

### Step 5: Restart Services

After updating code, restart the affected services:

```bash
# If watcher code changed
pm2 restart watcher

# If dashboard/API code changed
pm2 restart dashboard-api
```

### Step 6: Report Summary

Tell the owner:
- What commits were pulled (if any) for each repo
- What new features or instructions you found
- Any new MCP servers or tools available
- Which services were restarted

## Important Notes

- **Use PM2 for restarts** - `pm2 restart watcher` or `pm2 restart dashboard-api`
- **MCP servers use systemd** - `sudo systemctl restart mcp-servers`
- If there are merge conflicts, stop and ask for help
- If npm install/build fails, report the error
- This skill ensures you stay current with the latest capabilities and protocols
