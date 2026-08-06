import {
  DEPLOYMENT_PROFILE_PROTOCOL_VERSION,
  type DeploymentArchitecture,
  type DeploymentCapabilityKind,
  type DeploymentDesiredState,
  type DeploymentMigration,
  type DeploymentMigrationContext,
  type DeploymentMigrationPlan,
  type DeploymentObservation,
  type DeploymentProfile,
  type DeploymentProfileConfig,
  type DeploymentProfileDrivers,
  type DeploymentProfileManifest,
  type DeploymentReconciler,
} from "./contracts.js";
import { validateConfigSchema, validateProfileConfig } from "./config.js";
import {
  DeploymentGenerationConflictError,
  DeploymentMigrationExecutionError,
  DeploymentMigrationPlanError,
  DeploymentProfileAlreadyRegisteredError,
  DeploymentProfileCapabilityError,
  DeploymentProfileClosedError,
  DeploymentProfileInstantiationError,
  DeploymentProfileManifestError,
  DeploymentProfileNotFoundError,
  DeploymentProfileOperationError,
  DeploymentProfileError,
} from "./errors.js";

const PROFILE_ID = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,127}$/;
const SAFE_FEATURE = /^[a-z][a-z0-9._-]{0,63}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const PROVIDERS = new Set(["aws", "gcp", "azure", "kubernetes", "self_hosted", "synthetic"]);
const ARCHITECTURES = new Set<DeploymentArchitecture>(["linux-amd64", "linux-arm64"]);
const CAPABILITIES = new Set<DeploymentCapabilityKind>([
  "artifact_store",
  "secret_store",
  "credential_capsule",
  "control_metadata",
  "identity",
  "workload_runtime",
  "telemetry",
]);
const MANIFEST_KEYS = new Set(["protocolVersion", "profileId", "displayName", "provider", "profileVersion", "supportedArchitectures", "capabilities"]);
const CAPABILITY_KEYS = new Set(["kind", "driverVersion", "features"]);
const DESIRED_KEYS = new Set(["deploymentRef", "generation", "releaseDigest", "architecture"]);
const OBSERVATION_KEYS = new Set(["deploymentRef", "state", "observedGeneration", "resourceRefs", "failureCode"]);
const PROFILE_KEYS = new Set(["manifest", "configSchema", "migrations", "create"]);
const MIGRATION_KEYS = new Set(["migrationId", "fromVersion", "toVersion", "reversible", "apply", "rollback"]);
const INSTANCE_KEYS = new Set(["drivers", "reconciler", "close"]);
const PROFILE_HANDLE_TOKEN = Symbol("deployment-profile-handle");

const DRIVER_KEYS: Record<DeploymentCapabilityKind, keyof DeploymentProfileDrivers> = {
  artifact_store: "artifactStore",
  secret_store: "secretStore",
  credential_capsule: "credentialCapsule",
  control_metadata: "controlMetadata",
  identity: "identity",
  workload_runtime: "workloadRuntime",
  telemetry: "telemetry",
};

