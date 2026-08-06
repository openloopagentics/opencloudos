# Provider Runtime Broker

This package is the executable contract for user-bound agent-provider access. It currently contains:

- the provider-neutral Broker Interface;
- explicit provider-policy decisions;
- ownership checks on every connection and turn;
- allowlisted connection snapshots, provider events, and audit events;
- login-binding and replay protection;
- lifecycle, limit, logout, and revocation behavior;
- an in-memory connection store and synthetic Provider Adapter;
- executable AUTH-001 through AUTH-010 scenarios.

It deliberately contains no Codex or Claude production Adapter and no real credentials. The synthetic Adapter models a Credential Capsule with private in-memory state; it does not claim process-level isolation. The Codex Adapter, durable store, Provider Runner, and production capsule are later tracer-bullet slices. Claude subscription mode remains blocked pending written Anthropic approval.

Run the contract suite with `npm run test:broker` from the repository root.
