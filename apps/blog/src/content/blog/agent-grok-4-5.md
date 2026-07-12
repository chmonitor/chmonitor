---
title: "Agent mode now supports Grok 4.5"
description: "Pick x-ai/grok-4.5 from the model picker and the chmonitor AI agent will plan and run your ClickHouse diagnostics with it — over OpenRouter or AnyRouter."
date: 2026-07-12
tag: Update
---

The chmonitor AI agent now supports **Grok 4.5** (`x-ai/grok-4.5`). It shows up
in the model picker alongside the rest of the roster, over **OpenRouter** and
**AnyRouter**.

<img src="/assets/screenshots/ai-agent-grok-4.5-with-bg.png" alt="chmonitor AI agent model picker with x-ai/grok-4.5 selected" width="1708" height="742" loading="lazy" decoding="async" />

## How to use it

1. Open the agent and click the **model picker**.
2. Select **Grok 4.5** (`x-ai/grok-4.5`).
3. Ask away — "why is query latency spiking right now?", "which tables are close
   to too-many-parts?"

As long as an OpenRouter or AnyRouter key is configured on your deployment, the
model is selectable; the picker only lists models whose provider is actually set
up. Grok 4.5 comes from the same central registry as every other entry, so it
inherits cost tracking, tool use, and provider fallback. No extra setup.

<Related />

---
