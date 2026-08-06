# Deployment Profile SDK

**Implementation status:** protocol v1, registry, configuration validator, capability contracts, reconciler wrapper, migration executor, synthetic full-profile Implementation, and PROFILE-001 through PROFILE-011 conformance are implemented. AWS, GCP, Azure, Kubernetes, and self-hosted production profiles are not implemented.

## Purpose

The Deployment Profile SDK makes cloud support an extension problem rather than a product fork. Core OpenCloudOS modules ask for portable capabilities. An operator selects and installs a trusted profile package that implements those capabilities with local or cloud infrastructure.

```text
OpenCloudOS core
      |
      | capability requirements + desired generation
      v
DeploymentProfileRegistry
      |
      | validated config + immutable manifest
      v
DeploymentProfileHandle
      |-- ArtifactStoreDriver
      |-- SecretStoreDriver
      |-- CredentialCapsuleDriver
      |-- ControlMetadataDriver
      |-- IdentityDriver
      |-- WorkloadRuntimeDriver
      |-- TelemetryDriver
      |-- DeploymentReconciler
      `-- checkpointed migration graph
```

The SDK contains no AWS, Google Cloud, Azure, Kubernetes, Terraform, Pulumi, or vendor storage imports. A profile may use those dependencies inside its own package.

## Trust and loading model

Profiles are privileged infrastructure code. They are installed, pinned, and allowlisted by the operator at process startup. OpenCloudOS does not download a package from a manifest URL, execute profile code supplied by a user, load a profile from a Workspace or Gadget, or switch profiles from an untrusted request.

Recommended package names are:

```text
@opencloudos/profile-aws
@opencloudos/profile-gcp
@opencloudos/profile-azure
@opencloudos/profile-kubernetes
@opencloudos/profile-self-hosted
```

Each package exports a factory returning one `DeploymentProfile`. A profile contains a versioned manifest, flat declarative configuration schema, migrations, and a factory for a configured driver instance. Protocol v1 is provisional until at least two production profiles pass conformance, as required by ADR-0006.

## Registration and lifecycle

### Register

The registry validates and freezes the profile before publishing it:

- protocol version equals `1`;
- profile identifier, provider, display name, profile version, architectures, capabilities, driver versions, and feature names are valid;
- each capability is declared once;
- configuration fields and defaults are valid;
- credential-shaped configuration fields are opaque references rather than ordinary strings;
- migration identifiers and edges are unique, forward-only, and do not exceed the profile version;
- reversible migrations provide rollback.

Duplicate profile identifiers fail. Discovery returns defensive manifest copies; callers cannot mutate the registered manifest.

### Discover

Callers list profiles by required capability kinds. Discovery exposes only immutable metadata: profile/provider/version, architectures, driver versions, and feature names. It does not instantiate cloud clients or return configuration.

### Instantiate

The registry validates configuration before invoking profile code. Configuration is flat and contains strings, integers, booleans, enums, and opaque references. Unknown fields, missing required values, invalid types, ranges, choices, and formats produce field/reason codes without submitted values. Raw provider credentials are not configuration.

After the factory returns, the registry proves that every declared capability has exactly one driver and that no undeclared driver is present. Factory failures become a generic `deployment_profile_instantiation_failed`; raw cloud errors do not cross this boundary.

### Reconcile

The profile handle accepts a desired deployment reference, monotonically increasing generation, release SHA-256 digest, and supported architecture. It enforces:

- stale generations fail;
- retrying the same generation with the same desired state is idempotent;
- changing desired state at the same generation fails;
- destroying a generation converges to `absent`;
- a destroyed generation cannot be resurrected without a newer generation;
- observation resource references remain opaque;
- untyped profile exceptions become generic operation failures.

This in-process fence does not replace durable provider-side compare-and-swap. A production reconciler must persist its last generation so a process restart cannot admit a stale request.

### Migrate and close

The registry finds a deterministic forward path from the installed version to the target profile version. Before each migration it writes a `started` checkpoint; after success it writes `applied`. Retrying skips applied steps. Rollback walks the same untampered plan in reverse and requires every step to be reversible with a rollback function. Failed steps expose only their registered migration identifier.

Closing a profile instance is idempotent. A failed close can be retried. Operations after a successful close fail explicitly.

## Capability contracts

| Capability | Portable contract | Primary invariant |
|---|---|---|
| `artifact_store` | Immutable put by digest, head, read, delete | Read-after-publish and tenant isolation |
| `secret_store` | Seal material, create opaque workload binding, destroy | No read or export Interface |
| `credential_capsule` | Reconcile mount, inspect, seal, destroy | One tenant/generation; destruction is irreversible |
| `control_metadata` | Read, compare-and-swap, versioned delete | Strong conflict detection and tenant isolation |
| `identity` | Authenticate provider assertion into tenant/user/groups/expiry | No provider token in normalized identity |
| `workload_runtime` | Reconcile, inspect, generation-fenced destroy for runtime shard/provider runner/control service | Desired and observed generations match; stopped generation cannot be reused |
| `telemetry` | Emit normalized events | Provider-neutral event shape; no credential material |

The Secret Store and Credential Capsule are deliberately separate. A secret store handles sealed administrative or Gatekeeper material and never exports it. A Credential Capsule is a mutable storage/execution envelope owned by an official agent client. GCS, S3, and Blob Storage are suitable for artifacts and encrypted backups; they are not the live writable Codex credential cache.

## Cloud profile mapping

The exact services are profile decisions, but the contract mapping is fixed:

| Capability | AWS profile | GCP profile | Azure profile | Self-hosted profile |
|---|---|---|---|---|
| Artifact store | S3 adapter | GCS adapter | Blob Storage adapter | MinIO/filesystem adapter |
| Secret store | Secrets Manager adapter | Secret Manager adapter | Key Vault adapter | Vault adapter |
| Credential Capsule | Encrypted per-runner volume/binding | Encrypted per-runner volume/binding | Encrypted per-runner volume/binding | Encrypted dedicated volume/binding |
| Control metadata | PostgreSQL-compatible managed database | PostgreSQL-compatible managed database | PostgreSQL-compatible managed database | PostgreSQL |
| Workload runtime | EKS workload adapter | GKE workload adapter | AKS workload adapter | Kubernetes/local runtime adapter |
| Identity | Configured OIDC/workload identity adapter | Configured OIDC/workload identity adapter | Configured OIDC/workload identity adapter | Generic OIDC/local adapter |
| Telemetry | OTLP exporter | OTLP exporter | OTLP exporter | OpenTelemetry Collector |

Cloud service names and support claims remain profile compatibility data, not constants in core code.

## Provider Runner integration

The deployment profile schedules a `provider_runner` workload and mounts one `credential_capsule` attachment into it. Inside that isolated workload, the existing Codex supervisor owns one local pinned app-server process and bounded stdio transport. The control plane receives only workload, capsule, endpoint, and generation references.

```text
Deployment Profile                  Inside Provider Runner workload
------------------                  -------------------------------
WorkloadRuntimeDriver  -----------> CodexRunnerSupervisor
CredentialCapsuleDriver ----------> local capsule mount
                                     |
                                     `-> pinned codex app-server over stdio
```

