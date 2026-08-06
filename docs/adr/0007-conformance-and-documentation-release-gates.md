---
status: proposed
---

# Make conformance and documentation release gates

OpenCloudOS releases will require behavioral conformance evidence and current wiki records in addition to a successful build. This treats security semantics, recovery behavior, decisions, and operator knowledge as product artifacts; the tradeoff is added work on every change and a willingness to block releases for undocumented behavior.

## Consequences

Security, runtime, placement, storage, and deployment changes cannot use a documentation exemption. Stable releases publish known deviations rather than silently redefining parity.
