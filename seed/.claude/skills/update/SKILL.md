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

### Step 1: Update pHouseMcp

```bash
cd /home/ubuntu/pHouseMcp && git fetch origin && git pull origin main
```

Check what changed:
```bash
cd /home/ubuntu/pHouseMcp && git log --oneline -5
```

If there are new changes, run `npm install` to update dependencies.

### Step 2: Update pHouseClawd

```bash
cd /home/ubuntu/pHouseClawd && git fetch origin && git pull origin main
```

Check what changed:
```bash
cd /home/ubuntu/pHouseClawd && git log --oneline -5
```

If there are changes to `core/`, `dashboard/`, or `listeners/*/`, check if `npm install` is needed.

### Step 3: Review the Seed Files

Read `/home/ubuntu/pHouseClawd/seed/CLAUDE.md` and compare it to your current CLAUDE.md.

Look for:
- **New sections** that don't exist in your CLAUDE.md
- **Updated protocols** or best practices
- **New safety rules** you should follow
- **New skills** or tools documented

If you find new sections that should be in your CLAUDE.md, offer to add them.

### Step 4: Report Summary

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
