---
status: proposed
---

# Retain workerd as the Gadget sandbox

OpenCloudOS will retain workerd Dynamic Workers and Durable Object Facets for generated Gadget code rather than immediately translating Gadgets to containers, WebAssembly, or a new JavaScript sandbox. This maximizes upstream behavioral fidelity and preserves capability injection, but makes production workerd feasibility the first program gate.

## Consequences

Milestone 1 must prove persistence, restart, isolation, RPC, and WebSocket behavior without Cloudflare infrastructure. If required semantics cannot be reproduced safely, this ADR is reopened before building the distributed control plane.
