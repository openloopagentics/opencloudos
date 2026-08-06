# OpenCloudOS System Architecture

OpenCloudOS preserves the Cloudflare OS product and capability model while adding a portable control plane around the open-source workerd runtime. The design optimizes first for behavioral fidelity, tenant isolation, recoverability, and the ability to run the same release on any conforming Kubernetes cluster.

## Architectural principles

1. Preserve security semantics before feature breadth.
2. Keep generated code inside workerd rather than replacing isolate semantics prematurely.
3. Give every workspace one authoritative runtime owner at a time.
4. Put provider variation behind real seams with at least two adapters.
5. Make the module interface the conformance-test surface.
6. Prefer deep modules that hide provider, lifecycle, and recovery complexity.
7. Treat documentation and operational evidence as release artifacts.
8. Keep personal subscription credentials user-bound and owned by official provider runtimes.

## System contexts

### Product plane

The product plane is the user-visible Cloudflare OS experience: users, workspaces, agent sessions, gadgets, blueprints, sharing, collaboration, and gatekeepers. It should remain close to upstream so changes can be rebased rather than reimplemented.

### Control plane

The control plane authenticates requests, resolves tenant policy, assigns workspace placement, fences stale runtime owners, coordinates shard lifecycle, and records deployment state. It never executes generated gadget code.

### Runtime plane

The runtime plane hosts workspace supervisors, gadget sandboxes, gatekeeper facets, WebSockets, and shard-local state inside workerd. A runtime shard is single-active and must hold a valid placement lease before serving a workspace.

### Integration plane

The integration plane consists of gatekeepers and provider adapters. Gatekeepers enforce user authority toward external products. Provider adapters satisfy portable infrastructure interfaces without changing product semantics.

### Agent provider plane

The agent provider plane runs official provider clients in per-user credential capsules. It converts a user-owned provider connection into an agent execution stream while hiding OAuth, credential refresh, subscription entitlements, rate limits, and vendor session mechanics. It is distinct from product sign-in: proving a user identity never grants access to Claude, Codex, or another provider.

## Deep modules

### Request Gateway module

**Purpose:** turn an incoming HTTP or WebSocket request into an authenticated, tenant-scoped request delivered to the valid workspace owner.

**Interface:** callers provide a request and workspace locator. They may receive a response, an authentication failure, a placement-unavailable failure, or a retryable shard failure. The interface guarantees tenant context, trace context, request identity, and placement epoch propagation.

**Implementation hidden behind the interface:** OIDC validation, tenant resolution, placement lookup, connection proxying, bounded retry, stale-route invalidation, and request metrics.

**Invariants:**

- no unauthenticated request reaches a private workspace;
- the tenant in the identity must match the tenant in placement;
- retries never cross a side-effecting commit without an idempotency key;
- WebSocket sessions are attached to one placement epoch.

### Placement Registry module

**Purpose:** maintain the authoritative workspace-to-shard assignment and lease epoch.

**Interface:** allocate, resolve, renew, release, and move placement. Each successful mutation returns a monotonically increasing epoch. Conflicts are explicit rather than last-write-wins.

**Implementation hidden behind the interface:** PostgreSQL transactions, advisory coordination, expiry calculation, shard capacity policy, and audit events.

**Invariants:**

- at most one unexpired lease exists for a workspace epoch;
- a new owner always receives an epoch greater than every prior owner;
- a shard must prove its epoch when opening workspace state;
- expired owners cannot renew after a successor is assigned.

### Shard Controller module

**Purpose:** reconcile desired runtime-shard capacity with healthy workerd processes and durable volumes.

**Interface:** declare capacity, drain a shard, replace a failed shard, and report readiness. Draining is idempotent and does not itself move a workspace without the Placement Registry.

**Implementation hidden behind the interface:** Kubernetes StatefulSets, persistent-volume claims, readiness gates, disruption budgets, image rollout, and volume attachment.

**Invariants:**

- one active pod mounts a shard volume read-write;
- a shard is not ready until it can validate leases and open local storage;
- rollout never intentionally removes the last recoverable copy of state;
- shutdown stops lease renewal before process termination.

### Runtime Host module

**Purpose:** translate a valid placed request into upstream workspace execution inside workerd.

**Interface:** open a workspace for an epoch, deliver HTTP/RPC/WebSocket events, checkpoint, and close. Callers do not configure Durable Objects, Facets, or workerd services directly.

