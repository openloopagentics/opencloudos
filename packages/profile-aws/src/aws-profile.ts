import { createHash, randomUUID } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import {
  DEPLOYMENT_PROFILE_PROTOCOL_VERSION,
  DeploymentDriverConflictError,
  DeploymentGenerationConflictError,
  DeploymentProfileClosedError,
  type ArtifactMetadata,
  type ArtifactPutRequest,
  type ArtifactStoreDriver,
  type ControlMetadataDriver,
  type CredentialCapsuleDesiredState,
  type CredentialCapsuleDriver,
  type CredentialCapsuleObservation,
  type DeploymentDesiredState,
  type DeploymentIdentity,
  type DeploymentObservation,
  type DeploymentProfile,
  type DeploymentProfileConfig,
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
} from "../../deployment-profile-sdk/src/index.js";
import {
  AwsApiConflictError,
  type AwsProfileApi,
  type AwsStateRecord,
  createAwsSdkProfileApi,
} from "./aws-api.js";
import {
  EksRuntimeConflictError,
  InClusterEksRuntimeControl,
  type EksRuntimeControl,
} from "./eks-runtime.js";

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

interface AwsConfig {
  region: string;
  artifactBucketRef: string;
  artifactPrefix: string;
  metadataTableRef: string;
  secretPrefix: string;
  telemetryLogGroupRef: string;
  telemetryLogStreamRef: string;
  eksNamespace: string;
  eksServiceAccountRef: string;
  capsuleStorageClassRef: string;
  capsuleSizeGi: number;
  workloadImageRepository: string;
  workloadCpuRequest: string;
  workloadMemoryRequest: string;
  workloadResourcePolicyRef: string;
  workloadNetworkPolicyRef: string;
  workloadStoragePolicyRef: string;
  capsuleStoragePolicyRef: string;
  readinessTimeoutSeconds: number;
  identityIssuer: string;
  identityAudienceRef: string;
  identityUserPoolRef: string;
}

export interface AwsIdentityVerifier {
  verify(subjectToken: string): Promise<Record<string, unknown>>;
}

export interface AwsDeploymentProfileOptions {
  apiFactory?: (config: AwsConfig) => AwsProfileApi;
  eksFactory?: (config: AwsConfig) => Promise<EksRuntimeControl>;
  identityVerifierFactory?: (config: AwsConfig) => AwsIdentityVerifier;
  uuid?: () => string;
}

interface Lifecycle {
  closed: boolean;
}

