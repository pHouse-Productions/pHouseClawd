---
name: delete-site
description: Delete a hosted site or app. Removes from PM2, Caddy config, and deletes site files. Use when asked to remove/delete a site.
---

# Delete Site Skill

Safely delete a hosted site or app from the server.

## What Gets Deleted

- **For PM2 apps:** Stop process, delete from PM2, save PM2 state
- **Caddy config:** Remove the subdomain block from `/home/ubuntu/Caddyfile`
- **Site files:** Delete the folder from `/home/ubuntu/hosted-sites/<name>`
- **Sites config:** Remove entry from `~/.claude/sites.json` (if app)

## Workflow

### 1. Identify the Site

List current sites:
```bash
ls -la /home/ubuntu/hosted-sites/
pm2 list
```

Or check the sites.json config:
```bash
cat ~/.claude/sites.json
```

### 2. Confirm with User

Before deleting, confirm:
- Site name to delete
- What type (static site or PM2 app)
- That they understand it's permanent

### 3. For PM2 Apps

```bash
# Stop and delete from PM2
pm2 stop <app-name>
pm2 delete <app-name>
pm2 save
```

Update `~/.claude/sites.json` to remove the app entry.

### 4. Remove Caddy Config

Read the current Caddyfile:
```bash
cat /home/ubuntu/Caddyfile
```

Carefully remove the site's block. For example, if deleting "mysite":

```caddy
# This block should be removed:
mysite.mike-vito.rl-quests.com {
    root * /home/ubuntu/hosted-sites/mysite/dist
    try_files {path} /index.html
    file_server
}
```

Write the updated Caddyfile (use the Write tool, not sed/regex).

Then reload:
```bash
sudo systemctl reload caddy
```

### 5. Delete Site Files

```bash
rm -rf /home/ubuntu/hosted-sites/<site-name>
```

### 6. Verify

```bash
# Check PM2 (should not list the app)
pm2 list

# Check Caddy config (should not have the domain)
cat /home/ubuntu/Caddyfile

# Check files are gone
ls /home/ubuntu/hosted-sites/
```

## Important

- **Always confirm before deleting** - This is destructive
- **Read the Caddyfile before editing** - Don't use regex, manually identify the block
- **Be careful with nested configs** - The main domain has nested handle blocks
- **Never touch the main dashboard config** - `mike-vito.rl-quests.com` block is special

## Example

User: "Delete the habits app"

1. Check it exists: `pm2 list` shows "habits"
2. Confirm: "I'll delete the habits app. This removes the PM2 process, Caddy config, and all files. Proceed?"
3. Stop PM2: `pm2 stop habits && pm2 delete habits && pm2 save`
4. Read Caddyfile, remove the habits block, write back
5. Reload Caddy: `sudo systemctl reload caddy`
6. Delete files: `rm -rf /home/ubuntu/hosted-sites/habits`
7. Update sites.json if it was an app
8. Confirm: "Done. habits.mike-vito.rl-quests.com is no longer accessible."
