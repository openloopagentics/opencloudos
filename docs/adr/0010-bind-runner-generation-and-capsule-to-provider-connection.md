# ADR-0010: Bind one runner generation and capsule to one Provider Connection

- **Status:** Proposed
- **Date:** 2026-08-05
- **Owners:** Runtime and security workstreams
- **Related:** ADR-0004, ADR-0008, ADR-0009

## Context

Personal Codex authority must survive an ordinary Provider Runner stop without becoming accessible to a workspace, tool subprocess, shared Broker process, or another user. Process crashes, concurrent starts, host recovery, and late exit notifications can otherwise create two active processes, mount a capsule into the wrong owner, or allow an old process callback to corrupt the replacement's state.

A provider-neutral deployment also cannot embed local paths, Kubernetes object names, or cloud secret identifiers in the Provider Runtime Broker Interface.

## Decision

Each Provider Connection binds exactly one immutable, secret-free launch manifest and one opaque Credential Capsule reference. At most one runner generation is active for that connection.

The supervisor will:

- verify tenant and user ownership on every operation and hide the difference between missing and unauthorized references;
- admit only an exact manifest shape with a tested client/schema revision and an executable SHA-256 digest matching the supervisor's trusted release pin;
- keep process handles, transports, capsule leases, paths, and driver errors private;
- declare readiness only after the app-server initialization handshake completes;
- serialize lifecycle operations by Provider Connection;
- fence exit callbacks by both generation and process-handle identity;
- require explicit recovery, which increments the generation;
- treat stop as reversible sealing and destruction as irreversible credential deletion;
- give capsule/runtime drivers bounded startup deadlines and cancellation signals;
- expose only sanitized lifecycle metadata and failure codes.

Deployment profiles implement runtime and capsule drivers behind this contract. The supervisor itself imports no provider SDK.

## Consequences

Positive:

- a stale process cannot degrade or replace the current generation;
- cloud implementations share one ownership and lifecycle contract;
- credentials cannot enter generic launch manifests or public snapshots;
- graceful stop, forced termination, restart, and destruction can be tested independently;
- the durable tombstone can explain that local authority was destroyed without reconstructing it.

Costs:

- every profile needs robust, abort-aware, idempotent runtime and capsule drivers;
- durable reconciliation needs a metadata store and orphan cleanup protocol;
- a stopped runner needs explicit recovery rather than invisible restart;
- provider-side logout/revocation must be coordinated separately from local destruction;
- a capsule cannot be shared to reduce process cost.

## Rejected alternatives

- **Pool one authenticated runner across users:** breaks ownership, billing, failure isolation, and credential non-observability.
- **Pass credential paths or environment variables in the launch manifest:** makes generic orchestration, logging, and tool inheritance a credential exfiltration path.
- **Automatically restart forever:** hides operator-visible failure, can amplify provider outages, and obscures which generation owns the capsule.
- **Treat stop and delete as the same operation:** makes routine maintenance destroy user authority or makes revocation ambiguous.
- **Accept `latest` client versions:** permits experimental app-server drift to cross an untested security boundary.
- **Let restored Broker metadata recreate capsule credentials:** turns product metadata into credential authority and violates AUTH-009.

## Verification

SUPERVISOR-001 through SUPERVISOR-008 exercise hidden ownership, manifest validation, readiness sanitation, concurrency, crash fencing, explicit recovery, stop/destruction, startup timeout, and forced termination. Production acceptance still requires real process, encrypted capsule, host-recovery, malicious-repository, and multi-profile conformance evidence.