This preserves ADR-0009: the app-server JSONL transport remains local stdio and is not exposed as a cloud WebSocket service.

## Executable conformance

The reusable harness reports normalized pass/fail/skip results and never includes configuration values or cloud exception messages.

| Scenario | Required evidence |
|---|---|
| PROFILE-001 Discovery | Manifest protocol and capability-filtered discovery agree |
| PROFILE-002 Configuration | Unknown/invalid configuration fails without echoing submitted values |
| PROFILE-003 Driver parity | Capability declarations exactly match instantiated drivers |
| PROFILE-004 Artifacts | Digest, immutability, availability, and tenant isolation hold |
| PROFILE-005 Secrets | Workload bindings are opaque, cross-tenant access fails, no read/export method exists, and destroyed version identities are not reused |
| PROFILE-006 Metadata | Compare-and-swap rejects stale versions and keys remain tenant-scoped |
| PROFILE-007 Identity | Provider assertion normalizes to tenant/user without returning the token |
| PROFILE-008 Workloads | Runtime reconciliation reaches readiness and rejects stale generations |
| PROFILE-009 Deployment | Whole-profile reconciliation is idempotent, fenced, and cannot resurrect a destroyed generation |
| PROFILE-010 Capsules | Capsule mount/seal/destroy is tenant-scoped and generation-fenced; sealed/destroyed generations cannot remount |
| PROFILE-011 Migration | Checkpoints make apply resumable, rollback is explicit, and close is idempotent |

The included `synthetic-conformance` profile implements all seven capabilities in memory. It creates no cloud resource, account, credential, process, network connection, or production storage.

## Author checklist

1. Choose one unique profile ID and semantic version.
2. Declare only capabilities the package actually implements.
3. Keep cloud SDK imports inside the profile package.
4. Define flat configuration; use references for secret or credential inputs.
5. Namespace every resource and storage key by tenant/deployment ownership.
6. Persist generation fences outside the controller process.
7. Make reconciliation, teardown, and migration steps idempotent.
8. Return opaque resource references and normalized failure codes.
9. Keep raw cloud responses, tokens, keys, connection strings, and file paths out of public errors, telemetry, and evidence.
10. Run PROFILE-001 through PROFILE-011 against ephemeral provider resources.
11. Publish service/version support, IAM requirements, cost implications, backup/restore, and known deviations.
12. Complete security and operator review before marking the profile supported.

## Remaining implementation

- implement the self-hosted/Kubernetes profile first to prove a real driver set;
- implement AWS, GCP, and Azure packages without changing core imports;
- connect the profile registry to application bootstrap and persisted deployment selection;
- add durable PostgreSQL reconciliation state and controller leader fencing;
- define real configuration manifests and infrastructure provisioning boundaries;
- execute conformance against ephemeral cloud resources in protected CI;
- sign profile packages and record dependency/SBOM/provenance data;
- publish installation, upgrade, rollback, backup, restore, cost, quota, and deletion runbooks;
- keep protocol v1 provisional until two materially different production profiles pass.

Related records: [Architecture](./ARCHITECTURE.md), [Execution plan](./EXECUTION_PLAN.md), [Codex runner supervisor](./CODEX_RUNNER_SUPERVISOR.md), [ADR-0006](./adr/0006-provider-variation-through-real-seams.md), and [ADR-0011](./adr/0011-use-operator-installed-deployment-profiles.md).
