# ADR-0009: Use local stdio and reject unbound provider requests

- **Status:** Proposed
- **Date:** 2026-08-05

## Context

The Codex app-server protocol supports stdio, WebSocket, and Unix-socket transports. Stdio is the default newline-delimited JSON path. The inspected WebSocket path is experimental and unsupported, adds listener authentication and origin concerns, and can expose the credential-owning provider runtime beyond its intended boundary.

The protocol is also bidirectional. App-server may send requests that ask its host to approve command execution, file changes, extra filesystem or network permissions, MCP elicitation, or other actions. A transport that ignores these requests can hang a turn. A transport that accepts them automatically can bypass OpenCloudOS Capability, Prepared Action, human-approval, tenancy, and audit invariants.

## Decision

OpenCloudOS will connect to each Codex app-server process through bounded local stdio JSONL owned by the same user-scoped Provider Runner. The app-server control Interface will not be exposed through a TCP or non-local WebSocket listener.

The transport will apply explicit framing, UTF-8 validation, message-size limits, request-ID correlation, response-union validation, redacted RPC errors, and fail-closed shutdown. Raw JSONL messages will not be logged.

Every app-server server-initiated request will be rejected with a fixed unsupported error until a reviewed bridge can bind the request to Tenant, User, Workspace, Provider Connection, Agent Session, provider thread, turn, item, Capability, Prepared Action, expiry, and one auditable decision. The default path will never return `accept`, `acceptForSession`, an execution-policy amendment, or an equivalent approval.

The future approval bridge will be narrower than the transport. It must explicitly allow supported request methods and normalize only the fields needed by Capability Broker. Unknown request types continue to fail closed.

## Consequences

- App-server control traffic stays inside the Credential Capsule's process boundary.
- Provider Runner deployment does not need to secure a Codex WebSocket listener.
- Malformed, oversized, uncorrelated, incomplete, or provider-error messages terminate or reject work visibly instead of being guessed or logged.
- Commands and permission requests cannot execute until the Capability Broker integration exists.
- Early Codex turns that require host approval will fail rather than prompt or execute; this is intentional before the approval bridge ships.
- One Provider Runner must supervise process lifetime and stdio health for every enabled Provider Connection.
- A client-version upgrade must rerun RUNNER, CODEX, and AUTH scenarios because framing and server-request behavior are part of compatibility.

## Rejected alternatives

### Expose app-server WebSocket to the Broker

Rejected because the inspected Interface marks WebSocket experimental and unsupported, and network exposure adds authentication, origin, reachability, denial-of-service, and credential-boundary risks without product value.

### Treat server requests as ordinary notifications

Rejected because app-server waits for a correlated response and the turn can hang indefinitely.

### Automatically approve requests in read-write workspaces

Rejected because workspace mode is not sufficient authority for a specific external or local effect, and it bypasses Prepared Action review and audit.

### Forward raw server requests to the browser

Rejected because request payloads can contain commands, paths, permission scopes, tool arguments, and private repository context. The Capability Broker must first normalize and bind them to product authority.