function semverParts(version: string): [number, number, number] {
  const match = SEMVER.exec(version);
  if (!match) throw new DeploymentProfileManifestError("Deployment profile version must use strict semantic versioning");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: string, right: string): number {
  const a = semverParts(left);
  const b = semverParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function validateManifest(manifest: DeploymentProfileManifest): void {
  if (!manifest || typeof manifest !== "object") throw new DeploymentProfileManifestError("Deployment profile manifest is required");
  if (Object.keys(manifest).some((key) => !MANIFEST_KEYS.has(key))) {
    throw new DeploymentProfileManifestError("Deployment profile manifest contains an unsupported field");
  }
  if (manifest.protocolVersion !== DEPLOYMENT_PROFILE_PROTOCOL_VERSION) {
    throw new DeploymentProfileManifestError("Deployment profile protocol version is incompatible");
  }
  if (!PROFILE_ID.test(manifest.profileId)) throw new DeploymentProfileManifestError("Deployment profile identifier is invalid");
  if (!SAFE_NAME.test(manifest.displayName)) throw new DeploymentProfileManifestError("Deployment profile display name is invalid");
  if (!PROVIDERS.has(manifest.provider)) throw new DeploymentProfileManifestError("Deployment provider is unsupported");
  semverParts(manifest.profileVersion);
  if (
    !Array.isArray(manifest.supportedArchitectures)
    || manifest.supportedArchitectures.length === 0
    || new Set(manifest.supportedArchitectures).size !== manifest.supportedArchitectures.length
  ) {
    throw new DeploymentProfileManifestError("Deployment profile architectures must be non-empty and unique");
  }
  if (manifest.supportedArchitectures.some((architecture) => !ARCHITECTURES.has(architecture))) {
    throw new DeploymentProfileManifestError("Deployment profile architecture is unsupported");
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    throw new DeploymentProfileManifestError("Deployment profile must declare capabilities");
  }
  const capabilityKinds = new Set<DeploymentCapabilityKind>();
  for (const capability of manifest.capabilities) {
    if (!capability || typeof capability !== "object" || Array.isArray(capability) || !Array.isArray(capability.features)) {
      throw new DeploymentProfileManifestError("Deployment capability is invalid");
    }
    if (Object.keys(capability).some((key) => !CAPABILITY_KEYS.has(key))) {
      throw new DeploymentProfileManifestError("Deployment capability contains an unsupported field");
    }
    if (!CAPABILITIES.has(capability.kind) || capabilityKinds.has(capability.kind)) {
      throw new DeploymentProfileManifestError("Deployment profile capabilities must be supported and unique");
    }
    capabilityKinds.add(capability.kind);
    semverParts(capability.driverVersion);
    if (new Set(capability.features).size !== capability.features.length || capability.features.some((feature) => !SAFE_FEATURE.test(feature))) {
      throw new DeploymentProfileManifestError("Deployment capability features must be safe and unique");
    }
  }
}

function validateMigrations(profile: DeploymentProfile): void {
  if (!Array.isArray(profile.migrations)) throw new DeploymentProfileManifestError("Deployment migrations must be an array");
  const ids = new Set<string>();
  const edges = new Set<string>();
  for (const migration of profile.migrations) {
    if (
      !migration
      || typeof migration !== "object"
      || Array.isArray(migration)
      || Object.keys(migration).some((key) => !MIGRATION_KEYS.has(key))
      || typeof migration.apply !== "function"
      || typeof migration.reversible !== "boolean"
      || (migration.rollback !== undefined && typeof migration.rollback !== "function")
    ) {
      throw new DeploymentProfileManifestError("Deployment migration is invalid");
    }
    if (!SAFE_FEATURE.test(migration.migrationId) || ids.has(migration.migrationId)) {
      throw new DeploymentProfileManifestError("Deployment migration identifiers must be safe and unique");
    }
    ids.add(migration.migrationId);
    if (compareSemver(migration.fromVersion, migration.toVersion) >= 0) {
      throw new DeploymentProfileManifestError("Deployment migrations must move to a newer version");
    }
    if (compareSemver(migration.toVersion, profile.manifest.profileVersion) > 0) {
      throw new DeploymentProfileManifestError("Deployment migration cannot exceed the profile version");
    }
    const edge = `${migration.fromVersion}->${migration.toVersion}`;
    if (edges.has(edge)) throw new DeploymentProfileManifestError("Deployment migration edge is duplicated");
    edges.add(edge);
    if (migration.reversible && !migration.rollback) {
      throw new DeploymentProfileManifestError("A reversible migration must provide rollback");
    }
  }
}

function freezeManifest(manifest: DeploymentProfileManifest): DeploymentProfileManifest {
  for (const capability of manifest.capabilities) {
    Object.freeze(capability.features);
    Object.freeze(capability);
  }
  Object.freeze(manifest.capabilities);
  Object.freeze(manifest.supportedArchitectures);
  return Object.freeze(manifest);
}

function freezeProfile(profile: DeploymentProfile): DeploymentProfile {
  freezeManifest(profile.manifest);
  for (const field of Object.values(profile.configSchema.fields)) {
    if (field.type === "enum") Object.freeze(field.values);
    Object.freeze(field);
  }
  Object.freeze(profile.configSchema.fields);
  Object.freeze(profile.configSchema);
  for (const migration of profile.migrations) Object.freeze(migration);
  Object.freeze(profile.migrations);
  return Object.freeze(profile);
}

function validateDriverParity(manifest: DeploymentProfileManifest, drivers: DeploymentProfileDrivers): void {
  const declared = new Set(manifest.capabilities.map((capability) => capability.kind));
  const allowedDriverKeys = new Set(Object.values(DRIVER_KEYS));
  if (Object.keys(drivers).some((key) => !allowedDriverKeys.has(key as keyof DeploymentProfileDrivers))) {
    throw new DeploymentProfileCapabilityError("Deployment profile driver set contains an unsupported field");
  }
  for (const kind of CAPABILITIES) {
    const present = drivers[DRIVER_KEYS[kind]] !== undefined;
    if (declared.has(kind) !== present) {
      throw new DeploymentProfileCapabilityError("Deployment profile capability declaration does not match its driver set");
    }
  }
}

function validateDesired(desired: DeploymentDesiredState, architectures: DeploymentArchitecture[]): void {
  if (!desired || typeof desired !== "object" || Array.isArray(desired)) {
    throw new DeploymentProfileCapabilityError("Deployment desired state is invalid");
  }
  if (Object.keys(desired).some((key) => !DESIRED_KEYS.has(key))) {
    throw new DeploymentProfileCapabilityError("Deployment desired state contains an unsupported field");
  }
  if (!OPAQUE_REF.test(desired.deploymentRef) || !Number.isSafeInteger(desired.generation) || desired.generation < 1) {
    throw new DeploymentGenerationConflictError();
  }
  if (!SHA256.test(desired.releaseDigest)) throw new DeploymentProfileCapabilityError("Deployment release digest is invalid");
  if (!architectures.includes(desired.architecture)) {
    throw new DeploymentProfileCapabilityError("Deployment architecture is not supported by this profile");
  }
}

function validateObservation(observation: DeploymentObservation, deploymentRef: string, generation?: number): void {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw new DeploymentProfileCapabilityError("Deployment observation is invalid");
  }
  if (Object.keys(observation).some((key) => !OBSERVATION_KEYS.has(key))) {
    throw new DeploymentProfileCapabilityError("Deployment observation contains an unsupported field");
  }
  if (observation.deploymentRef !== deploymentRef || !Number.isSafeInteger(observation.observedGeneration)) {
    throw new DeploymentGenerationConflictError();
  }
  if (generation !== undefined && observation.observedGeneration !== generation) throw new DeploymentGenerationConflictError();
  if (!Array.isArray(observation.resourceRefs) || observation.resourceRefs.some((reference) => !OPAQUE_REF.test(reference))) {
    throw new DeploymentProfileCapabilityError("Deployment observation contains an invalid resource reference");
  }
  if (!["absent", "reconciling", "ready", "degraded"].includes(observation.state)) {
    throw new DeploymentProfileCapabilityError("Deployment observation state is invalid");
  }
  if (observation.failureCode !== undefined && !SAFE_FEATURE.test(observation.failureCode)) {
    throw new DeploymentProfileCapabilityError("Deployment observation failure code is invalid");
  }
}

