# OpenCloudOS Execution Plan

This plan turns the architecture into independently verifiable vertical outcomes. Dates are capacity assumptions, not promises: the baseline is four engineers, two-week iterations, one product/security reviewer shared with the team, and access to AWS, GCP, Azure, and a self-hosted Kubernetes test environment.

## Outcome

Release OpenCloudOS 1.0 as a self-hostable, provider-neutral distribution of Cloudflare OS that:

- runs without a Cloudflare account;
- preserves gadget isolation and capability security;
- installs locally and on conforming Kubernetes clusters;
- provides supported AWS, GCP, Azure, and self-hosted deployment profiles;
- recovers a failed runtime shard without silent workspace-state loss;
- lets each user run agent turns through an eligible personal Codex subscription, with Claude subscription support enabled only after required provider approval;
- passes a shared behavioral suite against the upstream Cloudflare deployment;
- documents every material behavior, decision, operational consequence, and shipped change in the wiki.

## Non-goals for 1.0

- multi-region active-active workspace execution;
- replacing workerd with a new sandbox runtime;
- transparent live migration of an active workspace between shards;
- reproducing Cloudflare's global edge placement or scale claims;
- supporting every upstream Gatekeeper at launch;
- hiding infrastructure cost or operational responsibility from the operator;
- a custom identity protocol, secret store, database, or object store.
- sharing, pooling, reselling, or silently falling back from a personal provider subscription;
- reverse-engineered Claude or Codex OAuth flows, copied credential caches, or generic browser-token import.

## Program assumptions

| Assumption | Baseline |
|---|---|
| Team | 4 engineers plus shared product/security review |
| Iteration | 2 weeks |
| Delivery style | Tracer-bullet vertical slices |
| First production substrate | Kubernetes 1.32+ on Linux amd64/arm64 |
| Sandbox | Pinned workerd release |
| Control metadata | PostgreSQL 16+ |
| Local object storage | MinIO or filesystem adapter |
| Authentication | OIDC plus local development adapter |
| Agent provider access | Per-user Provider Connections through pinned official clients; explicit API-funded fallbacks |
| Observability | OpenTelemetry / OTLP |
| Release channels | nightly, preview, stable |
| Original project license | MIT; upstream and third-party material retains its applicable license and notices |

## Current execution status

| Slice | Status | Evidence / next condition |
|---|---|---|
| M0 documentation control | Implemented | CI runs contract, documentation-integrity, material-change, type, and wiki build checks |
| Deployment Profile SDK | Protocol v1 implemented | Registry, seven capability contracts, config validation, generation-fenced reconciliation, checkpointed migrations, synthetic full profile, and PROFILE-001–011 |
| AWS profile | Experimental implementation | All seven drivers and real AWS/EKS bindings pass deterministic PROFILE/AWS suites; next gate is repeatable IaC and ephemeral-account conformance |
| GCP / Azure / self-hosted profiles | Not implemented | Build self-hosted/Kubernetes next; protocol remains provisional until two materially different profiles pass real-resource conformance |
| WS9 provider-neutral Broker | Implemented | Interface, policy registry, in-memory metadata store, normalized events, audit sink, and synthetic Adapter |
| AUTH-001 through AUTH-010 | Passing on synthetic target | Ten deterministic tests; official-provider and process-isolation targets still required |
| Anthropic approval package | Drafted, not sent | Maintainer must assign owner, review scope, and send through an approved channel |
| Codex auth protocol Adapter | Implemented as fixture spike | `codex-cli 0.146.1` schema captured; CODEX-001–008 cover handshake, sanitation, device login, limits, logout, billing separation, and fail-closed turns |
| Codex stdio JSONL transport | Implemented | RUNNER-001–008 cover request correlation, notifications, redaction, framing, bounds, shutdown, and default rejection of server requests |
| Codex isolated runner supervisor | Contract implemented | SUPERVISOR-001–008 prove exact pins, hidden ownership, init health, concurrency, crash fencing/recovery, stop/forced kill, and destruction against synthetic drivers |
| Local runtime + encrypted capsule drivers | Next | Spawn pinned app-server, bind the bounded stdio transport, enforce process/filesystem/network isolation, persist metadata, and reconcile orphans |
| Codex turn Adapter + approval bridge | Planned after real driver | Map stable thread/turn events and route server requests through Capability Broker rather than automatic approval |
| Claude subscription Adapter | Blocked | Written Anthropic approval reference required before Adapter login can start |

