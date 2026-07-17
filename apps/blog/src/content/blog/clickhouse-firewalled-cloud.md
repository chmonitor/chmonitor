---
title: "5 min of ClickHouse: connect a firewalled ClickHouse to chmonitor Cloud"
description: "chmonitor Cloud runs on Cloudflare Workers with no fixed egress IP, so allowlisting Cloudflare's ranges is not a real allowlist. Here's the tunnel that works with zero inbound ports opened."
date: 2026-07-10
tag: 5 min of ClickHouse
---

Five minutes, one real setup, no fluff. chmonitor **Cloud** runs entirely on Cloudflare Workers. When your ClickHouse sits behind a firewall, the Worker has to reach it — and because Workers have **no single fixed public IP by default**, a plain "allowlist our IP" doesn't work. Self-hosted chmonitor doesn't have this problem (it runs inside your network and reaches ClickHouse directly). This is the Cloud path.

## The default: Cloudflare Tunnel

A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-tunnel/) runs a small `cloudflared` connector next to ClickHouse. It makes only **outbound** connections to Cloudflare, so you open **no inbound ports and allowlist no IPs**. You then protect the tunnel's hostname with [Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) and hand chmonitor a **service token**.

```bash
cloudflared tunnel create chmonitor
cloudflared tunnel route dns chmonitor ch.example.com
```

Then add the host with URL `https://ch.example.com` and paste the service-token Client ID / Secret into the connection's headers (`CF-Access-Client-Id` / `CF-Access-Client-Secret`). No inbound hole, per-connection revocable token, end-to-end TLS — and it works today on free/standard Zero Trust tiers.

## Don't do this

> **Do not allowlist Cloudflare's public IP ranges.** Worker egress over those ranges is shared by *every* Cloudflare customer. Allowlisting them authorizes the entire fleet — not a real allowlist. Use a tunnel or dedicated egress IPs.

If a security team **requires** a literal firewall allowlist, chmonitor talks to ClickHouse over HTTP (`fetch()`), so Cloudflare's [Dedicated Egress IPs](https://developers.cloudflare.com/cloudflare-one/traffic-policies/egress-policies/dedicated-egress-ips/) (enterprise add-on) apply and give the Worker a stable source IP you can allowlist. Or run a reverse proxy (nginx/HAProxy) on a static-IP VM and allowlist only that.

## How chmonitor surfaces this

The [Connection errors](https://docs.chmonitor.dev/guide/guides/connection-errors) guide classifies "Test connection" failures (host not allowed / SSRF, invalid URL, auth failed, access denied, DNS/refused/TLS/timeout) so you know which leg of the tunnel is broken.

## Related

- Docs: [Connection errors](https://docs.chmonitor.dev/guide/guides/connection-errors) — diagnose failures kind by kind
- Docs: [Proxy & SSO auth setup](https://docs.chmonitor.dev/guide/guides/proxy-auth-setup)
- Docs: [Self-host](https://docs.chmonitor.dev/operate/deploy/self-host) — run inside your network, no tunnel needed
