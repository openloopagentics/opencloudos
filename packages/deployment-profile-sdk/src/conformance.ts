import { createHash } from "node:crypto";
import {
  DEPLOYMENT_PROFILE_PROTOCOL_VERSION,
  type DeploymentCapabilityKind,
  type DeploymentIdentity,
  type DeploymentProfileConfig,
  type DeploymentScope,
  type IdentityAssertion,
} from "./contracts.js";
import {
  DeploymentDriverConflictError,
  DeploymentGenerationConflictError,
  DeploymentProfileClosedError,
  DeploymentProfileConfigError,
  type DeploymentProfileError,
} from "./errors.js";
import { DeploymentProfileRegistry, type DeploymentProfileHandle } from "./registry.js";
import { InMemoryDeploymentMigrationCheckpointStore } from "./synthetic-profile.js";

export type DeploymentConformanceScenarioId =
  | "PROFILE-001"
  | "PROFILE-002"
  | "PROFILE-003"
  | "PROFILE-004"
  | "PROFILE-005"
  | "PROFILE-006"
  | "PROFILE-007"
  | "PROFILE-008"
  | "PROFILE-009"
  | "PROFILE-010"
  | "PROFILE-011";

export interface DeploymentConformanceScenarioResult {
  id: DeploymentConformanceScenarioId;
  outcome: "passed" | "failed" | "skipped";
  detail: string;
}

export interface DeploymentProfileConformanceReport {
  profileId: string;
  profileVersion: string;
  protocolVersion: number;
  passed: boolean;
  scenarios: DeploymentConformanceScenarioResult[];
}

export interface DeploymentProfileConformanceOptions {
  validConfig: Readonly<Record<string, unknown>>;
  invalidConfig: Readonly<Record<string, unknown>>;
  scopeA: DeploymentScope;
  scopeB: DeploymentScope;
  identityAssertion: IdentityAssertion;
  expectedIdentity: Pick<DeploymentIdentity, "tenantId" | "userId">;
  requiredCapabilities?: DeploymentCapabilityKind[];
  migrationFromVersion: string;
  now?: () => Date;
}

const ALL_CAPABILITIES: DeploymentCapabilityKind[] = [
  "artifact_store",
  "secret_store",
  "credential_capsule",
  "control_metadata",
  "identity",
  "workload_runtime",
  "telemetry",
];

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function rejectsWith(operation: () => Promise<unknown>, errorType: new (...args: never[]) => Error): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    if (error instanceof errorType) return;
    throw error;
  }
  throw new Error("expected operation to reject");
}

function driverFor(handle: DeploymentProfileHandle, capability: DeploymentCapabilityKind): unknown {
  const drivers = handle.drivers;
  if (capability === "artifact_store") return drivers.artifactStore;
  if (capability === "secret_store") return drivers.secretStore;
  if (capability === "credential_capsule") return drivers.credentialCapsule;
  if (capability === "control_metadata") return drivers.controlMetadata;
  if (capability === "identity") return drivers.identity;
  if (capability === "workload_runtime") return drivers.workloadRuntime;
  return drivers.telemetry;
}