Implementation status is also published in `docs/SUBSCRIPTION_AUTH.md`, `docs/PROVIDER_COMPATIBILITY.md`, the Project Log, and the public wiki.

## Workstreams

### WS0 — Upstream and release engineering

**Mission:** keep OpenCloudOS close enough to upstream that product improvements can be imported without compromising portable seams.

**Deliverables:**

- root MIT license and package metadata for original project work;
- third-party provenance boundary and automated license consistency checks;
- preserved Apache-2.0 notices and upstream history strategy;
- pinned upstream commit and workerd version manifest;
- automated upstream-diff and compatibility report;
- release image signing, software bill of materials, provenance, and changelog;
- nightly, preview, and stable channels.

**Exit evidence:** import a newer upstream commit in a rehearsal branch, classify every conflict, run conformance, and produce an upgrade report without manual archaeology.

**Depends on:** none. Enables every other workstream.

### WS1 — Runtime compatibility

**Mission:** run the upstream product through a deep Runtime Host module without exposing workerd mechanics to product callers.

**Deliverables:**

- production workerd configuration generator;
- Runtime Host interface and local adapter;
- workspace supervisor, Gadget sandbox, Facet storage, RPC, and WebSocket compatibility inventory;
- pinned compatibility flags and runtime limits;
- process health, graceful drain, checkpoint, and restart behavior.

**Exit evidence:** create a gadget, modify it, collaborate through a WebSocket, restart the runtime process, and recover code plus state with no Cloudflare account.

**Depends on:** WS0. Blocks WS4, WS5, and WS6.

### WS2 — State and artifacts

**Mission:** make state ownership explicit and portable without flattening shard-local transaction semantics into remote calls.

**Deliverables:**

- shard-volume layout and migration manifest;
- Artifact Repository interface;
- filesystem/MinIO and S3-compatible adapters;
- metadata publish ordering;
- snapshot, restore, checksum verification, and retention commands;
- PostgreSQL schemas for control metadata.

**Exit evidence:** back up a populated instance, restore into a clean installation, and verify users, workspaces, gadgets, blueprints, prepared actions, and audit references.

**Depends on:** WS1 for state inventory. Enables WS5 and WS6.

### WS3 — Identity and tenancy

**Mission:** normalize human and workload identity while keeping identity separate from capability authority.

**Deliverables:**

- Identity module interface;
- generic OIDC and local development adapters;
- tenant/user mapping and group policy;
- workload identity for internal calls;
- session invalidation, logout, and disabled-user behavior;
- tenant-isolation tests and audit context propagation.

**Exit evidence:** two tenants use the same deployment with no discoverable cross-tenant users, workspace identifiers, artifacts, metrics labels, capabilities, or audit records.

**Depends on:** WS0. Enables production WS4 and WS5.

### WS4 — Capabilities and Gatekeepers

**Mission:** preserve introductions, capability attenuation, staged mutations, human approval, and audit across portable deployments.

**Deliverables:**

- Capability Broker interface;
- Gatekeeper lifecycle and packaging convention;
- credential isolation through SecretStore adapters;
- prepared-action state machine with drift, expiry, idempotency, and compensation metadata;
- first supported Gatekeepers: GitHub, generic MCP, and one document provider;
- revocation and delegation conformance scenarios.

**Exit evidence:** a gadget receives repository-read authority only, cannot write, then receives a separate write capability whose mutation remains external-effect-free until user approval.

**Depends on:** WS1 and WS3. Security-critical release blocker.

### WS5 — Placement and routing control plane

**Mission:** distribute workspaces across runtime shards while preserving single ownership and explicit recovery.

**Deliverables:**

- Request Gateway, Placement Registry, and Shard Controller modules;
- PostgreSQL placement schema and epoch fencing;
- workspace allocation, lease renewal, drain, move, and failure recovery;
- WebSocket proxy and reconnect semantics;
- shard capacity and admission policy;
- operator-visible placement and recovery status.

**Exit evidence:** route 1,000 workspaces across at least three shards, kill one shard, recover its volume, issue new epochs, and reject writes from a deliberately stale owner.

**Depends on:** WS1, WS2, WS3, and WS4. Defines Kubernetes alpha.

### WS6 — Deployment profiles and operations

**Mission:** make installation, upgrade, backup, recovery, and observation consistent across providers.

**Deliverables:**

