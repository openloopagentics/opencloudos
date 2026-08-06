---
status: proposed
---

# Use single-active runtime shards with epoch fencing

Each workspace will be assigned to one active runtime shard for one monotonically increasing placement epoch. This matches workerd's process-local object model and preserves single-writer state semantics; the tradeoff is failover by restart and volume reattachment rather than active-active execution.

## Consequences

A stale epoch must be rejected at both request delivery and workspace-state open. Cross-region operation remains disaster recovery until storage replication and live ownership transfer have explicit semantics and conformance evidence.
