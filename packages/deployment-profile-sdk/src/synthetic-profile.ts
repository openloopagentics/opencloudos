import { createHash } from "node:crypto";
import {
  DEPLOYMENT_PROFILE_PROTOCOL_VERSION,
  type ArtifactMetadata,
  type ArtifactPutRequest,
  type ArtifactStoreDriver,
  type ControlMetadataDriver,
  type CredentialCapsuleDesiredState,
  type CredentialCapsuleDriver,
  type CredentialCapsuleObservation,
  type DeploymentDesiredState,
  type DeploymentIdentity,
  type DeploymentMigrationCheckpoint,
  type DeploymentMigrationCheckpointStore,
  type DeploymentObservation,
  type DeploymentProfile,
  type DeploymentProfileConfig,
  type DeploymentProfileDrivers,
  type DeploymentReconciler,
  type DeploymentScope,
  type DeploymentTelemetryEvent,
  type IdentityAssertion,
  type IdentityDriver,
  type MetadataRecord,
  type SecretStoreDriver,
  type SecretVersion,
  type TelemetryDriver,
  type WorkloadDesiredState,
  type WorkloadObservation,
  type WorkloadRuntimeDriver,
  type WorkloadSecretBinding,
} from "./contracts.js";
import {
  DeploymentDriverConflictError,
  DeploymentGenerationConflictError,
  DeploymentProfileClosedError,
} from "./errors.js";

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function scoped(scope: DeploymentScope, reference: string): string {
  if (!SAFE_REF.test(scope.tenantId) || !SAFE_REF.test(reference)) throw new DeploymentDriverConflictError();
  return `${scope.tenantId}\u0000${reference}`;
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

interface StoredArtifact {
  metadata: ArtifactMetadata;
  bytes: Uint8Array;
}

interface StoredSecret {
  material: Uint8Array;
  version: number;
}

interface SyntheticState {
  closed: boolean;
  closeCalls: number;
  artifacts: Map<string, StoredArtifact>;
  secrets: Map<string, StoredSecret>;
  secretVersions: Map<string, number>;
  capsules: Map<string, { desired: CredentialCapsuleDesiredState; observation: CredentialCapsuleObservation }>;
  metadata: Map<string, MetadataRecord>;
  metadataVersions: Map<string, number>;
  workloads: Map<string, { desired: WorkloadDesiredState; observation: WorkloadObservation }>;
  deployments: Map<string, { desired: DeploymentDesiredState; observation: DeploymentObservation }>;
  telemetry: DeploymentTelemetryEvent[];
}

function assertOpen(state: SyntheticState): void {
  if (state.closed) throw new DeploymentProfileClosedError();
}

class SyntheticArtifactStore implements ArtifactStoreDriver {
  constructor(private readonly state: SyntheticState) {}

  async putImmutable(scope: DeploymentScope, request: ArtifactPutRequest): Promise<ArtifactMetadata> {
    assertOpen(this.state);
    const key = scoped(scope, request.artifactRef);
    if (!SHA256.test(request.digest) || digest(request.bytes) !== request.digest) throw new DeploymentDriverConflictError("artifact_digest_invalid");
    const existing = this.state.artifacts.get(key);
    if (existing) {
      if (existing.metadata.digest !== request.digest) throw new DeploymentDriverConflictError("artifact_immutable_conflict");
      return structuredClone(existing.metadata);
    }
    const metadata = { artifactRef: request.artifactRef, digest: request.digest, size: request.bytes.byteLength };
    this.state.artifacts.set(key, { metadata, bytes: new Uint8Array(request.bytes) });
    return structuredClone(metadata);
  }

  async head(scope: DeploymentScope, artifactRef: string): Promise<ArtifactMetadata | undefined> {
    assertOpen(this.state);
    const stored = this.state.artifacts.get(scoped(scope, artifactRef));
    return stored ? structuredClone(stored.metadata) : undefined;
  }

  async read(scope: DeploymentScope, artifactRef: string): Promise<Uint8Array | undefined> {
    assertOpen(this.state);
    const stored = this.state.artifacts.get(scoped(scope, artifactRef));
    return stored ? new Uint8Array(stored.bytes) : undefined;
  }

  async delete(scope: DeploymentScope, artifactRef: string): Promise<void> {
    assertOpen(this.state);
    this.state.artifacts.delete(scoped(scope, artifactRef));
  }
}

class SyntheticSecretStore implements SecretStoreDriver {
  constructor(private readonly state: SyntheticState) {}

  async seal(scope: DeploymentScope, secretRef: string, material: Uint8Array): Promise<SecretVersion> {
    assertOpen(this.state);
    if (material.byteLength === 0) throw new DeploymentDriverConflictError("secret_material_invalid");
    const key = scoped(scope, secretRef);
    const version = (this.state.secretVersions.get(key) ?? 0) + 1;
    this.state.secretVersions.set(key, version);
    this.state.secrets.set(key, { material: new Uint8Array(material), version });
    return { secretRef, versionRef: `version:${version}` };
  }

  async bind(scope: DeploymentScope, secretRef: string, workloadRef: string): Promise<WorkloadSecretBinding> {
    assertOpen(this.state);
    const secret = this.state.secrets.get(scoped(scope, secretRef));
    if (!secret || !SAFE_REF.test(workloadRef)) throw new DeploymentDriverConflictError("secret_binding_unavailable");
    return {
      secretRef,
      versionRef: `version:${secret.version}`,
      bindingRef: `binding:${scope.tenantId}:${workloadRef}:${secret.version}`,
      workloadRef,
    };
  }

  async destroy(scope: DeploymentScope, secretRef: string): Promise<void> {
    assertOpen(this.state);
    const key = scoped(scope, secretRef);
    const secret = this.state.secrets.get(key);
    if (secret) secret.material.fill(0);
    this.state.secrets.delete(key);
  }
}

class SyntheticCredentialCapsules implements CredentialCapsuleDriver {
  constructor(private readonly state: SyntheticState) {}

  async reconcile(scope: DeploymentScope, desired: CredentialCapsuleDesiredState): Promise<CredentialCapsuleObservation> {
    assertOpen(this.state);
    const key = scoped(scope, desired.capsuleRef);
    const existing = this.state.capsules.get(key);
    if (existing && desired.generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
    if (
      existing
      && desired.generation === existing.desired.generation
      && (existing.observation.state !== "mounted" || JSON.stringify(existing.desired) !== JSON.stringify(desired))
    ) {
      throw new DeploymentGenerationConflictError();
    }
    const observation: CredentialCapsuleObservation = {
      capsuleRef: desired.capsuleRef,
      state: "mounted",
      observedGeneration: desired.generation,
      attachmentRef: `attachment:${scope.tenantId}:${desired.workloadRef}:${desired.generation}`,
    };
    this.state.capsules.set(key, { desired: structuredClone(desired), observation });
    return structuredClone(observation);
  }

  async inspect(scope: DeploymentScope, capsuleRef: string): Promise<CredentialCapsuleObservation | undefined> {
    assertOpen(this.state);
    const existing = this.state.capsules.get(scoped(scope, capsuleRef));
    return existing ? structuredClone(existing.observation) : undefined;
  }

  async seal(scope: DeploymentScope, capsuleRef: string, generation: number): Promise<CredentialCapsuleObservation> {
    assertOpen(this.state);
    const key = scoped(scope, capsuleRef);
    const existing = this.state.capsules.get(key);
    if (!existing || generation < existing.desired.generation || existing.observation.state === "destroyed") {
      throw new DeploymentGenerationConflictError();
    }
    existing.observation = { capsuleRef, state: "sealed", observedGeneration: generation };
    existing.desired = { ...existing.desired, generation };
    return structuredClone(existing.observation);
  }

  async destroy(scope: DeploymentScope, capsuleRef: string, generation: number): Promise<CredentialCapsuleObservation> {
    assertOpen(this.state);
    const key = scoped(scope, capsuleRef);
    const existing = this.state.capsules.get(key);
    if (!existing || generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
    existing.observation = { capsuleRef, state: "destroyed", observedGeneration: generation };
    existing.desired = { ...existing.desired, generation };
    return structuredClone(existing.observation);
  }
}

class SyntheticControlMetadata implements ControlMetadataDriver {
  constructor(private readonly state: SyntheticState) {}

  async read(scope: DeploymentScope, key: string): Promise<MetadataRecord | undefined> {
    assertOpen(this.state);
    const record = this.state.metadata.get(scoped(scope, key));
    return record ? structuredClone(record) : undefined;
  }

  async compareAndSwap(
    scope: DeploymentScope,
    key: string,
    expectedVersion: number | null,
    value: MetadataRecord["value"],
  ): Promise<MetadataRecord> {
    assertOpen(this.state);
    const storageKey = scoped(scope, key);
    const existing = this.state.metadata.get(storageKey);
    const actualVersion = existing?.version ?? null;
    if (actualVersion !== expectedVersion) throw new DeploymentDriverConflictError("metadata_version_conflict");
    const version = (this.state.metadataVersions.get(storageKey) ?? 0) + 1;
    const record = { key, version, value: structuredClone(value) };
    this.state.metadataVersions.set(storageKey, version);
    this.state.metadata.set(storageKey, record);
    return structuredClone(record);
  }

  async delete(scope: DeploymentScope, key: string, expectedVersion: number): Promise<void> {
    assertOpen(this.state);
    const storageKey = scoped(scope, key);
    if (this.state.metadata.get(storageKey)?.version !== expectedVersion) {
      throw new DeploymentDriverConflictError("metadata_version_conflict");
    }
    this.state.metadata.delete(storageKey);
  }
}

class SyntheticIdentity implements IdentityDriver {
  constructor(
    private readonly state: SyntheticState,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  async authenticate(assertion: IdentityAssertion): Promise<DeploymentIdentity> {
    assertOpen(this.state);
    if (
      assertion.issuer !== this.issuer
      || assertion.audience !== this.audience
      || assertion.subjectToken !== "synthetic-profile-token"
    ) {
      throw new DeploymentDriverConflictError("identity_assertion_invalid");
    }
    return {
      tenantId: "tenant-conformance-a",
      userId: "user-conformance-a",
      groups: ["operators"],
      expiresAt: "2026-08-06T12:00:00.000Z",
    };
  }
}

class SyntheticWorkloadRuntime implements WorkloadRuntimeDriver {
  constructor(private readonly state: SyntheticState) {}

  async reconcile(scope: DeploymentScope, desired: WorkloadDesiredState): Promise<WorkloadObservation> {
    assertOpen(this.state);
    const key = scoped(scope, desired.workloadRef);
    const existing = this.state.workloads.get(key);
    if (existing && desired.generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
    if (
      existing
      && desired.generation === existing.desired.generation
      && (existing.observation.state === "stopped" || JSON.stringify(existing.desired) !== JSON.stringify(desired))
    ) {
      throw new DeploymentGenerationConflictError();
    }
    const observation: WorkloadObservation = {
      workloadRef: desired.workloadRef,
      state: "ready",
      observedGeneration: desired.generation,
      endpointRef: `endpoint:${scope.tenantId}:${desired.workloadRef}`,
    };
    this.state.workloads.set(key, { desired: structuredClone(desired), observation });
    return structuredClone(observation);
  }

  async inspect(scope: DeploymentScope, workloadRef: string): Promise<WorkloadObservation | undefined> {
    assertOpen(this.state);
    const existing = this.state.workloads.get(scoped(scope, workloadRef));
    return existing ? structuredClone(existing.observation) : undefined;
  }

  async destroy(scope: DeploymentScope, workloadRef: string, generation: number): Promise<WorkloadObservation> {
    assertOpen(this.state);
    const key = scoped(scope, workloadRef);
    const existing = this.state.workloads.get(key);
    if (!existing || generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
    existing.desired = { ...existing.desired, generation };
    existing.observation = { workloadRef, state: "stopped", observedGeneration: generation };
    return structuredClone(existing.observation);
  }
}

class SyntheticTelemetry implements TelemetryDriver {
  constructor(private readonly state: SyntheticState) {}

  async emit(events: DeploymentTelemetryEvent[]): Promise<void> {
    assertOpen(this.state);
    this.state.telemetry.push(...structuredClone(events));
  }
}

class SyntheticReconciler implements DeploymentReconciler {
  constructor(private readonly state: SyntheticState) {}

  async observe(deploymentRef: string): Promise<DeploymentObservation> {
    assertOpen(this.state);
    const existing = this.state.deployments.get(deploymentRef);
    return existing
      ? structuredClone(existing.observation)
      : { deploymentRef, state: "absent", observedGeneration: 0, resourceRefs: [] };
  }

  async reconcile(desired: DeploymentDesiredState): Promise<DeploymentObservation> {
    assertOpen(this.state);
    const existing = this.state.deployments.get(desired.deploymentRef);
    if (existing && desired.generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
    if (existing && desired.generation === existing.desired.generation && JSON.stringify(existing.desired) !== JSON.stringify(desired)) {
      throw new DeploymentGenerationConflictError();
    }
    const observation: DeploymentObservation = {
      deploymentRef: desired.deploymentRef,
      state: "ready",
      observedGeneration: desired.generation,
      resourceRefs: [`resource:${desired.deploymentRef}:${desired.generation}`],
    };
    this.state.deployments.set(desired.deploymentRef, { desired: structuredClone(desired), observation });
    return structuredClone(observation);
  }

  async destroy(deploymentRef: string, generation: number): Promise<DeploymentObservation> {
    assertOpen(this.state);
    const existing = this.state.deployments.get(deploymentRef);
    if (existing && generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
    this.state.deployments.delete(deploymentRef);
    return { deploymentRef, state: "absent", observedGeneration: generation, resourceRefs: [] };
  }
}

export class InMemoryDeploymentMigrationCheckpointStore implements DeploymentMigrationCheckpointStore {
  readonly #records = new Map<string, DeploymentMigrationCheckpoint>();

  async read(deploymentRef: string, migrationId: string): Promise<DeploymentMigrationCheckpoint | undefined> {
    const record = this.#records.get(`${deploymentRef}\u0000${migrationId}`);
    return record ? structuredClone(record) : undefined;
  }

  async write(deploymentRef: string, checkpoint: DeploymentMigrationCheckpoint): Promise<void> {
    this.#records.set(`${deploymentRef}\u0000${checkpoint.migrationId}`, structuredClone(checkpoint));
  }
}

export function createSyntheticDeploymentProfile(): DeploymentProfile {
  return {
    manifest: {
      protocolVersion: DEPLOYMENT_PROFILE_PROTOCOL_VERSION,
      profileId: "synthetic-conformance",
      displayName: "Synthetic Conformance Profile",
      provider: "synthetic",
      profileVersion: "1.2.0",
      supportedArchitectures: ["linux-amd64", "linux-arm64"],
      capabilities: [
        { kind: "artifact_store", driverVersion: "1.0.0", features: ["immutable-put", "tenant-scope"] },
        { kind: "secret_store", driverVersion: "1.0.0", features: ["sealed-ingress", "workload-binding"] },
        { kind: "credential_capsule", driverVersion: "1.0.0", features: ["generation-fencing", "mount-seal-destroy"] },
        { kind: "control_metadata", driverVersion: "1.0.0", features: ["compare-and-swap", "tenant-scope"] },
        { kind: "identity", driverVersion: "1.0.0", features: ["oidc-normalization"] },
        { kind: "workload_runtime", driverVersion: "1.0.0", features: ["generation-fencing", "provider-runner"] },
        { kind: "telemetry", driverVersion: "1.0.0", features: ["normalized-events"] },
      ],
    },
    configSchema: {
      fields: {
        region: { type: "enum", required: true, values: ["test-east-1", "test-west-1"] },
        objectStoreRef: { type: "reference", required: true },
        secretStoreRef: { type: "reference", required: true },
        identityIssuer: { type: "string", required: true, pattern: "^https://[^ ]+$" },
        identityAudience: { type: "string", required: true, pattern: "^[A-Za-z0-9._:/-]+$" },
        runtimeCapacity: { type: "integer", default: 3, minimum: 1, maximum: 100 },
        privateNetwork: { type: "boolean", default: true },
      },
    },
    migrations: [
      {
        migrationId: "profile-storage-v1",
        fromVersion: "1.0.0",
        toVersion: "1.1.0",
        reversible: true,
        apply: async () => undefined,
        rollback: async () => undefined,
      },
      {
        migrationId: "profile-runtime-v2",
        fromVersion: "1.1.0",
        toVersion: "1.2.0",
        reversible: true,
        apply: async () => undefined,
        rollback: async () => undefined,
      },
    ],
    create: async (config: DeploymentProfileConfig) => {
      const state: SyntheticState = {
        closed: false,
        closeCalls: 0,
        artifacts: new Map(),
        secrets: new Map(),
        secretVersions: new Map(),
        capsules: new Map(),
        metadata: new Map(),
        metadataVersions: new Map(),
        workloads: new Map(),
        deployments: new Map(),
        telemetry: [],
      };
      const drivers: DeploymentProfileDrivers = {
        artifactStore: new SyntheticArtifactStore(state),
        secretStore: new SyntheticSecretStore(state),
        credentialCapsule: new SyntheticCredentialCapsules(state),
        controlMetadata: new SyntheticControlMetadata(state),
        identity: new SyntheticIdentity(state, String(config.identityIssuer), String(config.identityAudience)),
        workloadRuntime: new SyntheticWorkloadRuntime(state),
        telemetry: new SyntheticTelemetry(state),
      };
      return {
        drivers,
        reconciler: new SyntheticReconciler(state),
        close: async () => {
          if (state.closed) return;
          state.closed = true;
          state.closeCalls += 1;
          for (const secret of state.secrets.values()) secret.material.fill(0);
          state.secrets.clear();
        },
      };
    },
  };
}