- Deployment Profile SDK with immutable manifests, strict configuration, capability discovery, generation fencing, migrations, and conformance;
- Docker Compose development profile;
- Helm chart and Kubernetes operator procedures;
- self-hosted, AWS, GCP, and Azure profiles;
- health model, dashboards, alerts, and SLOs;
- upgrade, rollback, backup, restore, shard replacement, and credential-rotation runbooks;
- cost and capacity worksheet.

**Exit evidence:** an operator unfamiliar with the implementation installs each profile from the wiki, runs PROFILE-001–011 plus product smoke tests, performs a backup and restore, and completes a version upgrade.

**Depends on:** WS1 through WS5. Provides beta and 1.0 packaging.

### WS7 — Security and conformance

**Mission:** make behavioral fidelity and security invariants executable release gates.

**Deliverables:**

- threat model and abuse cases;
- Conformance Harness interface;
- upstream Cloudflare, local, and Kubernetes target adapters;
- gadget isolation, capability, approval, tenancy, recovery, and audit scenarios;
- dependency, image, secret, and infrastructure scanning;
- independent penetration-test plan and remediation gate.

**Exit evidence:** every stable release publishes a signed conformance report, threat-model delta, known deviations, and recovery-test result.

**Depends on:** begins with WS0 and grows alongside every workstream. Can block any release.

### WS8 — Documentation and community

**Mission:** make the wiki the current source of project intent and operations.

**Deliverables:**

- canonical context, architecture, ADR, execution, runbook, and project-log structure;
- pull request documentation checklist;
- automated documentation-change policy;
- contributor setup and upstream-sync guide;
- release notes generated from reviewed project-log entries;
- public compatibility and deviation matrix.

**Exit evidence:** every merged change in a release is traceable from wiki outcome to decision, implementation, verification, and operation.

**Depends on:** continuous across the program.

### WS9 — Agent providers and subscription access

**Mission:** let every user connect and spend their own eligible agent-provider subscription without exposing credentials, pooling usage, or bypassing vendor policy.

**Deliverables:**

- Provider Runtime Broker interface and synthetic Adapter;
- per-user Provider Runner and encrypted Credential Capsule lifecycle;
- Codex app-server Adapter with ChatGPT-managed device-code/browser login, status, rate limits, logout, and restart behavior;
- API-key and cloud-provider modes presented as explicit, separately billed connections;
- Claude Agent SDK/Claude Code Adapter implemented behind an unbypassable approval gate;
- provider compatibility matrix with client versions, supported plans, policy-review date, and deviations;
- AUTH-001 through AUTH-010 conformance scenarios and malicious-repository isolation fixtures;
- Anthropic third-party approval request and recorded outcome.

**Exit evidence:** two users collaborate in one workspace, connect separate provider test accounts, run interleaved turns, hit and recover from limit/reauthorization states, restart Provider Runners, and revoke connections without enumerating or spending each other's authority or exposing credential material. Claude subscription evidence is required only after written Anthropic approval; without approval the mode remains visibly blocked.

**Depends on:** policy work begins in WS0; implementation depends on WS1 and WS3. Security-critical release blocker for every enabled subscription mode.

## Critical path

```text
WS0 upstream baseline
  └─ WS1 Runtime Host
      ├─ WS2 state inventory + restore
      ├─ WS3 identity + tenancy
      │   └─ WS9 provider connections + credential capsules
      └─ WS4 capability parity
            └─ WS5 placement + routing
                  └─ WS6 provider profiles

WS7 conformance and WS8 documentation run across every step. WS9 starts provider-policy work in M0 and joins the technical critical path after identity exists.
```

The most important uncertainty is WS1: whether standalone workerd exposes every runtime semantic currently used by upstream Cloudflare OS in a production-usable form. The program does not commit to the Kubernetes control plane until the Milestone 1 runtime spike passes.

## Milestones

### M0 — Program foundation

**Target:** iteration 1

**Outcomes:**

- domain language, architecture, execution plan, ADR set, and documentation policy accepted;
- MIT project license, upstream source strategy, and license inventory complete;
- monorepo/toolchain direction recorded;
- initial threat model and conformance scenario catalog;
- provider-auth support matrix, Anthropic approval request, and ADR-0008 reviewed;
- CI builds the wiki and validates source, license, secrets, and documentation expectations.

**Exit gate:** a new contributor can explain the system, run the current wiki, locate every decision, and pick up a scoped tracer-bullet issue.

### M1 — Portable runtime feasibility

**Target:** iterations 2–3

**Outcomes:**

