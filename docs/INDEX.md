# Documentation Index

The public [architecture wiki](https://openloopagentics.github.io/opencloudos/) is the primary reading experience. These Markdown files are the reviewable source records for design and execution.

## Start here

- [Domain context](../CONTEXT.md) — canonical project language
- [System architecture](./ARCHITECTURE.md) — modules, state ownership, flows, and failure semantics
- [Execution plan](./EXECUTION_PLAN.md) — workstreams, milestones, backlog, and release gates
- [Deployment Profile SDK](./DEPLOYMENT_PROFILES.md) — extension protocol, capabilities, configuration, reconciliation, migrations, cloud mapping, and PROFILE conformance
- [Subscription-backed agent providers](./SUBSCRIPTION_AUTH.md) — Claude/Codex connection design, policy gates, isolation, and conformance
- [Codex app-server authentication spike](./CODEX_ADAPTER_SPIKE.md) — pinned auth protocol, sanitizer boundary, executable fixtures, and remaining production gates
- [Codex Provider Runner transport](./CODEX_RUNNER_TRANSPORT.md) — bounded stdio JSONL framing, correlation, failure semantics, and fail-closed server requests
- [Codex Provider Runner supervisor](./CODEX_RUNNER_SUPERVISOR.md) — ownership, process lifecycle, generation fencing, capsule boundary, and remaining real-driver work
- [Agent Provider compatibility](./PROVIDER_COMPATIBILITY.md) — current support state, official paths, client pins, and evidence gaps
- [Anthropic approval request draft](./provider-approval/ANTHROPIC_REQUEST_DRAFT.md) — unsent request and maintainer checklist
- [Documentation policy](./DOCUMENTATION.md) — the rule that every material change updates the wiki
- [Project log](./PROJECT_LOG.md) — chronological record of research, decisions, and delivery

## Decisions

- [ADR index](./adr/README.md)

## Rule

A change is not complete until its behavior, design decision, operational consequence, and project-log entry are documented at the appropriate level.
