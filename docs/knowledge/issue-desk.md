---
id: issue-desk
title: Scheduled Herdr desk (external CLI)
type: workflow
status: active
updated: 2026-08-18
tags:
  - herdr
  - cron
  - agents
  - github
related:
  - core-memory
  - conventions
---

# Scheduled Herdr desk

Unattended pass is the **herdr-desk Herdr plugin**. This repo only has
`.herdr-desk.json` (`desk:github-issues`, cron `0 7 * * *`, inline
`extra`). Open this workspace once; the plugin remembers it and fires
the schedule.

```bash
herdr plugin install duyet/herdr-desk
herdr plugin action invoke herdr-desk.start
```

State: `.herdr-desk/runs/issues/YYYY-MM-DD/` (gitignored).
