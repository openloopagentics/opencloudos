# Codex Provider Runner Transport

**Status:** implemented and fixture-tested on 2026-08-05. This is the bounded stdio transport seam for a future isolated Provider Runner; it does not spawn Codex, create a Credential Capsule, or support production agent turns.

**Client boundary:** `codex-cli 0.146.1`

**Wire format:** newline-delimited JSON over app-server stdin/stdout

**Maximum frame:** 1 MiB by default

## Outcome

OpenCloudOS now has a bidirectional JSONL transport that the user-scoped Provider Runner can place between `CodexAppServerClient` and a locally isolated `codex app-server` process. It correlates concurrent client requests, forwards notifications separately, redacts provider-controlled RPC errors, bounds every input and output frame, and fails closed when the stream violates the pinned protocol.

The transport is implemented in `packages/provider-runtime-broker/src/codex-jsonl-transport.ts`. Tests use in-memory line channels and Node streams. No test launches the installed Codex CLI, reads its account, changes its credential state, or performs a model request.

## Why stdio

The inspected app-server documentation defines stdio as the default newline-delimited JSON transport. Its WebSocket listener is experimental and unsupported, and non-loopback listeners can be unauthenticated unless separately configured. OpenCloudOS therefore keeps app-server control traffic inside the Provider Runner process boundary and does not expose it as a network service.

App-server messages omit the JSON-RPC `jsonrpc` header:

```text
client request       { method, id, params? }
server response      { id, result } | { id, error }
server notification  { method, params? }
server request       { method, id, params? }
```

## Components

### `CodexJsonlRpcTransport`

- assigns monotonically increasing safe-integer request IDs;
- resolves concurrent responses by ID even when responses arrive out of order;
- keeps notifications out of request-response correlation;
- requires exactly one of `result` or `error` on a response;
- treats unknown, malformed, duplicate, or structurally invalid responses as protocol failure;
- rejects all pending work when the transport closes;
- never includes provider-controlled error messages or error data in its public RPC error;
- sends exactly one JSON object and newline for every client frame.

### `NodeStreamCodexLineChannel`

- joins fragmented stdout chunks into complete newline-delimited frames;
- separates multiple frames delivered in one chunk;
- accepts LF and CRLF line endings;
- requires valid UTF-8;
- rejects incomplete final frames;
- applies the size limit before delivering a frame;
- ends app-server stdin when the channel fails or the runner closes it.

The line channel owns only local streams. It deliberately does not spawn a process, select a home directory, mount a workspace, or inherit an environment. Those decisions belong to the still-unimplemented Provider Runner supervisor and deployment profile.

## Fail-closed server requests

App-server is bidirectional. During an agent turn it can ask the client to approve command execution, file changes, extra filesystem/network permissions, MCP elicitation, or other host actions. Treating those messages as notifications would leave work hanging; accepting them automatically would bypass OpenCloudOS capability policy.

Until a separately reviewed approval bridge exists, every server-initiated request receives:

```json
{
  "id": "opaque-server-request-id",
  "error": {
    "code": -32601,
    "message": "OpenCloudOS Provider Runner rejects unsupported server requests"
  }
}
```

The rejection echoes only the request ID. It does not echo command text, paths, requested permissions, tool arguments, or other provider-controlled parameters. It never sends `accept`, `acceptForSession`, or an amended execution policy.

This is a temporary security boundary, not the final approval design. Future approval handling must bind Tenant, User, Workspace, Provider Connection, Agent Session, provider thread, turn, item, Prepared Action, Capability, expiry, and one terminal decision.

## Error and shutdown behavior

| Condition | Required result |
|---|---|
| App-server RPC error | Reject only the correlated request with method and numeric code; discard provider message and data |
| Malformed JSON or invalid UTF-8 | Close the channel and reject all pending requests |
| Unknown response ID | Close rather than risk attributing a result to the wrong caller |
| Both or neither `result` and `error` | Close as protocol drift |
| Oversized or incomplete frame | Close before the frame reaches the auth or turn client |
| stdin write failure | Close and reject all pending work |
| stdout end or error | Close and reject all pending work |
| Server-initiated request | Return the fixed unsupported error without copying its params |

Raw lines are never logged or included in exceptions. This is necessary because future account, tool, MCP, command, and file-change messages may contain private user or repository data even when they do not contain provider credentials.

## Executable evidence

| Scenario | Evidence |
|---|---|
| RUNNER-001 Initialization wire | Correlated initialize response; `initialized` notification; omitted `jsonrpc` header |
| RUNNER-002 Multiplexing | Concurrent responses resolve by ID while notifications remain out-of-band |
| RUNNER-003 Approval default | Command approval server request receives fixed `-32601`; params and acceptance decisions are absent |
| RUNNER-004 Error sanitation | Public error retains only requested method and numeric RPC code |
| RUNNER-005 Malformed input | Invalid JSON closes the transport and rejects every pending request |
| RUNNER-006 Correlation integrity | Unknown response ID closes rather than being attributed heuristically |
| RUNNER-007 Stream framing | Fragmented and coalesced LF/CRLF frames parse correctly; writes contain exactly one frame |
| RUNNER-008 Resource bounds | Oversized and incomplete stdout frames close the channel |

Additional coverage proves a failed stdin write closes the transport and prevents later requests.

Run the suite with `npm run test:broker`.

## Deliberately outside this transport

This transport does not provide:

- process launch, OS/container isolation, or durable reconciliation;
- executable artifact acquisition or digest verification;
- OS user, container, filesystem, environment, or network isolation;
- encrypted Credential Capsule creation, reopening, deletion, or recovery;
- workspace mount policy or separation from credential storage;
- thread creation, resume, turn start, event normalization, interruption, or terminal-state recovery;
- a Capability Broker bridge for command, file, network, MCP, or permission requests;
- Kubernetes workload identity, persistent volume policy, egress policy, or deployment profile;
- real account or subscription conformance.

The Broker must not instantiate `NodeStreamCodexLineChannel` directly. A user-scoped Provider Runner creates it only after its capsule and runtime isolation are established.

## Following execution slices

The capsule-bound supervisor lifecycle, exact manifest pins, initialization health, generation fencing, explicit recovery, and stop/destruction semantics now exist as a synthetic-driver contract in [Codex Provider Runner supervisor](./CODEX_RUNNER_SUPERVISOR.md). It does not weaken any of this transport's fail-closed behavior.

The next slice implements the real local runtime and encrypted capsule drivers, then binds this transport to the pinned child process. Thread/turn mapping and the Capability Broker approval bridge follow only after runtime isolation passes malicious-repository conformance.

Real Codex support remains blocked on the encrypted capsule, hostile-tool isolation, approved test accounts, AUTH-001 through AUTH-010 on the real runner, operational runbooks, and independent security review.

Related decisions: [ADR-0009](./adr/0009-use-local-stdio-and-reject-unbound-provider-requests.md) and [ADR-0010](./adr/0010-bind-runner-generation-and-capsule-to-provider-connection.md).

## Primary source

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
