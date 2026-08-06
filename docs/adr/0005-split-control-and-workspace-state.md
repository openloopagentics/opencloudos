---
status: proposed
---

# Split control metadata from shard-local workspace state

PostgreSQL will own tenant, placement, lease, deployment, and recovery metadata, while workerd's shard-local SQLite storage will own workspace, Gadget, and prepared-action state. This avoids forcing the upstream single-writer execution model through a remote database interface; the tradeoff is explicit shard backup, volume recovery, and state migration work.

## Consequences

Cross-module operations use state machines and idempotency rather than distributed transactions. The architecture must never reconstruct missing shard state from control metadata or silently start an empty workspace.
