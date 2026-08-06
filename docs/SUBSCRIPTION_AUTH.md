# Subscription-Backed Agent Providers

**Design status:** proposed for OpenCloudOS 1.0. The Codex app-server authentication protocol and bounded stdio JSONL transport are implemented against `codex-cli 0.146.1`; process supervision, Credential Capsule isolation, approval bridging, and agent-turn execution remain incomplete. Claude subscription support is designed but release-blocked until Anthropic gives written approval for third-party Claude.ai authentication and subscription rate limits.

This design lets each person connect an eligible Claude or ChatGPT/Codex subscription without turning OpenCloudOS into an OAuth implementation, a shared-token proxy, or a credential database.

## Implementation status

| Slice | Status | Evidence |
|---|---|---|
| Provider Runtime Broker Interface | Implemented | `packages/provider-runtime-broker/src` |
| Synthetic Provider Adapter | Implemented | Private in-memory credential fixture and metadata store |
| AUTH-001 through AUTH-010 | Passing | Node contract suite; no production credentials |
| Documentation enforcement | Implemented | Structural verifier and material-change policy in CI |
| Codex app-server authentication Adapter | Protocol spike implemented | Pinned `codex-cli 0.146.1`; CODEX-001–008 pass on captured fixtures |
| Codex app-server stdio transport | Implemented | RUNNER-001–008 cover framing, correlation, redaction, resource bounds, shutdown, and fail-closed server requests |
| Codex Provider Runner supervisor | Next | Pinned executable, capsule lifecycle, process health/restart, scope binding, and destruction |
| Codex app-server turn Adapter | Planned after supervisor | Thread/turn mapping, explicit approval bridge, interruption, recovery, and real test-account conformance |
| Production Credential Capsule | Planned | Process/filesystem/environment isolation not yet implemented |
| Claude subscription Adapter | `blocked_by_policy` | [Anthropic request drafted](./provider-approval/ANTHROPIC_REQUEST_DRAFT.md), not sent |

The current code is contract, auth-protocol, and transport evidence—not production subscription support. See the [Codex protocol spike](./CODEX_ADAPTER_SPIKE.md), [Provider Runner transport](./CODEX_RUNNER_TRANSPORT.md), and [compatibility matrix](./PROVIDER_COMPATIBILITY.md) for the release state.

## Product promise

A user can choose **Connect Codex** or **Connect Claude**, authorize with the provider, see which connection will fund an agent turn, observe rate-limit or reauthorization state, and disconnect. The user never needs to understand access and refresh tokens.

The promise has four limits:

1. A personal subscription connection belongs to one tenant and one user.
2. Personal usage is never pooled, shared with collaborators, or silently replaced by API-key billing.
3. OpenCloudOS supports only authentication paths documented and permitted by the provider.
4. Credential material remains inside an isolated credential capsule owned by the official provider client.

Product sign-in and provider connection are deliberately separate. OIDC proves who the OpenCloudOS user is; it grants no Claude or Codex usage.

## Current support matrix

This matrix is time-sensitive and must be revalidated for every stable release.

| Provider mode | Official path | Intended use | OpenCloudOS 1.0 disposition |
|---|---|---|---|
| Codex with ChatGPT subscription | `codex app-server` ChatGPT-managed browser or device-code login | Interactive per-user subscription access | Planned and enabled after conformance |
| Codex access token | `CODEX_ACCESS_TOKEN` or `codex login --with-access-token` | Trusted Business/Enterprise automation | Optional operator mode; never accepted as a browser-session token |
| OpenAI API key | Codex API-key login | Explicit pay-as-you-go execution | Separate tenant- or user-funded Adapter |
| Claude subscription login | Official Claude Code or Agent SDK login | Pro, Max, Team, or Enterprise subscription access | Release-blocked pending written Anthropic approval for third-party use |
| Claude long-lived OAuth token | `claude setup-token`, then `CLAUDE_CODE_OAUTH_TOKEN` | Headless scripts and CI with an eligible subscription | Same approval gate; one-time sealed ingress only after approval |
| Anthropic API key | `ANTHROPIC_API_KEY` or approved credential helper | Explicit pay-as-you-go execution | Separate supported Adapter |
| Bedrock, Google Cloud Agent Platform, Microsoft Foundry | Official cloud-provider authentication | Operator-funded enterprise execution | Separate deployment-profile Adapters |

Codex documents ChatGPT subscription sign-in, managed browser/device-code flows, token persistence and refresh, logout, plan state, and rate-limit reporting through its official clients. OpenCloudOS uses the documented app-server auth methods and will not parse `~/.codex/auth.json`. The inspected app-server Interface is experimental, so every supported client revision must be pinned and requalified.