- upstream frontend and backend run in a pinned production workerd process;
- one user can create, run, edit, and reload one Gadget;
- local persistence survives process restart;
- runtime feature inventory classifies supported, emulated, blocked, and deferred semantics;
- no Cloudflare account is required for the demonstrated slice.
- Provider Runtime Broker synthetic Adapter proves user ownership and event normalization without production credentials.

**Exit gate:** TB-001 and TB-002 pass. Any missing workerd primitive has a measured workaround or a decision to change scope. Failure at this gate reopens ADR-0003 before further platform investment.

### M2 — Secure single-node preview

**Target:** iterations 4–6

**Outcomes:**

- generic OIDC and tenant model;
- Codex app-server subscription connection for two test users, including device-code login, limit state, logout, and runner restart;
- Claude subscription mode visibly blocked unless written Anthropic approval has been recorded;
- Artifact Repository with local and S3-compatible adapters;
- default-deny Gadget egress;
- GitHub Gatekeeper read capability and approval-gated write capability;
- audit ledger and backup/restore;
- Docker Compose installation.

**Exit gate:** TB-003 and TB-007 pass, the single-node conformance suite is green, backup/restore succeeds, AUTH-001 through AUTH-010 pass for every enabled provider mode, and the threat model has no unmitigated critical finding.

### M3 — Kubernetes alpha

**Target:** iterations 7–10

**Outcomes:**

- stateless Request Gateway;
- Placement Registry with lease epoch fencing;
- three runtime shards managed through Kubernetes;
- WebSocket routing and reconnect;
- Helm installation using PostgreSQL and MinIO;
- shard loss and volume recovery runbook.

**Exit gate:** TB-004 and TB-005 pass under repeated fault injection. A stale shard cannot acknowledge a write. No recovery path silently creates empty workspace state.

### M4 — Multi-cloud beta

**Target:** iterations 11–13

**Outcomes:**

- supported self-hosted, AWS, GCP, and Azure profiles;
- secret-store and object-store adapters for each profile;
- Credential Capsule storage, destruction, recovery, and egress behavior for each profile;
- signed images, SBOM, provenance, dashboards, alerts, and SLO draft;
- upgrade and rollback rehearsal;
- operator installation study.

**Exit gate:** the same release passes conformance and recovery on all four profiles, with deviations published in the wiki.

### M5 — 1.0 release candidate

**Target:** iterations 14–15

**Outcomes:**

- release conformance report and compatibility matrix;
- independent security review and critical/high remediation;
- disaster-recovery rehearsal with recorded RPO/RTO;
- support policy, upgrade window, and deprecation policy;
- complete administrator, contributor, and Gatekeeper author documentation.
- current agent-provider compatibility matrix and provider-policy review.

**Exit gate:** all stable-release gates pass, no critical known deviation is hidden, and two independent operators complete install, upgrade, backup, and restore from documentation alone.

## Tracer-bullet backlog

### TB-001 — Boot the upstream experience without Cloudflare

**Outcome:** a clean checkout produces an OCI image that serves the upstream UI and backend through workerd.

**Acceptance:** no Cloudflare credentials; pinned source and runtime versions; health endpoint; one documented command; license notices included.

### TB-002 — Persist one Gadget through restart

**Outcome:** a user creates a Gadget, writes state, stops the runtime, restarts it, and observes the same code and state.

**Acceptance:** isolated gadget storage; deterministic volume path; corrupt/missing volume fails visibly; automated scenario.

### TB-003 — Introduce a repository safely

**Outcome:** an OIDC-authenticated user introduces one GitHub repository to one Gadget.

**Acceptance:** read capability cannot mutate; write call becomes a prepared action; rejection has no side effect; approval commits once; all steps audited.

### TB-004 — Route workspaces across shards

**Outcome:** a gateway places and routes workspaces across three runtime shards.

**Acceptance:** stable routing; tenant validation; capacity rejection; WebSocket connection; placement introspection; epoch attached to every request.

### TB-005 — Recover a failed shard

**Outcome:** a killed shard returns on the same volume and its workspaces reconnect.

**Acceptance:** old epoch fenced; new epoch issued; no empty-state fallback; prepared actions preserved; recovery evidence published.

### TB-006 — Prove the same release on four profiles

**Outcome:** one release artifact runs on self-hosted Kubernetes, EKS, GKE, and AKS.

**Acceptance:** identical product/runtime images; only adapters and infrastructure values differ; conformance results and cost envelope published.

### TB-007 — Connect and isolate personal subscriptions

**Outcome:** two users in one shared workspace connect separate Codex test subscriptions and run interleaved agent turns through dedicated Provider Runners. The Claude path reports `blocked_by_policy` until written approval exists, then must pass the same slice before enablement.

