# ADR-0011: Use operator-installed deployment profiles with versioned capability contracts

- **Status:** Proposed
- **Date:** 2026-08-06
- **Owners:** Runtime, operations, and security workstreams
- **Related:** ADR-0002, ADR-0006, ADR-0007, ADR-0010

## Context

OpenCloudOS must run on AWS, GCP, Azure, and self-hosted infrastructure without importing every provider SDK into core modules or letting deployment differences fork product and security behavior. Infrastructure adapters are privileged: they can create workloads, attach credential storage, access tenant artifacts, authenticate identities, and delete resources.

ADR-0006 requires real variation before a portable seam becomes stable. The project now needs a framework in which real profiles can be built, while only a synthetic full-profile Implementation exists today.

## Decision

OpenCloudOS will use operator-installed Deployment Profile packages behind protocol-versioned capability contracts.

- Profiles are pinned and registered at trusted process startup; they are never downloaded or selected from untrusted runtime input.
- A frozen manifest declares provider, profile version, architectures, capability driver versions, and feature names.
- Configuration is flat, declarative, strictly validated, and contains secret references rather than credential material.
- Declared capabilities must exactly match instantiated drivers.
- Artifact Store, Secret Store, Credential Capsule, Control Metadata, Identity, Workload Runtime, and Telemetry are distinct contracts.
- The profile-level reconciler and workload/capsule drivers use monotonically increasing generations and idempotent desired state.
- Migrations form an explicit forward graph with durable checkpoints and optional rollback.
- Every profile runs the same PROFILE conformance harness and publishes normalized evidence.
- Cloud exceptions and configuration values do not cross public SDK errors or reports.

Protocol v1 remains provisional until at least two materially different production profiles satisfy these contracts. This refines rather than removes ADR-0006's evidence requirement.

## Consequences

Positive:

- AWS, GCP, Azure, and self-hosted support can evolve outside core packages;
- capability discovery replaces provider-name conditionals;
- GCS/S3/Blob artifact storage remains distinct from live Credential Capsule storage;
- agent Provider Runners reuse the same workload and capsule lifecycle across clouds;
- migrations, teardown, and generation fencing become extension requirements rather than profile conventions;
- conformance evidence can compare providers using one vocabulary.

Costs:

- every production profile must implement substantial lifecycle, IAM, recovery, and documentation work;
- the SDK must preserve compatibility or explicitly version breaking contracts;
- profile packages have a large trusted computing base and need signing, SBOM, provenance, and security review;
- a generic contract may need refinement after the first two real profiles expose differences;
- operators must pin and upgrade profiles deliberately.

## Rejected alternatives

- **Import all cloud SDKs into core:** couples release cadence, permissions, dependencies, and failure behavior to every provider.
- **Provider-name conditionals:** create an implicit interface with no conformance or compatibility version.
- **Dynamically download profile code:** turns a configuration path into privileged remote code execution.
- **Treat object storage as the live credential capsule:** object APIs do not provide the isolated mutable official-client filesystem contract.
- **Put raw secrets in profile configuration:** leaks through configuration state, errors, plans, and automation.
- **Use only Terraform/Pulumi modules as the Interface:** provisioning alone does not define runtime reconciliation, capability behavior, migration, or application-visible failure semantics.
- **Mark protocol v1 stable with only a synthetic profile:** contradicts the evidence rule in ADR-0006.

## Verification

PROFILE-001 through PROFILE-011 validate registry discovery, strict redacted configuration, capability parity, artifacts, secrets, metadata, identity, workload fencing, profile reconciliation, credential capsules, migrations, and teardown against the synthetic profile. Production support requires the same scenarios against ephemeral real resources plus security and operator evidence.