Anthropic documents subscription login and `claude setup-token`, but its Agent SDK documentation also states that third-party developers may not offer Claude.ai login or subscription rate limits unless approved. Therefore a working technical experiment is not release authority. The public Claude subscription Adapter stays disabled until approval is recorded in the decision registry and compatibility matrix.

## Provider Runtime Broker Interface

The Provider Runtime Broker is a deep Module. Callers see a small, provider-neutral Interface:

```text
beginConnection(user, provider, mode) -> challenge | connected | blocked
readConnection(user, connectionRef) -> sanitized status
beginTurn(user, connectionRef, agentSessionRef, policy) -> event stream
cancelTurn(user, providerSessionRef) -> terminal status
logout(user, connectionRef) -> disconnected
revoke(user, connectionRef) -> destroyed | provider-action-required
```

The Interface never returns, accepts through a generic route, or logs raw access tokens, refresh tokens, provider cookie jars, or credential-cache files.

Provider-specific behavior lives behind Adapters:

- **Codex Adapter:** one pinned `codex app-server` Provider Runner per Provider Connection. The implemented auth spike initializes with experimental APIs disabled, uses `account/login/start` with ChatGPT-managed device-code authentication, observes sanitized login completion, reads allowlisted account and rate-limit state, and asks app-server to log out. The implemented bounded stdio transport correlates JSONL messages and rejects server-initiated approvals by default. The production process supervisor, Credential Capsule, approval bridge, and thread/turn event mapping are not implemented.
- **Claude Adapter:** one pinned Claude Agent SDK or Claude Code Provider Runner per Provider Connection. If Anthropic approves third-party subscription use, the official client owns interactive login. A headless `claude setup-token` may enter only through one-time sealed ingress directly into the credential capsule.
- **API-funded Adapters:** API keys and cloud credentials are explicit connection modes with separate billing labels, policy, and secret rotation. They never masquerade as subscription connections.

Experimental external-token Interfaces are not a 1.0 dependency. OpenCloudOS does not ask a browser to extract provider tokens, reuse a vendor client identifier, scrape an OS keychain, or copy a user's existing credential cache.

## Credential Capsule

Each personal provider connection receives one credential capsule. In local development it may be an OS credential store plus an isolated provider process. In Kubernetes it is a dedicated Provider Runner, encrypted persistent storage, workload identity, and a narrow authenticated transport.

The capsule enforces:

- credential storage is unreadable by PostgreSQL, Runtime Host, Gadget sandboxes, workspace file mounts, and tool subprocesses;
- the official provider client is the only writer of its credential cache;
- provider credentials are not inherited as tool environment variables;
- logs, crash dumps, traces, metrics, and audit payloads are redacted at source;
- egress is restricted to documented provider endpoints and explicitly configured MCP or capability paths;
- deletion removes local credential material and reports whether provider-side revocation still requires user action;
- the transport credential used to reach a remote Provider Runner is different from the user's provider credential.

Infrastructure encryption alone is insufficient. Conformance must demonstrate that repository-controlled commands cannot read provider credentials even while an agent turn is running.

## Connection flow

1. The authenticated user selects provider and connection mode.
2. Provider Runtime Broker creates an opaque Provider Connection in `connecting` state.
3. A user-scoped Provider Runner starts the official client login.
4. The UI receives only an authorization URL or device code, expiry, and login status.
5. The user authorizes directly with the provider.
6. The official client completes token exchange, persists credentials, and reports sanitized account and plan state.
7. Provider Runtime Broker marks the connection `ready` and Audit Ledger records the transition without secrets.

For remote Codex deployments, device-code login is the default because it avoids exposing a localhost callback. Browser login is permitted only when callback origin, state, PKCE, tenant, user, and one-time login identity are bound and tested.

## Agent-turn flow

1. The initiating user selects a ready Provider Connection or accepts their configured default.
2. Agent Session persists `initiatingUserId`, `providerConnectionRef`, provider name, and sanitized billing mode.
3. Provider Runtime Broker verifies tenant and user ownership on every turn; a reference alone is never authority.
4. Provider Runner starts or resumes the official provider session with an explicit tool policy and a scoped workspace mount.
5. Tool execution occurs outside the credential capsule's readable filesystem and environment.
6. Normalized messages, tool requests, usage metadata, limit state, and terminal outcome stream back to Agent Session.
7. Audit records provider, connection reference, user, policy, and outcome—not prompt contents or credentials.

