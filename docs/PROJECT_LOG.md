# Project Log

This log records material OpenCloudOS research, design, implementation, and operational changes. It is chronological and append-only except for correcting factual errors.

## 2026-08-05 — Provider Runtime Broker contract made executable

**Status:** shipped implementation slice

Implemented the first provider-neutral production-code seam in `packages/provider-runtime-broker`. Added the Broker Interface, static policy registry, in-memory Provider Connection store, normalized public events, secret-free audit sink, one-time login bindings, lifecycle transitions, and a synthetic Agent Provider Adapter.

Security behavior implemented:

- unknown and unauthorized Provider Connection references have the same public failure shape;
- every connection and turn verifies Tenant and User ownership;
- Adapter snapshots and events are copied through explicit allowlists;
- login references bind User, Tenant, Provider Connection, and one completion;
- Claude subscription login stays blocked when configuration says enabled but no approval reference exists;
- restored metadata without Credential Capsule state becomes `reauth_required` rather than reconstructing authority;
- logout and revocation remove the synthetic credential fixture and stop new turns;
- rate limits never change billing mode.

Delivery controls implemented:

- AUTH-001 through AUTH-010 run as deterministic Node tests without real credentials;
- documentation integrity checks validate required records, relative links, wiki navigation, ADR registration, and scenario coverage;
- CI enforces wiki, Project Log, and architecture records for material implementation or operational changes;
- GitHub checkout and Node setup Actions moved to their Node 24-based v6 releases;
- provider compatibility matrix published;
- Anthropic approval request drafted but not sent.

Verification:

- ten Broker contract tests passed;
- documentation integrity suite passed;
- TypeScript and production wiki build passed;
- no production provider credential used.

Related decision: ADR-0008. The Codex official-client Adapter and production Credential Capsule are the next technical slice.

## 2026-08-05 — Personal Claude and Codex access designed

**Status:** shipped design; implementation planned

Added user-owned Agent Provider access so people can use eligible subscriptions without turning OpenCloudOS into an OAuth client or shared credential proxy. Defined Provider Connection, Provider Runner, Credential Capsule, and the Provider Runtime Broker module. Added provider-specific support and policy matrix, connection and agent-turn flows, lifecycle and failure semantics, ten AUTH conformance scenarios, WS9, TB-007, execution-queue changes, and release gates.

Decisions and constraints introduced:

- Codex subscription access uses a pinned `codex app-server` Adapter with ChatGPT-managed browser or device-code authentication;
- personal Provider Connections belong to one Tenant and User and cannot be introduced, delegated, pooled, or spent by collaborators;
- official provider clients own credential exchange, storage, refresh, and logout inside per-user Credential Capsules;
- OpenCloudOS never parses provider credential caches or exposes generic OAuth token import;
- Claude subscription support remains `blocked_by_policy` until Anthropic grants written approval for third-party Claude.ai login and subscription rate limits;
- API-key and cloud-provider access remain explicit, separately billed modes with no silent fallback.

Verification:

- current first-party OpenAI Codex and Anthropic Claude authentication documentation reviewed;
- architecture, execution plan, domain context, ADR, documentation policy, pull-request checklist, and public wiki updated together;
- TypeScript production and GitHub Pages subpath builds;
- documentation consistency and broken-link inspection.

Related decision: ADR-0008. Detailed design: `docs/SUBSCRIPTION_AUTH.md`.

## 2026-08-05 — Detailed execution design

**Status:** shipped

Converted the initial research brief into an execution system. Added canonical domain language, module and state design, request and failure flows, nine workstreams, six milestones, the first tracer-bullet backlog, release gates, documentation governance, and seven initial architecture decisions.

Assumptions introduced:

- a core team of four engineers working in two-week iterations;
- Kubernetes is the first portable production substrate;
- workerd remains the gadget sandbox;
- the first distributed architecture uses single-active runtime shards with epoch fencing;
- PostgreSQL owns control-plane metadata while shard-local SQLite owns workspace state;
- every material change updates the public wiki.

Verification:

- TypeScript production build;
- GitHub Pages subpath build;
- documentation cross-link inspection;
- architecture and execution-plan consistency review.
- commit `ecd1f53` pushed to `main`;
- GitHub Pages run `31058568568` completed successfully;
- public wiki returned HTTP 200.

Operational follow-ups discovered during delivery:

- GitHub Actions reported that several pinned action releases still target the deprecated Node.js 20 runtime and are being forced onto Node.js 24; refresh those action revisions as a maintenance change;
- GitHub reported four open Dependabot alerts on the default branch: two high severity and two moderate severity; triage them before implementation dependencies expand.

Related decisions: ADR-0001 through ADR-0007.

## 2026-08-05 — Architecture field guide launched

**Status:** shipped

Researched the newly open-sourced Cloudflare OS repository and published the first OpenCloudOS architecture field guide. Documented the upstream product model, workerd portability gap, target sharded runtime, capability security model, provider matrix, initial roadmap, conformance goals, and naming conflict.

Verification:

- static production build;
- GitHub Pages deployment workflow;
- live site returned HTTP 200.

## 2026-08-05 — Repository initialized

**Status:** shipped

Created the OpenCloudOS repository with a minimal README.
