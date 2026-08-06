# ADR-0008: Use provider-owned, user-bound subscription authentication

- **Status:** Proposed
- **Date:** 2026-08-05

## Context

OpenCloudOS users should be able to run agent sessions against eligible Claude and ChatGPT/Codex subscriptions they already pay for. These credentials carry personal billing authority, workspace policy, and account identity. Treating them as ordinary shared secrets would let collaborators or compromised workspace code spend another user's plan.

Provider contracts are also asymmetric. Codex app-server documents managed ChatGPT login for host applications. Anthropic documents subscription login and long-lived tokens for Claude Code, while its Agent SDK documentation requires prior approval before a third-party product offers Claude.ai login or subscription rate limits.

## Decision

OpenCloudOS will represent subscription access as a user-owned Provider Connection behind the Provider Runtime Broker Interface.

Each connection runs through an official provider client inside an isolated Credential Capsule. The official client owns OAuth initiation, exchange, persistence, refresh, and logout. OpenCloudOS stores only opaque connection references and sanitized status.

Personal Provider Connections are scoped to one tenant and one user. They cannot be introduced, delegated, pooled, or reused by a collaborator. Tenant-funded API connections are a different connection type with explicit billing and policy.

Codex subscription support will use a pinned `codex app-server` Adapter with ChatGPT-managed authentication. Claude subscription support will remain disabled until Anthropic grants written third-party approval; technical ability to run a token does not satisfy this gate.

OpenCloudOS will not implement undocumented provider OAuth endpoints, reuse provider client identifiers, parse credential-cache files, accept arbitrary browser session tokens, or depend on experimental external-token Interfaces for 1.0.

## Consequences

- Users connect providers through browser or device-code flows instead of pasting ordinary OAuth tokens into product forms.
- Provider Runner and encrypted capsule lifecycle become production infrastructure.
- Tool execution must be isolated from provider credential files, environments, processes, and transports.
- Collaboration requires per-turn initiating-user attribution and cannot inherit the previous user's subscription.
- Provider plan limits and entitlement failures become visible product states.
- Claude subscription support may lag Codex even when the Claude Adapter is technically complete.
- API-key and cloud-provider Adapters remain necessary for operators needing shared or predictable production billing.
- Every stable release must revalidate official documentation, provider approval, and pinned client behavior.

## Rejected alternatives

### Store OAuth tokens in the ordinary SecretStore and call provider endpoints directly

Rejected because it turns OpenCloudOS into an OAuth client and token custodian, bypasses official agent runtimes, expands credential exposure, and may violate provider policy.

### Copy existing `auth.json` or `.credentials.json` files into a shared runner

Rejected because credential caches are password-equivalent, provider-private formats and would create user-confusion, leakage, refresh, and revocation failures.

### Let a workspace owner fund every collaborator turn

Rejected because personal subscription authority is not a workspace capability and must not be delegated implicitly.

### Enable Claude subscription mode because `claude setup-token` works technically

Rejected because current Anthropic Agent SDK documentation separately requires approval for third-party Claude.ai login or subscription rate limits.