**Implementation hidden behind the interface:** workerd configuration, Durable Object namespaces, Facet loading, local SQLite layout, runtime bindings, compatibility flags, and process supervision.

**Invariants:**

- the host rejects an older placement epoch;
- gadget code has no ambient network access;
- each gadget sees only introduced capabilities;
- runtime compatibility is pinned and included in release metadata.

### Provider Runtime Broker module

**Purpose:** connect each user to an agent provider and execute agent turns through that user's own subscription or an explicitly governed API-funded connection.

**Interface:** begin a provider connection, return a browser or device-code challenge, observe sanitized connection status, start or resume a provider turn, stream normalized events, report entitlement or rate-limit state, log out, and revoke. Callers exchange opaque provider-connection and provider-session references; no Interface returns raw access or refresh credentials.

**Implementation hidden behind the interface:** provider-runner lifecycle, official client protocols, OAuth browser and device-code flows, credential persistence and refresh, plan and workspace selection, vendor event normalization, rate-limit translation, logout, encrypted capsule storage, and version compatibility.

**Adapters:** Codex uses a dedicated `codex app-server` runner with ChatGPT-managed authentication. Claude uses the official Claude Agent SDK or Claude Code runner, but subscription authentication remains disabled until Anthropic grants written third-party approval. API-key, Bedrock, Google Cloud Agent Platform, and Microsoft Foundry modes remain separate adapters.

**Invariants:**

- every personal provider connection belongs to exactly one tenant and user;
- a provider connection cannot be introduced, delegated, pooled, or used by another user;
- official provider clients own OAuth initiation, token exchange, persistence, refresh, and logout;
- product code never parses provider credential caches or implements undocumented OAuth endpoints;
- raw credentials never enter PostgreSQL, workspace state, gadget bindings, model context, tool environments, telemetry, or audit payloads;
- provider credentials and the tool-execution sandbox do not share a readable filesystem, environment, or debug interface;
- a provider turn records the initiating user and provider connection without recording credential material;
- a provider-policy or entitlement failure fails closed and never falls back to a chargeable API key without explicit user consent.

### Capability Broker module

**Purpose:** create, attenuate, invoke, and revoke capabilities for agent sessions and gadgets.

**Interface:** introduce a resource, describe available operations, invoke a read, prepare a mutation, commit or reject a prepared action, and revoke authority. The interface exposes resource scope and risk classification.

**Implementation hidden behind the interface:** gatekeeper discovery, OAuth credential lookup, capability serialization, action staging, policy checks, idempotency, and audit correlation.

**Invariants:**

- capabilities are unforgeable and scoped to a tenant and subject;
- delegated authority is equal to or narrower than parent authority;
- raw long-lived credentials never enter gadget or model context;
- every mutation is either classified auto-commit by policy or becomes a prepared action;
- commit is idempotent for one prepared-action identity.

### Artifact Repository module

**Purpose:** store and retrieve immutable blueprint versions, exports, avatars, and other large artifacts.

**Interface:** put immutable content by digest, resolve metadata, stream content, list versions, and apply retention. A successful put is readable before metadata is published.

**Adapters:** S3-compatible storage and filesystem/MinIO are the first two real adapters; GCS and Azure Blob follow through the same conformance suite.

**Invariants:**

- published metadata never references missing content;
- artifact identity is content-derived where practical;
- tenant scope is part of every storage key and authorization check;
- checksums are verified on restore.

### Identity module

**Purpose:** convert provider identity into a normalized tenant and user context.

**Interface:** authenticate, refresh, log out, and resolve group claims. It exposes stable internal identifiers rather than provider subject strings to the rest of the product.

**Adapters:** generic OIDC and local development identity are the first two adapters.

**Invariants:**

- identity proves who the user is but grants no gadget capability;
- issuer and audience are deployment configuration, never user input;
- tenant selection is deterministic and audited;
- disabling a user prevents new sessions without rewriting history.

### Audit Ledger module

**Purpose:** append and query security-relevant facts with traceable causality.

**Interface:** append an event with tenant, actor, subject, action, placement epoch, correlation identity, and outcome; query by authorized scope; export with integrity metadata.

**Implementation hidden behind the interface:** durable writes, hash chaining or equivalent tamper evidence, redaction, retention, and export batching.