function assertOpen(lifecycle: Lifecycle): void {
  if (lifecycle.closed) throw new DeploymentProfileClosedError();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertRef(value: string): void {
  if (!SAFE_REF.test(value)) throw new DeploymentDriverConflictError("aws_reference_invalid");
}

function scopeHash(scope: DeploymentScope): string {
  assertRef(scope.tenantId);
  return hash(scope.tenantId);
}

function resourceName(prefix: string, reference: string): string {
  return `${prefix}-${hash(reference).slice(0, 32)}`.slice(0, 63).replace(/-+$/u, "");
}

function parsePayload<T>(record: AwsStateRecord): T {
  try {
    return JSON.parse(record.payload) as T;
  } catch {
    throw new DeploymentDriverConflictError("aws_state_invalid");
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function driverFailure(error: unknown): never {
  if (
    error instanceof DeploymentDriverConflictError
    || error instanceof DeploymentGenerationConflictError
    || error instanceof DeploymentProfileClosedError
  ) throw error;
  if (error instanceof AwsApiConflictError || error instanceof EksRuntimeConflictError) {
    throw new DeploymentGenerationConflictError();
  }
  throw new DeploymentDriverConflictError("aws_profile_operation_failed");
}

class AwsStateStore {
  constructor(
    private readonly api: AwsProfileApi,
    private readonly tableName: string,
  ) {}

  private keys(scope: DeploymentScope, kind: string, reference: string): { pk: string; sk: string } {
    assertRef(reference);
    return { pk: `tenant#${scopeHash(scope)}`, sk: `${kind}#${hash(reference)}` };
  }

  async read(scope: DeploymentScope, kind: string, reference: string): Promise<AwsStateRecord | undefined> {
    const { pk, sk } = this.keys(scope, kind, reference);
    return this.api.getStateRecord(this.tableName, pk, sk);
  }

  async write(
    scope: DeploymentScope,
    kind: string,
    reference: string,
    current: AwsStateRecord | undefined,
    payload: unknown,
    deleted = false,
  ): Promise<AwsStateRecord> {
    const { pk, sk } = this.keys(scope, kind, reference);
    const record = {
      pk,
      sk,
      version: (current?.version ?? 0) + 1,
      deleted,
      payload: JSON.stringify(payload),
    };
    await this.api.putStateRecord(
      this.tableName,
      record,
      current ? { kind: "version", version: current.version } : { kind: "absent" },
    );
    return record;
  }
}

class AwsArtifactStore implements ArtifactStoreDriver {
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly api: AwsProfileApi,
    private readonly config: AwsConfig,
  ) {}

  private key(scope: DeploymentScope, artifactRef: string): string {
    assertRef(artifactRef);
    const prefix = this.config.artifactPrefix.replace(/^\/+|\/+$/gu, "");
    return `${prefix}/tenants/${scopeHash(scope)}/artifacts/${hash(artifactRef)}`;
  }

  async putImmutable(scope: DeploymentScope, request: ArtifactPutRequest, signal?: AbortSignal): Promise<ArtifactMetadata> {
    assertOpen(this.lifecycle);
    try {
      const bytes = new Uint8Array(request.bytes);
      if (!SHA256.test(request.digest) || digestBytes(bytes) !== request.digest) {
        throw new DeploymentDriverConflictError("artifact_digest_invalid");
      }
      const key = this.key(scope, request.artifactRef);
      const existing = await this.api.headArtifact(this.config.artifactBucketRef, key);
      if (existing) {
        if (existing.digest !== request.digest) throw new DeploymentDriverConflictError("artifact_immutable_conflict");
        return { artifactRef: request.artifactRef, digest: existing.digest, size: existing.size };
      }
      try {
        await this.api.putArtifactImmutable(this.config.artifactBucketRef, key, request.digest, bytes, signal);
      } catch (error: unknown) {
        if (!(error instanceof AwsApiConflictError)) throw error;
        const raced = await this.api.headArtifact(this.config.artifactBucketRef, key);
        if (!raced || raced.digest !== request.digest) {
          throw new DeploymentDriverConflictError("artifact_immutable_conflict");
        }
        return { artifactRef: request.artifactRef, digest: raced.digest, size: raced.size };
      }
      return { artifactRef: request.artifactRef, digest: request.digest, size: bytes.byteLength };
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async head(scope: DeploymentScope, artifactRef: string): Promise<ArtifactMetadata | undefined> {
    assertOpen(this.lifecycle);
    try {
      const stored = await this.api.headArtifact(this.config.artifactBucketRef, this.key(scope, artifactRef));
      return stored ? { artifactRef, digest: stored.digest, size: stored.size } : undefined;
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async read(scope: DeploymentScope, artifactRef: string): Promise<Uint8Array | undefined> {
    assertOpen(this.lifecycle);
    try {
      const key = this.key(scope, artifactRef);
      const [head, bytes] = await Promise.all([
        this.api.headArtifact(this.config.artifactBucketRef, key),
        this.api.readArtifact(this.config.artifactBucketRef, key),
      ]);
      if (!head || !bytes) return undefined;
      if (digestBytes(bytes) !== head.digest) throw new DeploymentDriverConflictError("artifact_digest_invalid");
      return bytes;
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async delete(scope: DeploymentScope, artifactRef: string): Promise<void> {
    assertOpen(this.lifecycle);
    try {
      await this.api.deleteArtifact(this.config.artifactBucketRef, this.key(scope, artifactRef));
    } catch (error: unknown) {
      driverFailure(error);
    }
  }
}

interface SecretPayload {
  arn: string;
  versionId: string;
}

class AwsSecretStore implements SecretStoreDriver {
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly api: AwsProfileApi,
    private readonly state: AwsStateStore,
    private readonly config: AwsConfig,
    private readonly uuid: () => string,
  ) {}

  async seal(scope: DeploymentScope, secretRef: string, material: Uint8Array, signal?: AbortSignal): Promise<SecretVersion> {
    assertOpen(this.lifecycle);
    assertRef(secretRef);
    if (material.byteLength === 0 || signal?.aborted) throw new DeploymentDriverConflictError("secret_material_invalid");
    const copy = new Uint8Array(material);
    let createdArn: string | undefined;
    try {
      const current = await this.state.read(scope, "secret", secretRef);
      const token = this.uuid();
      const prior = current && !current.deleted ? parsePayload<SecretPayload>(current) : undefined;
      const result = prior
        ? await this.api.putSecretVersion(prior.arn, copy, token)
        : await this.api.createSecret(
          `${this.config.secretPrefix.replace(/^\/+|\/+$/gu, "")}/${scopeHash(scope)}/${hash(secretRef)}/${token}`,
          copy,
          token,
        );
      if (!prior) createdArn = result.arn;
      try {
        await this.state.write(scope, "secret", secretRef, current, { arn: result.arn, versionId: result.versionId });
      } catch (error: unknown) {
        if (createdArn) await this.api.deleteSecret(createdArn).catch(() => undefined);
        throw error;
      }
      return { secretRef, versionRef: result.versionId };
    } catch (error: unknown) {
      driverFailure(error);
    } finally {
      copy.fill(0);
    }
  }

  async bind(scope: DeploymentScope, secretRef: string, workloadRef: string): Promise<WorkloadSecretBinding> {
    assertOpen(this.lifecycle);
    assertRef(secretRef);
    assertRef(workloadRef);
    try {
      const current = await this.state.read(scope, "secret", secretRef);
      if (!current || current.deleted) throw new DeploymentDriverConflictError("secret_binding_unavailable");
      const payload = parsePayload<SecretPayload>(current);
      if (!await this.api.secretExists(payload.arn)) throw new DeploymentDriverConflictError("secret_binding_unavailable");
      return {
        secretRef,
        versionRef: payload.versionId,
        workloadRef,
        bindingRef: `aws:secret-binding:${hash(`${payload.arn}\0${workloadRef}`).slice(0, 48)}`,
      };
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async destroy(scope: DeploymentScope, secretRef: string): Promise<void> {
    assertOpen(this.lifecycle);
    assertRef(secretRef);
    try {
      let current = await this.state.read(scope, "secret", secretRef);
      if (!current) return;
      const payload = parsePayload<SecretPayload>(current);
      if (!current.deleted) current = await this.state.write(scope, "secret", secretRef, current, payload, true);
      await this.api.deleteSecret(payload.arn);
    } catch (error: unknown) {
      driverFailure(error);
    }
  }
}

class AwsControlMetadata implements ControlMetadataDriver {
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly state: AwsStateStore,
  ) {}

  async read(scope: DeploymentScope, key: string): Promise<MetadataRecord | undefined> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(scope, "metadata", key);
      if (!current || current.deleted) return undefined;
      return { key, version: current.version, value: parsePayload<MetadataRecord["value"]>(current) };
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async compareAndSwap(
    scope: DeploymentScope,
    key: string,
    expectedVersion: number | null,
    value: MetadataRecord["value"],
  ): Promise<MetadataRecord> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(scope, "metadata", key);
      const visibleVersion = current && !current.deleted ? current.version : null;
      if (visibleVersion !== expectedVersion) throw new DeploymentDriverConflictError("metadata_version_conflict");
      const written = await this.state.write(scope, "metadata", key, current, value);
      return { key, version: written.version, value: structuredClone(value) };
    } catch (error: unknown) {
      if (error instanceof AwsApiConflictError) throw new DeploymentDriverConflictError("metadata_version_conflict");
      driverFailure(error);
    }
  }

  async delete(scope: DeploymentScope, key: string, expectedVersion: number): Promise<void> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(scope, "metadata", key);
      if (!current || current.deleted || current.version !== expectedVersion) {
        throw new DeploymentDriverConflictError("metadata_version_conflict");
      }
      await this.state.write(scope, "metadata", key, current, null, true);
    } catch (error: unknown) {
      if (error instanceof AwsApiConflictError) throw new DeploymentDriverConflictError("metadata_version_conflict");
      driverFailure(error);
    }
  }
}

class AwsCognitoIdentity implements IdentityDriver {
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly config: AwsConfig,
    private readonly verifier: AwsIdentityVerifier,
  ) {}

  async authenticate(assertion: IdentityAssertion): Promise<DeploymentIdentity> {
    assertOpen(this.lifecycle);
    try {
      if (assertion.issuer !== this.config.identityIssuer || assertion.audience !== this.config.identityAudienceRef) {
        throw new DeploymentDriverConflictError("identity_assertion_invalid");
      }
      const claims = await this.verifier.verify(assertion.subjectToken);
      const tenantId = claims["custom:tenant_id"];
      const userId = claims.sub;
      const expires = claims.exp;
      const rawGroups = claims["cognito:groups"];
      if (typeof tenantId !== "string" || typeof userId !== "string" || typeof expires !== "number" || !Number.isFinite(expires)) {
        throw new DeploymentDriverConflictError("identity_assertion_invalid");
      }
      assertRef(tenantId);
      assertRef(userId);
      const groups = Array.isArray(rawGroups) && rawGroups.every((group) => typeof group === "string")
        ? rawGroups.filter((group) => SAFE_REF.test(group)) as string[]
        : [];
      return { tenantId, userId, groups, expiresAt: new Date(expires * 1_000).toISOString() };
    } catch (error: unknown) {
      driverFailure(error);
    }
  }
}

interface CapsulePayload {
  desired: CredentialCapsuleDesiredState;
  pvcName: string;
  state: "mounted" | "sealed" | "destroyed";
}

interface CapsuleLinkPayload {
  capsuleRef: string;
  pvcName: string;
  generation: number;
  state: "mounted" | "sealed" | "destroyed";
}

class AwsCredentialCapsules implements CredentialCapsuleDriver {
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly state: AwsStateStore,
    private readonly eks: EksRuntimeControl,
    private readonly config: AwsConfig,
  ) {}

  private observation(payload: CapsulePayload): CredentialCapsuleObservation {
    return {
      capsuleRef: payload.desired.capsuleRef,
      state: payload.state,
      observedGeneration: payload.desired.generation,
      ...(payload.state === "mounted" ? { attachmentRef: `k8s:pvc:${this.config.eksNamespace}/${payload.pvcName}` } : {}),
    };
  }

  private async ensureLink(scope: DeploymentScope, desired: CredentialCapsuleDesiredState, pvcName: string): Promise<void> {
    const current = await this.state.read(scope, "capsule-link", desired.workloadRef);
    if (current && !current.deleted) {
      const link = parsePayload<CapsuleLinkPayload>(current);
      if (link.capsuleRef !== desired.capsuleRef) throw new DeploymentDriverConflictError("capsule_workload_conflict");
      if (link.generation > desired.generation) throw new DeploymentGenerationConflictError();
      if (link.generation === desired.generation && link.state === "mounted" && link.pvcName === pvcName) return;
    }
    await this.state.write(scope, "capsule-link", desired.workloadRef, current, {
      capsuleRef: desired.capsuleRef,
      pvcName,
      generation: desired.generation,
      state: "mounted",
    } satisfies CapsuleLinkPayload);
  }

  async reconcile(scope: DeploymentScope, desired: CredentialCapsuleDesiredState): Promise<CredentialCapsuleObservation> {
    assertOpen(this.lifecycle);
    assertRef(desired.capsuleRef);
    assertRef(desired.workloadRef);
    if (desired.storagePolicyRef !== this.config.capsuleStoragePolicyRef || desired.generation < 1) {
      throw new DeploymentDriverConflictError("capsule_policy_invalid");
    }
    try {
      const current = await this.state.read(scope, "capsule", desired.capsuleRef);
      const existing = current ? parsePayload<CapsulePayload>(current) : undefined;
      if (existing) {
        if (desired.generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
        if (desired.generation === existing.desired.generation) {
          if (current?.deleted || existing.state !== "mounted" || !same(existing.desired, desired)) {
            throw new DeploymentGenerationConflictError();
          }
          if (await this.eks.inspectCapsule(this.config.eksNamespace, existing.pvcName) === "mounted") {
            await this.ensureLink(scope, desired, existing.pvcName);
            return this.observation(existing);
          }
        }
      }
      const pvcName = existing?.pvcName ?? resourceName("oc-capsule", `${scope.tenantId}\0${desired.capsuleRef}`);
      const workloadName = resourceName("oc-workload", `${scope.tenantId}\0${desired.workloadRef}`);
      const payload: CapsulePayload = { desired: structuredClone(desired), pvcName, state: "mounted" };
      await this.eks.reconcileCapsule({
        namespace: this.config.eksNamespace,
        name: pvcName,
        tenantHash: scopeHash(scope).slice(0, 32),
        workloadName,
        generation: desired.generation,
        storageClassName: this.config.capsuleStorageClassRef,
        sizeGi: this.config.capsuleSizeGi,
        desiredHash: hash(JSON.stringify(desired)),
      });
      await this.state.write(scope, "capsule", desired.capsuleRef, current, payload);
      await this.ensureLink(scope, desired, pvcName);
      return this.observation(payload);
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async inspect(scope: DeploymentScope, capsuleRef: string): Promise<CredentialCapsuleObservation | undefined> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(scope, "capsule", capsuleRef);
      if (!current) return undefined;
      const payload = parsePayload<CapsulePayload>(current);
      if (current.deleted) return this.observation({ ...payload, state: "destroyed" });
      const actual = await this.eks.inspectCapsule(this.config.eksNamespace, payload.pvcName);
      if (!actual) throw new DeploymentDriverConflictError("capsule_attachment_missing");
      return this.observation({ ...payload, state: actual });
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async seal(scope: DeploymentScope, capsuleRef: string, generation: number): Promise<CredentialCapsuleObservation> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(scope, "capsule", capsuleRef);
      if (!current || current.deleted) throw new DeploymentGenerationConflictError();
      const payload = parsePayload<CapsulePayload>(current);
      if (generation < payload.desired.generation) throw new DeploymentGenerationConflictError();
      if (payload.state === "sealed" && generation === payload.desired.generation) return this.observation(payload);
      const workloadName = resourceName("oc-workload", `${scope.tenantId}\0${payload.desired.workloadRef}`);
      await this.eks.sealCapsule(this.config.eksNamespace, payload.pvcName, workloadName, generation);
      const next: CapsulePayload = {
        ...payload,
        desired: { ...payload.desired, generation },
        state: "sealed",
      };
      await this.state.write(scope, "capsule", capsuleRef, current, next);
      const linkCurrent = await this.state.read(scope, "capsule-link", payload.desired.workloadRef);
      if (linkCurrent) await this.state.write(scope, "capsule-link", payload.desired.workloadRef, linkCurrent, {
        capsuleRef,
        pvcName: payload.pvcName,
        generation,
        state: "sealed",
      } satisfies CapsuleLinkPayload);
      return this.observation(next);
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async destroy(scope: DeploymentScope, capsuleRef: string, generation: number): Promise<CredentialCapsuleObservation> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(scope, "capsule", capsuleRef);
      if (!current) throw new DeploymentGenerationConflictError();
      const payload = parsePayload<CapsulePayload>(current);
      if (generation < payload.desired.generation) throw new DeploymentGenerationConflictError();
      if (current.deleted && generation === payload.desired.generation) return this.observation(payload);
      const workloadName = resourceName("oc-workload", `${scope.tenantId}\0${payload.desired.workloadRef}`);
      await this.eks.destroyCapsule(this.config.eksNamespace, payload.pvcName, workloadName, generation);
      const next: CapsulePayload = {
        ...payload,
        desired: { ...payload.desired, generation },
        state: "destroyed",
      };
      await this.state.write(scope, "capsule", capsuleRef, current, next, true);
      const linkCurrent = await this.state.read(scope, "capsule-link", payload.desired.workloadRef);
      if (linkCurrent) await this.state.write(scope, "capsule-link", payload.desired.workloadRef, linkCurrent, {
        capsuleRef,
        pvcName: payload.pvcName,
        generation,
        state: "destroyed",
      } satisfies CapsuleLinkPayload, true);
      return this.observation(next);
    } catch (error: unknown) {
      driverFailure(error);
    }
  }
}

interface WorkloadPayload {
  desired: WorkloadDesiredState;
  observation: WorkloadObservation;
  deploymentName: string;
}

class AwsEksWorkloadRuntime implements WorkloadRuntimeDriver {
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly state: AwsStateStore,
    private readonly eks: EksRuntimeControl,
    private readonly config: AwsConfig,
  ) {}

  private validatePolicies(desired: WorkloadDesiredState): void {
    if (
      desired.resourcePolicyRef !== this.config.workloadResourcePolicyRef
      || desired.networkPolicyRef !== this.config.workloadNetworkPolicyRef
      || desired.storagePolicyRef !== this.config.workloadStoragePolicyRef
    ) throw new DeploymentDriverConflictError("workload_policy_invalid");
  }

  async reconcile(scope: DeploymentScope, desired: WorkloadDesiredState, signal?: AbortSignal): Promise<WorkloadObservation> {
    assertOpen(this.lifecycle);
    assertRef(desired.workloadRef);
    this.validatePolicies(desired);
    if (!SHA256.test(desired.releaseDigest) || desired.generation < 1) throw new DeploymentDriverConflictError("workload_desired_invalid");
    try {
      const current = await this.state.read(scope, "workload", desired.workloadRef);
      const existing = current ? parsePayload<WorkloadPayload>(current) : undefined;
      if (existing) {
        if (desired.generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
        if (desired.generation === existing.desired.generation) {
          if (current?.deleted || existing.observation.state === "stopped" || !same(existing.desired, desired)) {
            throw new DeploymentGenerationConflictError();
          }
          const actual = await this.eks.inspectWorkload(this.config.eksNamespace, existing.deploymentName);
          if (actual?.state === existing.observation.state) return structuredClone(existing.observation);
        }
      }
      let capsuleClaimName: string | undefined;
      if (desired.kind === "provider_runner") {
        const linkRecord = await this.state.read(scope, "capsule-link", desired.workloadRef);
        if (!linkRecord || linkRecord.deleted) throw new DeploymentDriverConflictError("provider_runner_capsule_required");
        const link = parsePayload<CapsuleLinkPayload>(linkRecord);
        if (link.state !== "mounted") throw new DeploymentDriverConflictError("provider_runner_capsule_required");
        capsuleClaimName = link.pvcName;
      }
      const deploymentName = existing?.deploymentName ?? resourceName("oc-workload", `${scope.tenantId}\0${desired.workloadRef}`);
      const actual = await this.eks.reconcileWorkload({
        namespace: this.config.eksNamespace,
        name: deploymentName,
        tenantHash: scopeHash(scope).slice(0, 32),
        generation: desired.generation,
        desiredHash: hash(JSON.stringify(desired)),
        kind: desired.kind,
        image: `${this.config.workloadImageRepository}@${desired.releaseDigest}`,
        serviceAccountName: this.config.eksServiceAccountRef,
        resourcePolicyHash: hash(desired.resourcePolicyRef).slice(0, 32),
        networkPolicyHash: hash(desired.networkPolicyRef).slice(0, 32),
        storagePolicyHash: hash(desired.storagePolicyRef).slice(0, 32),
        capsuleClaimName,
        cpuRequest: this.config.workloadCpuRequest,
        memoryRequest: this.config.workloadMemoryRequest,
      }, signal);
      const observation: WorkloadObservation = {
        workloadRef: desired.workloadRef,
        state: actual.state,
        observedGeneration: desired.generation,
        endpointRef: actual.endpointRef,
      };
      await this.state.write(scope, "workload", desired.workloadRef, current, {
        desired: structuredClone(desired),
        observation,
        deploymentName,
      } satisfies WorkloadPayload);
      return structuredClone(observation);
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async inspect(scope: DeploymentScope, workloadRef: string): Promise<WorkloadObservation | undefined> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(scope, "workload", workloadRef);
      if (!current || current.deleted) return undefined;
      const payload = parsePayload<WorkloadPayload>(current);
      const actual = await this.eks.inspectWorkload(this.config.eksNamespace, payload.deploymentName);
      if (!actual) return { ...payload.observation, state: "degraded", failureCode: "workload_missing" };
      return { ...payload.observation, state: actual.state, endpointRef: actual.endpointRef };
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async destroy(scope: DeploymentScope, workloadRef: string, generation: number): Promise<WorkloadObservation> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(scope, "workload", workloadRef);
      if (!current) throw new DeploymentGenerationConflictError();
      const payload = parsePayload<WorkloadPayload>(current);
      if (generation < payload.desired.generation) throw new DeploymentGenerationConflictError();
      if (current.deleted && generation === payload.observation.observedGeneration) return structuredClone(payload.observation);
      await this.eks.destroyWorkload(this.config.eksNamespace, payload.deploymentName, generation);
      const observation: WorkloadObservation = { workloadRef, state: "stopped", observedGeneration: generation };
      await this.state.write(scope, "workload", workloadRef, current, {
        ...payload,
        desired: { ...payload.desired, generation },
        observation,
      } satisfies WorkloadPayload, true);
      return observation;
    } catch (error: unknown) {
      driverFailure(error);
    }
  }
}

class AwsCloudWatchTelemetry implements TelemetryDriver {
  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly api: AwsProfileApi,
    private readonly config: AwsConfig,
  ) {}

  async emit(events: DeploymentTelemetryEvent[]): Promise<void> {
    assertOpen(this.lifecycle);
    try {
      const logEvents = events.map((event) => {
        const timestamp = Date.parse(event.occurredAt);
        if (!Number.isFinite(timestamp)) throw new DeploymentDriverConflictError("telemetry_event_invalid");
        for (const key of Object.keys(event.attributes)) {
          if (/(authorization|password|secret|token)/iu.test(key)) {
            throw new DeploymentDriverConflictError("telemetry_attribute_forbidden");
          }
        }
        return { timestamp, message: JSON.stringify(event) };
      }).sort((left, right) => left.timestamp - right.timestamp);
      let batch: typeof logEvents = [];
      let batchBytes = 0;
      for (const event of logEvents) {
        const eventBytes = Buffer.byteLength(event.message) + 26;
        if (eventBytes > 1_048_576) throw new DeploymentDriverConflictError("telemetry_event_invalid");
        if (batch.length === 10_000 || batchBytes + eventBytes > 1_048_576) {
          await this.api.putLogEvents(this.config.telemetryLogGroupRef, this.config.telemetryLogStreamRef, batch);
          batch = [];
          batchBytes = 0;
        }
        batch.push(event);
        batchBytes += eventBytes;
      }
      if (batch.length > 0) {
        await this.api.putLogEvents(this.config.telemetryLogGroupRef, this.config.telemetryLogStreamRef, batch);
      }
    } catch (error: unknown) {
      driverFailure(error);
    }
  }
}

interface DeploymentPayload {
  desired: DeploymentDesiredState;
  observation: DeploymentObservation;
}

class AwsDeploymentReconciler implements DeploymentReconciler {
  private readonly scope = { tenantId: "system" };

  constructor(
    private readonly lifecycle: Lifecycle,
    private readonly state: AwsStateStore,
    private readonly config: AwsConfig,
  ) {}

  private resourceRefs(): string[] {
    return [
      `aws:s3:${hash(this.config.artifactBucketRef).slice(0, 32)}`,
      `aws:dynamodb:${hash(this.config.metadataTableRef).slice(0, 32)}`,
      `aws:eks:${hash(this.config.eksNamespace).slice(0, 32)}`,
    ];
  }

  async observe(deploymentRef: string): Promise<DeploymentObservation> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(this.scope, "deployment", deploymentRef);
      if (!current || current.deleted) {
        const payload = current ? parsePayload<DeploymentPayload>(current) : undefined;
        return { deploymentRef, state: "absent", observedGeneration: payload?.observation.observedGeneration ?? 0, resourceRefs: [] };
      }
      return structuredClone(parsePayload<DeploymentPayload>(current).observation);
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async reconcile(desired: DeploymentDesiredState): Promise<DeploymentObservation> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(this.scope, "deployment", desired.deploymentRef);
      const existing = current ? parsePayload<DeploymentPayload>(current) : undefined;
      if (existing) {
        if (desired.generation < existing.desired.generation) throw new DeploymentGenerationConflictError();
        if (desired.generation === existing.desired.generation) {
          if (current?.deleted || !same(existing.desired, desired)) throw new DeploymentGenerationConflictError();
          return structuredClone(existing.observation);
        }
      }
      const observation: DeploymentObservation = {
        deploymentRef: desired.deploymentRef,
        state: "ready",
        observedGeneration: desired.generation,
        resourceRefs: this.resourceRefs(),
      };
      await this.state.write(this.scope, "deployment", desired.deploymentRef, current, { desired, observation } satisfies DeploymentPayload);
      return structuredClone(observation);
    } catch (error: unknown) {
      driverFailure(error);
    }
  }

  async destroy(deploymentRef: string, generation: number): Promise<DeploymentObservation> {
    assertOpen(this.lifecycle);
    try {
      const current = await this.state.read(this.scope, "deployment", deploymentRef);
      if (!current) throw new DeploymentGenerationConflictError();
      const payload = parsePayload<DeploymentPayload>(current);
      if (generation < payload.desired.generation) throw new DeploymentGenerationConflictError();
      const observation: DeploymentObservation = { deploymentRef, state: "absent", observedGeneration: generation, resourceRefs: [] };
      await this.state.write(this.scope, "deployment", deploymentRef, current, {
        desired: { ...payload.desired, generation },
        observation,
      } satisfies DeploymentPayload, true);
      return observation;
    } catch (error: unknown) {
      driverFailure(error);
    }
  }
}