export async function runDeploymentProfileConformance(
  registry: DeploymentProfileRegistry,
  profileId: string,
  options: DeploymentProfileConformanceOptions,
): Promise<DeploymentProfileConformanceReport> {
  const results: DeploymentConformanceScenarioResult[] = [];
  const manifest = registry.resolve(profileId);
  const required = new Set(options.requiredCapabilities ?? ALL_CAPABILITIES);
  const available = new Set(manifest.capabilities.map((capability) => capability.kind));
  let handle: DeploymentProfileHandle | undefined;

  async function scenario(id: DeploymentConformanceScenarioId, detail: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
      results.push({ id, outcome: "passed", detail });
    } catch (error: unknown) {
      const code = (error as DeploymentProfileError | undefined)?.code ?? "unexpected_error";
      results.push({ id, outcome: "failed", detail: `${detail}; ${code}` });
    }
  }

  async function capabilityScenario(
    id: DeploymentConformanceScenarioId,
    capability: DeploymentCapabilityKind,
    detail: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    if (!available.has(capability)) {
      results.push({
        id,
        outcome: required.has(capability) ? "failed" : "skipped",
        detail: required.has(capability) ? `${detail}; required_capability_missing` : `${detail}; capability_not_declared`,
      });
      return;
    }
    await scenario(id, detail, operation);
  }

  await scenario("PROFILE-001", "manifest discovery and protocol compatibility", async () => {
    if (manifest.protocolVersion !== DEPLOYMENT_PROFILE_PROTOCOL_VERSION || manifest.profileId !== profileId) {
      throw new Error("manifest mismatch");
    }
    const discovered = registry.list([...required]);
    if (!discovered.some((candidate) => candidate.profileId === profileId)) throw new Error("profile not discoverable");
  });

  await scenario("PROFILE-002", "strict configuration validation with redacted failures", async () => {
    let failure: unknown;
    try {
      await registry.instantiate(profileId, options.invalidConfig);
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof DeploymentProfileConfigError)) throw new Error("invalid config was accepted");
    const serialized = JSON.stringify(failure);
    for (const value of Object.values(options.invalidConfig)) {
      if (typeof value === "string" && value.length > 8 && serialized.includes(value)) {
        throw new Error("configuration value escaped in error");
      }
    }
    handle = await registry.instantiate(profileId, options.validConfig);
  });

  await scenario("PROFILE-003", "declared capabilities match instantiated drivers", async () => {
    if (!handle) throw new Error("profile was not instantiated");
    for (const capability of available) {
      if (!driverFor(handle, capability)) throw new Error("declared driver missing");
    }
    for (const capability of required) {
      if (!available.has(capability)) throw new Error("required capability missing");
    }
  });

  await capabilityScenario("PROFILE-004", "artifact_store", "immutable artifacts preserve digest and tenant isolation", async () => {
    const driver = handle?.drivers.artifactStore;
    if (!driver) throw new Error("artifact driver unavailable");
    const bytes = new TextEncoder().encode("synthetic-profile-artifact");
    const digest = sha256(bytes);
    const stored = await driver.putImmutable(options.scopeA, { artifactRef: "artifact:conformance", digest, bytes });
    if (stored.digest !== digest || !await driver.read(options.scopeA, stored.artifactRef)) throw new Error("artifact unavailable");
    if (await driver.read(options.scopeB, stored.artifactRef)) throw new Error("artifact crossed tenant boundary");
    await rejectsWith(
      () => driver.putImmutable(options.scopeA, { artifactRef: stored.artifactRef, digest: `sha256:${"0".repeat(64)}`, bytes }),
      DeploymentDriverConflictError,
    );
  });

  await capabilityScenario("PROFILE-005", "secret_store", "sealed secrets bind opaquely and cannot cross tenants", async () => {
    const driver = handle?.drivers.secretStore;
    if (!driver) throw new Error("secret driver unavailable");
    if ("read" in driver || "export" in driver) throw new Error("secret export surface exists");
    const material = new TextEncoder().encode("synthetic-secret-material");
    const sealed = await driver.seal(options.scopeA, "secret:conformance", material);
    material.fill(0);
    const binding = await driver.bind(options.scopeA, sealed.secretRef, "workload:conformance");
    if (binding.secretRef !== sealed.secretRef || binding.bindingRef.includes("synthetic-secret-material")) {
      throw new Error("secret binding is not opaque");
    }
    await rejectsWith(
      () => driver.bind(options.scopeB, sealed.secretRef, "workload:conformance"),
      DeploymentDriverConflictError,
    );
    await driver.destroy(options.scopeA, sealed.secretRef);
    await rejectsWith(
      () => driver.bind(options.scopeA, sealed.secretRef, "workload:conformance"),
      DeploymentDriverConflictError,
    );
    const resealed = await driver.seal(options.scopeA, sealed.secretRef, new TextEncoder().encode("replacement-synthetic-secret"));
    if (resealed.versionRef === sealed.versionRef) throw new Error("secret version was reused after destruction");
    await driver.destroy(options.scopeA, resealed.secretRef);
  });

  await capabilityScenario("PROFILE-006", "control_metadata", "metadata compare-and-swap is tenant-scoped and conflict-aware", async () => {
    const driver = handle?.drivers.controlMetadata;
    if (!driver) throw new Error("metadata driver unavailable");
    const created = await driver.compareAndSwap(options.scopeA, "metadata:conformance", null, { generation: 1 });
    if (created.version !== 1 || await driver.read(options.scopeB, created.key)) throw new Error("metadata isolation failed");
    await rejectsWith(
      () => driver.compareAndSwap(options.scopeA, created.key, null, { generation: 2 }),
      DeploymentDriverConflictError,
    );
  });

  await capabilityScenario("PROFILE-007", "identity", "identity output is normalized and excludes the subject token", async () => {
    const driver = handle?.drivers.identity;
    if (!driver) throw new Error("identity driver unavailable");
    const identity = await driver.authenticate(options.identityAssertion);
    if (identity.tenantId !== options.expectedIdentity.tenantId || identity.userId !== options.expectedIdentity.userId) {
      throw new Error("identity normalization mismatch");
    }
    if (JSON.stringify(identity).includes(options.identityAssertion.subjectToken)) throw new Error("identity token escaped");
  });

  await capabilityScenario("PROFILE-008", "workload_runtime", "workload generations fence stale reconciliation", async () => {
    const driver = handle?.drivers.workloadRuntime;
    if (!driver) throw new Error("runtime driver unavailable");
    const desired = {
      workloadRef: "workload:conformance",
      kind: "provider_runner" as const,
      generation: 2,
      releaseDigest: `sha256:${"1".repeat(64)}`,
      resourcePolicyRef: "policy:resources",
      networkPolicyRef: "policy:network",
      storagePolicyRef: "policy:storage",
    };
    const ready = await driver.reconcile(options.scopeA, desired);
    if (ready.state !== "ready" || ready.observedGeneration !== 2) throw new Error("workload not ready");
    await rejectsWith(() => driver.reconcile(options.scopeA, { ...desired, generation: 1 }), DeploymentGenerationConflictError);
    if (await driver.inspect(options.scopeB, desired.workloadRef)) throw new Error("workload crossed tenant boundary");
    const stopped = await driver.destroy(options.scopeA, desired.workloadRef, 3);
    if (stopped.state !== "stopped" || stopped.observedGeneration !== 3) throw new Error("workload did not stop");
    await rejectsWith(() => driver.reconcile(options.scopeA, { ...desired, generation: 3 }), DeploymentGenerationConflictError);
  });

  await scenario("PROFILE-009", "profile reconciliation is idempotent and generation-fenced", async () => {
    if (!handle) throw new Error("profile was not instantiated");
    const desired = {
      deploymentRef: "deployment:conformance",
      generation: 2,
      releaseDigest: `sha256:${"2".repeat(64)}`,
      architecture: "linux-amd64" as const,
    };
    const first = await handle.reconcile(desired);
    const second = await handle.reconcile(desired);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("reconcile was not idempotent");
    await rejectsWith(() => handle!.reconcile({ ...desired, generation: 1 }), DeploymentGenerationConflictError);
    const absent = await handle.destroy(desired.deploymentRef, 3);
    if (absent.state !== "absent") throw new Error("destroy did not converge to absent");
    await rejectsWith(() => handle!.reconcile({ ...desired, generation: 3 }), DeploymentGenerationConflictError);
  });

  await capabilityScenario("PROFILE-010", "credential_capsule", "credential capsules mount, seal, and destroy with tenant and generation fencing", async () => {
    const driver = handle?.drivers.credentialCapsule;
    if (!driver) throw new Error("credential capsule driver unavailable");
    const desired = {
      capsuleRef: "capsule:conformance",
      workloadRef: "workload:conformance",
      generation: 2,
      storagePolicyRef: "policy:capsule-storage",
    };
    const mounted = await driver.reconcile(options.scopeA, desired);
    if (mounted.state !== "mounted" || !mounted.attachmentRef) throw new Error("capsule was not mounted");
    if (await driver.inspect(options.scopeB, desired.capsuleRef)) throw new Error("capsule crossed tenant boundary");
    const sealed = await driver.seal(options.scopeA, desired.capsuleRef, 2);
    if (sealed.state !== "sealed" || sealed.attachmentRef) throw new Error("capsule was not sealed");
    await rejectsWith(
      () => driver.reconcile(options.scopeA, desired),
      DeploymentGenerationConflictError,
    );
    await rejectsWith(
      () => driver.reconcile(options.scopeA, { ...desired, generation: 1 }),
      DeploymentGenerationConflictError,
    );
    await driver.reconcile(options.scopeA, { ...desired, generation: 3 });
    const destroyed = await driver.destroy(options.scopeA, desired.capsuleRef, 4);
    if (destroyed.state !== "destroyed" || destroyed.attachmentRef) throw new Error("capsule was not destroyed");
    await rejectsWith(
      () => driver.reconcile(options.scopeA, { ...desired, generation: 4 }),
      DeploymentGenerationConflictError,
    );
  });

  await scenario("PROFILE-011", "checkpointed migrations and instance teardown are resumable", async () => {
    if (!handle) throw new Error("profile was not instantiated");
    const plan = registry.planMigration(profileId, options.migrationFromVersion);
    if (plan.toVersion !== manifest.profileVersion || plan.steps.length === 0) throw new Error("migration path is incomplete");
    const checkpoints = new InMemoryDeploymentMigrationCheckpointStore();
    const context = {
      deploymentRef: "deployment:migration",
      checkpoints,
      now: options.now ?? (() => new Date()),
    };
    await registry.applyMigrations(plan, context);
    await registry.applyMigrations(plan, context);
    for (const step of plan.steps) {
      if ((await checkpoints.read(context.deploymentRef, step.migrationId))?.state !== "applied") {
        throw new Error("migration checkpoint is incomplete");
      }
    }
    await registry.rollbackMigrations(plan, context);
    await handle.close();
    await handle.close();
    await rejectsWith(() => handle!.observe("deployment:conformance"), DeploymentProfileClosedError);
  });

  if (handle && !results.some((result) => result.id === "PROFILE-011" && result.outcome === "passed")) {
    await handle.close().catch(() => undefined);
  }

  return {
    profileId,
    profileVersion: manifest.profileVersion,
    protocolVersion: manifest.protocolVersion,
    passed: results.every((result) => result.outcome !== "failed"),
    scenarios: results,
  };
}
