import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOYMENT_PROFILE_PROTOCOL_VERSION,
  DeploymentMigrationPlanError,
  DeploymentProfileAlreadyRegisteredError,
  DeploymentProfileCapabilityError,
  DeploymentProfileConfigError,
  DeploymentProfileInstantiationError,
  DeploymentProfileManifestError,
  DeploymentProfileRegistry,
  createSyntheticDeploymentProfile,
  runDeploymentProfileConformance,
  type DeploymentConformanceScenarioId,
  type DeploymentProfile,
} from "../src/index.js";

const VALID_CONFIG = {
  region: "test-east-1",
  objectStoreRef: "object-store:conformance",
  secretStoreRef: "secret-store:conformance",
  identityIssuer: "https://identity.example.test",
  identityAudience: "opencloudos-conformance",
};

async function conformanceReport() {
  const registry = new DeploymentProfileRegistry();
  registry.register(createSyntheticDeploymentProfile());
  return runDeploymentProfileConformance(registry, "synthetic-conformance", {
    validConfig: VALID_CONFIG,
    invalidConfig: { ...VALID_CONFIG, accessToken: "synthetic-secret-must-not-escape" },
    scopeA: { tenantId: "tenant-conformance-a" },
    scopeB: { tenantId: "tenant-conformance-b" },
    identityAssertion: {
      issuer: VALID_CONFIG.identityIssuer,
      audience: VALID_CONFIG.identityAudience,
      subjectToken: "synthetic-profile-token",
    },
    expectedIdentity: { tenantId: "tenant-conformance-a", userId: "user-conformance-a" },
    migrationFromVersion: "1.0.0",
    now: () => new Date("2026-08-06T12:00:00.000Z"),
  });
}

const reportPromise = conformanceReport();
const SCENARIOS: Array<[DeploymentConformanceScenarioId, string]> = [
  ["PROFILE-001", "manifest discovery and protocol compatibility"],
  ["PROFILE-002", "configuration rejects unknown secrets without echoing values"],
  ["PROFILE-003", "capability declarations match the instantiated drivers"],
  ["PROFILE-004", "artifact storage is immutable and tenant-scoped"],
  ["PROFILE-005", "secret storage exposes bindings but no read or export method"],
  ["PROFILE-006", "control metadata uses tenant-scoped compare-and-swap"],
  ["PROFILE-007", "identity output is normalized and token-free"],
  ["PROFILE-008", "workload runtime rejects stale generations"],
  ["PROFILE-009", "deployment reconciliation is idempotent and fenced"],
  ["PROFILE-010", "credential capsules are tenant-scoped and generation-fenced"],
  ["PROFILE-011", "migrations checkpoint, resume, roll back, and close"],
];

for (const [id, description] of SCENARIOS) {
  test(`${id}: ${description}`, async () => {
    const report = await reportPromise;
    const scenario = report.scenarios.find((candidate) => candidate.id === id);
    assert.ok(scenario);
    assert.equal(scenario.outcome, "passed", scenario.detail);
    assert.equal(report.passed, true);
  });
}

test("registry rejects duplicate profiles and returns defensive manifest snapshots", () => {
  const registry = new DeploymentProfileRegistry();
  const profile = createSyntheticDeploymentProfile();
  registry.register(profile);
  assert.throws(() => registry.register(profile), DeploymentProfileAlreadyRegisteredError);

  const first = registry.resolve("synthetic-conformance");
  first.displayName = "mutated by caller";
  first.capabilities.length = 0;
  const second = registry.resolve("synthetic-conformance");
  assert.equal(second.displayName, "Synthetic Conformance Profile");
  assert.equal(second.capabilities.length, 7);
});

test("instantiated handles freeze manifest and driver-map mutation", async () => {
  const registry = new DeploymentProfileRegistry();
  registry.register(createSyntheticDeploymentProfile());
  const handle = await registry.instantiate("synthetic-conformance", VALID_CONFIG);
  assert.equal(Object.isFrozen(handle.manifest), true);
  assert.equal(Object.isFrozen(handle.manifest.capabilities), true);
  assert.equal(Object.isFrozen(handle.drivers), true);
  assert.throws(() => { handle.manifest.supportedArchitectures.push("linux-amd64"); }, TypeError);
  assert.throws(() => {
    (handle.drivers as unknown as Record<string, unknown>).rawCloudClient = { token: "must-not-escape" };
  }, TypeError);
  await handle.close();
});

test("registry capability discovery selects profiles without exposing live manifests", () => {
  const registry = new DeploymentProfileRegistry();
  registry.register(createSyntheticDeploymentProfile());
  assert.deepEqual(
    registry.list(["artifact_store", "workload_runtime"]).map((manifest) => manifest.profileId),
    ["synthetic-conformance"],
  );
  assert.deepEqual(registry.list(["identity"]).at(0)?.protocolVersion, DEPLOYMENT_PROFILE_PROTOCOL_VERSION);
});

test("profile schemas cannot define raw credential material fields", () => {
  const profile = createSyntheticDeploymentProfile();
  profile.manifest.profileId = "invalid-secret-schema";
  profile.configSchema.fields.accessToken = { type: "string", required: true };
  const registry = new DeploymentProfileRegistry();
  assert.throws(() => registry.register(profile), DeploymentProfileManifestError);
});

