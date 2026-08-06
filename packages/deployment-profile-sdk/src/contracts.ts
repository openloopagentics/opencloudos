export const DEPLOYMENT_PROFILE_PROTOCOL_VERSION = 1;

export type DeploymentProvider = "aws" | "gcp" | "azure" | "kubernetes" | "self_hosted" | "synthetic";
export type DeploymentArchitecture = "linux-amd64" | "linux-arm64";
export type DeploymentCapabilityKind =
  | "artifact_store"
  | "secret_store"
  | "credential_capsule"
  | "control_metadata"
  | "identity"
  | "workload_runtime"
  | "telemetry";

export interface DeploymentScope {
  tenantId: string;
}

export interface DeploymentCapabilityDeclaration {
  kind: DeploymentCapabilityKind;
  driverVersion: string;
  features: string[];
}

export interface DeploymentProfileManifest {
  protocolVersion: number;
  profileId: string;
  displayName: string;
  provider: DeploymentProvider;
  profileVersion: string;
  supportedArchitectures: DeploymentArchitecture[];
  capabilities: DeploymentCapabilityDeclaration[];
}

export type DeploymentConfigPrimitive = string | number | boolean;
export type DeploymentProfileConfig = Readonly<Record<string, DeploymentConfigPrimitive>>;

export type DeploymentConfigField =
  | { type: "string"; required?: boolean; default?: string; pattern?: string }
  | { type: "integer"; required?: boolean; default?: number; minimum?: number; maximum?: number }
  | { type: "boolean"; required?: boolean; default?: boolean }
  | { type: "enum"; required?: boolean; default?: string; values: string[] }
  | { type: "reference"; required?: boolean; default?: string };

export interface DeploymentProfileConfigSchema {
  fields: Record<string, DeploymentConfigField>;
}

export interface ArtifactPutRequest {
  artifactRef: string;
  digest: string;
  bytes: Uint8Array;
}

export interface ArtifactMetadata {
  artifactRef: string;
  digest: string;
  size: number;
}

export interface ArtifactStoreDriver {
  putImmutable(scope: DeploymentScope, request: ArtifactPutRequest, signal?: AbortSignal): Promise<ArtifactMetadata>;
  head(scope: DeploymentScope, artifactRef: string): Promise<ArtifactMetadata | undefined>;
  read(scope: DeploymentScope, artifactRef: string): Promise<Uint8Array | undefined>;
  delete(scope: DeploymentScope, artifactRef: string): Promise<void>;
}

export interface SecretVersion {
  secretRef: string;
  versionRef: string;
}

export interface WorkloadSecretBinding extends SecretVersion {
  bindingRef: string;
  workloadRef: string;
}

export interface SecretStoreDriver {
  seal(scope: DeploymentScope, secretRef: string, material: Uint8Array, signal?: AbortSignal): Promise<SecretVersion>;
  bind(scope: DeploymentScope, secretRef: string, workloadRef: string): Promise<WorkloadSecretBinding>;
  destroy(scope: DeploymentScope, secretRef: string): Promise<void>;
}

export interface CredentialCapsuleDesiredState {
  capsuleRef: string;
  workloadRef: string;
  generation: number;
  storagePolicyRef: string;
}

export interface CredentialCapsuleObservation {
  capsuleRef: string;
  state: "sealed" | "mounted" | "destroyed";
  observedGeneration: number;
  attachmentRef?: string;
}

export interface CredentialCapsuleDriver {
  reconcile(
    scope: DeploymentScope,
    desired: CredentialCapsuleDesiredState,
    signal?: AbortSignal,
  ): Promise<CredentialCapsuleObservation>;
  inspect(scope: DeploymentScope, capsuleRef: string): Promise<CredentialCapsuleObservation | undefined>;
  seal(scope: DeploymentScope, capsuleRef: string, generation: number): Promise<CredentialCapsuleObservation>;
  destroy(scope: DeploymentScope, capsuleRef: string, generation: number): Promise<CredentialCapsuleObservation>;
}

export type DeploymentJson =
  | null
  | boolean
  | number
  | string
  | DeploymentJson[]
  | { [key: string]: DeploymentJson };

export interface MetadataRecord {
  key: string;
  version: number;
  value: DeploymentJson;
}

export interface ControlMetadataDriver {
  read(scope: DeploymentScope, key: string): Promise<MetadataRecord | undefined>;
  compareAndSwap(
    scope: DeploymentScope,
    key: string,
    expectedVersion: number | null,
    value: DeploymentJson,
  ): Promise<MetadataRecord>;
  delete(scope: DeploymentScope, key: string, expectedVersion: number): Promise<void>;
}