**Acceptance:** official client login only; per-user connection ownership; no cross-user enumeration or spend; credentials absent from workspace files, environments, processes, prompts, logs, traces, and audit; explicit subscription billing label; visible rate limit; runner restart; logout and revocation; no implicit API-key fallback; AUTH-001 through AUTH-010 automated.

## First implementation queue

These issues are ordered to reduce uncertainty rather than maximize visible features.

1. Vendor or track the upstream source snapshot with license and patch provenance.
2. Request Anthropic approval for third-party Claude.ai login and subscription limits; record the response without blocking other work.
3. Pin official Codex and Claude clients and publish the first provider compatibility matrix.
4. Create the pinned workerd runtime image and minimal production configuration.
5. Inventory every upstream use of Durable Objects, Facets, Worker Loader, KV, R2, browser, and service RPC.
6. Define the Runtime Host interface from observed caller needs and failure modes.
7. Implement TB-001 with a production health check and smoke scenario.
8. Specify shard-volume layout, state manifest, and corruption behavior.
9. Implement TB-002 and restart conformance.
10. Define Artifact Repository interface; build filesystem and S3-compatible adapters.
11. Implement generic OIDC and local development identity adapters.
12. Define Provider Runtime Broker and implement a synthetic Adapter for AUTH-001 through AUTH-010.
13. **Implemented:** spike Codex app-server managed device-code login from generated `codex-cli 0.146.1` schemas without reading its credential cache or a real account.
14. **Implemented contract:** capsule-bound supervisor passes SUPERVISOR-001–008 with a pinned manifest, one capsule per connection, generation fencing, explicit recovery, bounded stop, and irreversible destruction against synthetic drivers.
15. **Implemented protocol:** Deployment Profile SDK v1, seven capability contracts, synthetic full profile, and PROFILE-001–011 conformance.
16. **Active:** implement the real local app-server runtime and encrypted capsule drivers, bind the bounded stdio transport, persist supervisor state, and reconcile orphans.
17. Map Codex thread/turn events and implement the explicit Capability Broker approval bridge.
18. Enforce default-deny Gadget egress and malicious-repository credential isolation.
19. Port the GitHub Gatekeeper through Capability Broker semantics.
20. Implement prepared-action and approval state machines.
21. Add the Audit Ledger and privileged fail-closed behavior.
22. **Implemented experimental adapter:** add the full AWS EKS profile and pass PROFILE-001–011 plus AWS-001–006 against deterministic AWS/EKS fakes.
23. Build repeatable isolated-account AWS IaC and run the live qualification, recovery, security, cost, and operator gates before changing its support label.
24. Build the first real self-hosted/Kubernetes Deployment Profile and run PROFILE-001–011.
25. Ship Docker Compose preview with backup, restore, capsule destruction, and reauthorization.
26. Define Placement Registry schema and property tests for lease epochs.
27. Build Request Gateway routing without WebSocket support, then add reconnect semantics.
28. Build Shard Controller and Helm alpha.
29. Add shard fault injection and TB-005.
30. Add GCP and Azure profiles one at a time behind the same tests.
31. If Anthropic approval exists, enable Claude subscription mode only after TB-007 and independent security review pass.
32. Run release-candidate security and operator validation.

## Release gates

Every preview or stable release must satisfy:

- source, dependency, type, and image builds are reproducible;
- license notices, SBOM, and provenance are present;
- all required conformance scenarios pass or have a published, approved deviation;
- PROFILE-001 through PROFILE-011 pass against real resources for every supported Deployment Profile;
- Gadget egress and capability-attenuation tests pass;
- AUTH-001 through AUTH-010 pass for every enabled Agent Provider mode;
- each subscription mode has current official documentation, pinned client evidence, and required provider approval;
- no personal Provider Connection can be enumerated, delegated, or spent by another user;
- no provider credential is observable from workspace code, tool execution, product state, telemetry, or audit;
- billing mode is explicit and no subscription-to-API fallback occurs without user consent;
- backup artifacts restore successfully in a clean environment;
- migrations have forward, rollback, and interrupted-run evidence;
- release images are signed;
- no critical vulnerability or threat-model finding is open;
- runbooks match the released interfaces and failure modes;
- architecture, execution plan, ADR registry, compatibility matrix, and project log are current;
- GitHub Pages deploy succeeds.

Stable releases additionally require:

