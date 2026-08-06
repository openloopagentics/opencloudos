# OpenCloudOS Execution Plan

This plan turns the architecture into independently verifiable vertical outcomes. Dates are capacity assumptions, not promises: the baseline is four engineers, two-week iterations, one product/security reviewer shared with the team, and access to AWS, GCP, Azure, and a self-hosted Kubernetes test environment.

## Outcome

Release OpenCloudOS 1.0 as a self-hostable, provider-neutral distribution of Cloudflare OS that:

- runs without a Cloudflare account;
- preserves gadget isolation and capability security;
- installs locally and on conforming Kubernetes clusters;
- provides supported AWS, GCP, Azure, and self-hosted deployment profiles;
- recovers a failed runtime shard without silent workspace-state loss;
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
| Observability | OpenTelemetry / OTLP |
| Release channels | nightly, preview, stable |

## Workstreams

### WS0 — Upstream and release engineering

**Mission:** keep OpenCloudOS close enough to upstream that product improvements can be imported without compromising portable seams.

**Deliverables:**

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

- Docker Compose development profile;
- Helm chart and Kubernetes operator procedures;
- self-hosted, AWS, GCP, and Azure profiles;
- health model, dashboards, alerts, and SLOs;
- upgrade, rollback, backup, restore, shard replacement, and credential-rotation runbooks;
- cost and capacity worksheet.

**Exit evidence:** an operator unfamiliar with the implementation installs each profile from the wiki, runs smoke tests, performs a backup and restore, and completes a version upgrade.

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

## Critical path

```text
WS0 upstream baseline
  └─ WS1 Runtime Host
      ├─ WS2 state inventory + restore
      ├─ WS3 identity + tenancy
      └─ WS4 capability parity
            └─ WS5 placement + routing
                  └─ WS6 provider profiles

WS7 conformance and WS8 documentation run across every step.
```

The most important uncertainty is WS1: whether standalone workerd exposes every runtime semantic currently used by upstream Cloudflare OS in a production-usable form. The program does not commit to the Kubernetes control plane until the Milestone 1 runtime spike passes.

## Milestones

### M0 — Program foundation

**Target:** iteration 1

**Outcomes:**

- domain language, architecture, execution plan, ADR set, and documentation policy accepted;
- upstream source strategy and license inventory complete;
- monorepo/toolchain direction recorded;
- initial threat model and conformance scenario catalog;
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

**Exit gate:** TB-001 and TB-002 pass. Any missing workerd primitive has a measured workaround or a decision to change scope. Failure at this gate reopens ADR-0003 before further platform investment.

### M2 — Secure single-node preview

**Target:** iterations 4–6

**Outcomes:**

- generic OIDC and tenant model;
- Artifact Repository with local and S3-compatible adapters;
- default-deny Gadget egress;
- GitHub Gatekeeper read capability and approval-gated write capability;
- audit ledger and backup/restore;
- Docker Compose installation.

**Exit gate:** TB-003 passes, the single-node conformance suite is green, backup/restore succeeds, and the threat model has no unmitigated critical finding.

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

## First implementation queue

These issues are ordered to reduce uncertainty rather than maximize visible features.

1. Vendor or track the upstream source snapshot with license and patch provenance.
2. Create the pinned workerd runtime image and minimal production configuration.
3. Inventory every upstream use of Durable Objects, Facets, Worker Loader, KV, R2, browser, and service RPC.
4. Define the Runtime Host interface from observed caller needs and failure modes.
5. Implement TB-001 with a production health check and smoke scenario.
6. Specify shard-volume layout, state manifest, and corruption behavior.
7. Implement TB-002 and restart conformance.
8. Define Artifact Repository interface; build filesystem and S3-compatible adapters.
9. Implement generic OIDC and local development identity adapters.
10. Enforce default-deny Gadget egress and test escape attempts.
11. Port the GitHub Gatekeeper through Capability Broker semantics.
12. Implement prepared-action and approval state machines.
13. Add the Audit Ledger and privileged fail-closed behavior.
14. Ship Docker Compose preview with backup and restore.
15. Define Placement Registry schema and property tests for lease epochs.
16. Build Request Gateway routing without WebSocket support, then add reconnect semantics.
17. Build Shard Controller and Helm alpha.
18. Add shard fault injection and TB-005.
19. Add provider adapters and deployment profiles one at a time behind the same tests.
20. Run release-candidate security and operator validation.

## Release gates

Every preview or stable release must satisfy:

- source, dependency, type, and image builds are reproducible;
- license notices, SBOM, and provenance are present;
- all required conformance scenarios pass or have a published, approved deviation;
- Gadget egress and capability-attenuation tests pass;
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
5. Upgrade, rollback, and recovery effects are understood.
6. Domain language and ADRs are updated if the change introduces either.
7. Architecture and execution documentation reflect the resulting system.
8. The public wiki and project log are updated in the same pull request.
9. CI and the relevant conformance target pass.

## Metrics

### Product and runtime

- workspace open success and latency;
- Gadget cold start and warm invocation latency;
- active WebSocket sessions and reconnect success;
- sandbox policy violations;
- agent model request latency, tokens, and cost by tenant policy.

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
| Recovery too slow | Volume attach or replay exceeds SLO | Revisit shard size, snapshots, and placement units | Repartition before stable |
| Documentation drift | Code behavior differs from wiki | Required checks and owner review | Block release |
| Name conflict | Community or legal review rejects OpenCloudOS | Rename before package and domain ecosystem hardens | Must resolve before public 1.0 branding |

## Immediate next decision

Milestone 0 must decide how upstream source is tracked: a history-preserving fork, a vendor subtree with a patch queue, or a package-level downstream. The default recommendation is a history-preserving fork plus explicit portability patches because it maximizes upstream merge visibility. That choice should be validated against Cloudflare's repository contribution posture and the expected size of runtime changes before implementation begins.
