# Provider Runtime Broker

This package is the executable contract for user-bound agent-provider access. It currently contains:

- the provider-neutral Broker Interface;
- explicit provider-policy decisions;
- ownership checks on every connection and turn;
- allowlisted connection snapshots, provider events, and audit events;
- login-binding and replay protection;
- lifecycle, limit, logout, and revocation behavior;
- an in-memory connection store and synthetic Provider Adapter;
- an authentication-only, version-pinned Codex app-server protocol client and Adapter;
- a bounded stdio JSONL transport with correlated requests, redacted failures, and fail-closed server requests;
- a capsule-bound Codex runner supervisor with exact manifest validation, initialization health, hidden ownership, serialized lifecycle operations, crash generation fencing, bounded startup/shutdown, explicit recovery, and irreversible destruction;
- captured Codex auth fixtures with raw-response field allowlisting;
- executable AUTH-001 through AUTH-010, CODEX-001 through CODEX-008, RUNNER-001 through RUNNER-008, and SUPERVISOR-001 through SUPERVISOR-008 scenarios.

It deliberately contains no production-ready Codex or Claude Adapter and no real credentials. The synthetic Adapter models a Credential Capsule with private in-memory state; it does not claim process-level isolation. The Codex Adapter maps initialization, device login, sanitized account state, rate limits, and logout. Its JSONL transport can bind local app-server streams without spawning a process and rejects all server-initiated approval requests. The supervisor uses injected synthetic runtime and capsule drivers: it does not spawn `codex app-server` or create encrypted storage. Turn execution still fails closed. Durable metadata, real Provider Runner isolation, a production capsule driver, approval bridge, and real-account conformance remain later tracer-bullet slices. Claude subscription mode remains blocked pending written Anthropic approval.

Run the contract suite with `npm run test:broker` from the repository root.