**Invariants:**

- audit failure blocks privileged commit unless a recorded emergency policy says otherwise;
- secrets and raw model context are never written;
- events are append-only;
- timestamps and correlation identities preserve causal ordering without claiming a global total order.

### Conformance Harness module

**Purpose:** run the same product and security scenarios against upstream Cloudflare OS and each OpenCloudOS deployment profile.

**Interface:** provision a target, run a named scenario, collect normalized evidence, compare required invariants, and tear down. Scenario authors do not know provider-specific deployment commands.

**Adapters:** upstream Cloudflare deployment and local OpenCloudOS are the first two target adapters. Kubernetes becomes the third.

**Invariants:**

- scenarios assert observable behavior rather than private implementation;
- secrets are isolated per run;
- failed teardown is visible and retried;
- evidence includes release, runtime, adapter, and scenario versions.

## State ownership

| State | Authoritative owner | Consistency | Recovery |
|---|---|---|---|
| Tenant and user identity mapping | Identity module / PostgreSQL | Strong transaction | Database backup and point-in-time restore |
| Workspace placement and epoch | Placement Registry / PostgreSQL | Serializable mutation | Recompute only after fencing old epoch |
| Workspace chats and metadata | Runtime shard / local SQLite | Single-writer transaction | Volume snapshot and shard recovery |
| Gadget code and live state | Gadget sandbox / Facet SQLite | Single-writer transaction | Same shard volume as supervisor |
| Blueprint metadata | Product plane metadata store | Strong publish ordering | Rebuild from artifact manifests |
| Blueprint and export content | Artifact Repository | Read-after-publish | Replication, versioning, checksum restore |
| Capability grant | Workspace state plus Gatekeeper reference | Strong within workspace | Restore with workspace; revalidate external identity |
| Provider connection metadata | Provider Runtime Broker / PostgreSQL | Strong transaction | Restore metadata, then require provider revalidation |
| Provider credential material | Official client store inside Credential Capsule | Provider-defined durable write | Encrypted capsule restore or user reauthorization; never database restore |
| Provider session reference | Agent Session plus Provider Runtime Broker | Workspace transaction plus provider semantics | Resume when supported or begin a new provider session visibly |
| Provider rate-limit snapshot | Provider Runtime Broker cache | Advisory and expiring | Refetch from official client; never infer billing authority |
| Gatekeeper OAuth credential | SecretStore adapter | Provider-defined durable write | Provider backup or credential reauthorization |
| Prepared action | Gatekeeper state | Strong, expiring, idempotent | Resume, reject, or expire after restart |
| Approval decision | Gatekeeper state and Audit Ledger | Append-only | Replay decision; never infer approval |
| Audit event | Audit Ledger | Durable append | Replicated export and integrity verification |
| Deployment and shard status | Shard Controller / Kubernetes + PostgreSQL | Eventually reconciled | Controller reconciliation |

## Core execution flows

### Open a workspace

1. Request Gateway validates the OIDC session and resolves tenant and user.
2. Request Gateway resolves workspace placement.
3. If no placement exists, Placement Registry selects a ready shard and creates epoch 1.
4. Request Gateway forwards the request with tenant, user, workspace, trace, and epoch.
5. Runtime Host verifies the epoch, opens the workspace supervisor, and returns the product response.
6. Gateway caches the placement only within its lease validity and invalidates it on a stale-epoch response.

### Create and run a gadget

1. Agent Session produces source code in a workspace.
2. Runtime Host bundles the code and computes a version digest.
3. Workspace supervisor asks workerd Worker Loader to create the gadget sandbox.
4. The sandbox receives only its self interface, state Facet, and explicit introductions.
5. Client code runs in a sandboxed iframe with a restrictive content security policy.
6. Server and client communicate through Cap'n Web RPC.
7. Code and state are checkpointed before a version becomes shareable as a blueprint.

### Connect a personal agent provider

1. An authenticated user asks Provider Runtime Broker to begin a connection for one agent provider.
2. Provider Runtime Broker creates or resumes that user's isolated provider runner and asks the official client to begin its documented login flow.
3. The product displays only the official authorization URL, one-time code, expiry, and sanitized status. OAuth state and PKCE material stay in the credential capsule.
4. The user authorizes directly with the provider. The official client completes token exchange and stores credentials in its own protected store.
5. Provider Runtime Broker receives only connection status, provider identity metadata permitted for display, entitlement mode, and reauthorization requirements.
6. Audit Ledger records connection, reauthorization, logout, and revocation facts without authorization URLs, codes, tokens, or raw provider responses.