export class DeploymentProfileHandle {
  readonly manifest: DeploymentProfileManifest;
  readonly drivers: DeploymentProfileDrivers;
  readonly #reconciler: DeploymentReconciler;
  readonly #closeInstance: () => Promise<void>;
  readonly #generations = new Map<string, { generation: number; fingerprint?: string; destroyed: boolean }>();
  #closed = false;
  #closeAttempt?: Promise<void>;

  constructor(
    manifest: DeploymentProfileManifest,
    drivers: DeploymentProfileDrivers,
    reconciler: DeploymentReconciler,
    close: () => Promise<void>,
    registrationToken: symbol,
  ) {
    if (registrationToken !== PROFILE_HANDLE_TOKEN) {
      throw new DeploymentProfileInstantiationError();
    }
    this.manifest = freezeManifest(structuredClone(manifest));
    this.drivers = Object.freeze({ ...drivers });
    this.#reconciler = reconciler;
    this.#closeInstance = close;
  }

  async observe(deploymentRef: string): Promise<DeploymentObservation> {
    this.#assertOpen();
    if (!OPAQUE_REF.test(deploymentRef)) throw new DeploymentGenerationConflictError();
    const observation = await this.#invoke("observe", () => this.#reconciler.observe(deploymentRef));
    validateObservation(observation, deploymentRef);
    return structuredClone(observation);
  }

  async reconcile(desired: DeploymentDesiredState, signal?: AbortSignal): Promise<DeploymentObservation> {
    this.#assertOpen();
    validateDesired(desired, this.manifest.supportedArchitectures);
    const current = this.#generations.get(desired.deploymentRef);
    const fingerprint = JSON.stringify(desired);
    if (
      current
      && (
        desired.generation < current.generation
        || (desired.generation === current.generation && (current.destroyed || current.fingerprint !== fingerprint))
      )
    ) {
      throw new DeploymentGenerationConflictError();
    }
    const observation = await this.#invoke("reconcile", () => this.#reconciler.reconcile(structuredClone(desired), signal));
    validateObservation(observation, desired.deploymentRef, desired.generation);
    this.#generations.set(desired.deploymentRef, { generation: desired.generation, fingerprint, destroyed: false });
    return structuredClone(observation);
  }

