# Changelog

All notable changes to this project are documented in this file. Versioned
entries are generated automatically by [release-please](.github/workflows/release-please.yml)
from conventional commits; the `Unreleased` section below is a human-curated
preview of the next release.

## [0.2.13](https://github.com/chmonitor/chmonitor/compare/v0.2.12...v0.2.13) (2026-07-06)


### ✨ Features

* **advisor:** capacity forecast + TTL advisor tools, recommend-only (plan 50) ([#2222](https://github.com/chmonitor/chmonitor/issues/2222)) ([0af61a8](https://github.com/chmonitor/chmonitor/commit/0af61a8aec36b64e15cebaa99495ce2cd441e13a))
* **advisor:** MV/projection designer, recommend-only (plan 47) ([#2237](https://github.com/chmonitor/chmonitor/issues/2237)) ([db35d2d](https://github.com/chmonitor/chmonitor/commit/db35d2defc4116d9ce544a5944269a3a6d03c319))
* **advisor:** proactive weekly health report, styled HTML narrative (plan 52) ([#2253](https://github.com/chmonitor/chmonitor/issues/2253)) ([59487ab](https://github.com/chmonitor/chmonitor/commit/59487abd5262b719fb955d1ace33229ca4141bd5))
* **advisor:** query optimization advisor engine, recommend-only (plan 46) ([#2234](https://github.com/chmonitor/chmonitor/issues/2234)) ([b132509](https://github.com/chmonitor/chmonitor/commit/b132509cec3d762377d28266549270bf91312311))
* **advisor:** read-only EXPLAIN-based query cost estimator (plan 49) ([#2233](https://github.com/chmonitor/chmonitor/issues/2233)) ([a3acf68](https://github.com/chmonitor/chmonitor/commit/a3acf686c55dc17ff91cf70d963228443f0c1da9))
* **agent:** clickable follow-up suggestion chips ([#2324](https://github.com/chmonitor/chmonitor/issues/2324)) ([#2331](https://github.com/chmonitor/chmonitor/issues/2331)) ([8cff7a2](https://github.com/chmonitor/chmonitor/commit/8cff7a20136a161f3403e0e9c399ce64d667a64f))
* **agent:** find_reference_query — retrieve over the QueryConfig library ([#2325](https://github.com/chmonitor/chmonitor/issues/2325)) ([#2327](https://github.com/chmonitor/chmonitor/issues/2327)) ([0991794](https://github.com/chmonitor/chmonitor/commit/0991794a54ace3aed3f72a0151db3b97a24058cd))
* **agent:** list_slow_query_patterns tool + harden query-optimization loop ([#2306](https://github.com/chmonitor/chmonitor/issues/2306)) ([c15f6a7](https://github.com/chmonitor/chmonitor/commit/c15f6a7a8be235dcfe169613f3ecd1be4f56340c)), closes [#2263](https://github.com/chmonitor/chmonitor/issues/2263)
* **agents:** open MCP "Connect" entries in dialogs ([#2292](https://github.com/chmonitor/chmonitor/issues/2292)) ([845b2aa](https://github.com/chmonitor/chmonitor/commit/845b2aab05d5499277ee07a556d459aa76d39609))
* **agent:** tool-first operating rules + behavioral eval tracking ([#2321](https://github.com/chmonitor/chmonitor/issues/2321)) ([3f5cfaf](https://github.com/chmonitor/chmonitor/commit/3f5cfaf2babbbc09b095bc289bdfd8d2292243e4))
* **alerting:** alert ack / manual resolution (plan 29) ([#2258](https://github.com/chmonitor/chmonitor/issues/2258)) ([f5eda59](https://github.com/chmonitor/chmonitor/commit/f5eda599087dec91922ff5594c548fbe2296ee14))
* **alerting:** compound alert rules (plan 31) ([#2249](https://github.com/chmonitor/chmonitor/issues/2249)) ([24c782e](https://github.com/chmonitor/chmonitor/commit/24c782e44703ad204375b569f5058c431306e896))
* **alerting:** custom alert rule builder (plan 32) ([#2257](https://github.com/chmonitor/chmonitor/issues/2257)) ([8401a50](https://github.com/chmonitor/chmonitor/commit/8401a502d0e81e4babc241743b077219fbaf4d0d))
* **alerting:** email alert adapter — Mailgun/SendGrid (plan 25) ([#2218](https://github.com/chmonitor/chmonitor/issues/2218)) ([aaac26e](https://github.com/chmonitor/chmonitor/commit/aaac26efb01a6d54ad630d4eb058892e5a4b9229))
* **alerting:** maintenance windows / alert suppression (plan 28) ([#2254](https://github.com/chmonitor/chmonitor/issues/2254)) ([2340f98](https://github.com/chmonitor/chmonitor/commit/2340f98d6ab75b12ef7798e31925308de81cee05))
* **alerting:** Opsgenie adapter (plan 26) ([#2248](https://github.com/chmonitor/chmonitor/issues/2248)) ([42e793d](https://github.com/chmonitor/chmonitor/commit/42e793d674cd06a9f2bf97f03e343e4ad60df455))
* **alerting:** PagerDuty escalation / on-call routing (plan 34) ([#2281](https://github.com/chmonitor/chmonitor/issues/2281)) ([9f1a8b0](https://github.com/chmonitor/chmonitor/commit/9f1a8b0c6ea30f9b50b491cf946af3a5a9bb7546))
* **alerting:** per-rule/per-host alert routing (plan 30) ([#2269](https://github.com/chmonitor/chmonitor/issues/2269)) ([c103b7c](https://github.com/chmonitor/chmonitor/commit/c103b7c6392cb20b555595033903c28dca83e2b9))
* **alerting:** remediation action links (plan 33) ([#2255](https://github.com/chmonitor/chmonitor/issues/2255)) ([602be6c](https://github.com/chmonitor/chmonitor/commit/602be6cea18842c0d276e10e2328c13808719993))
* **analytics:** full-capture PostHog across dashboard, docs, landing, blog ([#2344](https://github.com/chmonitor/chmonitor/issues/2344)) ([4985ba7](https://github.com/chmonitor/chmonitor/commit/4985ba7d82166b7bf1991c30b6de3fad20acf515))
* **analytics:** privacy-respecting PostHog funnel instrumentation, off by default (plan 62) ([#2219](https://github.com/chmonitor/chmonitor/issues/2219)) ([cf9f84f](https://github.com/chmonitor/chmonitor/commit/cf9f84fcd421cf8ad4d6d45c2a916167cb46fc7d))
* **api:** Query Insights API — list + detail for slow query patterns ([#2310](https://github.com/chmonitor/chmonitor/issues/2310)) ([e8cf70b](https://github.com/chmonitor/chmonitor/commit/e8cf70b9498ab6ed8d5a98b5bd22c6906d186873))
* **audit:** org-scoped audit log + CSV export (plan 22) ([#2232](https://github.com/chmonitor/chmonitor/issues/2232)) ([1f6e3b6](https://github.com/chmonitor/chmonitor/commit/1f6e3b6c76a8000e5811e52d9c41e24286df2a33))
* **billing:** AI monthly-spend meter + honest deferred labels on usage card (plan 16) ([#2267](https://github.com/chmonitor/chmonitor/issues/2267)) ([7ebddc1](https://github.com/chmonitor/chmonitor/commit/7ebddc13e0a32253c74f185cbdbf2d05c7c12b46))
* **billing:** downgrade protection modal (plan 19) ([#2291](https://github.com/chmonitor/chmonitor/issues/2291)) ([82dabf9](https://github.com/chmonitor/chmonitor/commit/82dabf918ebee11f9681e5c61785215bbbaa94af))
* **billing:** meter AI overage only past included allowance; Free hard-caps ([#2213](https://github.com/chmonitor/chmonitor/issues/2213)) ([f8f91c4](https://github.com/chmonitor/chmonitor/commit/f8f91c404af2f9a5d1e007881bae8a1fe1dc7e1d))
* **billing:** per-host overage billing (plan 18) ([#2289](https://github.com/chmonitor/chmonitor/issues/2289)) ([1c77974](https://github.com/chmonitor/chmonitor/commit/1c77974355e0d9ddab87f857e4d1c3df34f657fd))
* **billing:** seat-cap invite-time gate (plan 20) ([#2290](https://github.com/chmonitor/chmonitor/issues/2290)) ([8524cc1](https://github.com/chmonitor/chmonitor/commit/8524cc143090c9d084173cff3d0cd767bb727a0f))
* **billing:** upgrade paywall modal (plan 15) ([#2273](https://github.com/chmonitor/chmonitor/issues/2273)) ([5d577ff](https://github.com/chmonitor/chmonitor/commit/5d577ff25db55243af2c00776c39a746dba639fd))
* **blog:** redirect /v0.3 to blog, add more v0.3 screenshots ([#2353](https://github.com/chmonitor/chmonitor/issues/2353)) ([57d2f9f](https://github.com/chmonitor/chmonitor/commit/57d2f9f28e3c9f1b643b03403941ef92b70361fc))
* **cache:** enable Cloudflare Workers Cache across workers ([#2412](https://github.com/chmonitor/chmonitor/issues/2412)) ([cff4579](https://github.com/chmonitor/chmonitor/commit/cff4579438758a00dee3b4453306ca5f17b89b8b))
* **ch-cloud:** ClickHouse Cloud connect preset + optional billing usage sync (plan 41) ([#2240](https://github.com/chmonitor/chmonitor/issues/2240)) ([63aa030](https://github.com/chmonitor/chmonitor/commit/63aa030fc3ab475b45776ed5d7014d463f1f1b13))
* **charts:** collapse to per-row mini preview instead of unmounting ([#2358](https://github.com/chmonitor/chmonitor/issues/2358)) ([5c88a16](https://github.com/chmonitor/chmonitor/commit/5c88a1664ac5d252c8c5f3a0353d6a78b2efc18e))
* **charts:** declarative chart schema + loader (plan 58) ([#2256](https://github.com/chmonitor/chmonitor/issues/2256)) ([7b88654](https://github.com/chmonitor/chmonitor/commit/7b8865404e24081ba092bbbd62c4db2c6f93471d))
* **dashboards:** AI-generated dashboards (plan 59) ([#2280](https://github.com/chmonitor/chmonitor/issues/2280)) ([116afbb](https://github.com/chmonitor/chmonitor/commit/116afbb37259f9cb6960e1f0986befac923c6150))
* **dashboards:** custom dashboard builder grid (plan 57) ([#2265](https://github.com/chmonitor/chmonitor/issues/2265)) ([c77267b](https://github.com/chmonitor/chmonitor/commit/c77267b45109abc495ca0706569061446165741d))
* **dashboards:** D1 persistence + read-only sharing, owner-scoped (plan 56) ([#2224](https://github.com/chmonitor/chmonitor/issues/2224)) ([553c62f](https://github.com/chmonitor/chmonitor/commit/553c62f456278fe356ae634ce7f401867a9997d6))
* **deployments:** GitHub deploy-correlation (plan 45) ([#2238](https://github.com/chmonitor/chmonitor/issues/2238)) ([37d1b31](https://github.com/chmonitor/chmonitor/commit/37d1b3120b9eb31171410c94d8e86f941eb194e7))
* **docs:** blog/content engine — calendar, templates, RSS, release sync, latest-posts widget (plan 67) ([#2250](https://github.com/chmonitor/chmonitor/issues/2250)) ([ddca937](https://github.com/chmonitor/chmonitor/commit/ddca937cc439c4c036605d0d78d6c56a8c94ed27))
* **events:** inbound event bus — /api/events/ingest, queue-or-inline (plan 36) ([#2236](https://github.com/chmonitor/chmonitor/issues/2236)) ([597aa0a](https://github.com/chmonitor/chmonitor/commit/597aa0a8ba36b63eec3d82dfe8b6810506945e30))
* **events:** outbound webhook subscription bus, HMAC + SSRF-guarded (plan 44) ([#2235](https://github.com/chmonitor/chmonitor/issues/2235)) ([6eaaccc](https://github.com/chmonitor/chmonitor/commit/6eaaccc9236488b08cd6170d442267585f910aba))
* **expensive-queries:** adjustable window+duration filters, faster scan, fix empty-state ([#2276](https://github.com/chmonitor/chmonitor/issues/2276)) ([179b6a8](https://github.com/chmonitor/chmonitor/commit/179b6a8d285c306e068c9021b8c2beb358df6e56))
* **explain:** redesign page, add query picker and query_id prefill ([#2285](https://github.com/chmonitor/chmonitor/issues/2285)) ([8a6bf15](https://github.com/chmonitor/chmonitor/commit/8a6bf15d7903ebec928a5076f677d5c6110b1592))
* **explorer:** copy-friendly names, DDL beautify toggle, compact Indexes tab ([#2294](https://github.com/chmonitor/chmonitor/issues/2294)) ([ad1c033](https://github.com/chmonitor/chmonitor/commit/ad1c0339ad884682feb4ea0c2999b69d749babc0))
* **health:** add mini trend sparkline to dense health check rows ([#2359](https://github.com/chmonitor/chmonitor/issues/2359)) ([fcc8ee8](https://github.com/chmonitor/chmonitor/commit/fcc8ee8d25feae701e4c830489fc034abb8541a5))
* **health:** persist dispatched alerts to D1 alert_events + history API ([#2231](https://github.com/chmonitor/chmonitor/issues/2231)) ([6b96cf0](https://github.com/chmonitor/chmonitor/commit/6b96cf042c4be43fb8e652a36a6496c386907245))
* **health:** redesign health cards + generic per-check drill-down to affected rows ([#2277](https://github.com/chmonitor/chmonitor/issues/2277)) ([98e944f](https://github.com/chmonitor/chmonitor/commit/98e944ff96fb000eef052db19bc71e743591602f))
* **health:** severity-tiered Health page redesign ([#2346](https://github.com/chmonitor/chmonitor/issues/2346)) ([aaebd43](https://github.com/chmonitor/chmonitor/commit/aaebd43b8e253b0fde6ebcbcb8b2766ff55a1907))
* **host:** edit/details dialog on host switcher, permission-gated ([#2371](https://github.com/chmonitor/chmonitor/issues/2371)) ([6b33724](https://github.com/chmonitor/chmonitor/commit/6b3372440f1666de26cf825ec64423db0666bac9))
* **insights:** add memory, read-throughput, top-users charts; widen zoom dialog ([#2350](https://github.com/chmonitor/chmonitor/issues/2350)) ([d7fa0ea](https://github.com/chmonitor/chmonitor/commit/d7fa0ea4b31ea9fe41f611cc78c1cbad94ff01a2))
* **insights:** add Query Insights overview page ([#2307](https://github.com/chmonitor/chmonitor/issues/2307)) ([0bc4585](https://github.com/chmonitor/chmonitor/commit/0bc4585f0ee58d1eed4eee5575a1e43b9d68bbe7))
* **insights:** AI Insights section + schema optimization suggestions ([#2343](https://github.com/chmonitor/chmonitor/issues/2343)) ([19e1c80](https://github.com/chmonitor/chmonitor/commit/19e1c803d6bf498ccaa85fe7b41c71150d182086))
* **insights:** normalized slow-query-patterns table (plan 2261) ([#2303](https://github.com/chmonitor/chmonitor/issues/2303)) ([8dba82e](https://github.com/chmonitor/chmonitor/commit/8dba82edb25806e3064eab5f18c14168dade4dff))
* **insights:** per-cluster statistical anomaly baselines with cold-start fallback (plan 48) ([#2217](https://github.com/chmonitor/chmonitor/issues/2217)) ([6bf332d](https://github.com/chmonitor/chmonitor/commit/6bf332d67292f0ac98175c70a68172b11ef527e9))
* **insights:** query pattern detail flyout + recent queries panel (plan 2262) ([#2316](https://github.com/chmonitor/chmonitor/issues/2316)) ([9b60111](https://github.com/chmonitor/chmonitor/commit/9b601113334226fc325f6118b280dbd160a79ec8))
* **insights:** redesign overview strip + insights board, add operational collectors ([#2296](https://github.com/chmonitor/chmonitor/issues/2296)) ([99c4a57](https://github.com/chmonitor/chmonitor/commit/99c4a57fdad91ff8a41e624e20bd8df2b76e3d84))
* **insights:** separate AI Insights from Statistics Insights on both pages ([#2356](https://github.com/chmonitor/chmonitor/issues/2356)) ([8457ee8](https://github.com/chmonitor/chmonitor/commit/8457ee81487f6d11f9850fd1a1b4a3971d7c9941))
* **insights:** static mock example (no LLM, guest-safe) + Statistics Insights threshold settings ([#2366](https://github.com/chmonitor/chmonitor/issues/2366)) ([5b04fa7](https://github.com/chmonitor/chmonitor/commit/5b04fa7668d0d2eea1e878e61ca14450ff85599b))
* **landing,blog:** per-page OG images + SEO meta/schema audit (plan 69) ([#2223](https://github.com/chmonitor/chmonitor/issues/2223)) ([d61847a](https://github.com/chmonitor/chmonitor/commit/d61847ac4e1a441c0a7f1ff3bef91ef46ec5b5ae))
* **landing:** add Slow Queries and PeerDB Mirrors to hero gallery ([#2354](https://github.com/chmonitor/chmonitor/issues/2354)) ([beedc95](https://github.com/chmonitor/chmonitor/commit/beedc955cd4d6a67eb88b5b2597090205cf7c95f))
* **landing:** editorial halftone hero + CTA, real screenshots, serif sections ([#2197](https://github.com/chmonitor/chmonitor/issues/2197)) ([e7ccd58](https://github.com/chmonitor/chmonitor/commit/e7ccd582ea720b33132e637e710f7e8cbb4659f5))
* **landing:** feature-sections advisor/alerts refresh (plan 61) ([#2251](https://github.com/chmonitor/chmonitor/issues/2251)) ([cdb027b](https://github.com/chmonitor/chmonitor/commit/cdb027bc6c94205b40da8dda27c2c2846a7d1768))
* **landing:** finish shadcn section rebuild + hero redesign + fixes ([#2396](https://github.com/chmonitor/chmonitor/issues/2396)) ([2c3983d](https://github.com/chmonitor/chmonitor/commit/2c3983de39b0255abe8a3357c1a8c9544f86af9e))
* **landing:** hero GitHub star badge + shared build-time star fetch (plan 68) ([#2228](https://github.com/chmonitor/chmonitor/issues/2228)) ([179d69f](https://github.com/chmonitor/chmonitor/commit/179d69fecf25d25b15002d19b6018f490523027d))
* **landing:** hero wedge refresh — advisor + real-time alerts (plan 60) ([#2241](https://github.com/chmonitor/chmonitor/issues/2241)) ([6312d2b](https://github.com/chmonitor/chmonitor/commit/6312d2bfbae2ac5174d820c0b30ba739861c070d))
* **landing:** honest /vs-* comparison pages (Grafana, Datadog, ClickHouse Cloud) ([#2247](https://github.com/chmonitor/chmonitor/issues/2247)) ([e1bf253](https://github.com/chmonitor/chmonitor/commit/e1bf253aebd2934b814907244392e713f5949894))
* **landing:** refresh screenshots, add Cluster Insights section, static hero ([#2329](https://github.com/chmonitor/chmonitor/issues/2329)) ([5f2e8a4](https://github.com/chmonitor/chmonitor/commit/5f2e8a4ef4e589c8d6ff684ced9ea565f222df06))
* **landing:** remove 'Open source, built in public' section from homepage ([#2341](https://github.com/chmonitor/chmonitor/issues/2341)) ([e3fe5f2](https://github.com/chmonitor/chmonitor/commit/e3fe5f22431f6e37e5ea0e7fd65884df9bb368ad))
* **landing:** SEO use-case landing pages (plan 64) ([#2239](https://github.com/chmonitor/chmonitor/issues/2239)) ([1ae59d7](https://github.com/chmonitor/chmonitor/commit/1ae59d7217e7c19eceea0576a067251c567578f1))
* **landing:** shadcn hero + blue theme + v0.3 screenshots ([#2394](https://github.com/chmonitor/chmonitor/issues/2394)) ([9556197](https://github.com/chmonitor/chmonitor/commit/95561976ffc8d8b591942eeded2a3a6e80621143))
* **mcp:** per-user external MCP server registry (register, validate, load) (plan 43) ([#2271](https://github.com/chmonitor/chmonitor/issues/2271)) ([92fb45f](https://github.com/chmonitor/chmonitor/commit/92fb45fecfd2191c08dd3141743ff53878cbc259))
* **menu:** nest Insights and Insights Settings under an Insights parent ([#2342](https://github.com/chmonitor/chmonitor/issues/2342)) ([3e4424f](https://github.com/chmonitor/chmonitor/commit/3e4424fff89b2267496d7758b4cec84f295aa5be))
* **metrics:** cached feature-gated Prometheus /metrics exporter (plan 35) ([#2215](https://github.com/chmonitor/chmonitor/issues/2215)) ([649c4ab](https://github.com/chmonitor/chmonitor/commit/649c4ab35acd621d8f50b1d352d6ad035cd3a553))
* **onboarding:** 'Try with sample ClickHouse' preset + convert CTA (plan 66) ([#2225](https://github.com/chmonitor/chmonitor/issues/2225)) ([aae050c](https://github.com/chmonitor/chmonitor/commit/aae050cfa8b9b6daf6e8c7aa29871c3817eb5c58))
* **otel:** opt-in OTel trace export, off by default (plan 39) ([#2243](https://github.com/chmonitor/chmonitor/issues/2243)) ([ad67d2e](https://github.com/chmonitor/chmonitor/commit/ad67d2e830bbae2c5ddf50e642b00e46445a6c67))
* **platform:** add lib/target module for platform detection (PR1 of [#2187](https://github.com/chmonitor/chmonitor/issues/2187)) ([#2304](https://github.com/chmonitor/chmonitor/issues/2304)) ([5627d03](https://github.com/chmonitor/chmonitor/commit/5627d03a22d2430224a6e6a820521a5a528bc084))
* **queries-insights:** moving-average band + threshold anomaly overlays on charts ([#2367](https://github.com/chmonitor/chmonitor/issues/2367)) ([966da9c](https://github.com/chmonitor/chmonitor/commit/966da9c16931f835252868bfaf7f4bb8774923c1))
* **query-cache:** redesign page with row expansion, hit-rate chart, cleaner columns ([#2283](https://github.com/chmonitor/chmonitor/issues/2283)) ([ba80f5c](https://github.com/chmonitor/chmonitor/commit/ba80f5c0e3c7f127b1e94d977b73987a8b17bd27))
* **query-config:** community query-pack registry ([#2230](https://github.com/chmonitor/chmonitor/issues/2230)) ([0f89e21](https://github.com/chmonitor/chmonitor/commit/0f89e2170fc89c7cb6779001e9083d43a3888b78))
* **query-config:** self-hosted local config override (queries.d) ([#2221](https://github.com/chmonitor/chmonitor/issues/2221)) ([63006c4](https://github.com/chmonitor/chmonitor/commit/63006c4f928c61204d8d5fbdb5b3c889437bd84a))
* **query-metric-log:** expandable SQL rows, formatted metrics, sampled-memory chart ([#2287](https://github.com/chmonitor/chmonitor/issues/2287)) ([c18c7f0](https://github.com/chmonitor/chmonitor/commit/c18c7f0e5a152eaa27b4ef5871b8d35ec2cd053d))
* **query:** child-query lineage + heuristic insights on detail page ([#2393](https://github.com/chmonitor/chmonitor/issues/2393)) ([21e4aaf](https://github.com/chmonitor/chmonitor/commit/21e4aaf4a74406afe634b3cbe002b42ab1307c0e))
* **query:** enrich query-detail data (stack trace, upstream tables, lineage) ([#2377](https://github.com/chmonitor/chmonitor/issues/2377)) ([983dac2](https://github.com/chmonitor/chmonitor/commit/983dac2406bda3610bf8f90f6fe7e475f81d67bb))
* **query:** query-stages chart (per-processor duration breakdown) ([#2395](https://github.com/chmonitor/chmonitor/issues/2395)) ([e850723](https://github.com/chmonitor/chmonitor/commit/e8507236ccbab514feb30e124f32d49bf854708f))
* **query:** SQL panel with syntax highlight + beautify toggle ([#2376](https://github.com/chmonitor/chmonitor/issues/2376)) ([0c170ef](https://github.com/chmonitor/chmonitor/commit/0c170efb240ebd7858369d55827b5b9fc4cbcd3a))
* **recent-queries:** expandable rows + readable column headers ([#2345](https://github.com/chmonitor/chmonitor/issues/2345)) ([c4c9eee](https://github.com/chmonitor/chmonitor/commit/c4c9eeeb0ae57c8e0af87eda96d27413ef7eb9e5))
* **running-queries:** keep expanded queries as Done on finish + Explain link ([#2279](https://github.com/chmonitor/chmonitor/issues/2279)) ([151639b](https://github.com/chmonitor/chmonitor/commit/151639bc4e80764151997ac01e0a248a5f86a5e3))
* **slack:** native Slack app with OAuth, slash commands, Home tab, ACK buttons (plan 37) ([#2275](https://github.com/chmonitor/chmonitor/issues/2275)) ([88e4c7c](https://github.com/chmonitor/chmonitor/commit/88e4c7c23fd0ab04cbdef4d6fb8777b6f4ca8e14))
* **ui:** blur dialog background, document anti-slop design rule ([#2357](https://github.com/chmonitor/chmonitor/issues/2357)) ([e622df2](https://github.com/chmonitor/chmonitor/commit/e622df20f3920b056b5369cff2bf5a744c39709a))
* **ui:** migrate shadcn components from Radix UI to Base UI ([#2361](https://github.com/chmonitor/chmonitor/issues/2361)) ([9da2d43](https://github.com/chmonitor/chmonitor/commit/9da2d430ed344736273869db017692b8fd8f34e4))
* **user-processes:** enrich page with live + windowed per-user query_log activity ([#2288](https://github.com/chmonitor/chmonitor/issues/2288)) ([35a7636](https://github.com/chmonitor/chmonitor/commit/35a7636a5cc76603d22ced1e1d0235b51263217d))


### 🐛 Bug Fixes

* **about:** correct license from MIT to GPL-3.0 ([#2372](https://github.com/chmonitor/chmonitor/issues/2372)) ([48355bd](https://github.com/chmonitor/chmonitor/commit/48355bd66ebbec3eb8baf59f9990f544b760a88f))
* **agent-chat:** clean agent starting state ([#2295](https://github.com/chmonitor/chmonitor/issues/2295)) ([17e6f35](https://github.com/chmonitor/chmonitor/commit/17e6f35b92c2bfc6ce1a4b0505086f905ce73b2b))
* **agent:** expose 7 hidden tools in system prompt + anti-drift guard ([#2320](https://github.com/chmonitor/chmonitor/issues/2320)) ([77ad992](https://github.com/chmonitor/chmonitor/commit/77ad992335bc6c7aebd3ea0dc4d6b48dd771afa8))
* **agent:** fix settings page auth error, merge tabs, redesign MCP tab, fix menu highlight ([#2349](https://github.com/chmonitor/chmonitor/issues/2349)) ([1c49c2a](https://github.com/chmonitor/chmonitor/commit/1c49c2a28144c6f0744c2f9f9ac22144d1fb06eb))
* **agent:** polish tool-call chat rendering — stable streaming + collapsible rows ([#2274](https://github.com/chmonitor/chmonitor/issues/2274)) ([8d0e6b1](https://github.com/chmonitor/chmonitor/commit/8d0e6b11acc71790326ece5baa0e009125717862))
* **alerting:** commit dedup state only after webhook delivery to stop dropped alerts ([#2205](https://github.com/chmonitor/chmonitor/issues/2205)) ([cc43786](https://github.com/chmonitor/chmonitor/commit/cc437860b4c169b2a57b4fac60ad38b821ad49b4))
* **api:** enable ClickHouse query cache on read-only polling paths ([#2313](https://github.com/chmonitor/chmonitor/issues/2313)) ([6091f97](https://github.com/chmonitor/chmonitor/commit/6091f9713e3bcd00fe59bd2eafee80fbf5167031))
* **api:** floor fractional range hours before binding to UInt32 ([#2312](https://github.com/chmonitor/chmonitor/issues/2312)) ([fbf9881](https://github.com/chmonitor/chmonitor/commit/fbf9881c4aa26472815614b4bcdb809cf6852592))
* **billing,organization:** hide cloud-only routes on OSS, fix org card ([#2374](https://github.com/chmonitor/chmonitor/issues/2374)) ([ca975db](https://github.com/chmonitor/chmonitor/commit/ca975db0700cc9ac6733d8ae35d9eb92db108e76))
* **cf:** /healthz 500 from Sentry locking the response body ([#2352](https://github.com/chmonitor/chmonitor/issues/2352)) ([a6c6521](https://github.com/chmonitor/chmonitor/commit/a6c6521e80abe28783f02d663f15369e97dd8c23))
* **charts:** replace dev-facing empty state with a user-friendly one ([#2375](https://github.com/chmonitor/chmonitor/issues/2375)) ([4c988fc](https://github.com/chmonitor/chmonitor/commit/4c988fc54329cb64fab083627242ce1c03c09387))
* **ci:** bump remaining bun pins to 1.3.14 (fixes deploy/landing ENOENT) ([#2252](https://github.com/chmonitor/chmonitor/issues/2252)) ([075b38f](https://github.com/chmonitor/chmonitor/commit/075b38f2b97f342fdb80e6700a8d16025152e06b))
* **ci:** bump unit-tests bun-version to 1.3.14 to fix coverage WriteFailed ([#2242](https://github.com/chmonitor/chmonitor/issues/2242)) ([cc3b790](https://github.com/chmonitor/chmonitor/commit/cc3b790c31bb63afa1608d567534b36fef4d14b3))
* **ci:** drop text coverage reporter to avoid Bun WriteFailed crash ([#2301](https://github.com/chmonitor/chmonitor/issues/2301)) ([d3d9606](https://github.com/chmonitor/chmonitor/commit/d3d96066a1feefff196b53dd8556d6ce72255c4a)), closes [#2299](https://github.com/chmonitor/chmonitor/issues/2299)
* **ci:** pin dtolnay/rust-toolchain to [@stable](https://github.com/stable), not a numeric tag ([#2198](https://github.com/chmonitor/chmonitor/issues/2198)) ([3bceeb4](https://github.com/chmonitor/chmonitor/commit/3bceeb4024c5e616a15a492ac3a08af03bdd31a2))
* **cloud:** extend demo-host guard to remaining hostId data routes ([#2315](https://github.com/chmonitor/chmonitor/issues/2315)) ([2abc14b](https://github.com/chmonitor/chmonitor/commit/2abc14b224d34327ca6917b93800eb1e0e1c4f45))
* **cloud:** reject non-negative hostId for authenticated cloud principals ([#2302](https://github.com/chmonitor/chmonitor/issues/2302)) ([831c935](https://github.com/chmonitor/chmonitor/commit/831c935bed9a6d7509bd512ea8fb5c8451e3f928))
* **conversations:** scope upsert to owner to close cross-tenant IDOR ([#2203](https://github.com/chmonitor/chmonitor/issues/2203)) ([71a8ee2](https://github.com/chmonitor/chmonitor/commit/71a8ee21dd71edb3997278f44921fa46403ed37a))
* **db:** resolve alert_acks migration collision ([#2300](https://github.com/chmonitor/chmonitor/issues/2300)) ([0dc7dc2](https://github.com/chmonitor/chmonitor/commit/0dc7dc2e477cee073585e2d1a362140cc1ed3e7b))
* **docs,landing,blog:** move Slack/Discord alerting guide to docs, fix broken links ([#2334](https://github.com/chmonitor/chmonitor/issues/2334)) ([57ae77a](https://github.com/chmonitor/chmonitor/commit/57ae77a3b6a6fbca56bc1e0a9acc25dc010ef573))
* **findings:** avoid event_time alias shadowing in findings query ([#2173](https://github.com/chmonitor/chmonitor/issues/2173)) ([#2200](https://github.com/chmonitor/chmonitor/issues/2200)) ([a61c9c5](https://github.com/chmonitor/chmonitor/commit/a61c9c5b59c758d5c56bf0842abe0f13698985b3))
* **health:** remove redundant card border rail, fix detail dialog overflow ([#2355](https://github.com/chmonitor/chmonitor/issues/2355)) ([42b4113](https://github.com/chmonitor/chmonitor/commit/42b4113c2be7c0a99375e16749373c13ac7943ae))
* **history-queries:** enable row expand + share running-queries design ([#2297](https://github.com/chmonitor/chmonitor/issues/2297)) ([dc1eb9c](https://github.com/chmonitor/chmonitor/commit/dc1eb9c82d915ca034b93cb9c6fd213da4096604))
* **hooks:** correct keyboard-shortcut modifiers, debounce ref/identity, csv CR quoting ([#2157](https://github.com/chmonitor/chmonitor/issues/2157)) ([0b88cb2](https://github.com/chmonitor/chmonitor/commit/0b88cb2827c32e6f412d1f7b43d47b5832c59655))
* **insights:** break baseline import cycle + clear round-3 format drift ([#2220](https://github.com/chmonitor/chmonitor/issues/2220)) ([078024c](https://github.com/chmonitor/chmonitor/commit/078024cd03ba427f29b7445f03058d07f2c45c93))
* **insights:** break weekly-report/weekly-report-html circular import ([#2270](https://github.com/chmonitor/chmonitor/issues/2270)) ([d124f75](https://github.com/chmonitor/chmonitor/commit/d124f75f1d4b0e3f43fb54b609394b6f56e9f6e8))
* **insights:** rank notable runs server-side, not from a capped sample ([#2317](https://github.com/chmonitor/chmonitor/issues/2317)) ([3ae79ac](https://github.com/chmonitor/chmonitor/commit/3ae79ac07a8a8c0615dbcaa443ccc2d961265698))
* **menu:** hide Billing & Organization in OSS; cleaner insight card border ([#2397](https://github.com/chmonitor/chmonitor/issues/2397)) ([6c82440](https://github.com/chmonitor/chmonitor/commit/6c824409ec447188eed0a05f660e1eb89d2fadbf))
* **menu:** remove docs link from Operations parent menu item ([#2373](https://github.com/chmonitor/chmonitor/issues/2373)) ([fa72f67](https://github.com/chmonitor/chmonitor/commit/fa72f673b6c5d68c4a2cf7771bb71a149d5f3ac4))
* **peerdb:** stop infinite render loop on peer topology graph (React [#185](https://github.com/chmonitor/chmonitor/issues/185)) ([#2293](https://github.com/chmonitor/chmonitor/issues/2293)) ([d2effb2](https://github.com/chmonitor/chmonitor/commit/d2effb2f4c5ccced7f982b396fbc7ce70c84eb58))
* **query-config:** fail closed on malformed declarative config; document CHM_CONFIG_SOURCE ([#2214](https://github.com/chmonitor/chmonitor/issues/2214)) ([0963db3](https://github.com/chmonitor/chmonitor/commit/0963db355cdd9483e40f5557f3450914a8ec5fd9))
* **query-config:** keep query-metric-log flip-safe with a TS-only expandable allowlist ([#2298](https://github.com/chmonitor/chmonitor/issues/2298)) ([acde35e](https://github.com/chmonitor/chmonitor/commit/acde35e3faefd4089f4dde78cc3a6f6eb4952236))
* **security:** add readonly to browser-connection proxy + report-only CSP ([#2152](https://github.com/chmonitor/chmonitor/issues/2152)) ([1f155dd](https://github.com/chmonitor/chmonitor/commit/1f155dda080e4faba9d290da2b73e6caa25ed102))
* **security:** escape literals and validate privilege/target in management DDL ([#2208](https://github.com/chmonitor/chmonitor/issues/2208)) ([352b1d8](https://github.com/chmonitor/chmonitor/commit/352b1d8e8ae93220f830fc286b0772bba285b791))
* **security:** require write-auth on health/webhook SSRF proxy ([#2204](https://github.com/chmonitor/chmonitor/issues/2204)) ([734f62b](https://github.com/chmonitor/chmonitor/commit/734f62bee13947a8b2e691dfe72c71d161c61526))
* **test:** stop feature-permissions mock.module leak breaking main unit-tests ([#2314](https://github.com/chmonitor/chmonitor/issues/2314)) ([c6d1b02](https://github.com/chmonitor/chmonitor/commit/c6d1b029529a85b64bffde2c18aa98ef878cf80a))
* **theme:** brighten dark-mode --primary for readable filter pills ([#2340](https://github.com/chmonitor/chmonitor/issues/2340)) ([e08ad3c](https://github.com/chmonitor/chmonitor/commit/e08ad3cdc1692885e9f84c6e82b2159c26a100dd))
* **ui:** de-slop Example card icon and Health summary banner ([#2370](https://github.com/chmonitor/chmonitor/issues/2370)) ([9e9d084](https://github.com/chmonitor/chmonitor/commit/9e9d084a73f1e4a2e4576f674943ab38645d8696))
* **ui:** fix remaining Base UI CSS-var and data-attr mismatches from [#2361](https://github.com/chmonitor/chmonitor/issues/2361) ([#2364](https://github.com/chmonitor/chmonitor/issues/2364)) ([a4d3bac](https://github.com/chmonitor/chmonitor/commit/a4d3bacc850aef69e2cfa1d956a0f65d311e762f))
* **ui:** neutral chart skeleton on dark, wider failed-query dialogs ([#2365](https://github.com/chmonitor/chmonitor/issues/2365)) ([fb0e9c6](https://github.com/chmonitor/chmonitor/commit/fb0e9c6234ea359ce1609707b4d851db1d90ebb0))
* **ui:** restore Base UI orientation variants broken in Radix→Base UI migration ([#2363](https://github.com/chmonitor/chmonitor/issues/2363)) ([99a4a43](https://github.com/chmonitor/chmonitor/commit/99a4a436399a7464ff41054b543f19525beaaaa8))
* **ui:** wrap menu labels in groups to stop Base UI GroupContext crash ([#2369](https://github.com/chmonitor/chmonitor/issues/2369)) ([4f41b7d](https://github.com/chmonitor/chmonitor/commit/4f41b7dbc7bea1d8c20c542ddee62bad9a9af980))


### ⚡ Performance

* **api:** edge-cache anonymous public-read chart responses ([#2181](https://github.com/chmonitor/chmonitor/issues/2181)) ([#2311](https://github.com/chmonitor/chmonitor/issues/2311)) ([495c7ed](https://github.com/chmonitor/chmonitor/commit/495c7ed5b08ae678c0c3d6f59b6842adfabf1297))
* **api:** KV-back the /api/v1/data dashboard-query allowlist cache ([#2309](https://github.com/chmonitor/chmonitor/issues/2309)) ([a85ddb5](https://github.com/chmonitor/chmonitor/commit/a85ddb5523b8d808a51411d8857a85c1c72d4278)), closes [#2185](https://github.com/chmonitor/chmonitor/issues/2185)
* **auth:** skip Clerk verify on the anonymous public-read fast path ([#2308](https://github.com/chmonitor/chmonitor/issues/2308)) ([c9e7a23](https://github.com/chmonitor/chmonitor/commit/c9e7a2337b8cf718f4eff98bad2ca318293b8baf)), closes [#2186](https://github.com/chmonitor/chmonitor/issues/2186)
* **clickhouse:** KV-backed L2 cache for version + table-existence checks ([#2318](https://github.com/chmonitor/chmonitor/issues/2318)) ([0ccd2a1](https://github.com/chmonitor/chmonitor/commit/0ccd2a1803cefc01472bba03fd65c0efefda3199))
* **connections:** run multi-query charts in parallel on user connections ([#2206](https://github.com/chmonitor/chmonitor/issues/2206)) ([a351340](https://github.com/chmonitor/chmonitor/commit/a3513407aa308226681b7cd1706804f51f5c90bf))
* **data-table:** build body render key from primitives instead of JSON.stringify ([#2209](https://github.com/chmonitor/chmonitor/issues/2209)) ([b0768dc](https://github.com/chmonitor/chmonitor/commit/b0768dcc9619a6d3351613c20308ec0e10e6faf4))
* **failed-queries:** PREWHERE + drop unused columns; fix loading-vs-empty state ([#2278](https://github.com/chmonitor/chmonitor/issues/2278)) ([182e6a0](https://github.com/chmonitor/chmonitor/commit/182e6a0655f7ca571b128bf576541fd6b3709490))
* **history-queries:** default 24h window, lift window fns out of LIMIT, keep filter bar on empty ([#2347](https://github.com/chmonitor/chmonitor/issues/2347)) ([8952df9](https://github.com/chmonitor/chmonitor/commit/8952df91920ad80150e3a8ad5dad6431e76ef7d8))
* **insights:** throttle regeneration with server-side min-interval ([#2192](https://github.com/chmonitor/chmonitor/issues/2192)) ([c5b2ae4](https://github.com/chmonitor/chmonitor/commit/c5b2ae41c141bb0a15e61bb6fa5544b211db5cd7))
* **landing:** defer hero shader, lazy-load gallery, trim dead CSS, add Lighthouse CI check ([#2226](https://github.com/chmonitor/chmonitor/issues/2226)) ([267fe13](https://github.com/chmonitor/chmonitor/commit/267fe130df9a5fc08f9f135f8ce65c2806f5d419))
* **query:** drop volatile host-list dim from server-host query keys ([#2184](https://github.com/chmonitor/chmonitor/issues/2184)) ([#2201](https://github.com/chmonitor/chmonitor/issues/2201)) ([beb53c8](https://github.com/chmonitor/chmonitor/commit/beb53c8001f690d4b9eca7fe34e08d1f0c8ddc65))
* **query:** keep cached data on page revisits via 30s staleTime + keepPreviousData ([#2282](https://github.com/chmonitor/chmonitor/issues/2282)) ([d4a6641](https://github.com/chmonitor/chmonitor/commit/d4a6641f82d2eb01cc4ac59d29d8e9fa91875b19))
* **tables-overview:** cut per-part work in tables-overview query and nav badge ([#2284](https://github.com/chmonitor/chmonitor/issues/2284)) ([a11f543](https://github.com/chmonitor/chmonitor/commit/a11f543368cc6ca32facdc50388401a385077c61))


### ♻️ Refactoring

* **agent:** merge AI Agent/MCP Servers/MCP Server nav into one menu, add Agent Settings page ([#2336](https://github.com/chmonitor/chmonitor/issues/2336)) ([6934eca](https://github.com/chmonitor/chmonitor/commit/6934ecad0be8e9cb10cfc5831dbf3bf88f034ec0))
* **agent:** modularize the system prompt into named sections ([#2323](https://github.com/chmonitor/chmonitor/issues/2323)) ([#2330](https://github.com/chmonitor/chmonitor/issues/2330)) ([08aea1b](https://github.com/chmonitor/chmonitor/commit/08aea1bb037e6acf0dc28f59101c9d84daf4881b))
* **agent:** slim the inline ClickHouse encyclopedia into the skills ([#2323](https://github.com/chmonitor/chmonitor/issues/2323)) ([#2332](https://github.com/chmonitor/chmonitor/issues/2332)) ([4d4bc17](https://github.com/chmonitor/chmonitor/commit/4d4bc176af49d7fefd295662d501d22daa1ce7ca))
* **dashboard:** move Inbound Events into the Others menu section ([#2339](https://github.com/chmonitor/chmonitor/issues/2339)) ([e117bd9](https://github.com/chmonitor/chmonitor/commit/e117bd91264cd7a26db03d53f6315e36287f79ac))
* **mcp-server:** extract shared runReadonlyQuery helper for tools ([#2164](https://github.com/chmonitor/chmonitor/issues/2164)) ([3729229](https://github.com/chmonitor/chmonitor/commit/372922988f80416d71418adc37d2e5a522042c4a)), closes [#2148](https://github.com/chmonitor/chmonitor/issues/2148)
* **slow-queries:** premium table redesign, drop red row stripe, fix duration sizing ([#2272](https://github.com/chmonitor/chmonitor/issues/2272)) ([80805c0](https://github.com/chmonitor/chmonitor/commit/80805c08eefd8db2156967ddf72a722576f8bb77))
* **types:** replace any with generics in data-table and chart tooltip ([#2163](https://github.com/chmonitor/chmonitor/issues/2163)) ([331b354](https://github.com/chmonitor/chmonitor/commit/331b354602f5e609515321622657176bd1f5f95b))

## [0.2.12](https://github.com/chmonitor/chmonitor/compare/v0.2.11...v0.2.12) (2026-07-02)


### ✨ Features

* **agent:** Base UI chat thread + custom MCP server runtime ([#2003](https://github.com/chmonitor/chmonitor/issues/2003)) ([756607a](https://github.com/chmonitor/chmonitor/commit/756607a582b73946c71a3dcda8937a0bfb6c859e))
* **agent:** conversation-level session stats aggregate in thread ([#2102](https://github.com/chmonitor/chmonitor/issues/2102)) ([92abe84](https://github.com/chmonitor/chmonitor/commit/92abe8410111d3238307bb41261fe1fa18b643b5)), closes [#2074](https://github.com/chmonitor/chmonitor/issues/2074)
* **agent:** daily AI-quota indicator in chat UI ([#2103](https://github.com/chmonitor/chmonitor/issues/2103)) ([63ccd89](https://github.com/chmonitor/chmonitor/commit/63ccd898e862b964aae50a6cd0ef0d1016ee5bd5)), closes [#2073](https://github.com/chmonitor/chmonitor/issues/2073)
* **alerting:** pluggable rule engine + repl-lag/slow-query/MV-refresh rules ([#1970](https://github.com/chmonitor/chmonitor/issues/1970)) ([eeba8e0](https://github.com/chmonitor/chmonitor/commit/eeba8e0b88a08c3b8a191208f7eb81cb13dba3a4))
* **billing,config:** plan-benefits parity registry, private-host opt-in, blog polish ([#2038](https://github.com/chmonitor/chmonitor/issues/2038)) ([fcb8c11](https://github.com/chmonitor/chmonitor/commit/fcb8c11dd4bb91d0b49d0d3aafe40e96475a8d06))
* **billing:** centralize plan limit checks, enrich tiers, add pricing page ([#2029](https://github.com/chmonitor/chmonitor/issues/2029)) ([38d67cc](https://github.com/chmonitor/chmonitor/commit/38d67ccc18495581fdd41a5b61fc3972ef2326c6))
* **billing:** clearer AI label, yearly summary, inherited-row highlight, signed-out state ([#2037](https://github.com/chmonitor/chmonitor/issues/2037)) ([0be34e6](https://github.com/chmonitor/chmonitor/commit/0be34e60a20841a678cd1dc0c968ff09c8be22b9))
* **billing:** enforce monthly AI USD budget and fix daily-usage accounting ([#2104](https://github.com/chmonitor/chmonitor/issues/2104)) ([99c84f6](https://github.com/chmonitor/chmonitor/commit/99c84f6870d85ede310016ab1dd922407c30902b)), closes [#2071](https://github.com/chmonitor/chmonitor/issues/2071)
* **billing:** enforce per-tier plan limits (AI cap, seats, retention, MCP capability) ([#2039](https://github.com/chmonitor/chmonitor/issues/2039)) ([fe81ae2](https://github.com/chmonitor/chmonitor/commit/fe81ae2756492f8e919e3ca2039f3af8b9ec13e4))
* **billing:** org-scoped billing (lazy org on paid) + org UI ([#2019](https://github.com/chmonitor/chmonitor/issues/2019)) ([b6ad5d2](https://github.com/chmonitor/chmonitor/commit/b6ad5d2735f452ca93a0dc06479d30de9a03b64b))
* **billing:** Polar subscriptions + host-limit enforcement (cloud) ([#2018](https://github.com/chmonitor/chmonitor/issues/2018)) ([d83fde1](https://github.com/chmonitor/chmonitor/commit/d83fde1e96b72154a70c5f371bd34559757d618d))
* **billing:** pool host limit across org members ([#2035](https://github.com/chmonitor/chmonitor/issues/2035)) ([1a63aa6](https://github.com/chmonitor/chmonitor/commit/1a63aa64bfce229c526746a29c24003dadb35e0a))
* **billing:** production Polar config + e2e harness for billing/org flow ([#2020](https://github.com/chmonitor/chmonitor/issues/2020)) ([a066b40](https://github.com/chmonitor/chmonitor/commit/a066b40ce84d7fd1b4ef25b6e4e1ff0a8d807bab))
* **billing:** shared PlanCard across /billing + /setup — bigger, fancier, aligned CTAs ([#2021](https://github.com/chmonitor/chmonitor/issues/2021)) ([35bcf73](https://github.com/chmonitor/chmonitor/commit/35bcf73a578b2a3d178fb8fa4c219e38c3de1743))
* **billing:** theme Clerk components to shadcn design tokens ([#2034](https://github.com/chmonitor/chmonitor/issues/2034)) ([8e096fd](https://github.com/chmonitor/chmonitor/commit/8e096fdd8df0750b37e2215ccd4378ef97a3cffb))
* **billing:** usage read API + current-plan usage summary ([#2101](https://github.com/chmonitor/chmonitor/issues/2101)) ([1dada3f](https://github.com/chmonitor/chmonitor/commit/1dada3f643c01ac0847ecb3779c36fc683f2058f)), closes [#2072](https://github.com/chmonitor/chmonitor/issues/2072)
* **blog:** add blog.chmonitor.dev with v0.3 release post ([#2027](https://github.com/chmonitor/chmonitor/issues/2027)) ([9b92009](https://github.com/chmonitor/chmonitor/commit/9b9200929bcd273409bac4ecac4b333fa2632f90))
* **bug-handler:** email→GitHub-issue Cloudflare worker ([#2041](https://github.com/chmonitor/chmonitor/issues/2041)) ([0034bfd](https://github.com/chmonitor/chmonitor/commit/0034bfd912e5197366c7e4376362c471855c88f1))
* **cloud:** pop nav plan badge + add /sign-in,/sign-up routes ([#2026](https://github.com/chmonitor/chmonitor/issues/2026)) ([8c02405](https://github.com/chmonitor/chmonitor/commit/8c02405830ee3c944f1c1acd15e60b4d17067a61))
* **connections:** docs help in Add-host dialog + permission/connectivity guides ([#2045](https://github.com/chmonitor/chmonitor/issues/2045)) ([bf17e95](https://github.com/chmonitor/chmonitor/commit/bf17e95c1fd8a6a0ca1de502b2f47047718cec69))
* **connections:** two-column Add ClickHouse host dialog with help panel ([#2169](https://github.com/chmonitor/chmonitor/issues/2169)) ([d6fa9ee](https://github.com/chmonitor/chmonitor/commit/d6fa9eebbd55932869cd97fb7f7934bc8f66ddc2))
* **dashboard:** signed-out plans link + Add Host CTA for empty host state ([#2024](https://github.com/chmonitor/chmonitor/issues/2024)) ([8fce49c](https://github.com/chmonitor/chmonitor/commit/8fce49c5728954ec5b35d9d974128bd1cb9c6c19))
* **docs:** add chmonitor logo mark to docs nav ([#1978](https://github.com/chmonitor/chmonitor/issues/1978)) ([80134d2](https://github.com/chmonitor/chmonitor/commit/80134d2f9bc0a107c59679ae638670f6513e24b7))
* **docs:** add Mermaid, Twoslash, and llms.txt integrations ([#1981](https://github.com/chmonitor/chmonitor/issues/1981)) ([c98e62f](https://github.com/chmonitor/chmonitor/commit/c98e62f104adb5c1c926dc5b64cf4340d522c61a))
* **docs:** build-time Takumi OG image generation ([#1979](https://github.com/chmonitor/chmonitor/issues/1979)) ([a81455e](https://github.com/chmonitor/chmonitor/commit/a81455ee9070687cd40c5733f73b4f9e2683daa7))
* **docs:** migrate docs site from Astro Starlight to Fumadocs (TanStack Start) ([#1977](https://github.com/chmonitor/chmonitor/issues/1977)) ([cc6dd93](https://github.com/chmonitor/chmonitor/commit/cc6dd9303814c809b8b5b27970c18e10f3d3e339))
* **docs:** overhaul Fumadocs site — hero, theme, mermaid, nav tree, no dead links ([#1982](https://github.com/chmonitor/chmonitor/issues/1982)) ([2516f3d](https://github.com/chmonitor/chmonitor/commit/2516f3dc26d74ce0621bad784006653ae88693f6))
* **docs:** reorganize content tree and add cards, callouts, steps, tabs ([#1980](https://github.com/chmonitor/chmonitor/issues/1980)) ([abdb9e3](https://github.com/chmonitor/chmonitor/commit/abdb9e3c616ae394422f336c8c10c1e9ed480ae7))
* **docs:** reorganize into 3 tabs with nested sidebar ([#1985](https://github.com/chmonitor/chmonitor/issues/1985)) ([eda2032](https://github.com/chmonitor/chmonitor/commit/eda2032003aa6000a442ff9aff227b2b5b2329d5))
* **docs:** sidebar layout tabs as a dropdown ([#1984](https://github.com/chmonitor/chmonitor/issues/1984)) ([8dc8d41](https://github.com/chmonitor/chmonitor/commit/8dc8d41d5c715077d30eb6b3313cece1a20a585e))
* **docs:** stacked version + section dropdowns in sidebar ([#2000](https://github.com/chmonitor/chmonitor/issues/2000)) ([25ee382](https://github.com/chmonitor/chmonitor/commit/25ee382c3580f845b8ad04dae1e548ed7e431b3f))
* **docs:** version switcher as dropdown menu ([#1983](https://github.com/chmonitor/chmonitor/issues/1983)) ([42e091b](https://github.com/chmonitor/chmonitor/commit/42e091bc63587f437109f5cee6b1014538ede258))
* **env:** centralize all config to single-source .env* files ([#2009](https://github.com/chmonitor/chmonitor/issues/2009)) ([9e921e7](https://github.com/chmonitor/chmonitor/commit/9e921e731d75fb740829265807af6aaa81e8e7c8))
* **explorer:** add Overview tab with per-table summary (size, engine, index, compression, usage) ([#2002](https://github.com/chmonitor/chmonitor/issues/2002)) ([7c18b4a](https://github.com/chmonitor/chmonitor/commit/7c18b4a38856a5abe80b0d20c9a089bda717c37d))
* **health:** add incident system snapshot capture + endpoint ([#2093](https://github.com/chmonitor/chmonitor/issues/2093)) ([a7e462d](https://github.com/chmonitor/chmonitor/commit/a7e462dec131345c53201cd945fb34973a1d2de0)), closes [#2079](https://github.com/chmonitor/chmonitor/issues/2079)
* **health:** add notification adapter layer (pure formatters) ([#2088](https://github.com/chmonitor/chmonitor/issues/2088)) ([da0e5ea](https://github.com/chmonitor/chmonitor/commit/da0e5eaf5bb7ec038d2e65e565a0b79e21f72bbb)), closes [#2076](https://github.com/chmonitor/chmonitor/issues/2076)
* **health:** registry-driven sweep with alert dedup + env thresholds ([#2092](https://github.com/chmonitor/chmonitor/issues/2092)) ([c89576d](https://github.com/chmonitor/chmonitor/commit/c89576dea60a09b9ddce016e563238de411a63d1)), closes [#2077](https://github.com/chmonitor/chmonitor/issues/2077)
* **host-switch:** vXX.yy version, auto-hide metadata, remove demo label, add cloud sign-in note ([#2051](https://github.com/chmonitor/chmonitor/issues/2051)) ([f9202c9](https://github.com/chmonitor/chmonitor/commit/f9202c9e6195c803ae5de8b624b51021b8e5b16d))
* **identity:** provider-agnostic auth identity sync (Clerk adapter) ([#2042](https://github.com/chmonitor/chmonitor/issues/2042)) ([d6169f0](https://github.com/chmonitor/chmonitor/commit/d6169f044cebdb4084e23797cd6ce8f7d5d631d3))
* **insights:** show created date on insight card ([#1996](https://github.com/chmonitor/chmonitor/issues/1996)) ([db8f885](https://github.com/chmonitor/chmonitor/commit/db8f885840cffc1ebfa22d0c39ded41f91149fc6))
* **landing:** add mobile hamburger nav drawer ([#2084](https://github.com/chmonitor/chmonitor/issues/2084)) ([a53bf30](https://github.com/chmonitor/chmonitor/commit/a53bf305415096b4220677df6c25dd8acf1998ce)), closes [#2058](https://github.com/chmonitor/chmonitor/issues/2058)
* **landing:** cloud pricing tiers + dark-mode polish ([#2014](https://github.com/chmonitor/chmonitor/issues/2014)) ([d8c637a](https://github.com/chmonitor/chmonitor/commit/d8c637a4da4d19aed77a0393106afa77c06486dc))
* **landing:** dark mode + toggle, grouped nav, copy polish ([#2010](https://github.com/chmonitor/chmonitor/issues/2010)) ([7fcb374](https://github.com/chmonitor/chmonitor/commit/7fcb3746eef919c119befeb0c7b1f20d4c07ba49))
* **landing:** hand-crafted SVG topology & dependency-graph viz ([#2091](https://github.com/chmonitor/chmonitor/issues/2091)) ([b7bd6d0](https://github.com/chmonitor/chmonitor/commit/b7bd6d013a98b68fc4abaadeaeae93c081ff8ebc)), closes [#2061](https://github.com/chmonitor/chmonitor/issues/2061)
* **landing:** pricing, comparison, SEO, FAQ, changelog, social proof ([#1959](https://github.com/chmonitor/chmonitor/issues/1959)) ([cc6e469](https://github.com/chmonitor/chmonitor/commit/cc6e4697d6120062bae238a114418e96d6b0e001))
* **landing:** redesign Open Graph image ([#2004](https://github.com/chmonitor/chmonitor/issues/2004)) ([ecc72b9](https://github.com/chmonitor/chmonitor/commit/ecc72b9f74a5f2607a89a135cabcf02e48260848))
* **landing:** replace Health screenshots with theme-aware inline viz ([#2085](https://github.com/chmonitor/chmonitor/issues/2085)) ([790077a](https://github.com/chmonitor/chmonitor/commit/790077a2785a28fa38e5390277b5303ba703094c)), closes [#2060](https://github.com/chmonitor/chmonitor/issues/2060)
* **monitoring:** async-insert, RabbitMQ consumers, background schedule pool ([#1969](https://github.com/chmonitor/chmonitor/issues/1969)) ([a098812](https://github.com/chmonitor/chmonitor/commit/a098812907c72775a3fff06c439f51d5c146622c))
* **monitoring:** blob_storage_log view, storage economics, new bg-op cols ([#1962](https://github.com/chmonitor/chmonitor/issues/1962)) ([d848bfd](https://github.com/chmonitor/chmonitor/commit/d848bfd99405fcd07850c14a3b91beaabdd1bf34))
* **monitoring:** CH version detection + Keeper 26.6 deep-dive ([#1961](https://github.com/chmonitor/chmonitor/issues/1961)) ([49e3c35](https://github.com/chmonitor/chmonitor/commit/49e3c35e29bcc036c127974e500c7c9431c57a53))
* **monitoring:** histogram metrics, workload scheduling, OTel spans, index analytics ([#1972](https://github.com/chmonitor/chmonitor/issues/1972)) ([4e934f6](https://github.com/chmonitor/chmonitor/commit/4e934f6d440f102f68b37171c1129f73c918a15a))
* **monitoring:** query diagnostics — error_log/client_agent/query_metric/condition_cache ([#1963](https://github.com/chmonitor/chmonitor/issues/1963)) ([ca4058f](https://github.com/chmonitor/chmonitor/commit/ca4058f5a8173e333f53b7621b79910eab3607fd))
* **nav-user:** show a "Free" badge instead of an "Upgrade →" link ([#2047](https://github.com/chmonitor/chmonitor/issues/2047)) ([603c1b5](https://github.com/chmonitor/chmonitor/commit/603c1b55e099d9efc5b79ef1dd56995fdac76b57))
* **observability:** Sentry error tracking for OSS + Cloud ([#2040](https://github.com/chmonitor/chmonitor/issues/2040)) ([b95d7e8](https://github.com/chmonitor/chmonitor/commit/b95d7e871e51e995d1381a59dc6585c2ec4ef6aa))
* **saas:** add reachable /setup "Connect a host" page ([#2007](https://github.com/chmonitor/chmonitor/issues/2007)) ([3143d35](https://github.com/chmonitor/chmonitor/commit/3143d35ae198c3b26b1338aef9b611927b2fbde8))
* **saas:** CHM_CLOUD_DEMO_HOSTS — narrow public demo to named hosts ([#2013](https://github.com/chmonitor/chmonitor/issues/2013)) ([5aa8227](https://github.com/chmonitor/chmonitor/commit/5aa82274e9cc8e439d834debaa548aa488815c03))
* **saas:** cloud mode with demo hosts, welcome/setup, connection-error help ([#2005](https://github.com/chmonitor/chmonitor/issues/2005)) ([c43f07c](https://github.com/chmonitor/chmonitor/commit/c43f07c2e70743c33e1c5d928e7ec17cd4f69703))
* **security:** add guarded RBAC management ([d723675](https://github.com/chmonitor/chmonitor/commit/d723675a349f2392c9a17d65ae31debb3d90607e))
* **security:** API rate limiting, chart param validation, agent logging ([#1965](https://github.com/chmonitor/chmonitor/issues/1965)) ([1782350](https://github.com/chmonitor/chmonitor/commit/17823503d1a6d6640bc7aa8716f8c36f6271e3c8))
* **settings:** cross-host settings diff + guarded RBAC management ([#1975](https://github.com/chmonitor/chmonitor/issues/1975)) ([d723675](https://github.com/chmonitor/chmonitor/commit/d723675a349f2392c9a17d65ae31debb3d90607e))
* **setup:** clearer docs link on "Connect your ClickHouse" ([#2046](https://github.com/chmonitor/chmonitor/issues/2046)) ([2a1caab](https://github.com/chmonitor/chmonitor/commit/2a1caab03fd1122758fe0b2dc66559616497f4fe))
* **site:** docs homepage as docs overview + landing polish ([#1999](https://github.com/chmonitor/chmonitor/issues/1999)) ([b5e5916](https://github.com/chmonitor/chmonitor/commit/b5e59168a6777f042e11a741fc7c01a7a3507222))
* **telemetry:** collector + default-on opt-out + D1 forever-retention ([#2006](https://github.com/chmonitor/chmonitor/issues/2006)) ([31abb6e](https://github.com/chmonitor/chmonitor/commit/31abb6e0d46c35d9910eb7370609f9fc2139830f))
* **ui:** add Marker + Attachment chat components, Rhea theme, shimmer loader ([#2048](https://github.com/chmonitor/chmonitor/issues/2048)) ([5c6927b](https://github.com/chmonitor/chmonitor/commit/5c6927b2a6cc20d7b28eeafd13cb9e0e605d99b7))
* **ui:** add svgl.app brand logos for AI provider selector ([#2053](https://github.com/chmonitor/chmonitor/issues/2053)) ([55b5eb2](https://github.com/chmonitor/chmonitor/commit/55b5eb2fb18763da73cfecc4b90cfaecf9b5b2f2))
* **ui:** shadcn chat components, Rhea theme, interactive docs GrantBuilder ([#2049](https://github.com/chmonitor/chmonitor/issues/2049)) ([74eb2fd](https://github.com/chmonitor/chmonitor/commit/74eb2fd22e29808a4d3b44a669a8fb31d8613a00))
* **ux:** consistent global time-range, query favorites, bulk explain ([#1973](https://github.com/chmonitor/chmonitor/issues/1973)) ([dbd14b5](https://github.com/chmonitor/chmonitor/commit/dbd14b57048c0d78e793ba99135ba85aa5b8f1bf))
* **ux:** multi-cluster fleet view, log severity/search, command palette ([#1974](https://github.com/chmonitor/chmonitor/issues/1974)) ([bdb0073](https://github.com/chmonitor/chmonitor/commit/bdb0073c9745a3df5b08b33f7a3984b8eca75c22))


### 🐛 Bug Fixes

* **about:** sync src/package.json version with release-please ([#2052](https://github.com/chmonitor/chmonitor/issues/2052)) ([e774c7a](https://github.com/chmonitor/chmonitor/commit/e774c7a5ea29bdda809851f61106b36bed02edd7))
* **agent:** add outermost error boundary to /api/v1/agent so setup throws render as error cards ([#2170](https://github.com/chmonitor/chmonitor/issues/2170)) ([440e451](https://github.com/chmonitor/chmonitor/commit/440e4519db83abd33af396c5e65806ef950f3859))
* **billing:** correct org seat cap off-by-one in Clerk webhook ([#2098](https://github.com/chmonitor/chmonitor/issues/2098)) ([45d253f](https://github.com/chmonitor/chmonitor/commit/45d253f90014bb89413a72c59505be14332c42c9)), closes [#2070](https://github.com/chmonitor/chmonitor/issues/2070)
* **billing:** prune retention by billing owner, not raw user_id ([#2112](https://github.com/chmonitor/chmonitor/issues/2112)) ([b04c69a](https://github.com/chmonitor/chmonitor/commit/b04c69a728f7ca111375850c750044ea9941b4c5))
* **billing:** pull entitlement from Polar (resilient) + provision CHM_CLOUD_D1 ([#2022](https://github.com/chmonitor/chmonitor/issues/2022)) ([f329401](https://github.com/chmonitor/chmonitor/commit/f32940173ce2d5cc50e22a5b933f7a3bd414d46b))
* **billing:** registry-driven "beta included" plan matrix + doc/naming cleanup ([#2100](https://github.com/chmonitor/chmonitor/issues/2100)) ([7d384a5](https://github.com/chmonitor/chmonitor/commit/7d384a56f5c60c63ad61461258e15e1ecfd568f1)), closes [#2075](https://github.com/chmonitor/chmonitor/issues/2075)
* **billing:** resolve BE-2..BE-6 edge cases from epic [#2097](https://github.com/chmonitor/chmonitor/issues/2097) ([#2130](https://github.com/chmonitor/chmonitor/issues/2130)) ([ccae7c1](https://github.com/chmonitor/chmonitor/commit/ccae7c14b575bebf696bf06d3e4b77042351c8c7))
* **billing:** route active subscribers to portal for plan changes ([#2028](https://github.com/chmonitor/chmonitor/issues/2028)) ([4244cd8](https://github.com/chmonitor/chmonitor/commit/4244cd85cbe6e3a9f480aab12a83b808d1f4c948))
* **billing:** route active subscribers to portal for plan changes ([#2031](https://github.com/chmonitor/chmonitor/issues/2031)) ([9bc76ac](https://github.com/chmonitor/chmonitor/commit/9bc76ac253cd4d2a1a535f73e4ce9cd41380a13a))
* **blog:** change v0.3 post URL to /v0.3/ ([#2030](https://github.com/chmonitor/chmonitor/issues/2030)) ([65e88af](https://github.com/chmonitor/chmonitor/commit/65e88af2389fefcab0ce5c482aea5920154e1490))
* **charts:** guard wide query_log scans with max_execution_time + clamp lastHours ([#2109](https://github.com/chmonitor/chmonitor/issues/2109)) ([4686ab0](https://github.com/chmonitor/chmonitor/commit/4686ab0010d29b5738806b38b15c523e2d0f59dd))
* **ci:** pin rust-toolchain to real 1.94.0 (revert bogus 1.100.0) ([#1991](https://github.com/chmonitor/chmonitor/issues/1991)) ([9500241](https://github.com/chmonitor/chmonitor/commit/9500241b29ea4c3828787dcf6d9bee700e24155a))
* **cloud:** stop signed-in zero-connection users seeing demo host data ([#2171](https://github.com/chmonitor/chmonitor/issues/2171)) ([ab4c344](https://github.com/chmonitor/chmonitor/commit/ab4c3442684db43fc1d77a5c10a02dadd762d398))
* **dashboard:** route no-host users to /setup; tidy sidebar first-run UX ([#2017](https://github.com/chmonitor/chmonitor/issues/2017)) ([d9c3657](https://github.com/chmonitor/chmonitor/commit/d9c3657831a19bb50e24e36f841f9374ee461ecf))
* **deploy:** emit concrete mode vars so cloud anon read-only demo works ([#2012](https://github.com/chmonitor/chmonitor/issues/2012)) ([d68d3e2](https://github.com/chmonitor/chmonitor/commit/d68d3e2b60144c0039f01d3bd7a9dea313f41ee0))
* **deps:** update dependency astro to v7 ([#1992](https://github.com/chmonitor/chmonitor/issues/1992)) ([fd1669e](https://github.com/chmonitor/chmonitor/commit/fd1669e0346333e3f8a4b941758c937db231b911))
* **deps:** update dependency fumadocs-twoslash to v3 ([#1993](https://github.com/chmonitor/chmonitor/issues/1993)) ([e7be18d](https://github.com/chmonitor/chmonitor/commit/e7be18d502048633d573d6409b77e0e0bbf01b5a))
* **deps:** update dependency lucide-react to v1 ([#1994](https://github.com/chmonitor/chmonitor/issues/1994)) ([e3193b0](https://github.com/chmonitor/chmonitor/commit/e3193b03fe30fe17dfe25fdeedbf8dd2f08296d9))
* **docs:** correct deploy/env-var drift + add build-vs-runtime guide ([#1956](https://github.com/chmonitor/chmonitor/issues/1956)) ([2ddf854](https://github.com/chmonitor/chmonitor/commit/2ddf8540d34e873d68ebe8163f275fa497f7f276))
* **docs:** restore Deploy & Operate tab (add tab landings) ([#1986](https://github.com/chmonitor/chmonitor/issues/1986)) ([7d00720](https://github.com/chmonitor/chmonitor/commit/7d00720d2d6a1f83880d9f4a86428d187fd7506c))
* **health:** harden webhook proxy against SSRF ([#2089](https://github.com/chmonitor/chmonitor/issues/2089)) ([1633f7a](https://github.com/chmonitor/chmonitor/commit/1633f7ae0419d3fc22658da51c9bd7a6df8c2cc5))
* **health:** persist alert escalation state and add recovery dispatch ([#2090](https://github.com/chmonitor/chmonitor/issues/2090)) ([55126de](https://github.com/chmonitor/chmonitor/commit/55126de812752e667afa0705323816e456511cc4)), closes [#2080](https://github.com/chmonitor/chmonitor/issues/2080)
* **heatmap:** prevent error 1016 on year-long query_log scan ([#2050](https://github.com/chmonitor/chmonitor/issues/2050)) ([ec86491](https://github.com/chmonitor/chmonitor/commit/ec86491bcd168b2e8dae3e3f8a00ad2242e2e477))
* **insights:** skip LLM enrichment on auto-generate to cut cost ([#2188](https://github.com/chmonitor/chmonitor/issues/2188)) ([0b449ef](https://github.com/chmonitor/chmonitor/commit/0b449efcc7e6496a752f9d41f5385d7fdde4a08b))
* **landing:** add @astrojs/sitemap to lockfile ([#1964](https://github.com/chmonitor/chmonitor/issues/1964)) ([bda9051](https://github.com/chmonitor/chmonitor/commit/bda90514967c5d109f9c1a75cc433606a89e363a))
* **landing:** add page h1s and tighten copy on marketing pages ([#2086](https://github.com/chmonitor/chmonitor/issues/2086)) ([b005073](https://github.com/chmonitor/chmonitor/commit/b005073e39de091d9f79bf136091cf91e31c1cc5)), closes [#2062](https://github.com/chmonitor/chmonitor/issues/2062)
* **landing:** badge spacing + equal-height pricing headings ([#2016](https://github.com/chmonitor/chmonitor/issues/2016)) ([560422b](https://github.com/chmonitor/chmonitor/commit/560422b1ad4d869216997009e8a2357ae6133585))
* **landing:** correct cd dir in deploy install snippets ([#2082](https://github.com/chmonitor/chmonitor/issues/2082)) ([4296ceb](https://github.com/chmonitor/chmonitor/commit/4296ceb0c99ccb82b1bc118b1a635de27cb5fb38)), closes [#2059](https://github.com/chmonitor/chmonitor/issues/2059)
* **landing:** equal-height pricing cards ([#1998](https://github.com/chmonitor/chmonitor/issues/1998)) ([b59d9ef](https://github.com/chmonitor/chmonitor/commit/b59d9ef2753965984380d1c4e663590ef2747e67))
* **landing:** remove duplicate $ on struck-through yearly price ([#2044](https://github.com/chmonitor/chmonitor/issues/2044)) ([39c650b](https://github.com/chmonitor/chmonitor/commit/39c650b16a32694a8b93a6e5801195dc2d6fe421))
* **landing:** render gallery screenshots + add Features jump menu ([#2134](https://github.com/chmonitor/chmonitor/issues/2134)) ([0d4537c](https://github.com/chmonitor/chmonitor/commit/0d4537c23dbd8e3f59b68d3fea581318bb31814d))
* **landing:** standardize pricing CTAs and derive annual savings copy ([#2083](https://github.com/chmonitor/chmonitor/issues/2083)) ([d7cd1c6](https://github.com/chmonitor/chmonitor/commit/d7cd1c628fad1c3e8f0d23fc89e65404d7ab7db6))
* **landing:** unstretch feature screenshots + compact community & pricing ([#2168](https://github.com/chmonitor/chmonitor/issues/2168)) ([b29e4c8](https://github.com/chmonitor/chmonitor/commit/b29e4c8e601a4725d5b3bbadb6004963021770e3))
* **query-config:** sync declarative catalog parity for merges/mutations/part-info ([#1966](https://github.com/chmonitor/chmonitor/issues/1966)) ([25f283d](https://github.com/chmonitor/chmonitor/commit/25f283d81c550c3ef4b45b9dd0cdec5acd1b9f38))
* **query:** edge-case fixes Q-B..Q-E for [#2096](https://github.com/chmonitor/chmonitor/issues/2096) ([#2129](https://github.com/chmonitor/chmonitor/issues/2129)) ([74ddb65](https://github.com/chmonitor/chmonitor/commit/74ddb6574025632b38f92fdade2fe8d8b7986c45))
* **routes:** register OG metadata for blob-storage-log, storage-economics, query-condition-cache ([#1968](https://github.com/chmonitor/chmonitor/issues/1968)) ([3f24339](https://github.com/chmonitor/chmonitor/commit/3f243392a2bbab09ced83694b48081f9e39469f6))
* **rust:** return errors instead of panicking on bad input ([#2165](https://github.com/chmonitor/chmonitor/issues/2165)) ([4469f64](https://github.com/chmonitor/chmonitor/commit/4469f6495b67f8f75663df0a0a837e4a92c91f75))
* **security:** gate anonymous writes on settings + insights generate ([#2107](https://github.com/chmonitor/chmonitor/issues/2107)) ([8fde649](https://github.com/chmonitor/chmonitor/commit/8fde64939a8bd4122bc5dee84b79766970903041))
* **security:** guard non-v1 mutating routes against anonymous access ([#2110](https://github.com/chmonitor/chmonitor/issues/2110)) ([9ec2b2d](https://github.com/chmonitor/chmonitor/commit/9ec2b2de1347e23628858728d4e4d0d7d3be4d5e))
* **security:** harden MCP custom-server SSRF guard ([#2113](https://github.com/chmonitor/chmonitor/issues/2113)) ([edb54c3](https://github.com/chmonitor/chmonitor/commit/edb54c3872e646a64866fa5c4db88ab21e6ab77c))
* **security:** per-identity agent rate limit, withQueryParams escaping, least-privilege docs ([#2131](https://github.com/chmonitor/chmonitor/issues/2131)) ([4f9b92d](https://github.com/chmonitor/chmonitor/commit/4f9b92de86644023d7e08d9672d7dff0e0e9d185))
* **skills:** allowlist domain skills in registry generator to prevent leak ([#2161](https://github.com/chmonitor/chmonitor/issues/2161)) ([e6333a4](https://github.com/chmonitor/chmonitor/commit/e6333a4bf16471a6974e48ffa2090623da9fcc9f))


### ⚡ Performance

* **agent:** extend prompt caching to AnyRouter Anthropic path ([#2193](https://github.com/chmonitor/chmonitor/issues/2193)) ([38fc36d](https://github.com/chmonitor/chmonitor/commit/38fc36d99723d20ebcde55438375787d260eb991))
* **billing:** negative-cache free users' Polar entitlement reads ([#2032](https://github.com/chmonitor/chmonitor/issues/2032)) ([690be21](https://github.com/chmonitor/chmonitor/commit/690be21bb14c089a6d4f30102a292cccb0edf335))
* **clickhouse-client:** skip eager JSON.stringify & config redaction in hot path ([#2194](https://github.com/chmonitor/chmonitor/issues/2194)) ([cba2ac2](https://github.com/chmonitor/chmonitor/commit/cba2ac2153aa3600765356ad7862dc6de08335d2)), closes [#2174](https://github.com/chmonitor/chmonitor/issues/2174)
* **feature-permissions:** memoize AppConfig per isolate ([#2190](https://github.com/chmonitor/chmonitor/issues/2190)) ([c907f04](https://github.com/chmonitor/chmonitor/commit/c907f04feee9812ab48202ca2e7c0c057c1285ad))
* **query:** cap retries on non-critical always-on polls ([#2180](https://github.com/chmonitor/chmonitor/issues/2180)) ([#2191](https://github.com/chmonitor/chmonitor/issues/2191)) ([fff9b75](https://github.com/chmonitor/chmonitor/commit/fff9b75c0d361145897c94cd1718c84382b37fdd))
* **swr:** make always-mounted polling hooks visibility-aware ([#2189](https://github.com/chmonitor/chmonitor/issues/2189)) ([5422166](https://github.com/chmonitor/chmonitor/commit/5422166954e548aeffb74c35252f5fae6ae5fefc))


### ♻️ Refactoring

* **billing:** centralize pricing + AI message model, self-host fonts ([#2036](https://github.com/chmonitor/chmonitor/issues/2036)) ([472358d](https://github.com/chmonitor/chmonitor/commit/472358d53721ae12df8aa13a3f9e92128572a746))
* **config:** CHM_DEPLOYMENT_MODE — simpler env config + OSS-clean repo ([#2011](https://github.com/chmonitor/chmonitor/issues/2011)) ([15e4a85](https://github.com/chmonitor/chmonitor/commit/15e4a8578d9c2e3a340b6d67251029a616466988))
* **deploy:** single-source wrangler name/routes + mode-default matrix ([#2111](https://github.com/chmonitor/chmonitor/issues/2111)) ([4b58f97](https://github.com/chmonitor/chmonitor/commit/4b58f97ec8bbaa0e02097839878acc55b4ebbd98))
* **docs:** simplify sidebar nav dropdowns + finish rebrand misses ([#2001](https://github.com/chmonitor/chmonitor/issues/2001)) ([45d3223](https://github.com/chmonitor/chmonitor/commit/45d32230373a2829355a16c84708ac5545f5d5c7))
* **health:** use shared classifyValue for severity thresholds ([#2087](https://github.com/chmonitor/chmonitor/issues/2087)) ([65ada4a](https://github.com/chmonitor/chmonitor/commit/65ada4a2d34fca9561ec6952326b0a61467f9010)), closes [#2081](https://github.com/chmonitor/chmonitor/issues/2081)
* **insights:** split insights-settings-form into section sub-forms ([#2108](https://github.com/chmonitor/chmonitor/issues/2108)) ([74753b9](https://github.com/chmonitor/chmonitor/commit/74753b931a892ccea20d34ac6bf4712964867f1c)), closes [#2069](https://github.com/chmonitor/chmonitor/issues/2069)
* **saas:** share isServerHost helper; dedup demo badge + docs footer ([#2008](https://github.com/chmonitor/chmonitor/issues/2008)) ([3d4be45](https://github.com/chmonitor/chmonitor/commit/3d4be45c000e10fd1da4ffe78c11798bc8d42ef2))
* **security:** split management route into dedicated components ([#2105](https://github.com/chmonitor/chmonitor/issues/2105)) ([a066336](https://github.com/chmonitor/chmonitor/commit/a066336de02f670afa329faf0ed1bb30d0da43e1)), closes [#2068](https://github.com/chmonitor/chmonitor/issues/2068)

## [0.2.11](https://github.com/chmonitor/chmonitor/compare/v0.2.10...v0.2.11) (2026-06-23)


### ✨ Features

* **agent:** persist MCP server config to localStorage ([#1833](https://github.com/chmonitor/chmonitor/issues/1833)) ([723f7b3](https://github.com/chmonitor/chmonitor/commit/723f7b33b65420ecb607ebb843bff4efab6dad67))
* **ai-insights:** redesign panel + persist & auto-load insights + settings link ([#1819](https://github.com/chmonitor/chmonitor/issues/1819)) ([bc9d633](https://github.com/chmonitor/chmonitor/commit/bc9d633bb7163890d8b2a88fde35ef0d508b4f30))
* **alerts:** browser notifications on by default (out-of-box, opt-out) ([#1858](https://github.com/chmonitor/chmonitor/issues/1858)) ([6a21a28](https://github.com/chmonitor/chmonitor/commit/6a21a2846d7ead4e15c5aba5f9120816408ff81c))
* **auth:** add 'trusted' reverse-proxy auth mode with forwarded identity ([#1755](https://github.com/chmonitor/chmonitor/issues/1755)) ([094391a](https://github.com/chmonitor/chmonitor/commit/094391a60df8c99dd0fc371c85932c32e85de587))
* **auth:** show "via trusted proxy" source label in sidebar user menu ([#1824](https://github.com/chmonitor/chmonitor/issues/1824)) ([3193f89](https://github.com/chmonitor/chmonitor/commit/3193f895998e1d2bce4393d213c2bc3bfda9803b))
* **expensive-queries:** total-time sort, metric bars, and cluster-load summary ([#1827](https://github.com/chmonitor/chmonitor/issues/1827)) ([f7d3830](https://github.com/chmonitor/chmonitor/commit/f7d3830bcc28f1e0f1b8e9922a8f3654249b1515))
* **explain:** syntax highlighting, FORMAT/semicolon tolerance, multi-query tabs ([#1826](https://github.com/chmonitor/chmonitor/issues/1826)) ([41e8e8b](https://github.com/chmonitor/chmonitor/commit/41e8e8bc984bd5ee3d7979c717ff9af9c90d28e3))
* **insights-settings:** redesign page — searchable model picker w/ provider icons + docs links ([#1820](https://github.com/chmonitor/chmonitor/issues/1820)) ([8be8555](https://github.com/chmonitor/chmonitor/commit/8be8555133ca8ea9b6c393b19b615e760ce3255f))
* **insights:** add AI insights panel to /insights page, merge plans into docs ([2ba9fe4](https://github.com/chmonitor/chmonitor/commit/2ba9fe49180c9fe917009363a044378f2d3514ea))
* **insights:** AI Insights settings page + panel link, wired into generation ([#1782](https://github.com/chmonitor/chmonitor/issues/1782)) ([6bfd0aa](https://github.com/chmonitor/chmonitor/commit/6bfd0aa34d6eb37af5d9ecbd595890be17a9a152))
* **insights:** configurable AI insight generation (model, prompt style, enrichment) ([#1767](https://github.com/chmonitor/chmonitor/issues/1767)) ([8ef2977](https://github.com/chmonitor/chmonitor/commit/8ef2977a186dd4a5b1cd24c270acb2e6ed4cf3c8))
* **insights:** global AI Insights header popover on every page ([#1783](https://github.com/chmonitor/chmonitor/issues/1783)) ([c04f2fa](https://github.com/chmonitor/chmonitor/commit/c04f2fa1653d3e4add070e4c1259dc0798f9d6da))
* **insights:** pluggable AI Insights storage backends ([#1797](https://github.com/chmonitor/chmonitor/issues/1797)) ([7cdd146](https://github.com/chmonitor/chmonitor/commit/7cdd146a6d175aad8d74c185c5b2858896b1a08b))
* **insights:** preview generation with current settings on the settings page ([#1786](https://github.com/chmonitor/chmonitor/issues/1786)) ([039a5d2](https://github.com/chmonitor/chmonitor/commit/039a5d2c6dae1312dd290fb6d77e9dcf7075c9ec))
* **insights:** redesign settings — templates, icon grid, side-by-side live example ([#1790](https://github.com/chmonitor/chmonitor/issues/1790)) ([5f2e3dc](https://github.com/chmonitor/chmonitor/commit/5f2e3dc5e2cd78480b94faaba54d81077e4e55c7))
* **insights:** surface enrichment availability + default model in settings ([#1787](https://github.com/chmonitor/chmonitor/issues/1787)) ([463c825](https://github.com/chmonitor/chmonitor/commit/463c8255e3da190487f75a84ba8b448eb29f7029))
* **seo:** complete docs icon set + add robots.txt to docs & dashboard ([#1837](https://github.com/chmonitor/chmonitor/issues/1837)) ([0062a09](https://github.com/chmonitor/chmonitor/commit/0062a09d7c49ab5dad549c4f13f4a708154d0e5a))
* **seo:** keyword-rich descriptions + schema.org structured data ([#1838](https://github.com/chmonitor/chmonitor/issues/1838)) ([e4f832f](https://github.com/chmonitor/chmonitor/commit/e4f832f00c442a9791384788f5a467afeff21ba2))
* **sql-console:** multi-query results, database picker, tree sidebar, buttons below editor ([#1822](https://github.com/chmonitor/chmonitor/issues/1822)) ([e5de0a8](https://github.com/chmonitor/chmonitor/commit/e5de0a878e17af878870fd9567f36de17ac5a603))
* **ui:** overview design pass — palette, cards, chart colors, heatmap ([#1836](https://github.com/chmonitor/chmonitor/issues/1836)) ([b148009](https://github.com/chmonitor/chmonitor/commit/b14800987ecee5663df5886a9c12c0f8c56e1a34))


### 🐛 Bug Fixes

* **a11y:** add aria-labels to icon-only buttons ([#1874](https://github.com/chmonitor/chmonitor/issues/1874)) ([cf930ab](https://github.com/chmonitor/chmonitor/commit/cf930abafca2a2456a1821108eb17ebb0b97e1f7))
* **agent-api:** gate unconditional debug logs behind AGENT_DEBUG_LOGS ([#1791](https://github.com/chmonitor/chmonitor/issues/1791)) ([e15cd7a](https://github.com/chmonitor/chmonitor/commit/e15cd7a5653e6d4dda55c5182fc2067a76a2b655))
* **agent:** explain_query use EXPLAIN PLAN indexes=1 for indexes mode ([#1781](https://github.com/chmonitor/chmonitor/issues/1781)) ([25795e5](https://github.com/chmonitor/chmonitor/commit/25795e5b6c76f79b705e1d03d55d66ff0588d90d))
* **agent:** explore_table_schema query valid system.parts columns ([#1780](https://github.com/chmonitor/chmonitor/issues/1780)) ([e8d6f6c](https://github.com/chmonitor/chmonitor/commit/e8d6f6cb1e4b897427ba42ccb18dfa53668ddadb))
* **agents:** wire MCP panel status to real /api/v1/mcp/info data ([#1831](https://github.com/chmonitor/chmonitor/issues/1831)) ([03ca2d8](https://github.com/chmonitor/chmonitor/commit/03ca2d858515256e3549bbe1fc48678d2c90f2ff))
* **api:** gate /api/health metadata on genuine auth, not public-read ([#1834](https://github.com/chmonitor/chmonitor/issues/1834)) ([a61dfc6](https://github.com/chmonitor/chmonitor/commit/a61dfc67120d11e320d613d71c52ec4e040cbee9))
* **api:** harden actions/explain/explorer input & output handling ([#1785](https://github.com/chmonitor/chmonitor/issues/1785)) ([4f1b4ea](https://github.com/chmonitor/chmonitor/commit/4f1b4ea6ef8f90b7058816c48e2c388acf32ac85))
* **api:** hide deployment metadata from anonymous /api/health callers ([#1829](https://github.com/chmonitor/chmonitor/issues/1829)) ([f0905ee](https://github.com/chmonitor/chmonitor/commit/f0905eef41fb9ae50169de35b31749d860c03cbc))
* **api:** reject negative and fractional hostId at route boundary ([#1760](https://github.com/chmonitor/chmonitor/issues/1760)) ([214389c](https://github.com/chmonitor/chmonitor/commit/214389c094a0b664013c61241f5f9c3489070e09))
* **api:** return 503/504 for unreachable ClickHouse upstream, not 500 ([#1840](https://github.com/chmonitor/chmonitor/issues/1840)) ([2064493](https://github.com/chmonitor/chmonitor/commit/2064493edb200585f9ab2d5f11aca6df7ba90cd1))
* **api:** return 503/504 for unreachable ClickHouse upstream, not 500 ([#1841](https://github.com/chmonitor/chmonitor/issues/1841)) ([1412df1](https://github.com/chmonitor/chmonitor/commit/1412df1092a9eea440ace7023d2caf8034cafb14))
* **auth:** gate sidebar identity on runtime auth provider, not build-time ([#1812](https://github.com/chmonitor/chmonitor/issues/1812)) ([ee77b94](https://github.com/chmonitor/chmonitor/commit/ee77b94750ca968ffaa819d070f2f41599261a3c))
* **ci:** label apps/dashboard as 'app: dashboard', not legacy ([#1886](https://github.com/chmonitor/chmonitor/issues/1886)) ([3949b3a](https://github.com/chmonitor/chmonitor/commit/3949b3ae14bace0346e1a37f2447800d5c167633))
* **ci:** retry transient Cloudflare 10215 conflict when setting worker secrets ([#1896](https://github.com/chmonitor/chmonitor/issues/1896)) ([d7d2872](https://github.com/chmonitor/chmonitor/commit/d7d287219101d6536a25f647a20a52db79b046a0))
* **ci:** skip dashboard deploy steps for dependabot PRs ([#1835](https://github.com/chmonitor/chmonitor/issues/1835)) ([bcc1fc8](https://github.com/chmonitor/chmonitor/commit/bcc1fc8cee194040821225dcb834c98ab2f90177)), closes [#1809](https://github.com/chmonitor/chmonitor/issues/1809)
* **clickhouse-client:** default to web client on all runtimes (Docker fix) ([#1752](https://github.com/chmonitor/chmonitor/issues/1752)) ([a1970ed](https://github.com/chmonitor/chmonitor/commit/a1970ed0557aac7ff1fe6b63e9553e583bcf5536))
* **clickhouse-client:** honor versioned queryConfig.sql[] in fetchJsonEachRowAsNormalizedJson ([#1806](https://github.com/chmonitor/chmonitor/issues/1806)) ([b1fb977](https://github.com/chmonitor/chmonitor/commit/b1fb9770950d903661905f5c3dc78d2c3aa8a340))
* **dashboard-storage:** remove dead [@ts-expect-error](https://github.com/ts-expect-error) directives ([7f420ae](https://github.com/chmonitor/chmonitor/commit/7f420ae265807d3cabbb012edd06c9d831adfdb3))
* **dashboard:** repair dev-mode crashes + UI/UX audit a11y/error fixes ([#1814](https://github.com/chmonitor/chmonitor/issues/1814)) ([fc2e66d](https://github.com/chmonitor/chmonitor/commit/fc2e66d2115e808e1e8513b6b993a4a2b67faebf))
* **insights:** render generated insights immediately, independent of persistence ([#1792](https://github.com/chmonitor/chmonitor/issues/1792)) ([6855eb8](https://github.com/chmonitor/chmonitor/commit/6855eb890ad2ff56d81ab61974253d07105a917a))
* **lint:** apply biome auto-fixes to test files ([9efa76f](https://github.com/chmonitor/chmonitor/commit/9efa76f99c2c566be6415fe9d622685eaa9dc021))
* **mcp:** secure-by-default — deny anonymous access unless CHM_MCP_PUBLIC=true ([#1830](https://github.com/chmonitor/chmonitor/issues/1830)) ([5109f56](https://github.com/chmonitor/chmonitor/commit/5109f5681fd70b7523e7c53e90ba7b119533f72a))
* **mutations:** redesign sparse summary cards with denser hierarchy + empty state ([#1817](https://github.com/chmonitor/chmonitor/issues/1817)) ([1e612f1](https://github.com/chmonitor/chmonitor/commit/1e612f17a823b37552c17da463341c02d0beac51))
* **query-config:** query-metric-log 500 on modern ClickHouse (aggregate alias in WHERE) ([#1815](https://github.com/chmonitor/chmonitor/issues/1815)) ([32d2d34](https://github.com/chmonitor/chmonitor/commit/32d2d34c7953473df7c999853177850b79fbed6a))
* **query-config:** query-metric-log 500 on modern ClickHouse (aggregate alias in WHERE) ([#1816](https://github.com/chmonitor/chmonitor/issues/1816)) ([72544d0](https://github.com/chmonitor/chmonitor/commit/72544d0de712ae3af2c3e57ec14b9c9a668d7acc))
* **security:** constant-time CRON_SECRET comparison in health-sweep ([#1893](https://github.com/chmonitor/chmonitor/issues/1893)) ([72f93b2](https://github.com/chmonitor/chmonitor/commit/72f93b23379b24b4e4a422e4f3a30908765d74ea))
* **security:** redact ClickHouse error details from action API responses ([#1894](https://github.com/chmonitor/chmonitor/issues/1894)) ([6f20ae9](https://github.com/chmonitor/chmonitor/commit/6f20ae933d916adb01472ee189050fb155271cba))
* **seo:** inject JSON-LD via effect to avoid hydration mismatch ([#1839](https://github.com/chmonitor/chmonitor/issues/1839)) ([f0da6bc](https://github.com/chmonitor/chmonitor/commit/f0da6bc9b4e94fcd4baa3fe6631311e3292eba7c))
* **sql-builder:** add splitSqlStatements source for orphaned test on main ([#1821](https://github.com/chmonitor/chmonitor/issues/1821)) ([c4355ba](https://github.com/chmonitor/chmonitor/commit/c4355bad43c408d5a0929bc80c8596b7b7461b52))
* **sql-builder:** only strip trailing FORMAT for known ClickHouse formats ([#1828](https://github.com/chmonitor/chmonitor/issues/1828)) ([a5fded5](https://github.com/chmonitor/chmonitor/commit/a5fded54dac1e1cd70fff42c68d41a39f1d25bb2))
* **sql-validator:** stop rejecting legitimate read-only queries ([#1758](https://github.com/chmonitor/chmonitor/issues/1758)) ([ee4894b](https://github.com/chmonitor/chmonitor/commit/ee4894be88fa684053ab44326fb79f3871965289))
* **ui:** align chart skeleton min-height to loaded chart to cut CLS ([#1865](https://github.com/chmonitor/chmonitor/issues/1865)) ([8adc563](https://github.com/chmonitor/chmonitor/commit/8adc5636c0fcd59d2f14b21aa435247a3bad44c2))
* **ui:** prevent mobile horizontal overflow on toolbar + explain tabs ([#1864](https://github.com/chmonitor/chmonitor/issues/1864)) ([9eb5216](https://github.com/chmonitor/chmonitor/commit/9eb5216eb042ba9d63ac9c430e5e245ee62e992f))
* **ui:** tabular-nums on live/columnar numeric displays ([#1875](https://github.com/chmonitor/chmonitor/issues/1875)) ([9713041](https://github.com/chmonitor/chmonitor/commit/9713041cc6b6f0141c618fa0ede32538bc739ac1))


### ⚡ Performance

* **charts:** lazy-load chart-error diagnostics dialog (react-markdown) ([#1877](https://github.com/chmonitor/chmonitor/issues/1877)) ([1a5fb4a](https://github.com/chmonitor/chmonitor/commit/1a5fb4ae817fb9e6f46c5b5c99dc1d66d72b8872))
* **charts:** use REFRESH_INTERVAL presets for refresh intervals ([#1772](https://github.com/chmonitor/chmonitor/issues/1772)) ([#1811](https://github.com/chmonitor/chmonitor/issues/1811)) ([4192e50](https://github.com/chmonitor/chmonitor/commit/4192e50286f4c49eac98b2871ab63007acdaf9e0))
* **data-table:** memoize render-path allocations ([#1771](https://github.com/chmonitor/chmonitor/issues/1771)) ([#1810](https://github.com/chmonitor/chmonitor/issues/1810)) ([72c6273](https://github.com/chmonitor/chmonitor/commit/72c6273873c123cb205c1bc55105f07599e808e5))
* **keeper:** memoize cluster grouping + React.memo NodeCard ([#1876](https://github.com/chmonitor/chmonitor/issues/1876)) ([332252d](https://github.com/chmonitor/chmonitor/commit/332252d4b913007390f8d0a6d3ff2cd876350282))
* **overview:** memoize OverviewChart and tab chart filters ([#1895](https://github.com/chmonitor/chmonitor/issues/1895)) ([5be08c4](https://github.com/chmonitor/chmonitor/commit/5be08c4b002a0eb7107acd94f3dd4d2c9871921b))
* **running-queries:** memoize chart transforms with useMemo ([#1857](https://github.com/chmonitor/chmonitor/issues/1857)) ([1595ed1](https://github.com/chmonitor/chmonitor/commit/1595ed1d279a9371842709c3bcb39e78a7499769))


### ♻️ Refactoring

* **charts:** collapse charts to compact row instead of hiding ([#1818](https://github.com/chmonitor/chmonitor/issues/1818)) ([3547aa1](https://github.com/chmonitor/chmonitor/commit/3547aa184ab3beeacd29ca9c494ec4fbbc106309))
* **charts:** use REFRESH_INTERVAL constant in data-freshness ([#1799](https://github.com/chmonitor/chmonitor/issues/1799)) ([#1801](https://github.com/chmonitor/chmonitor/issues/1801)) ([359c450](https://github.com/chmonitor/chmonitor/commit/359c450b57324c1d616a8157b71bb634ce051b03))
* **clickhouse-client:** remove dead query() helper (Workers trap) ([#1789](https://github.com/chmonitor/chmonitor/issues/1789)) ([bb02046](https://github.com/chmonitor/chmonitor/commit/bb0204604f0135e474cbe17b5c09df66a03854aa))
* dedup formatDuration + tighten data-table types (review-ready, supersedes [#1823](https://github.com/chmonitor/chmonitor/issues/1823)) ([#1825](https://github.com/chmonitor/chmonitor/issues/1825)) ([5f14b25](https://github.com/chmonitor/chmonitor/commit/5f14b254e1283779ec57885b359b4c261eabedf5))
* **docs:** replace custom theme with native Astro Starlight ([#1757](https://github.com/chmonitor/chmonitor/issues/1757)) ([32b2841](https://github.com/chmonitor/chmonitor/commit/32b28418f48d4fd871f3ff34a1ad0e59bed30ebe))
* **insights:** redesign insight card with tinted icon box ([978e011](https://github.com/chmonitor/chmonitor/commit/978e0114a7b722b3f5c2aae78ab108bbc544b866))
* remove deprecated variants property from QueryConfig type schema ([#1765](https://github.com/chmonitor/chmonitor/issues/1765)) ([14a5ff4](https://github.com/chmonitor/chmonitor/commit/14a5ff4d8d015b06fbe3debdf409b614b66e6634))

## [0.2.10](https://github.com/chmonitor/chmonitor/compare/v0.2.9...v0.2.10) (2026-06-18)


### ✨ Features

* **agent:** add AgentState as a conversation-history backend option ([#1673](https://github.com/chmonitor/chmonitor/issues/1673)) ([9080602](https://github.com/chmonitor/chmonitor/commit/90806029d694550188690c022694df550a196b2f))
* **agent:** add scatter/radial/bar-list chart types to chat visualization ([#1658](https://github.com/chmonitor/chmonitor/issues/1658)) ([a9b8a3f](https://github.com/chmonitor/chmonitor/commit/a9b8a3f4e190e5b647fd25865a9d06cc5de7c8f6))
* **agent:** expand skill library with 9 new skills ([#1655](https://github.com/chmonitor/chmonitor/issues/1655)) ([3accc86](https://github.com/chmonitor/chmonitor/commit/3accc861121f0a3e9ed5749e0b952588e36efc74))
* **agent:** route AnyRouter upstream through @anyr/ai-sdk-provider ([#1682](https://github.com/chmonitor/chmonitor/issues/1682)) ([eec305e](https://github.com/chmonitor/chmonitor/commit/eec305e5cdad133dbcba1941732128a5d22151fc))
* **agent:** route prod conversations to AgentState backend ([#1731](https://github.com/chmonitor/chmonitor/issues/1731)) ([cf15bbb](https://github.com/chmonitor/chmonitor/commit/cf15bbb9286bc62d9db284cc671347abffd64ba8))
* **auth:** add SSO/SAML scaffold (enterprise-gated, community inert) ([#1700](https://github.com/chmonitor/chmonitor/issues/1700)) ([c948e3f](https://github.com/chmonitor/chmonitor/commit/c948e3f0e6248ea693a68449ed8de45d745c6ff0))
* **brand:** flatten chmonitor mark across landing, docs & dashboard ([#1661](https://github.com/chmonitor/chmonitor/issues/1661)) ([5277eec](https://github.com/chmonitor/chmonitor/commit/5277eec480bd4937f4f143925a74bfdbcdf0b933))
* **brand:** use chmonitor mark in host switcher ([#1662](https://github.com/chmonitor/chmonitor/issues/1662)) ([7873e44](https://github.com/chmonitor/chmonitor/commit/7873e44617716e32823f0c1eceb2c6dfa9204798))
* **ch-capabilities:** add capability-diff report formatter (Plan 10c offline) ([#1724](https://github.com/chmonitor/chmonitor/issues/1724)) ([ff6f7da](https://github.com/chmonitor/chmonitor/commit/ff6f7da2d9ddb5bf5ceb1a0dc498ffffd6c2a480))
* **ch-compat:** add capability discovery + diff harness ([#1703](https://github.com/chmonitor/chmonitor/issues/1703)) ([e7b279d](https://github.com/chmonitor/chmonitor/commit/e7b279d17ee44075230e964f22fbdb52c725e431))
* **charts:** redesign query activity heatmap as github-style year calendar ([5f9f137](https://github.com/chmonitor/chmonitor/commit/5f9f137f2b247383a376483da46600eeeec43113))
* **ci:** add Claude Code GitHub Workflow ([#1664](https://github.com/chmonitor/chmonitor/issues/1664)) ([08f4ea4](https://github.com/chmonitor/chmonitor/commit/08f4ea435bb85af28e7defa3733cc6c8649c1bf8))
* **deploy:** add Railway/Render/Fly one-click templates ([#1708](https://github.com/chmonitor/chmonitor/issues/1708)) ([e61d41c](https://github.com/chmonitor/chmonitor/commit/e61d41c7c7b6b05c604e929c17c9ad16dec754c5))
* **docs:** generate ClickHouse platform support matrix ([#1702](https://github.com/chmonitor/chmonitor/issues/1702)) ([a7d1deb](https://github.com/chmonitor/chmonitor/commit/a7d1deb682e09774488f2a1893189a975861b19a))
* **docs:** redirect /docs to docs.chmonitor.dev, remove in-app reader ([#1663](https://github.com/chmonitor/chmonitor/issues/1663)) ([6eea45b](https://github.com/chmonitor/chmonitor/commit/6eea45b8676be1cef1bc13d873fad651c3de5fe3))
* **edition:** add open-core edition module (default community, fail-open) ([#1690](https://github.com/chmonitor/chmonitor/issues/1690)) ([cc78c22](https://github.com/chmonitor/chmonitor/commit/cc78c22f82b351584ff3a1eca08d09bda8e062df))
* **health:** redesign Health Summary with severity banner, filters & sparklines ([#1680](https://github.com/chmonitor/chmonitor/issues/1680)) ([24d6765](https://github.com/chmonitor/chmonitor/commit/24d6765a4a81d16de886a333efee2bf16c8a6ec5))
* **helm:** publish chart to OCI and GitHub Pages on release ([8636352](https://github.com/chmonitor/chmonitor/commit/8636352952ac2548b74edc8c89e6fa6099c74c49))
* **helm:** serve chart repo via Cloudflare Pages at charts.chmonitor.dev ([#1747](https://github.com/chmonitor/chmonitor/issues/1747)) ([a5c5d1e](https://github.com/chmonitor/chmonitor/commit/a5c5d1e38999124f7ee00d9acf84c583fafce791))
* **landing:** add chmonitor logo system + /brand page ([#1660](https://github.com/chmonitor/chmonitor/issues/1660)) ([77d15d3](https://github.com/chmonitor/chmonitor/commit/77d15d3106fd11fb49aa199b6b6bfba7c2f0c1d3))
* **menu:** surface 5 orphaned pages in navigation ([#1735](https://github.com/chmonitor/chmonitor/issues/1735)) ([762d915](https://github.com/chmonitor/chmonitor/commit/762d9155c2df1243ec3b8f71b741843f0b6b02c7))
* **overview:** add multi-disk Disk Usage breakdown card ([#1674](https://github.com/chmonitor/chmonitor/issues/1674)) ([f1fafa1](https://github.com/chmonitor/chmonitor/commit/f1fafa122c93bf92e20ef102b1f64bd961e5d33b))
* **overview:** break Query Activity Heatmap into compact per-month blocks ([#1725](https://github.com/chmonitor/chmonitor/issues/1725)) ([d491024](https://github.com/chmonitor/chmonitor/commit/d49102433e99c4811eb233fe3629bea6a0bfcee6))
* **overview:** icons on heatmap metric pills, compact KPI cards, hidden scrollbar ([#1727](https://github.com/chmonitor/chmonitor/issues/1727)) ([93eae72](https://github.com/chmonitor/chmonitor/commit/93eae72bf0a10e4d598d67b889cb370430c518c7))
* **overview:** move query activity heatmap to top, full width ([#1668](https://github.com/chmonitor/chmonitor/issues/1668)) ([d6d4876](https://github.com/chmonitor/chmonitor/commit/d6d4876c11a8dd7b8deb194944a379cae688268f))
* **overview:** redesign Query Activity Heatmap as multi-metric full-width banner ([#1681](https://github.com/chmonitor/chmonitor/issues/1681)) ([0dc0a36](https://github.com/chmonitor/chmonitor/commit/0dc0a364064376caa2e885f482826d2105d991c3))
* **overview:** restyle backup size card empty state ([#1677](https://github.com/chmonitor/chmonitor/issues/1677)) ([fea30f7](https://github.com/chmonitor/chmonitor/commit/fea30f72815998c3f82d0a6d81d8658c4f687c97))
* **overview:** restyle disk size card to match storage redesign ([#1675](https://github.com/chmonitor/chmonitor/issues/1675)) ([a30082c](https://github.com/chmonitor/chmonitor/commit/a30082c00958200e6dff2bc2188edb9700d2bda0))
* **overview:** restyle storage tab — partition health stat-triad, RankBars, grid ([#1678](https://github.com/chmonitor/chmonitor/issues/1678)) ([b48dfb6](https://github.com/chmonitor/chmonitor/commit/b48dfb68c13c519396d3e8f2de423db5b914bd8d))
* **query-config:** add clickhouseSettings to declarative schema; migrate tables-overview + stack-traces ([#1717](https://github.com/chmonitor/chmonitor/issues/1717)) ([c940031](https://github.com/chmonitor/chmonitor/commit/c940031d4c1436a93ee6657236b879b926c4a6a7))
* **query-config:** add declarative config loader behind CHM_CONFIG_SOURCE (default ts) ([#1689](https://github.com/chmonitor/chmonitor/issues/1689)) ([43c1d31](https://github.com/chmonitor/chmonitor/commit/43c1d31377d6f80663d2a0c6adae1b190a569a75))
* **query-config:** add declarative config schema + validator ([#1685](https://github.com/chmonitor/chmonitor/issues/1685)) ([91f3837](https://github.com/chmonitor/chmonitor/commit/91f3837aeb5ffc016af639e8772ee1069a293758))
* **query-config:** declarative docs as plain string + migrate query-cache/merge-performance ([#1718](https://github.com/chmonitor/chmonitor/issues/1718)) ([c875dc7](https://github.com/chmonitor/chmonitor/commit/c875dc7b01527a139cab9d52908361541136edfe))
* **query-config:** declarative expandable spec, migrate settings/users ([#1728](https://github.com/chmonitor/chmonitor/issues/1728)) ([d119b03](https://github.com/chmonitor/chmonitor/commit/d119b036aab479b73860fa565ad195bd8bfc627e))
* **query-config:** declarative permission field + migrate query-detail/mergetree-settings/metrics ([#1721](https://github.com/chmonitor/chmonitor/issues/1721)) ([640ea18](https://github.com/chmonitor/chmonitor/commit/640ea18748f2b171372a23c598b33c62c4a6e786))
* **query-config:** declarative rowStyle (compiles to rowClassName) + migrate kafka-consumers ([#1719](https://github.com/chmonitor/chmonitor/issues/1719)) ([e3d82e5](https://github.com/chmonitor/chmonitor/commit/e3d82e5e67f2a8ececbddd4e1aa51689df7034d2))
* **query-config:** migrate explorer/ domain to declarative catalog (behind flag) ([#1693](https://github.com/chmonitor/chmonitor/issues/1693)) ([63595e5](https://github.com/chmonitor/chmonitor/commit/63595e5598dca73b1b1fb73a6d5be827820c31cf))
* **query-config:** migrate keeper/ domain to declarative catalog (behind flag) ([#1694](https://github.com/chmonitor/chmonitor/issues/1694)) ([2e555d0](https://github.com/chmonitor/chmonitor/commit/2e555d02db6c65e077373bb250ad52813d4c8a4e))
* **query-config:** migrate logs/security/anomaly/merges domains to declarative (behind flag) ([#1697](https://github.com/chmonitor/chmonitor/issues/1697)) ([dbe6de1](https://github.com/chmonitor/chmonitor/commit/dbe6de146e46fa71da726d500289c1541cd6629a))
* **query-config:** migrate more/ domain to declarative catalog (behind flag) ([#1695](https://github.com/chmonitor/chmonitor/issues/1695)) ([3d86388](https://github.com/chmonitor/chmonitor/commit/3d8638887f6caccc3ff05b03ab15371f63bcd8c4))
* **query-config:** migrate part-info/projections/user-processes to declarative catalog ([#1716](https://github.com/chmonitor/chmonitor/issues/1716)) ([a6c133e](https://github.com/chmonitor/chmonitor/commit/a6c133ebb1568ba44580466f33b8b1b5a2cf47a0))
* **query-config:** migrate part-log + mutations to declarative rowStyle ([#1720](https://github.com/chmonitor/chmonitor/issues/1720)) ([26dd40c](https://github.com/chmonitor/chmonitor/commit/26dd40caa26b42a8b7e25ce4d001229502da4839))
* **query-config:** migrate queries/ domain to declarative (behind flag) ([#1696](https://github.com/chmonitor/chmonitor/issues/1696)) ([2996fca](https://github.com/chmonitor/chmonitor/commit/2996fcada4b4f92b7b43c6db36d0521267996baf))
* **query-config:** migrate system/ domain to declarative catalog (behind flag) ([#1691](https://github.com/chmonitor/chmonitor/issues/1691)) ([4507be8](https://github.com/chmonitor/chmonitor/commit/4507be83e825197810cdff1bdcffea5cb613c1f1))
* **query-config:** migrate tables/ domain to declarative catalog (behind flag) ([#1692](https://github.com/chmonitor/chmonitor/issues/1692)) ([ba5ea86](https://github.com/chmonitor/chmonitor/commit/ba5ea86fc5d61aace081559fc8bd44b4e25f6076))
* **query-config:** resolve declarative catalog in registry behind CHM_CONFIG_SOURCE (default ts) ([#1699](https://github.com/chmonitor/chmonitor/issues/1699)) ([9a545ae](https://github.com/chmonitor/chmonitor/commit/9a545ae8bfef58ab13b2642006f97e7f8ef51c95))
* **rbac:** add RBAC scaffold (community all-access, fail-open) ([#1698](https://github.com/chmonitor/chmonitor/issues/1698)) ([1d54595](https://github.com/chmonitor/chmonitor/commit/1d545951c9da47407f022656e1732fb1e7f6e4cb))
* **telemetry:** add opt-in daily instance ping (dark by default) ([#1688](https://github.com/chmonitor/chmonitor/issues/1688)) ([964f6b3](https://github.com/chmonitor/chmonitor/commit/964f6b39498e0317d63f27253844bf73d7a8d8f5))
* **telemetry:** add opt-in telemetry core (off by default) ([#1683](https://github.com/chmonitor/chmonitor/issues/1683)) ([87b6de0](https://github.com/chmonitor/chmonitor/commit/87b6de0b0f372608ff12e7ca050adc66aa3c40cc))
* **telemetry:** capture deploy target + ClickHouse version/flavor dimensions ([#1686](https://github.com/chmonitor/chmonitor/issues/1686)) ([6ac19ce](https://github.com/chmonitor/chmonitor/commit/6ac19cec828ae0214bd3f33f8bc6f59efbdb5a86))
* **telemetry:** wire activation events + define activation metric ([#1684](https://github.com/chmonitor/chmonitor/issues/1684)) ([9a3137e](https://github.com/chmonitor/chmonitor/commit/9a3137e1cc318db9d3eaf8b52202fd30139285af))


### 🐛 Bug Fixes

* **agent:** separate reasoning & tool blocks, local grouping, auto-collapse ([#1657](https://github.com/chmonitor/chmonitor/issues/1657)) ([e20b996](https://github.com/chmonitor/chmonitor/commit/e20b99648eaa023d3b867a162adb39b6b898fca2))
* **charts:** degrade optional chart with missing table to empty 200 ([#1733](https://github.com/chmonitor/chmonitor/issues/1733)) ([ef5161c](https://github.com/chmonitor/chmonitor/commit/ef5161c31b9910c9e64c0f7743c4675403d3c7f8))
* **charts:** mount charts eagerly to stop scroll-triggered skeleton flashing ([dd398dc](https://github.com/chmonitor/chmonitor/commit/dd398dc4f1cec13a72b2b5b5ca386cb14846eab9))
* **charts:** stop disks-usage query OOM by pre-filtering metrics ([#1736](https://github.com/chmonitor/chmonitor/issues/1736)) ([8c2e920](https://github.com/chmonitor/chmonitor/commit/8c2e9201047f9ee6bc2761bbdceb50791c8a5c14))
* **ci:** publish chmonitor multi-arch manifest on push to main ([#1751](https://github.com/chmonitor/chmonitor/issues/1751)) ([36ffe49](https://github.com/chmonitor/chmonitor/commit/36ffe499cf1156cfbaa4f33d5df40517af098bea))
* **conversation-store:** widen AgentState list scan to keep older history ([#1737](https://github.com/chmonitor/chmonitor/issues/1737)) ([69ec855](https://github.com/chmonitor/chmonitor/commit/69ec855f06ae131836ee473a179678a757aa5b00))
* **dashboard:** responsive audit — min-w-0 on about FeatureCard ([#1666](https://github.com/chmonitor/chmonitor/issues/1666)) ([65fc2e6](https://github.com/chmonitor/chmonitor/commit/65fc2e66d851ab4e34ad8d71256281d63b44c69c))
* **data-table:** contain horizontal scroll within table on mobile ([#1670](https://github.com/chmonitor/chmonitor/issues/1670)) ([e58ca6e](https://github.com/chmonitor/chmonitor/commit/e58ca6e6759036c705b8f0786234472f848d6324))
* **healthz:** add /healthz route and fix k8s probe crash loop ([e3886b6](https://github.com/chmonitor/chmonitor/commit/e3886b63b44ec09206ed8464c6d0493f51335073))
* **healthz:** add /heathz typo alias sharing the same handler ([47cbed4](https://github.com/chmonitor/chmonitor/commit/47cbed460e809433c163349fa116756aa75e92ea))
* **healthz:** bound /api/healthz ping + parameterize chart probes + dual-runtime guard ([#1749](https://github.com/chmonitor/chmonitor/issues/1749)) ([67b49c8](https://github.com/chmonitor/chmonitor/commit/67b49c898d2f394cc0cbc06d82deea08dd7a2624))
* **helm:** bootstrap gh-pages branch on first chart release ([#1745](https://github.com/chmonitor/chmonitor/issues/1745)) ([b676241](https://github.com/chmonitor/chmonitor/commit/b676241453d57ad9304539b4376a3d3c96599803))
* **helm:** drop dead Pages-enable step that 403s every run ([#1746](https://github.com/chmonitor/chmonitor/issues/1746)) ([c4ff1d6](https://github.com/chmonitor/chmonitor/commit/c4ff1d6bb6b87802441fc3a80f85a0c0a309c796))
* **helm:** skip existing releases so chart-releaser is idempotent ([#1748](https://github.com/chmonitor/chmonitor/issues/1748)) ([b05072c](https://github.com/chmonitor/chmonitor/commit/b05072c3f5899f27549720e2553f9a7480ad3fa7))
* **insights:** add auto-rows to charts grid to prevent blank space ([#1671](https://github.com/chmonitor/chmonitor/issues/1671)) ([047648a](https://github.com/chmonitor/chmonitor/commit/047648a603a373094e8bd2a681b01a2943b38a94))
* **insights:** align card title padding between skeleton and loaded states ([#1667](https://github.com/chmonitor/chmonitor/issues/1667)) ([35c8a3c](https://github.com/chmonitor/chmonitor/commit/35c8a3cf01d69c457c83f25cb941a4acbc51679f))
* **insights:** give charts-section grid definite row height ([7e70f1d](https://github.com/chmonitor/chmonitor/commit/7e70f1dc4123724fba37a00b9b471fdb6c4b1834))
* **landing:** correct stale OpenNext deploy copy on the marketing page ([#1714](https://github.com/chmonitor/chmonitor/issues/1714)) ([5ba0eb9](https://github.com/chmonitor/chmonitor/commit/5ba0eb93b14063fb42b05a8db07bf5f16ac16206))
* **overview:** remove stray tab strip scrollbar ([#1665](https://github.com/chmonitor/chmonitor/issues/1665)) ([b4e8d7c](https://github.com/chmonitor/chmonitor/commit/b4e8d7cf673b587f0d47375d77566d319dce19e8))
* **shell:** resolve app-shell Lighthouse a11y failures (aria, label, skip-link) ([#1734](https://github.com/chmonitor/chmonitor/issues/1734)) ([200cdc7](https://github.com/chmonitor/chmonitor/commit/200cdc74f127d19b987e1fa8017a91fa602cd7db))
* **ui:** explorer tree a11y — name toggle buttons, fix list nesting ([#1740](https://github.com/chmonitor/chmonitor/issues/1740)) ([f09751d](https://github.com/chmonitor/chmonitor/commit/f09751d47ca4cb4ab8db878b185fccab5c75d7b2))
* **ui:** give data-table Select triggers accessible names ([#1741](https://github.com/chmonitor/chmonitor/issues/1741)) ([405e9bf](https://github.com/chmonitor/chmonitor/commit/405e9bf67b522ec090e8721f666b0ba376653470))
* **ui:** give Progress bars accessible names (aria-progressbar-name) ([#1743](https://github.com/chmonitor/chmonitor/issues/1743)) ([bfe4e1e](https://github.com/chmonitor/chmonitor/commit/bfe4e1e50c09e923a933a74be7f178442f448901))
* **ui:** host switcher accessible name matches visible label (WCAG 2.5.3) ([#1742](https://github.com/chmonitor/chmonitor/issues/1742)) ([ea9ae2f](https://github.com/chmonitor/chmonitor/commit/ea9ae2f6785806acdac24bd9c9cf50d299ec8827))
* **ui:** name the icon-only query-row action links (a11y link-name) ([#1739](https://github.com/chmonitor/chmonitor/issues/1739)) ([786f2e0](https://github.com/chmonitor/chmonitor/commit/786f2e0f87c05736fbbc41831e06a519f226b934))
* **ui:** raise contrast of data-table "N records" count (WCAG AA) ([#1744](https://github.com/chmonitor/chmonitor/issues/1744)) ([492ca08](https://github.com/chmonitor/chmonitor/commit/492ca08454a07ebc70959ad1bf914cc4a855f0aa))
* **ui:** raise contrast on muted labels and the "New" badge (WCAG AA) ([#1738](https://github.com/chmonitor/chmonitor/issues/1738)) ([8f64428](https://github.com/chmonitor/chmonitor/commit/8f64428ae82c02e72cb88843806b17462fd7893f))


### ⚡ Performance

* **health:** batch health checks into one request + show cached values instantly ([#1669](https://github.com/chmonitor/chmonitor/issues/1669)) ([9be95d8](https://github.com/chmonitor/chmonitor/commit/9be95d8fa8dd915ba2e01bbe30ce20358fac325c))


### ♻️ Refactoring

* **agent:** trim tools to lean primitives (63 to ~18) ([#1656](https://github.com/chmonitor/chmonitor/issues/1656)) ([6879bf1](https://github.com/chmonitor/chmonitor/commit/6879bf145063356446c55921b6788bf9d860ab27))

## [0.2.9](https://github.com/chmonitor/chmonitor/compare/v0.2.8...v0.2.9) (2026-06-14)


### 🐛 Bug Fixes

* **ci:** align release docker cache scope + diagnosable container health checks ([#1610](https://github.com/chmonitor/chmonitor/issues/1610)) ([ae78ad9](https://github.com/chmonitor/chmonitor/commit/ae78ad918667dda2f51a2a8347f2402c039c3798))
* **ci:** pass -R to gh workflow run in release-please ([#1608](https://github.com/chmonitor/chmonitor/issues/1608)) ([da18863](https://github.com/chmonitor/chmonitor/commit/da18863b3132467cbd69fb8ab8450c5478ffb258))

## [0.2.8](https://github.com/chmonitor/chmonitor/compare/v0.2.7...v0.2.8) (2026-06-13)


### ✨ Features

* **release:** tiered LLM notes (Copilot→Models→AnyRouter), recap stats, docker pin ([#1582](https://github.com/chmonitor/chmonitor/issues/1582)) ([3009f99](https://github.com/chmonitor/chmonitor/commit/3009f994a9c73f3a018ddae6f148a7a8bce9103b))


### 🐛 Bug Fixes

* add Running Queries and Clusters as top-level sidebar items ([#1569](https://github.com/chmonitor/chmonitor/issues/1569)) ([74fc5eb](https://github.com/chmonitor/chmonitor/commit/74fc5eb6f2dae1a7bfe931cac07d0d57470c7bde))
* **api:** enforce auth on clean/init/pageview endpoints and sanitize error responses ([#1602](https://github.com/chmonitor/chmonitor/issues/1602)) ([9b9d239](https://github.com/chmonitor/chmonitor/commit/9b9d2398bba240573de50977a83be313e2ba0f99))
* **clickhouse-client:** harden http status code regex in clickhouse-fetch ([#1578](https://github.com/chmonitor/chmonitor/issues/1578)) ([0d27e33](https://github.com/chmonitor/chmonitor/commit/0d27e33811e223c4d5a3e569e3dd1a95f8218530))
* **clickhouse-client:** redact inline credentials from host config debug logs ([#1581](https://github.com/chmonitor/chmonitor/issues/1581)) ([6d0609b](https://github.com/chmonitor/chmonitor/commit/6d0609b5a3cbf442730ed2cd2880200810e3ee78))
* **dashboard-tsr:** bridge CLICKHOUSE_DATABASE and EVENTS_TABLE_NAME on workers ([#1576](https://github.com/chmonitor/chmonitor/issues/1576)) ([8096672](https://github.com/chmonitor/chmonitor/commit/80966727cf779cd2731b375261d7eb0e3e85adef))
* **dashboard-tsr:** fix a11y violations in health, dashboard, and menu ([#1588](https://github.com/chmonitor/chmonitor/issues/1588)) ([5340ce8](https://github.com/chmonitor/chmonitor/commit/5340ce8b477510c51c28737b1c5123dd73dc70e1))
* **dashboard-tsr:** listen for swr:revalidate event to refresh TanStack Query cache ([#1579](https://github.com/chmonitor/chmonitor/issues/1579)) ([7927f18](https://github.com/chmonitor/chmonitor/commit/7927f18fd6dd831861bb2757c477ff06fb0084c6))
* **dashboard-tsr:** skip hash-anchor URLs in prerender crawl to unblock Docker build ([#1583](https://github.com/chmonitor/chmonitor/issues/1583)) ([f001263](https://github.com/chmonitor/chmonitor/commit/f001263953dbb4c459b4b84de6b2bec1d6273494))
* **dashboard-tsr:** type menu-counts test to unblock type-check:test ([#1605](https://github.com/chmonitor/chmonitor/issues/1605)) ([850162e](https://github.com/chmonitor/chmonitor/commit/850162e2fe6d56f62731c7adef787ea2bfb39449))
* **e2e:** expand collapsible menu sections before checking sidebar links ([#1568](https://github.com/chmonitor/chmonitor/issues/1568)) ([cc6cdbd](https://github.com/chmonitor/chmonitor/commit/cc6cdbd33ea75a7abfedde6659e2a3a5ea23f340))
* **logger:** safely guard process.env access for browser and serverless runtimes ([#1589](https://github.com/chmonitor/chmonitor/issues/1589)) ([36f3b1d](https://github.com/chmonitor/chmonitor/commit/36f3b1d357e138fecb7b342636f7828eeded8da5))
* **rust/ch-json:** prevent normalization of numeric strings with leading zeros ([#1590](https://github.com/chmonitor/chmonitor/issues/1590)) ([eb9a091](https://github.com/chmonitor/chmonitor/commit/eb9a091d9ba39dc3204083458caaee84af94a88e))
* **validate-docker:** bundle @clickhouse/client-common + follow root redirect ([#1604](https://github.com/chmonitor/chmonitor/issues/1604)) ([6d280d9](https://github.com/chmonitor/chmonitor/commit/6d280d9d74cc0d56d5779b754c502e6b113965ef))


### ⚡ Performance

* **dashboard-tsr:** optimize menu counts endpoint to use single batched query ([#1591](https://github.com/chmonitor/chmonitor/issues/1591)) ([dff6ed4](https://github.com/chmonitor/chmonitor/commit/dff6ed4b531424f969bff5181ad7aa68f2a7715a))
* **dashboard-tsr:** unmount collapsed chart rows to stop background polling ([#1580](https://github.com/chmonitor/chmonitor/issues/1580)) ([1400632](https://github.com/chmonitor/chmonitor/commit/14006320758aef09b3485b5d99d4d9dabbda2e3b))

## [Unreleased] — v0.3 preview

> **v0.3 rebuilds the dashboard on TanStack Start.** Full upgrade steps:
> [Migrate to v0.3](docs/content/migrating/v0-3.mdx) ·
> What's new: [Release notes](docs/content/releases/v0-3.mdx).

### 💥 Breaking Changes

- **Runtime app switched from Next.js to TanStack Start** (`apps/dashboard-tsr`
  replaces `apps/dashboard` as the primary app). Same features, routes, and
  ClickHouse setup.
- **Browser env vars renamed `NEXT_PUBLIC_*` → `VITE_*`** (build-time inlined).
  The old `NEXT_PUBLIC_*` names still work as a compatibility fallback, so the
  rename is recommended but not required.
- **Docker entrypoint changed** from `node server.js` (OpenNext standalone) to
  `node server/index.mjs` (Nitro node-server). Port `3000` and the
  `/api/healthz` healthcheck are unchanged.

### 🔧 Environment Changes

| Old (v0.2) | New (v0.3) | Notes |
|---|---|---|
| `NEXT_PUBLIC_AUTH_PROVIDER` | `VITE_AUTH_PROVIDER` | client; server uses `CHM_AUTH_PROVIDER` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `VITE_CLERK_PUBLISHABLE_KEY` | client, build-time |
| `NEXT_PUBLIC_FEATURE_CONVERSATION_DB` | `VITE_FEATURE_CONVERSATION_DB` | client, build-time |
| `NEXT_PUBLIC_AUTOCOMPLETE_LIMIT` | `VITE_AUTOCOMPLETE_LIMIT` | client, build-time |
| `NEXT_PUBLIC_RUNNING_QUERIES_REFRESH_MS` | `VITE_RUNNING_QUERIES_REFRESH_MS` | client, build-time |
| `CLICKHOUSE_*`, `CHM_*`, `CLERK_SECRET_KEY`, `*_API_KEY` | _unchanged_ | server vars |

New optional vars: `CHM_AUTH_PROVIDER` (`none\|clerk\|proxy`), `CHM_API_KEY_SECRET`,
`CHM_CF_ACCESS_TEAM_DOMAIN` + `CHM_CF_ACCESS_AUD`, `CHM_PROXY_AUTH_SECRET`,
`HEALTH_ALERT_ENABLED` + `HEALTH_ALERT_WEBHOOK_URL`,
`AGENT_CONVERSATION_PERSISTENCE` + `AGENT_CONVERSATION_STORE`.

### ✨ Features

- **Promote TanStack Start dashboard to primary, remove legacy Next.js app** ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)).

### 🤖 Migrate with an AI assistant

Paste your config into any AI assistant with the prompt in
[`.github/release-migration-prompt.md`](.github/release-migration-prompt.md)
(also published in every breaking-change GitHub Release and in the
[README](README.md#upgrading-to-v03)).

## [0.2.7](https://github.com/chmonitor/chmonitor/compare/v0.2.6...v0.2.7) (2026-06-13)


### ✨ Features

* add perf-compare script for Win Metrics ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([#1514](https://github.com/chmonitor/chmonitor/issues/1514)) ([faa6972](https://github.com/chmonitor/chmonitor/commit/faa697231f10a44d280ea8188046855a597e9f89))
* **agent:** add conversation storage adapters ([#1517](https://github.com/chmonitor/chmonitor/issues/1517)) ([34ac9d4](https://github.com/chmonitor/chmonitor/commit/34ac9d4b847124c19d31ccae9eea90a56ec469f4))
* **auth:** activate CHM_CLERK_PUBLIC_READ on dash + dash-tsr ([#1536](https://github.com/chmonitor/chmonitor/issues/1536)) ([e9b7e45](https://github.com/chmonitor/chmonitor/commit/e9b7e45d46cce5ce796e23f71d2e9f3d3e4befcd))
* **auth:** read/write permission model + CHM_CLERK_PUBLIC_READ ([#1535](https://github.com/chmonitor/chmonitor/issues/1535)) ([1112238](https://github.com/chmonitor/chmonitor/commit/1112238714d3d3d24ec01757e089c10c3752e477))
* **dashboard-tsr:** BI-style SQL Console + fix explorer tab-switch freeze ([#1531](https://github.com/chmonitor/chmonitor/issues/1531)) ([b42ebb9](https://github.com/chmonitor/chmonitor/commit/b42ebb9be1af587008e531436c941eae9a4e026e))
* **dashboard-tsr:** pluggable auth providers (none|clerk|proxy) + CF Access/proxy + auth docs + v0.3 changelog ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([#1440](https://github.com/chmonitor/chmonitor/issues/1440)) ([4c2a50c](https://github.com/chmonitor/chmonitor/commit/4c2a50c3b6ed892dce862338b753a5eab3e68772))
* **docs:** astro-design-system theme + per-release versioning ([#1529](https://github.com/chmonitor/chmonitor/issues/1529)) ([2552de4](https://github.com/chmonitor/chmonitor/commit/2552de4365481cabd796526ed1e8d1d42b7ca78a))


### 🐛 Bug Fixes

* add missing WASM artifact upload step in CI workflow ([#1553](https://github.com/chmonitor/chmonitor/issues/1553)) ([13fcd92](https://github.com/chmonitor/chmonitor/commit/13fcd928eb426b1bf520317d5a685e01db03f809))
* **agent:** send AnyRouter category in X-AnyRouter-Categories, not the source header ([#1516](https://github.com/chmonitor/chmonitor/issues/1516)) ([20cb0a3](https://github.com/chmonitor/chmonitor/commit/20cb0a39a5d2493ddca163b15e7a5612af7561ea))
* change regex to /\bunion\s+(all\s+)?select\b/i. ([0f15879](https://github.com/chmonitor/chmonitor/commit/0f15879e33cba3e9743041e9d8b626a8ec48083a))
* classify unknown table errors as table_not_found ([#1546](https://github.com/chmonitor/chmonitor/issues/1546)) ([b0618af](https://github.com/chmonitor/chmonitor/commit/b0618afc55dad189b35bea0122dd1abbf9f1400a))
* **dashboard-tsr:** accept Clerk session in /api/v1 guard ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([#1437](https://github.com/chmonitor/chmonitor/issues/1437)) ([6b894e7](https://github.com/chmonitor/chmonitor/commit/6b894e71a02839574e5e880cb4f0ea8f1faf1bbb))
* **dashboard-tsr:** add a11y attributes to KpiCard loading skeleton ([#1473](https://github.com/chmonitor/chmonitor/issues/1473)) ([6ff8d63](https://github.com/chmonitor/chmonitor/commit/6ff8d6370a1e6ca9f20e4b66101f640d3052e009))
* **dashboard-tsr:** add a11y loading announcement to LazyChartWrapper placeholder ([#1485](https://github.com/chmonitor/chmonitor/issues/1485)) ([d4b56b9](https://github.com/chmonitor/chmonitor/commit/d4b56b997cc10a835ffe5156a3b5aaa2c93f1fa6))
* **dashboard-tsr:** add focus-visible ring to explorer tree expand button ([#1458](https://github.com/chmonitor/chmonitor/issues/1458)) ([88bfda7](https://github.com/chmonitor/chmonitor/commit/88bfda75a2ff7416ddea1c4a44d7e6a297def59d))
* **dashboard-tsr:** add keyboard a11y to ChartEmpty clickable card ([#1478](https://github.com/chmonitor/chmonitor/issues/1478)) ([1789061](https://github.com/chmonitor/chmonitor/commit/17890619984ba0f91cf18d4c337e0d6c701f3fe4))
* **dashboard-tsr:** add keyboard a11y to explorer database cards ([#1481](https://github.com/chmonitor/chmonitor/issues/1481)) ([0c91dc2](https://github.com/chmonitor/chmonitor/commit/0c91dc2b8ef23e0155264f03649cbf7488e94424))
* **dashboard-tsr:** add security headers to static pages via _headers ([#1491](https://github.com/chmonitor/chmonitor/issues/1491)) ([bc516dc](https://github.com/chmonitor/chmonitor/commit/bc516dc876f34bf00678e1b3e52a16ee6841024f))
* **dashboard-tsr:** add security response headers ([#1487](https://github.com/chmonitor/chmonitor/issues/1487)) ([0035c84](https://github.com/chmonitor/chmonitor/commit/0035c8451491c7390264d04d076515edb65718c2))
* **dashboard-tsr:** add SheetTitle to ExplorerSidebar for screen-reader a11y ([#1457](https://github.com/chmonitor/chmonitor/issues/1457)) ([bc9f76d](https://github.com/chmonitor/chmonitor/commit/bc9f76d08cf74056788d162f43ef942a95d4fe40))
* **dashboard-tsr:** add SQL validation to browser-connections proxy endpoint ([#1471](https://github.com/chmonitor/chmonitor/issues/1471)) ([cd9b309](https://github.com/chmonitor/chmonitor/commit/cd9b309260aab9c3611ca9452ae83737101671dc))
* **dashboard-tsr:** add SQL validation to POST /api/v1/data with queryConfigName ([#1483](https://github.com/chmonitor/chmonitor/issues/1483)) ([f54fa04](https://github.com/chmonitor/chmonitor/commit/f54fa0418e5fcb66ba8773e04676d45405747354))
* **dashboard-tsr:** add underline variant to TabsSkeleton to prevent CLS on overview load ([#1460](https://github.com/chmonitor/chmonitor/issues/1460)) ([7d17fe3](https://github.com/chmonitor/chmonitor/commit/7d17fe38a846d0fd98b9aed510622fc85734d51c))
* **dashboard-tsr:** auth=none opens everything; frontend renders, backend enforces ([#1533](https://github.com/chmonitor/chmonitor/issues/1533)) ([497d474](https://github.com/chmonitor/chmonitor/commit/497d4745403f3bed64de5f9259021c854a425e43))
* **dashboard-tsr:** auto-reload on stale dynamic-import after deploy ([#1538](https://github.com/chmonitor/chmonitor/issues/1538)) ([2ee1f31](https://github.com/chmonitor/chmonitor/commit/2ee1f3146fd00ccc780ad7808fe25d6686b3c89f))
* **dashboard-tsr:** collapse root redirect to one edge hop + unblock e2e CI ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([763184e](https://github.com/chmonitor/chmonitor/commit/763184e3923efca1bffcf570abefd9104ca970f7))
* **dashboard-tsr:** collapse root redirect to single edge hop + unblock e2e CI ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([2674450](https://github.com/chmonitor/chmonitor/commit/2674450db5ad99ade9342908b73a7604bb02d36f))
* **dashboard-tsr:** convention fixes, stable keys, ai-agent docs sync, regression tests ([#1555](https://github.com/chmonitor/chmonitor/issues/1555)) ([9c5944d](https://github.com/chmonitor/chmonitor/commit/9c5944d30d58c4bead7b1772229d4f5845c6bbff))
* **dashboard-tsr:** correct explorer page height to account for shell padding ([#1479](https://github.com/chmonitor/chmonitor/issues/1479)) ([2fd5802](https://github.com/chmonitor/chmonitor/commit/2fd5802ee343b37ed44077c88a2f4f0a4fba7cb7))
* **dashboard-tsr:** deploy CHM_CLERK_PUBLIC_READ var (CI patch script) ([#1537](https://github.com/chmonitor/chmonitor/issues/1537)) ([90d1378](https://github.com/chmonitor/chmonitor/commit/90d13786d1b5a36995f31bf66625b3dc525a312d))
* **dashboard-tsr:** deterministic cache-bust in clerk-client test ([#1503](https://github.com/chmonitor/chmonitor/issues/1503)) ([121184f](https://github.com/chmonitor/chmonitor/commit/121184fc36005ff501184fff0100c79d44d11a31))
* **dashboard-tsr:** drop hardcoded clerk key default, sync env docs ([#1561](https://github.com/chmonitor/chmonitor/issues/1561)) ([3bb9df9](https://github.com/chmonitor/chmonitor/commit/3bb9df9148954f4cd2c3bc92efd412f6b5ad44cd))
* **dashboard-tsr:** enforce chart feature perms + port deprecated chart variants ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([#1445](https://github.com/chmonitor/chmonitor/issues/1445)) ([07dc70c](https://github.com/chmonitor/chmonitor/commit/07dc70c44cf963f3f4a1bc54ca5c520a90f0d2ab))
* **dashboard-tsr:** enforce ClickHouse readonly mode in /api/v1/data ([#1476](https://github.com/chmonitor/chmonitor/issues/1476)) ([54f3af1](https://github.com/chmonitor/chmonitor/commit/54f3af1cad64de6fc7ae9ebce28c9e5cb556b261))
* **dashboard-tsr:** keep agent menu visible when signed in ([#1453](https://github.com/chmonitor/chmonitor/issues/1453)) ([5853abc](https://github.com/chmonitor/chmonitor/commit/5853abca2a276b2c23fb3a7eb8e00a72f08b454a))
* **dashboard-tsr:** lint cleanup, flaky test, and query-config SQL fixes ([#1554](https://github.com/chmonitor/chmonitor/issues/1554)) ([5ae1c49](https://github.com/chmonitor/chmonitor/commit/5ae1c49656cef72b7cac0c54cd5cdb8f32fe3675))
* **dashboard-tsr:** make SSR stub constructable so prerender stops throwing ([#1499](https://github.com/chmonitor/chmonitor/issues/1499)) ([a220610](https://github.com/chmonitor/chmonitor/commit/a2206105cd3092dce29a0613f50e887c4e332dd6))
* **dashboard-tsr:** match overview fallback skeleton to KpiCard layout ([#1480](https://github.com/chmonitor/chmonitor/issues/1480)) ([60af83d](https://github.com/chmonitor/chmonitor/commit/60af83d87d7dad77a9675ee78ca2a197dd738430))
* **dashboard-tsr:** populate client chart-component registry (71 charts) ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([#1443](https://github.com/chmonitor/chmonitor/issues/1443)) ([7fcf623](https://github.com/chmonitor/chmonitor/commit/7fcf623ec7834c57d1fe430baa6820a994c16cfb))
* **dashboard-tsr:** query detail button + collapse charts instead of hiding ([#1497](https://github.com/chmonitor/chmonitor/issues/1497)) ([15a43d5](https://github.com/chmonitor/chmonitor/commit/15a43d56219e2205326e7e732ec680e851dbd7ef))
* **dashboard-tsr:** re-export shape-matched TableSkeleton to prevent CLS ([#1474](https://github.com/chmonitor/chmonitor/issues/1474)) ([80a163b](https://github.com/chmonitor/chmonitor/commit/80a163bdc07eb7f60433d5f5cb96ff29e3e8ba26))
* **dashboard-tsr:** register all chart modules so charts resolve ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([#1441](https://github.com/chmonitor/chmonitor/issues/1441)) ([c42ed90](https://github.com/chmonitor/chmonitor/commit/c42ed90385456f08ecb141deb2ba62ffa7a15a1f))
* **dashboard-tsr:** register clerkMiddleware + missing explorer configs ([#1496](https://github.com/chmonitor/chmonitor/issues/1496)) ([6bf699e](https://github.com/chmonitor/chmonitor/commit/6bf699e056004bfb64b37e7291ad4645e615433e))
* **dashboard-tsr:** remove aria-hidden that suppresses skeleton loading announcements ([#1482](https://github.com/chmonitor/chmonitor/issues/1482)) ([a1d2af8](https://github.com/chmonitor/chmonitor/commit/a1d2af8bfc16c6056e487a9d24c6aab71e6515b8))
* **dashboard-tsr:** replace require() Clerk gating with ESM imports ([#1532](https://github.com/chmonitor/chmonitor/issues/1532)) ([764f8fb](https://github.com/chmonitor/chmonitor/commit/764f8fb2211b04e585392918e62f718b4b97ce5b))
* **dashboard-tsr:** replace running-queries Suspense fallback with full-page skeleton ([#1467](https://github.com/chmonitor/chmonitor/issues/1467)) ([f0c3a30](https://github.com/chmonitor/chmonitor/commit/f0c3a3000e3b9266d8b31f52fd3c4317985e66ca))
* **dashboard-tsr:** restore focus-visible ring on overview tab triggers ([#1461](https://github.com/chmonitor/chmonitor/issues/1461)) ([5a0639c](https://github.com/chmonitor/chmonitor/commit/5a0639cd643e0c2944327e85eb917cc51f831d66))
* **dashboard-tsr:** shrink OverviewPageFallback status strip skeleton h-10→h-5 ([#1456](https://github.com/chmonitor/chmonitor/issues/1456)) ([4781009](https://github.com/chmonitor/chmonitor/commit/47810096794299ca5abfef54904ab5592103525b))
* **dashboard-tsr:** skip prerender for e2e build so the gate actually runs ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([cfa550c](https://github.com/chmonitor/chmonitor/commit/cfa550cd86eeffc70ca1e80a250701ce3eef8dbf))
* **dashboard-tsr:** stabilize table/chart renders (memoize context + columns, keepPreviousData) ([#1543](https://github.com/chmonitor/chmonitor/issues/1543)) ([c90b03c](https://github.com/chmonitor/chmonitor/commit/c90b03c34f0aaf0b9904e8e67cc204f6d782799e))
* **dashboard-tsr:** stop full-page skeleton flash on overview tab switch ([#1454](https://github.com/chmonitor/chmonitor/issues/1454)) ([02d5292](https://github.com/chmonitor/chmonitor/commit/02d5292c53d6ebb8d12c69a0df935066f01458e7))
* **dashboard-tsr:** surface D1 persist failures + bound repoCache + guard conversation routes ([#1511](https://github.com/chmonitor/chmonitor/issues/1511)) ([305341b](https://github.com/chmonitor/chmonitor/commit/305341b72eadc9b4d8f63f106ed6741ce9c60176))
* **dashboard-tsr:** unblock main — chainable SSR stub + readonly string type ([#1488](https://github.com/chmonitor/chmonitor/issues/1488)) ([4b84603](https://github.com/chmonitor/chmonitor/commit/4b8460306c2d9362d33c069ccc876ef34dcc4bbc))
* **dashboard-tsr:** unmount collapsed query charts ([#1498](https://github.com/chmonitor/chmonitor/issues/1498)) ([9584c68](https://github.com/chmonitor/chmonitor/commit/9584c6846e0d04e1db11ecd8644f2966a1b6f580))
* **dashboard-tsr:** update readonly structural test for string value ([#1490](https://github.com/chmonitor/chmonitor/issues/1490)) ([941d4e9](https://github.com/chmonitor/chmonitor/commit/941d4e9004fa3d6ccd34792433db8db5ae159b42))
* **dashboard-tsr:** use 100dvh in explorer to match agents page ([#1463](https://github.com/chmonitor/chmonitor/issues/1463)) ([9527ef1](https://github.com/chmonitor/chmonitor/commit/9527ef1097ae7747563baca1680ed786127ab28b))
* **dashboard-tsr:** use grid skeleton for dashboard page loading state ([#1468](https://github.com/chmonitor/chmonitor/issues/1468)) ([af05aa8](https://github.com/chmonitor/chmonitor/commit/af05aa837708b4d5a8de3a17558702e684a63947))
* **dashboard-tsr:** use h-96 instead of h-screen for table redirect skeleton ([#1486](https://github.com/chmonitor/chmonitor/issues/1486)) ([c767498](https://github.com/chmonitor/chmonitor/commit/c76749879d9b39a2315a46456d2e4aa043bdd69a))
* **dashboard-tsr:** use port 8443 for Tailscale funnel ([#1539](https://github.com/chmonitor/chmonitor/issues/1539)) ([49a9250](https://github.com/chmonitor/chmonitor/commit/49a9250ba51c36dfa4e9611bbc2b88733f2f9d9b))
* **dashboard-tsr:** use shared ChartSkeleton/TableSkeleton in page skeletons ([#1470](https://github.com/chmonitor/chmonitor/issues/1470)) ([bf592c4](https://github.com/chmonitor/chmonitor/commit/bf592c456eb6d65f70e6b6d530592aacadd0f9d3))
* **dashboard-tsr:** use Skeleton shimmer in KpiCard loading state ([#1459](https://github.com/chmonitor/chmonitor/issues/1459)) ([f44a9df](https://github.com/chmonitor/chmonitor/commit/f44a9df4bd58d1df88d9d726abc1e4e7e1b10904))
* **dashboard-tsr:** wire table filterSchema + restore actions feature-auth ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([#1444](https://github.com/chmonitor/chmonitor/issues/1444)) ([8d3ca79](https://github.com/chmonitor/chmonitor/commit/8d3ca79cc11f29ff9a74e0f0bc7a2568c247dee5))
* **dashboard:** keep view state local so toggle clicks work in Cypress ([#1557](https://github.com/chmonitor/chmonitor/issues/1557)) ([a216552](https://github.com/chmonitor/chmonitor/commit/a2165524ac528c044e3268fb06fde4319f00888a))
* **docker:** copy tsconfig.base.json into builder stage ([#1556](https://github.com/chmonitor/chmonitor/issues/1556)) ([e74c70a](https://github.com/chmonitor/chmonitor/commit/e74c70a0741bd5992f11a865b1557a6177750530))
* **e2e:** green e2e-test and e2e-test-tsr on main ([#1558](https://github.com/chmonitor/chmonitor/issues/1558)) ([bc6e451](https://github.com/chmonitor/chmonitor/commit/bc6e451a12883e53fb0fea1741c7281bf7c360e5))
* enable rust build in docker jobs after WASM build removal ([#1552](https://github.com/chmonitor/chmonitor/issues/1552)) ([6783aab](https://github.com/chmonitor/chmonitor/commit/6783aab20fec81657ce4b1d093a2e0e70014b188))
* **explorer:** resolve dependency graph hydration mismatch and infinite loop ([#1510](https://github.com/chmonitor/chmonitor/issues/1510)) ([e2d9618](https://github.com/chmonitor/chmonitor/commit/e2d9618dd1627b62b34c652075f8112f4f21f127))
* green main — prerender crawl crashes and root Dockerfile tsconfig ([#1563](https://github.com/chmonitor/chmonitor/issues/1563)) ([053fd62](https://github.com/chmonitor/chmonitor/commit/053fd62dcd91e37cdea6390b9cad7c8333f1e312))
* **release:** remove duplicated Git changes and Docker tags from release notes ([#1442](https://github.com/chmonitor/chmonitor/issues/1442)) ([4810b40](https://github.com/chmonitor/chmonitor/commit/4810b404f49621c62c7983c8fe53f2d62a93ffbc))
* resolve TSR cutover blockers (hydration, layout, zoom dialog) ([#1527](https://github.com/chmonitor/chmonitor/issues/1527)) ([fd187ce](https://github.com/chmonitor/chmonitor/commit/fd187ceb99b5cc289a8a12eb5af80f889fa118a1))
* **sql-validator:** catch UNION ALL SELECT injection bypass ([#1475](https://github.com/chmonitor/chmonitor/issues/1475)) ([0f15879](https://github.com/chmonitor/chmonitor/commit/0f15879e33cba3e9743041e9d8b626a8ec48083a))
* switch root Dockerfile and docker-compose to dashboard-tsr ([#1548](https://github.com/chmonitor/chmonitor/issues/1548)) ([03a3c44](https://github.com/chmonitor/chmonitor/commit/03a3c4461bc49e0d15d4e8b1620b65ed19b95a46))
* **verify-deploy:** degrade ClickHouse-upstream timeouts to warnings ([8b5b16f](https://github.com/chmonitor/chmonitor/commit/8b5b16f9a5523671f450324292f1da456d0f4300))


### ⚡ Performance

* **dashboard-tsr:** cache content-hashed assets immutably for lower TTFB ([#1507](https://github.com/chmonitor/chmonitor/issues/1507)) ([8c26970](https://github.com/chmonitor/chmonitor/commit/8c269709f8269749013fa4b06b1b8cd972e3b6fc))
* **dashboard-tsr:** combine SSR stubs for xyflow/streamdown/highlight.js/assistant-ui ([#1472](https://github.com/chmonitor/chmonitor/issues/1472)) ([f7dfc4c](https://github.com/chmonitor/chmonitor/commit/f7dfc4ce878ce8f6b1786b662bd71243e464ef63))
* **dashboard-tsr:** fix loading CLS drift + cut hidden-tab polling and re-renders ([#1515](https://github.com/chmonitor/chmonitor/issues/1515)) ([1818e80](https://github.com/chmonitor/chmonitor/commit/1818e803565134984026f721278ebb3e6232ffaa))
* **dashboard-tsr:** hover-prefetch, lazy-init providers, visibility-guard pollers ([#1544](https://github.com/chmonitor/chmonitor/issues/1544)) ([ac3baeb](https://github.com/chmonitor/chmonitor/commit/ac3baeb41d634540c805674a430f5156b4b57cb5))
* **dashboard-tsr:** make loading skeletons static for faster first paint ([#1506](https://github.com/chmonitor/chmonitor/issues/1506)) ([d627154](https://github.com/chmonitor/chmonitor/commit/d627154fb286e6967cc70e74724d1006036cc05f))
* **dashboard-tsr:** memoize data-table filter context and handlers ([#1524](https://github.com/chmonitor/chmonitor/issues/1524)) ([12248d1](https://github.com/chmonitor/chmonitor/commit/12248d13762a932817c0bb25b7703c7b4b762d30))
* **dashboard-tsr:** persist query cache + host list to localStorage for instant warm loads ([#1508](https://github.com/chmonitor/chmonitor/issues/1508)) ([2d31e38](https://github.com/chmonitor/chmonitor/commit/2d31e38a97f13d78ed571e79a4c5e7f4436148d6))
* **dashboard-tsr:** persist query cache to localStorage for instant repeat loads ([#1505](https://github.com/chmonitor/chmonitor/issues/1505)) ([ae5b31f](https://github.com/chmonitor/chmonitor/commit/ae5b31fe09320b2c84e7e7bc72b180182a66eae3))
* **dashboard-tsr:** set query gcTime to 30m for instant back-nav ([#1489](https://github.com/chmonitor/chmonitor/issues/1489)) ([3413444](https://github.com/chmonitor/chmonitor/commit/3413444f9b62a94178e60e4d3243f5cb4bc94c02))
* **dashboard-tsr:** stop background polling on hidden tabs and inactive chart tabs ([#1523](https://github.com/chmonitor/chmonitor/issues/1523)) ([0591e7d](https://github.com/chmonitor/chmonitor/commit/0591e7d83513191ff0fcdb58f29a06328234e879))
* **dashboard-tsr:** stub @json-render/shadcn + @json-render/react from SSR bundle ([#1477](https://github.com/chmonitor/chmonitor/issues/1477)) ([76a6cfe](https://github.com/chmonitor/chmonitor/commit/76a6cfe1c077ab8fc709b0c4660caf2e8f0ab891))
* **dashboard-tsr:** stub assistant-stream out of CF Worker bundle ([#1484](https://github.com/chmonitor/chmonitor/issues/1484)) ([2f34d4f](https://github.com/chmonitor/chmonitor/commit/2f34d4fe186b39cc646e59e29eee29247d177116))
* **dashboard-tsr:** stub recharts in SSR worker bundle (~1 MiB reduction) ([#1462](https://github.com/chmonitor/chmonitor/issues/1462)) ([e719f7e](https://github.com/chmonitor/chmonitor/commit/e719f7e791d479e1af9a7ddc042f844160a9d25f))


### ♻️ Refactoring

* **api:** cache headers, parallel queries, and shared validators in dashboard-tsr ([#1526](https://github.com/chmonitor/chmonitor/issues/1526)) ([208c645](https://github.com/chmonitor/chmonitor/commit/208c645621f4bae423c898e304c1a24d31d07b4e))
* **dashboard-tsr:** adopt activateOnEnterOrSpace in chart-empty + expandable-text ([#1495](https://github.com/chmonitor/chmonitor/issues/1495)) ([3aa6bec](https://github.com/chmonitor/chmonitor/commit/3aa6bec8854750c819736f35f4a4ae80b25e205c))
* **dashboard-tsr:** dedup components and fix false keeper-leader layout ([#1525](https://github.com/chmonitor/chmonitor/issues/1525)) ([866a874](https://github.com/chmonitor/chmonitor/commit/866a8741bdae3547e728ed4870cadf85d8090991))
* **dashboard-tsr:** docs route hygiene, dead hooks, lazy sql-formatter ([#1564](https://github.com/chmonitor/chmonitor/issues/1564)) ([7cbed3d](https://github.com/chmonitor/chmonitor/commit/7cbed3d6e10b78a1dd79a76e254b18bd1fb0e655))
* **dashboard-tsr:** extract activateOnEnterOrSpace a11y helper ([#1494](https://github.com/chmonitor/chmonitor/issues/1494)) ([9b01572](https://github.com/chmonitor/chmonitor/commit/9b015729db1c65381c4337a34f5b6bd50d1a87c6))
* **dashboard-tsr:** import zod directly instead of the zod/v3 compat shim ([#1521](https://github.com/chmonitor/chmonitor/issues/1521)) ([6e55851](https://github.com/chmonitor/chmonitor/commit/6e55851b9f599df7c32e9e54b063902a8cb379d9))
* **dashboard-tsr:** replace last swr usage with tanstack query, drop swr dep ([#1562](https://github.com/chmonitor/chmonitor/issues/1562)) ([6ccb7f5](https://github.com/chmonitor/chmonitor/commit/6ccb7f51751bd29e67267c16c9cceea50a70abce))
* **dashboard-tsr:** split + dedup large components for reuse ([#1392](https://github.com/chmonitor/chmonitor/issues/1392)) ([#1449](https://github.com/chmonitor/chmonitor/issues/1449)) ([966d96e](https://github.com/chmonitor/chmonitor/commit/966d96e7dfe50c61490c37888f97707da0a6b4bf))

## [0.2.0] - 2026-01-08

### 🏗️ Major Architecture Changes

#### Static Site + SWR Migration
- **Migrated from SSR/dynamic routes to fully static site with client-side API routes**
  - Changed routing from `/[host]/overview` to `/overview?host=0` for better CDN caching
  - All pages are now static pre-rendered and served from edge
  - Client-side data fetching with SWR for real-time data updates
  - Benefits: Faster initial page load, better CDN distribution, simpler deployment

- **Data Fetching Pattern Overhaul**
  - Centralized data fetching through `/api/v1/*` API routes
  - All client components now use SWR hooks (`useChartData`, `useTableData`)
  - `fetchData()` now requires explicit `hostId` parameter (breaking change)
  - Introduced `useHostId()` hook to extract host from query parameters
  - Enables independent data refresh on host switching without full page reload

#### Framework & Build Updates
- **Next.js 15 with React 19** and Turbopack
- **Migrated to Bun** as the primary package manager
  - Better performance and compatibility with modern JavaScript ecosystem
  - Replaced PNPM with Bun (`bun install`, `bun run dev`, etc.)
- **Biome** for code formatting and linting (replacing ESLint/Prettier)
- **Bun test runner** replacing Jest for unit tests
  - Faster test execution and better Node.js compatibility
  - Note: Jest was experiencing hanging issues - Bun provides a stable alternative

#### Cloudflare Workers Deployment
- **Full support for Cloudflare Workers deployment**
  - Uses OpenNextJS for Next.js compatibility
  - API routes run on Workers using Fetch API
  - Hybrid static + API architecture
  - Deploy with: `bun run cf:deploy`
- **Enhanced CI/CD with Docker tagging strategy**
  - Release workflows with automatic Docker image versioning
  - Cloudflare deployment summaries in CI output

### ✨ New Features

#### UI/UX Enhancements
- **User Settings Modal**: Timezone and theme management per user
- **Settings Page**: Column ordering with drag-and-drop, context-aware help
- **Dark Mode Improvements**: Fixed ClickHouse logo visibility in dark mode
- **Command Palette**: Keyboard shortcuts for navigation
- **Readonly Tables Warning**: Indicator for replica tables in cluster overview

#### Data Explorer & Analytics
- **Page Views Analytics**: 4 new charts for usage insights (browsers, devices, pages, referrers)
- **Part Info Page**: Detailed information about ClickHouse table parts
- **Improved Table Validation**: Graceful handling of optional system tables (backup_log, error_log, zookeeper)

#### Developer Tools
- **Enhanced Query EXPLAIN**: Better visualization and context
- **Query Kill Functionality**: Kill long-running queries from UI
- **Zookeeper Explorer**: Monitor cluster coordination

### 🚀 Performance & Infrastructure

#### CDN & Caching
- **Static site architecture** enables aggressive CDN caching at edge
- **Query parameters routing** improves cache hit rates
- **Cloudflare Workers deployment** pre-renders static pages at edge
- **Supports multiple ClickHouse hosts** without cache invalidation

#### Database Query Optimization
- **Version-aware queries** using chronological `sql` arrays
  - Handle ClickHouse schema changes across versions (v23.8, v24.1, etc.)
  - Graceful degradation for missing columns/tables
- **Table validation system** with 5-minute caching
  - Prevents errors on optional tables
  - User-friendly error messages

#### Chart & Visualization
- **30+ metric charts** across all pages
- **Replaced donut charts with progress bars** for better readability
- **Heat maps** for visual performance analysis
- **Graceful error handling** during SWR revalidation preserves user experience

### 🛠️ Development & Testing

#### Testing Infrastructure
- **Cypress component tests** for UI validation
- **Cypress E2E tests** for user workflows
- **Bun test runner** for unit and integration tests
  - `bun run test` - Run all tests with coverage
  - `bun run test:unit` - Unit tests only
  - `bun run test:query-config` - ClickHouse query config validation
- **Query Config Validation**: Automated testing against multiple ClickHouse versions

#### Code Quality
- **Biome** for consistent formatting and linting
- **Type safety** with TypeScript 5
- **React Compiler** for automatic performance optimizations
- **Husky + lint-staged** for pre-commit checks

#### CI/CD Pipeline
- **GitHub Actions workflows** for automated testing and deployment
- **Claude Code integration** for AI-assisted code review
- **Multi-stage Docker builds** for optimized container images
- **Cloudflare Workers deployment** with automatic URL generation

### 🔄 Breaking Changes

1. **Routing**: `/[host]/overview` → `/overview?host=0`
   - Update bookmarks and API clients to use query parameter format

2. **API - `fetchData()` now requires `hostId`**:
   ```typescript
   // Old
   const data = await fetchData(query, variables)

   // New - hostId is required, not optional
   const data = await fetchData(query, variables, hostId)
   ```

3. **Component Props**: All chart/table components require `hostId` prop
   - `<MyChart hostId={hostId} />` instead of relying on context
   - Prevents prop drilling through explicit prop passing at usage site

4. **Package Manager**: Requires Bun 10.18.2+
   - `bun install` instead of `npm install`
   - `bun run dev` instead of `npm run dev`

### 📦 Dependencies

#### Major Upgrades
- React: 18 → 19
- Next.js: 13 → 15
- Tailwind CSS: 3 → 4
- TypeScript: 4 → 5
- Radix UI: Updated to latest versions with new primitives

#### New Dependencies
- `@dnd-kit/*` - Drag-and-drop functionality for column reordering
- `@xyflow/react` - Zookeeper explorer visualization
- `opennextjs-cloudflare` - Next.js on Cloudflare Workers
- `biome` - Code formatter and linter
- `sonner` - Toast notifications

### 🐛 Bug Fixes

- Fixed host switcher not triggering data refresh on navigation
- Fixed darkmode logo visibility issues
- Fixed cluster routing badge counts
- Fixed E2E test navigation with /tables redirect
- Fixed mock import order for Bun test runner
- Improved error handling in env-utils for client components

### 📊 Monitoring & Observability

- **Query Performance Monitoring**: Enhanced query detail page
- **Cluster Health Metrics**: Expanded system metrics coverage
- **Error Logging**: Better error context and user-friendly messages
- **Table Validation**: Prevents confusing errors from optional tables

### 📝 Documentation

- **Migration Guide**: From v0.1 dynamic routing to v0.2 static routing
- **Cloudflare Workers Deployment**: Complete setup and configuration guide
- **Schema Documentation**: Per-version ClickHouse schema compatibility
- **Development Conventions**: Code organization, patterns, and best practices
- **AI Generated Docs**: Available at zread.ai/chmonitor/chmonitor

### 🎯 Comparison: v0.1.16 → v0.2.0

| Aspect | v0.1.16 | v0.2.0 |
|--------|---------|--------|
| **Architecture** | SSR + Dynamic Routes | Static Site + SWR API |
| **Routing** | `/[host]/overview` | `/overview?host=0` |
| **Build Tool** | Turbopack | Turbopack (same, optimized) |
| **Framework** | React 18 + Next.js 13 | React 19 + Next.js 15 |
| **Package Manager** | PNPM | Bun |
| **Linting** | ESLint + Prettier | Biome |
| **Testing** | Jest (with issues) | Bun test runner + Cypress |
| **Deployment** | Vercel + Docker | Vercel + Docker + Cloudflare Workers |
| **Pages** | ~12 static pages | ~15+ static pages + analytics |
| **Charts** | ~20 charts | ~30+ charts |
| **CDN Caching** | Limited (dynamic routes) | Aggressive (static pages) |
| **Load Time** | ~2-3s | ~0.5-1s (edge cache) |

### ⚠️ Known Issues & Limitations

- **Jest Test Runner**: Currently hangs indefinitely in CI environment
  - Workaround: Using Bun test runner instead
  - Alternative: Cypress for testing until resolved

- **Cloudflare Workers Build**: Requires Webpack instead of Turbopack
  - Performance impact during build (CF Workers compatibility requirement)

### 🔮 Future Improvements

- Real-time query streaming with WebSockets
- Advanced analytics dashboard
- Custom metric definitions
- Query performance history and trends
- Cluster topology visualization
- Advanced access control and RBAC

---

## [0.1.16] - Previous Release

For details on v0.1.x releases, see [GitHub Releases](https://github.com/chmonitor/chmonitor/releases).

### Key Features (v0.1 era)

- Multi-host ClickHouse cluster monitoring
- 20+ metric visualization charts
- Query monitoring and management
- Cluster overview and analytics
- Database and table explorer
- Real-time system metrics
- Docker and Vercel deployment support

---

## Version History

- **0.2.0-beta.4** - Pre-release with migration features
- **0.2.0-beta.3** - Cloudflare Workers support
- **0.2.0-beta.2** - SWR migration improvements
- **0.2.0-beta.1** - Initial static site migration
- **0.1.16** - Final v0.1 release
- **0.1.0** - Initial release