Codex defaults to app-server device-code login for a remote deployment and may use its managed browser flow when the callback route is safely bound. Claude subscription login is not enabled in a public build until Anthropic approval is recorded. After approval, the Claude adapter must still use the official login or `claude setup-token` path rather than an OpenCloudOS OAuth client.

### Run an agent turn with a personal subscription

1. The Agent Session records the initiating user and selected provider connection.
2. Runtime Host asks Provider Runtime Broker to start or resume a turn using opaque references and an explicit tool policy.
3. Provider Runtime Broker verifies tenant, user, connection status, provider policy, and rate-limit state before routing to the provider runner.
4. The official provider client performs model requests while the tool sandbox receives only workspace mounts and approved capabilities—not credential storage or provider-auth environment variables.
5. Normalized events stream back to the Agent Session with provider session reference, usage metadata when available, and correlation identity.
6. If another collaborator sends the next message, the system selects that collaborator's provider connection or asks them to connect; it never spends the previous user's subscription.
7. On logout, revocation, or unrecoverable refresh failure, new turns fail closed, active provider work is cancelled where supported, and the user is asked to reconnect.

### Introduce an external resource

1. User selects an external identity and resource scope.
2. Capability Broker asks the Gatekeeper to validate the identity can access the scope.
3. Gatekeeper returns a capability description and risk classification.
4. User confirms the introduction target: one agent session or one gadget.
5. Capability Broker persists the grant and supplies an unforgeable capability reference.
6. Audit Ledger records who introduced what scope to which subject.

### Prepare and commit a mutation

1. Gadget or Agent Session invokes a side-effecting capability method with an idempotency key.
2. Gatekeeper validates subject, scope, parameters, current external state, and policy.
3. Gatekeeper creates a prepared action with preview, expiry, drift fingerprint, and compensation metadata.
4. Agent continues against an explicit simulated result; simulation is never represented as committed reality.
5. User records an approval decision.
6. Gatekeeper revalidates scope and drift, then commits exactly once or returns a conflict requiring a new preparation.
7. Audit Ledger records preparation, decision, attempt, and outcome as correlated events.

### Recover a failed shard

1. Shard Controller observes failed readiness and stops considering the shard routable.
2. Placement leases expire or are explicitly revoked.
3. Kubernetes terminates the old pod and ensures its volume is detached.
4. Replacement pod mounts the volume and starts workerd.
5. Replacement proves volume health and registers the shard as recovering.
6. Placement Registry issues new epochs before traffic resumes.
7. Gateway reconnects sessions; clients replay safe subscription state.
8. Conformance probes verify workspace, gadget, capability, and approval recovery.

## Consistency model

- Placement, approval decisions, and capability revocation require strong transactional semantics.
- Workspace state uses a single-writer model enforced by placement epoch fencing.
- Artifact content is immutable; metadata publish establishes visibility.
- Deployment status is eventually reconciled and never used as authority without lease validation.
- Audit events preserve causal chains through correlation identities and epochs; they do not require one global sequence across tenants.
- Cross-module operations use explicit state machines and idempotency rather than distributed transactions.

## Failure model