  async destroy(deploymentRef: string, generation: number, signal?: AbortSignal): Promise<DeploymentObservation> {
    this.#assertOpen();
    const current = this.#generations.get(deploymentRef);
    if (!OPAQUE_REF.test(deploymentRef) || !Number.isSafeInteger(generation) || (current && generation < current.generation)) {
      throw new DeploymentGenerationConflictError();
    }
    const observation = await this.#invoke("destroy", () => this.#reconciler.destroy(deploymentRef, generation, signal));
    validateObservation(observation, deploymentRef, generation);
    if (observation.state !== "absent") throw new DeploymentGenerationConflictError();
    this.#generations.set(deploymentRef, { generation, destroyed: true });
    return structuredClone(observation);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closeAttempt ??= this.#invoke("close", this.#closeInstance)
      .then(() => { this.#closed = true; })
      .catch((error: unknown) => {
        this.#closeAttempt = undefined;
        throw error;
      });
    await this.#closeAttempt;
  }

  #assertOpen(): void {
    if (this.#closed) throw new DeploymentProfileClosedError();
  }

  async #invoke<T>(operation: string, invoke: () => Promise<T>): Promise<T> {
    try {
      return await invoke();
    } catch (error: unknown) {
      if (error instanceof DeploymentProfileError) throw error;
      throw new DeploymentProfileOperationError(operation);
    }
  }
}

export class DeploymentProfileRegistry {
  readonly #profiles = new Map<string, DeploymentProfile>();

  register(profile: DeploymentProfile): void {
    if (
      !profile
      || typeof profile !== "object"
      || Array.isArray(profile)
      || Object.keys(profile).some((key) => !PROFILE_KEYS.has(key))
      || typeof profile.create !== "function"
    ) {
      throw new DeploymentProfileManifestError("Deployment profile is invalid");
    }
    validateManifest(profile.manifest);
    validateConfigSchema(profile.configSchema);
    validateMigrations(profile);
    if (this.#profiles.has(profile.manifest.profileId)) {
      throw new DeploymentProfileAlreadyRegisteredError(profile.manifest.profileId);
    }
    this.#profiles.set(profile.manifest.profileId, freezeProfile(profile));
  }