export interface IdentityAssertion {
  issuer: string;
  audience: string;
  subjectToken: string;
}

export interface DeploymentIdentity {
  tenantId: string;
  userId: string;
  groups: string[];
  expiresAt: string;
}

export interface IdentityDriver {
  authenticate(assertion: IdentityAssertion): Promise<DeploymentIdentity>;
}

export type DeploymentWorkloadKind = "runtime_shard" | "provider_runner" | "control_service";

export interface WorkloadDesiredState {
  workloadRef: string;
  kind: DeploymentWorkloadKind;
  generation: number;
  releaseDigest: string;
  resourcePolicyRef: string;
  networkPolicyRef: string;
  storagePolicyRef: string;
}

export interface WorkloadObservation {
  workloadRef: string;
  state: "starting" | "ready" | "degraded" | "stopped";
  observedGeneration: number;
  endpointRef?: string;
  failureCode?: string;
}

export interface WorkloadRuntimeDriver {
  reconcile(scope: DeploymentScope, desired: WorkloadDesiredState, signal?: AbortSignal): Promise<WorkloadObservation>;
  inspect(scope: DeploymentScope, workloadRef: string): Promise<WorkloadObservation | undefined>;
  destroy(scope: DeploymentScope, workloadRef: string, generation: number): Promise<WorkloadObservation>;
}

export interface DeploymentTelemetryEvent {
  type: string;
  occurredAt: string;
  tenantId?: string;
  attributes: Record<string, string | number | boolean>;
}

export interface TelemetryDriver {
  emit(events: DeploymentTelemetryEvent[]): Promise<void>;
}

export interface DeploymentProfileDrivers {
  artifactStore?: ArtifactStoreDriver;
  secretStore?: SecretStoreDriver;
  credentialCapsule?: CredentialCapsuleDriver;
  controlMetadata?: ControlMetadataDriver;
  identity?: IdentityDriver;
  workloadRuntime?: WorkloadRuntimeDriver;
  telemetry?: TelemetryDriver;
}

export interface DeploymentDesiredState {
  deploymentRef: string;
  generation: number;
  releaseDigest: string;
  architecture: DeploymentArchitecture;
}

export interface DeploymentObservation {
  deploymentRef: string;
  state: "absent" | "reconciling" | "ready" | "degraded";
  observedGeneration: number;
  resourceRefs: string[];
  failureCode?: string;
}

export interface DeploymentReconciler {
  observe(deploymentRef: string): Promise<DeploymentObservation>;
  reconcile(desired: DeploymentDesiredState, signal?: AbortSignal): Promise<DeploymentObservation>;
  destroy(deploymentRef: string, generation: number, signal?: AbortSignal): Promise<DeploymentObservation>;
}

export interface DeploymentMigrationCheckpoint {
  migrationId: string;
  state: "started" | "applied" | "rolled_back";
  checkpointRef?: string;
  updatedAt: string;
}

export interface DeploymentMigrationCheckpointStore {
  read(deploymentRef: string, migrationId: string): Promise<DeploymentMigrationCheckpoint | undefined>;
  write(deploymentRef: string, checkpoint: DeploymentMigrationCheckpoint): Promise<void>;
}

export interface DeploymentMigrationContext {
  deploymentRef: string;
  checkpoints: DeploymentMigrationCheckpointStore;
  now: () => Date;
}

export interface DeploymentMigration {
  migrationId: string;
  fromVersion: string;
  toVersion: string;
  reversible: boolean;
  apply(context: DeploymentMigrationContext, signal?: AbortSignal): Promise<void>;
  rollback?(context: DeploymentMigrationContext, signal?: AbortSignal): Promise<void>;
}

export interface DeploymentProfileInstance {
  drivers: DeploymentProfileDrivers;
  reconciler: DeploymentReconciler;
  close(): Promise<void>;
}

export interface DeploymentProfile {
  manifest: DeploymentProfileManifest;
  configSchema: DeploymentProfileConfigSchema;
  migrations: DeploymentMigration[];
  create(config: DeploymentProfileConfig): Promise<DeploymentProfileInstance>;
}

export interface DeploymentMigrationPlan {
  profileId: string;
  fromVersion: string;
  toVersion: string;
  steps: Array<{
    migrationId: string;
    fromVersion: string;
    toVersion: string;
    reversible: boolean;
  }>;
}