| Failure | Required behavior | Data consequence | Operator signal |
|---|---|---|---|
| Gateway instance loss | Retry through another instance | None | Availability and retry metric |
| PostgreSQL unavailable | Existing shard sessions may continue briefly; no placement mutation or privileged approval | No acknowledged metadata loss | Critical control-plane alert |
| Runtime process crash | Restart against same volume; reconnect clients | At most unacknowledged in-flight turn | Shard recovery event |
| Runtime shard split brain | Older epoch rejects state access and privileged requests | No dual acknowledged writers | Fencing violation alert |
| Persistent volume unavailable | Keep workspace offline; do not create empty replacement | No silent reset | Recovery-blocked incident |
| Object store unavailable | Existing gadgets continue; blueprint publish/export pauses | No metadata publish without content | Artifact degraded alert |
| Secret store unavailable | Existing short-lived tokens may work; new connection and refresh fail closed | No credential exposure | Integration degraded alert |
| Provider runner crash | Restart the runner inside the same credential capsule; resume only when the provider supports it | Agent turn may require visible retry; no token copy | Provider runner restart event |
| Provider login expires or is revoked | Stop new turns and request reauthorization | Existing workspace history remains; credential is not reconstructed | User-visible reconnect state |
| Provider rate limit reached | Pause or reject with provider reset information; never switch billing modes silently | No hidden API charge | User-visible limit state and metric |
| Credential capsule unavailable | Keep the provider connection offline; never copy its credential into product state | No credential fallback | Security-critical provider degradation |
| Vendor policy no longer permits a mode | Disable new connections for that mode and publish a compatibility deviation | Existing credentials follow the vendor's revocation guidance | Release-blocking policy alert |
| External provider timeout | Gatekeeper returns retryable or unknown outcome; idempotency resolves ambiguity | Prepared action retained | Per-gatekeeper error budget |
| Audit ledger unavailable | Privileged commits fail closed | Prepared action remains uncommitted | Security critical alert |
| Upstream upgrade incompatibility | Block release at conformance gate | Current release stays supported | Upgrade report |

## Security model

### Trust zones

1. Public edge: untrusted requests before identity validation.
2. Product plane: authenticated user interface and request coordination.
3. Runtime shard: trusted supervisor code and untrusted gadget isolates.
4. Capability plane: trusted gatekeepers with access to credentials.
5. Agent provider plane: official provider clients and credential capsules, isolated from tool execution.
6. Infrastructure adapters: trusted operator-selected data and secret systems.
7. External systems: independently trusted providers with their own authorization and consistency.

### Mandatory controls

- default-deny egress for gadget isolates and runtime pods;
- explicit allow paths from supervisors to Gatekeepers;
- workload identity between control-plane modules and adapters;
- tenant identifiers on every state key, trace, metric, and audit event where policy permits;
- encryption in transit and at rest;
- no secrets in source, model prompts, gadget bindings, logs, or audit payloads;
- no generic endpoint for importing arbitrary OAuth access or refresh tokens;
- one credential capsule per personal provider connection, with encrypted storage and explicit destruction;
- separate process, filesystem, environment, and transport authority for provider credentials and tool execution;
- CSRF state, PKCE, callback binding, one-time-code expiry, and replay tests for every interactive login Adapter;
- vendor-policy review and official-client version pinning for every subscription-auth release;
- software bill of materials, signed release images, and pinned runtime compatibility;
- threat-model review for every new Gatekeeper and provider adapter.

## Deployment topology

The first production topology uses one Kubernetes cluster, a replicated PostgreSQL deployment, an object store, an OIDC provider, a secret store, stateless gateways, a shard controller, multiple runtime-shard StatefulSets, and isolated provider runners with encrypted credential-capsule storage. Provider runners use dedicated workload identity, restricted egress, and a transport credential distinct from the user's provider credential. Cross-region operation is disaster recovery, not active-active, until placement and storage replication semantics are proven.

Provider-specific infrastructure belongs in deployment profiles. Product, runtime, capability, and conformance modules remain identical across profiles.

## Upgrade strategy

1. Pin the upstream Cloudflare OS commit and workerd compatibility date in release metadata.
2. Generate an upstream-diff report before every import.
3. Run unit, interface, conformance, recovery, and security suites.
4. Roll out control-plane modules independently when interfaces are compatible.
5. Drain runtime shards before changing workerd or state layout.
6. Snapshot and verify each shard before irreversible migration.
7. Keep one rollback-compatible release until post-rollout conformance passes.

## Architecture fitness functions

- The same release artifact runs in local and Kubernetes profiles.
- No core product module imports AWS, Google Cloud, or Azure SDKs.
- A gadget with no introductions cannot reach the public internet.
- A stale placement epoch cannot acknowledge a workspace write.
- A rejected prepared action causes no external mutation.
- Killing a runtime-shard pod recovers its workspaces without silent state reset.
- Upstream and OpenCloudOS pass the same capability and gadget conformance scenarios.
- Two users in one workspace cannot observe or spend each other's provider connections.
- A malicious repository command cannot read provider credentials from a file, environment variable, process, transport, error, trace, or audit event.
- Revoking a provider connection prevents every new provider turn without deleting workspace history.
- Every enabled subscription mode is backed by current official documentation and any required written provider approval.
- Every production change has a current wiki record, verification evidence, and project-log entry.