  list(requiredCapabilities: DeploymentCapabilityKind[] = []): DeploymentProfileManifest[] {
    const required = new Set(requiredCapabilities);
    return [...this.#profiles.values()]
      .filter((profile) => {
        const available = new Set(profile.manifest.capabilities.map((capability) => capability.kind));
        return [...required].every((kind) => available.has(kind));
      })
      .map((profile) => structuredClone(profile.manifest))
      .sort((left, right) => left.profileId.localeCompare(right.profileId));
  }

  resolve(profileId: string): DeploymentProfileManifest {
    return structuredClone(this.#profile(profileId).manifest);
  }

  async instantiate(profileId: string, input: Readonly<Record<string, unknown>>): Promise<DeploymentProfileHandle> {
    const profile = this.#profile(profileId);
    const config: DeploymentProfileConfig = validateProfileConfig(profile.configSchema, input);
    try {
      const instance = await profile.create(config);
      if (
        !instance
        || typeof instance !== "object"
        || Array.isArray(instance)
        || Object.keys(instance).some((key) => !INSTANCE_KEYS.has(key))
        || typeof instance.close !== "function"
        || !instance.drivers
        || typeof instance.drivers !== "object"
        || Array.isArray(instance.drivers)
        || !instance.reconciler
        || typeof instance.reconciler.observe !== "function"
        || typeof instance.reconciler.reconcile !== "function"
        || typeof instance.reconciler.destroy !== "function"
      ) {
        throw new DeploymentProfileCapabilityError("Deployment profile instance is invalid");
      }
      validateDriverParity(profile.manifest, instance.drivers);
      return new DeploymentProfileHandle(
        profile.manifest,
        instance.drivers,
        instance.reconciler,
        () => instance.close(),
        PROFILE_HANDLE_TOKEN,
      );
    } catch (error: unknown) {
      if (error instanceof DeploymentProfileCapabilityError) throw error;
      throw new DeploymentProfileInstantiationError();
    }
  }

  planMigration(profileId: string, fromVersion: string, toVersion?: string): DeploymentMigrationPlan {
    const profile = this.#profile(profileId);
    const target = toVersion ?? profile.manifest.profileVersion;
    semverParts(fromVersion);
    semverParts(target);
    if (compareSemver(fromVersion, target) > 0) {
      throw new DeploymentMigrationPlanError("Deployment profile downgrade requires an explicit rollback plan");
    }
    if (fromVersion === target) return { profileId, fromVersion, toVersion: target, steps: [] };

    const queue: Array<{ version: string; path: DeploymentMigration[] }> = [{ version: fromVersion, path: [] }];
    const visited = new Set([fromVersion]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const candidates = profile.migrations
        .filter((migration) => migration.fromVersion === current.version && compareSemver(migration.toVersion, target) <= 0)
        .sort((left, right) => left.toVersion.localeCompare(right.toVersion));
      for (const migration of candidates) {
        const path = [...current.path, migration];
        if (migration.toVersion === target) {
          return {
            profileId,
            fromVersion,
            toVersion: target,
            steps: path.map((step) => ({
              migrationId: step.migrationId,
              fromVersion: step.fromVersion,
              toVersion: step.toVersion,
              reversible: step.reversible,
            })),
          };
        }
        if (!visited.has(migration.toVersion)) {
          visited.add(migration.toVersion);
          queue.push({ version: migration.toVersion, path });
        }
      }
    }
    throw new DeploymentMigrationPlanError("No complete deployment migration path exists");
  }

  async applyMigrations(
    plan: DeploymentMigrationPlan,
    context: DeploymentMigrationContext,
    signal?: AbortSignal,
  ): Promise<void> {
    const profile = this.#profile(plan.profileId);
    const expected = this.planMigration(plan.profileId, plan.fromVersion, plan.toVersion);
    if (JSON.stringify(expected.steps) !== JSON.stringify(plan.steps)) {
      throw new DeploymentMigrationPlanError("Deployment migration plan does not match the registered profile");
    }
    for (const step of plan.steps) {
      const migration = profile.migrations.find((candidate) => candidate.migrationId === step.migrationId);
      if (!migration) throw new DeploymentMigrationPlanError("Deployment migration is not registered");
      const checkpoint = await context.checkpoints.read(context.deploymentRef, migration.migrationId);
      if (checkpoint?.state === "applied") continue;
      await context.checkpoints.write(context.deploymentRef, {
        migrationId: migration.migrationId,
        state: "started",
        updatedAt: context.now().toISOString(),
      });
      try {
        await migration.apply(context, signal);
      } catch {
        throw new DeploymentMigrationExecutionError(migration.migrationId);
      }
      await context.checkpoints.write(context.deploymentRef, {
        migrationId: migration.migrationId,
        state: "applied",
        updatedAt: context.now().toISOString(),
      });
    }
  }

  async rollbackMigrations(
    plan: DeploymentMigrationPlan,
    context: DeploymentMigrationContext,
    signal?: AbortSignal,
  ): Promise<void> {
    const profile = this.#profile(plan.profileId);
    const expected = this.planMigration(plan.profileId, plan.fromVersion, plan.toVersion);
    if (JSON.stringify(expected.steps) !== JSON.stringify(plan.steps)) {
      throw new DeploymentMigrationPlanError("Deployment migration plan does not match the registered profile");
    }
    for (const step of [...plan.steps].reverse()) {
      const migration = profile.migrations.find((candidate) => candidate.migrationId === step.migrationId);
      if (!migration?.reversible || !migration.rollback) {
        throw new DeploymentMigrationPlanError("Deployment migration plan is not fully reversible");
      }
      const checkpoint = await context.checkpoints.read(context.deploymentRef, migration.migrationId);
      if (checkpoint?.state !== "applied") continue;
      try {
        await migration.rollback(context, signal);
      } catch {
        throw new DeploymentMigrationExecutionError(migration.migrationId);
      }
      await context.checkpoints.write(context.deploymentRef, {
        migrationId: migration.migrationId,
        state: "rolled_back",
        updatedAt: context.now().toISOString(),
      });
    }
  }

  #profile(profileId: string): DeploymentProfile {
    const profile = this.#profiles.get(profileId);
    if (!profile) throw new DeploymentProfileNotFoundError();
    return profile;
  }
}