test("profile factory failures are redacted", async () => {
  const profile = createSyntheticDeploymentProfile();
  profile.manifest.profileId = "failing-profile";
  profile.create = async () => {
    throw new Error("cloud error containing synthetic-secret-must-not-escape");
  };
  const registry = new DeploymentProfileRegistry();
  registry.register(profile);
  await assert.rejects(registry.instantiate("failing-profile", VALID_CONFIG), (error: unknown) => {
    assert.ok(error instanceof DeploymentProfileInstantiationError);
    assert.equal(String(error).includes("synthetic-secret-must-not-escape"), false);
    return true;
  });
});

test("profile driver sets must exactly match declared capabilities", async () => {
  const profile = createSyntheticDeploymentProfile();
  profile.manifest.profileId = "missing-driver-profile";
  const create = profile.create;
  profile.create = async (config) => {
    const instance = await create(config);
    delete instance.drivers.telemetry;
    return instance;
  };
  const registry = new DeploymentProfileRegistry();
  registry.register(profile);
  await assert.rejects(registry.instantiate("missing-driver-profile", VALID_CONFIG), DeploymentProfileCapabilityError);
});

test("configuration errors expose fields and reason codes but not submitted values", async () => {
  const registry = new DeploymentProfileRegistry();
  registry.register(createSyntheticDeploymentProfile());
  const secret = "synthetic-secret-must-not-escape";
  await assert.rejects(
    registry.instantiate("synthetic-conformance", { ...VALID_CONFIG, unknown: secret }),
    (error: unknown) => {
      assert.ok(error instanceof DeploymentProfileConfigError);
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.deepEqual(error.issues, [{ field: "$unknown", code: "unknown" }]);
      return true;
    },
  );
});

test("migration plans cannot be tampered with before checkpointed execution", async () => {
  const registry = new DeploymentProfileRegistry();
  registry.register(createSyntheticDeploymentProfile());
  const plan = registry.planMigration("synthetic-conformance", "1.0.0");
  plan.steps[0]!.migrationId = "substituted-migration";
  await assert.rejects(
    registry.applyMigrations(plan, {
      deploymentRef: "deployment:tampered",
      checkpoints: { read: async () => undefined, write: async () => undefined },
      now: () => new Date(),
    }),
    DeploymentMigrationPlanError,
  );
});

test("manifest validation rejects unsupported protocol versions", () => {
  const profile: DeploymentProfile = createSyntheticDeploymentProfile();
  profile.manifest.profileId = "future-protocol-profile";
  profile.manifest.protocolVersion = DEPLOYMENT_PROFILE_PROTOCOL_VERSION + 1;
  const registry = new DeploymentProfileRegistry();
  assert.throws(() => registry.register(profile), DeploymentProfileManifestError);
});

test("runtime exactness rejects hidden manifest, driver, desired-state, and observation fields", async () => {
  const manifestProfile = createSyntheticDeploymentProfile();
  manifestProfile.manifest.profileId = "hidden-manifest-field";
  (manifestProfile.manifest as unknown as Record<string, unknown>).installScript = "synthetic-secret-must-not-escape";
  assert.throws(() => new DeploymentProfileRegistry().register(manifestProfile), DeploymentProfileManifestError);

  const driverProfile = createSyntheticDeploymentProfile();
  driverProfile.manifest.profileId = "hidden-driver-field";
  const createDrivers = driverProfile.create;
  driverProfile.create = async (config) => {
    const instance = await createDrivers(config);
    (instance.drivers as unknown as Record<string, unknown>).rawCloudClient = { token: "must-not-escape" };
    return instance;
  };
  const driverRegistry = new DeploymentProfileRegistry();
  driverRegistry.register(driverProfile);
  await assert.rejects(driverRegistry.instantiate("hidden-driver-field", VALID_CONFIG), DeploymentProfileCapabilityError);

  const registry = new DeploymentProfileRegistry();
  registry.register(createSyntheticDeploymentProfile());
  const handle = await registry.instantiate("synthetic-conformance", VALID_CONFIG);
  await assert.rejects(
    handle.reconcile({
      deploymentRef: "deployment:exactness",
      generation: 1,
      releaseDigest: `sha256:${"3".repeat(64)}`,
      architecture: "linux-amd64",
      env: { TOKEN: "must-not-escape" },
    } as unknown as Parameters<typeof handle.reconcile>[0]),
    DeploymentProfileCapabilityError,
  );
  await handle.close();

  const observationProfile = createSyntheticDeploymentProfile();
  observationProfile.manifest.profileId = "hidden-observation-field";
  const createObservation = observationProfile.create;
  observationProfile.create = async (config) => {
    const instance = await createObservation(config);
    const reconcile = instance.reconciler.reconcile.bind(instance.reconciler);
    instance.reconciler.reconcile = async (desired, signal) => ({
      ...await reconcile(desired, signal),
      rawCloudResponse: { token: "must-not-escape" },
    } as unknown as Awaited<ReturnType<typeof reconcile>>);
    return instance;
  };
  const observationRegistry = new DeploymentProfileRegistry();
  observationRegistry.register(observationProfile);
  const observationHandle = await observationRegistry.instantiate("hidden-observation-field", VALID_CONFIG);
  await assert.rejects(
    observationHandle.reconcile({
      deploymentRef: "deployment:observation",
      generation: 1,
      releaseDigest: `sha256:${"4".repeat(64)}`,
      architecture: "linux-amd64",
    }),
    DeploymentProfileCapabilityError,
  );
  await observationHandle.close();
});