- shard failure rehearsal;
- credential rotation rehearsal;
- upgrade from the previous supported release;
- recovery-point and recovery-time evidence;
- operator installation validation;
- security approval.

## Definition of done

A work item is done only when:

1. Its user or operator outcome is demonstrated.
2. The owning module and interface are clear.
3. Success, error, retry, ordering, and security semantics are tested at that interface.
4. Metrics, traces, and audit consequences are implemented where applicable.
5. Agent-provider work proves credential isolation, per-user billing authority, logout, revocation, rate limits, and policy status.
6. Upgrade, rollback, and recovery effects are understood.
7. Domain language and ADRs are updated if the change introduces either.
8. Architecture and execution documentation reflect the resulting system.
9. The public wiki and project log are updated in the same pull request.
10. CI and the relevant conformance target pass.

## Metrics

### Product and runtime

- workspace open success and latency;
- Gadget cold start and warm invocation latency;
- active WebSocket sessions and reconnect success;
- sandbox policy violations;
- agent model request latency, tokens, and cost by tenant policy.
- provider connections by mode and sanitized state;
- provider login, reauthorization, logout, and revocation success;
- provider rate-limit events and reset duration by user-visible mode;
- Provider Runner cold start, restart, session resume, and cancellation success;

### Control plane

- placement resolution latency and conflicts;
- lease renewal failures and stale-epoch rejections;
- shard capacity, recovery duration, and unavailable workspaces;
- gateway retry and route invalidation rate.

### Capability security

- active capabilities by scope and subject;
- prepared-action age, approval latency, expiry, rejection, and conflict;
- idempotent replay count and unknown external outcomes;
- audit append failures;
- Gatekeeper provider errors by operation classification.

### Delivery health

- upstream lag in commits and days;
- conformance pass rate and known deviations;
- mean shard recovery time;
- backup restore success and age;
- percentage of merged changes with wiki and project-log updates;
- time from preview to stable.

## Risks and decision triggers

| Risk | Early signal | Response | Decision trigger |
|---|---|---|---|
| Missing workerd production primitive | M1 spike cannot reproduce state or isolation | Minimize compatibility adapter; prototype contained upstream patch | Reopen workerd ADR if conformance cannot pass |
| Upstream divergence | Import conflicts grow each cycle | Shrink patches; upstream generic portability changes | Pause feature work if rebasing exceeds 20% capacity |
| Split-brain workspace writes | Fault test acknowledges two epochs | Strengthen fencing at storage open and request paths | Block Kubernetes alpha |
| Gatekeeper simulation drift | Prepared actions conflict frequently | Improve fingerprinting, preview language, and expiry | Disable deferred approval per operation if unsafe |
| Provider adapter leakage | Core module imports provider SDK | Move behavior behind an existing real seam | Block profile merge |
| Personal credential exposure | Tool fixture reads credential file, environment, process, transport, log, or trace | Stop release; redesign capsule isolation and rotate test credential | Block every subscription mode |
| Cross-user subscription spend | Collaborator turn resolves another user's connection | Enforce initiating-user ownership at Broker and session state | Security incident and release blocker |
| Claude approval absent or withdrawn | No written approval, or provider policy changes | Keep or move mode to `blocked_by_policy`; offer explicit API/cloud modes | Never enable based on technical feasibility alone |
| Official client drift | Login, event, rate-limit, or logout fixture changes | Hold pinned version; update Adapter and compatibility record | Block client upgrade and stable release |
| Silent billing fallback | Environment API key overrides subscription or runner changes mode | Sanitize runner environment and require explicit connection selection | Block provider mode |
| Recovery too slow | Volume attach or replay exceeds SLO | Revisit shard size, snapshots, and placement units | Repartition before stable |
| Documentation drift | Code behavior differs from wiki | Required checks and owner review | Block release |
| Name conflict | Community or legal review rejects OpenCloudOS | Rename before package and domain ecosystem hardens | Must resolve before public 1.0 branding |

## Immediate next decision

Milestone 0 has two immediate decisions. First, decide how upstream source is tracked: a history-preserving fork, a vendor subtree with a patch queue, or a package-level downstream. The default recommendation remains a history-preserving fork plus explicit portability patches because it maximizes upstream merge visibility.

Second, submit the Anthropic third-party approval request and record its exact scope. This request does not block the provider-neutral Broker, Codex Adapter, synthetic AUTH suite, or Claude API/cloud Adapters. It does block enabling Claude subscription authentication in any public or hosted distribution. Technical success with `claude setup-token` is not approval.