If a collaborator continues a shared conversation, the next turn uses the collaborator's connection. If none exists, the UI asks them to connect or select a tenant-funded API connection. It never reuses the previous user's personal subscription.

## Lifecycle and failure semantics

Provider Connection states are:

```text
disconnected -> connecting -> ready -> reauth_required -> revoked
                         \-> rate_limited
                         \-> blocked_by_policy
```

- A runner restart reopens the same encrypted capsule and asks the official client to validate the session.
- A refresh or entitlement failure moves to `reauth_required`; the system does not reconstruct or copy a token.
- A rate limit pauses only the affected user's connection and displays provider-supplied reset information when available.
- Logout stops new turns and asks the official client to delete local credentials.
- Revocation destroys the capsule and clearly tells the user if provider-side revocation is still necessary.
- A vendor-policy change moves the mode to `blocked_by_policy` and blocks new connections until the release compatibility record is updated.

## Conformance scenarios

| Scenario | Required evidence |
|---|---|
| AUTH-001 User ownership | Two users in one workspace cannot enumerate, select, or spend each other's personal connections |
| AUTH-002 Credential non-observability | Workspace commands, Gadgets, prompts, errors, logs, traces, `/proc`, environment, and mounted files reveal no credential material |
| AUTH-003 Login binding | OAuth state, PKCE, callback or device code, tenant, user, provider, and login identity cannot be swapped or replayed |
| AUTH-004 Refresh and restart | Runner restart preserves a valid connection; failed refresh moves visibly to reauthorization |
| AUTH-005 Logout and revocation | New turns fail immediately, local material is destroyed, and provider-side action is reported accurately |
| AUTH-006 Collaboration billing | A collaborator's turn uses their own connection or stops for selection; it never spends the prior user's plan |
| AUTH-007 Limit behavior | Rate limits pause only the affected connection and never trigger an implicit pay-as-you-go fallback |
| AUTH-008 Policy gate | A disabled or unapproved provider mode cannot be enabled through configuration alone |
| AUTH-009 Secret-store recovery | Restoring product metadata without capsule material requires reauthorization rather than token reconstruction |
| AUTH-010 Version drift | Pinned official-client upgrades pass login, refresh, logout, isolation, and event-normalization fixtures |

No fixture uses a maintainer's personal production credential. Provider-approved test accounts, synthetic adapters, and ephemeral CI secrets are required.

## Execution slices

1. **Policy and protocol spike — active:** Anthropic approval request drafted but unsent; Codex auth schemas pinned at `codex-cli 0.146.1`; CODEX-001–008 pass without external credentials. Claude client pin remains pending its approval boundary.
2. **Provider-neutral skeleton — implemented:** Provider Runtime Broker, synthetic Adapter, and AUTH scenarios run without external credentials.
3. **Codex vertical slice — active:** bounded stdio transport implemented; next build the isolated Provider Runner supervisor and capsule, then connect two approved test users through device-code login, run turns, expose limit state, restart runners, and revoke.
4. **Isolation hardening:** prove tool subprocesses cannot read credential storage or transport authority under malicious repository tests.
5. **Claude approved slice:** only after written approval, connect provider-approved accounts through the official runner and execute the same suite.
6. **Deployment profiles:** prove capsule storage, destruction, recovery, egress, and observability on local, AWS, GCP, Azure, and self-hosted profiles.

## Release gates

Subscription access cannot ship unless:

- the provider path is documented and permitted for this product class;
- official client versions and hashes are pinned in release metadata;
- the complete AUTH suite passes on every supported deployment profile;
- an independent security review finds no path from tool execution to credential material;
- logout, revocation, limit, expiration, and provider outage behavior are documented;
- the compatibility matrix names supported plans, modes, known deviations, and policy review date;
- no user can be charged through an unselected billing mode.

## Primary sources

- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth) — ChatGPT subscription login, device code, credential storage, refresh, logout, and access-token modes.
- [OpenAI Codex app-server](https://learn.chatgpt.com/docs/app-server) — host Interface and managed ChatGPT authentication lifecycle.
- [OpenAI Codex access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens) — trusted Business/Enterprise automation credentials and isolation guidance.
- [Anthropic Claude Code authentication](https://code.claude.com/docs/en/authentication) — subscription login, credential storage, precedence, expiration, and `claude setup-token`.
- [Anthropic Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) — third-party Claude.ai login and subscription-rate-limit approval requirement.
- [Anthropic Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting) — isolated process and container deployment patterns.
- [Anthropic secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment) — credential isolation and proxy guidance.
- [Anthropic subscription usage update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) — current, explicitly time-sensitive treatment of Agent SDK and third-party subscription usage.
