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
- captured Codex auth fixtures with raw-response field allowlisting;
- executable AUTH-001 through AUTH-010 scenarios.

It deliberately contains no production-ready Codex or Claude Adapter and no real credentials. The synthetic Adapter models a Credential Capsule with private in-memory state; it does not claim process-level isolation. The Codex Adapter is an authentication protocol spike: it maps initialization, device login, sanitized account state, rate limits, and logout, while turn execution fails closed. The durable store, app-server process transport, Provider Runner, production capsule, and real-account conformance remain later tracer-bullet slices. Claude subscription mode remains blocked pending written Anthropic approval.

Run the contract suite with `npm run test:broker` from the repository root.