function configOf(config: DeploymentProfileConfig): AwsConfig {
  return config as unknown as AwsConfig;
}

function defaultIdentityVerifier(config: AwsConfig): AwsIdentityVerifier {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.identityUserPoolRef,
    tokenUse: "id",
    clientId: config.identityAudienceRef,
  });
  return { verify: async (subjectToken) => await verifier.verify(subjectToken) as unknown as Record<string, unknown> };
}

export function createAwsDeploymentProfile(options: AwsDeploymentProfileOptions = {}): DeploymentProfile {
  return {
    manifest: {
      protocolVersion: DEPLOYMENT_PROFILE_PROTOCOL_VERSION,
      profileId: "aws-eks",
      displayName: "AWS EKS Experimental Profile",
      provider: "aws",
      profileVersion: "0.1.0",
      supportedArchitectures: ["linux-amd64", "linux-arm64"],
      capabilities: [
        { kind: "artifact_store", driverVersion: "0.1.0", features: ["s3-conditional-put", "sha256"] },
        { kind: "secret_store", driverVersion: "0.1.0", features: ["secrets-manager", "opaque-binding"] },
        { kind: "credential_capsule", driverVersion: "0.1.0", features: ["eks-pvc", "generation-fence"] },
        { kind: "control_metadata", driverVersion: "0.1.0", features: ["dynamodb-cas", "strong-read"] },
        { kind: "identity", driverVersion: "0.1.0", features: ["cognito-id-token"] },
        { kind: "workload_runtime", driverVersion: "0.1.0", features: ["eks-deployment", "generation-fence"] },
        { kind: "telemetry", driverVersion: "0.1.0", features: ["cloudwatch-logs"] },
      ],
    },
    configSchema: {
      fields: {
        region: { type: "string", required: true, pattern: "^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]+$" },
        artifactBucketRef: { type: "reference", required: true },
        artifactPrefix: { type: "string", default: "opencloudos", pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$" },
        metadataTableRef: { type: "reference", required: true },
        secretPrefix: { type: "string", default: "opencloudos", pattern: "^[A-Za-z0-9][A-Za-z0-9/_+=.@-]{0,127}$" },
        telemetryLogGroupRef: { type: "string", required: true, pattern: "^[A-Za-z0-9._/#-]{1,512}$" },
        telemetryLogStreamRef: { type: "reference", required: true },
        eksNamespace: { type: "string", required: true, pattern: "^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$" },
        eksServiceAccountRef: { type: "string", required: true, pattern: "^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$" },
        capsuleStorageClassRef: { type: "string", required: true, pattern: "^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$" },
        capsuleSizeGi: { type: "integer", default: 5, minimum: 1, maximum: 1024 },
        workloadImageRepository: { type: "string", required: true, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$" },
        workloadCpuRequest: { type: "string", default: "500m", pattern: "^[1-9][0-9]*(?:m)?$" },
        workloadMemoryRequest: { type: "string", default: "1Gi", pattern: "^[1-9][0-9]*(?:Mi|Gi)$" },
        workloadResourcePolicyRef: { type: "reference", required: true },
        workloadNetworkPolicyRef: { type: "reference", required: true },
        workloadStoragePolicyRef: { type: "reference", required: true },
        capsuleStoragePolicyRef: { type: "reference", required: true },
        readinessTimeoutSeconds: { type: "integer", default: 120, minimum: 5, maximum: 600 },
        identityIssuer: { type: "string", required: true, pattern: "^https://[^\\s]+$" },
        identityAudienceRef: { type: "reference", required: true },
        identityUserPoolRef: { type: "reference", required: true },
      },
    },
    migrations: [{
      migrationId: "aws-profile-v0-1-0",
      fromVersion: "0.0.0",
      toVersion: "0.1.0",
      reversible: true,
      async apply() {},
      async rollback() {},
    }],
    async create(rawConfig) {
      const config = configOf(rawConfig);
      const lifecycle = { closed: false };
      const api = options.apiFactory?.(config) ?? createAwsSdkProfileApi(config.region);
      let eks: EksRuntimeControl | undefined;
      let verifier: AwsIdentityVerifier;
      try {
        eks = options.eksFactory
          ? await options.eksFactory(config)
          : await InClusterEksRuntimeControl.create({ readinessTimeoutSeconds: config.readinessTimeoutSeconds });
        verifier = (options.identityVerifierFactory ?? defaultIdentityVerifier)(config);
      } catch (error: unknown) {
        eks?.close();
        api.close();
        throw error;
      }
      const state = new AwsStateStore(api, config.metadataTableRef);
      return {
        drivers: {
          artifactStore: new AwsArtifactStore(lifecycle, api, config),
          secretStore: new AwsSecretStore(lifecycle, api, state, config, options.uuid ?? randomUUID),
          credentialCapsule: new AwsCredentialCapsules(lifecycle, state, eks, config),
          controlMetadata: new AwsControlMetadata(lifecycle, state),
          identity: new AwsCognitoIdentity(lifecycle, config, verifier),
          workloadRuntime: new AwsEksWorkloadRuntime(lifecycle, state, eks, config),
          telemetry: new AwsCloudWatchTelemetry(lifecycle, api, config),
        },
        reconciler: new AwsDeploymentReconciler(lifecycle, state, config),
        async close() {
          if (lifecycle.closed) return;
          lifecycle.closed = true;
          try {
            eks.close();
          } finally {
            api.close();
          }
        },
      };
    },
  };
}
