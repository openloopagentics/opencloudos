import assert from "node:assert/strict";
import test from "node:test";
import {
  DeploymentDriverConflictError,
  DeploymentProfileClosedError,
  DeploymentProfileRegistry,
  runDeploymentProfileConformance,
} from "../../deployment-profile-sdk/src/index.js";
import {
  AwsApiConflictError,
  AwsSdkProfileApi,
  createAwsDeploymentProfile,
  type AwsArtifactHead,
  type AwsIdentityVerifier,
  type AwsProfileApi,
  type AwsSdkClientSet,
  type AwsSecretVersionResult,
  type AwsStateCondition,
  type AwsStateRecord,
  type EksCapsuleSpec,
  type EksRuntimeControl,
  type EksRuntimeObservation,
  type EksWorkloadSpec,
} from "../src/index.js";

const VALID_CONFIG = {
  region: "us-west-2",
  artifactBucketRef: "opencloudos-artifacts",
  artifactPrefix: "opencloudos",
  metadataTableRef: "opencloudos-control",
  secretPrefix: "opencloudos",
  telemetryLogGroupRef: "/aws/opencloudos/profile",
  telemetryLogStreamRef: "profile-conformance",
  eksNamespace: "opencloudos-system",
  eksServiceAccountRef: "opencloudos-profile",
  capsuleStorageClassRef: "efs-opencloudos",
  capsuleSizeGi: 5,
  workloadImageRepository: "123456789012.dkr.ecr.us-west-2.amazonaws.com/opencloudos-runtime",
  workloadCpuRequest: "500m",
  workloadMemoryRequest: "1Gi",
  workloadResourcePolicyRef: "policy:resources",
  workloadNetworkPolicyRef: "policy:network",
  workloadStoragePolicyRef: "policy:storage",
  capsuleStoragePolicyRef: "policy:capsule-storage",
  readinessTimeoutSeconds: 30,
  identityIssuer: "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_example",
  identityAudienceRef: "cognito-client",
  identityUserPoolRef: "us-west-2_example",
};

class InMemoryAwsApi implements AwsProfileApi {
  readonly artifacts = new Map<string, { head: AwsArtifactHead; bytes: Uint8Array }>();
  readonly secrets = new Map<string, { material: Uint8Array; versionId: string }>();
  readonly records = new Map<string, AwsStateRecord>();
  readonly logs: Array<{ group: string; stream: string; messages: string[] }> = [];
  closeCalls = 0;

  private artifactKey(bucket: string, key: string): string {
    return `${bucket}\0${key}`;
  }

  async headArtifact(bucket: string, key: string): Promise<AwsArtifactHead | undefined> {
    const stored = this.artifacts.get(this.artifactKey(bucket, key));
    return stored ? structuredClone(stored.head) : undefined;
  }

  async putArtifactImmutable(
    bucket: string,
    key: string,
    digest: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const storageKey = this.artifactKey(bucket, key);
    if (this.artifacts.has(storageKey)) throw new AwsApiConflictError();
    this.artifacts.set(storageKey, { head: { digest, size: bytes.byteLength }, bytes: new Uint8Array(bytes) });
  }

  async readArtifact(bucket: string, key: string): Promise<Uint8Array | undefined> {
    const stored = this.artifacts.get(this.artifactKey(bucket, key));
    return stored ? new Uint8Array(stored.bytes) : undefined;
  }

  async deleteArtifact(bucket: string, key: string): Promise<void> {
    this.artifacts.delete(this.artifactKey(bucket, key));
  }

  async createSecret(name: string, material: Uint8Array, requestToken: string): Promise<AwsSecretVersionResult> {
    const arn = `arn:aws:secretsmanager:us-west-2:123456789012:secret:${name}`;
    if (this.secrets.has(arn)) throw new AwsApiConflictError();
    this.secrets.set(arn, { material: new Uint8Array(material), versionId: requestToken });
    return { arn, versionId: requestToken };
  }

  async putSecretVersion(secretId: string, material: Uint8Array, requestToken: string): Promise<AwsSecretVersionResult> {
    if (!this.secrets.has(secretId)) throw new Error("missing");
    this.secrets.set(secretId, { material: new Uint8Array(material), versionId: requestToken });
    return { arn: secretId, versionId: requestToken };
  }

  async secretExists(secretId: string): Promise<boolean> {
    return this.secrets.has(secretId);
  }

  async deleteSecret(secretId: string): Promise<void> {
    const secret = this.secrets.get(secretId);
    secret?.material.fill(0);
    this.secrets.delete(secretId);
  }

  async getStateRecord(_tableName: string, pk: string, sk: string): Promise<AwsStateRecord | undefined> {
    const record = this.records.get(`${pk}\0${sk}`);
    return record ? structuredClone(record) : undefined;
  }

  async putStateRecord(_tableName: string, record: AwsStateRecord, condition: AwsStateCondition): Promise<void> {
    const key = `${record.pk}\0${record.sk}`;
    const current = this.records.get(key);
    if (
      (condition.kind === "absent" && current)
      || (condition.kind === "version" && current?.version !== condition.version)
    ) throw new AwsApiConflictError();
    this.records.set(key, structuredClone(record));
  }

  async putLogEvents(_logGroupName: string, _logStreamName: string, events: Array<{ message?: string }>): Promise<void> {
    this.logs.push({
      group: _logGroupName,
      stream: _logStreamName,
      messages: events.map((event) => event.message ?? ""),
    });
  }

  close(): void {
    this.closeCalls += 1;
  }
}

class InMemoryEksRuntime implements EksRuntimeControl {
  readonly capsules = new Map<string, { state: "mounted" | "sealed"; generation: number; desiredHash: string }>();
  readonly workloads = new Map<string, { state: "starting" | "ready" | "degraded"; generation: number; desiredHash: string }>();
  lastWorkload?: EksWorkloadSpec;
  closeCalls = 0;

  private key(namespace: string, name: string): string {
    return `${namespace}/${name}`;
  }

  async reconcileCapsule(spec: EksCapsuleSpec): Promise<string> {
    const key = this.key(spec.namespace, spec.name);
    const current = this.capsules.get(key);
    if (current && (current.generation > spec.generation || (current.generation === spec.generation && current.desiredHash !== spec.desiredHash))) {
      throw new Error("generation conflict");
    }
    this.capsules.set(key, { state: "mounted", generation: spec.generation, desiredHash: spec.desiredHash });
    return `k8s:pvc:${key}`;
  }

  async inspectCapsule(namespace: string, name: string): Promise<"mounted" | "sealed" | undefined> {
    return this.capsules.get(this.key(namespace, name))?.state;
  }

  async sealCapsule(namespace: string, name: string, workloadName: string, generation: number): Promise<void> {
    await this.destroyWorkload(namespace, workloadName, generation);
    const key = this.key(namespace, name);
    const current = this.capsules.get(key);
    if (!current) throw new Error("missing capsule");
    this.capsules.set(key, { ...current, state: "sealed", generation });
  }

  async destroyCapsule(namespace: string, name: string, workloadName: string, generation: number): Promise<void> {
    await this.destroyWorkload(namespace, workloadName, generation);
    this.capsules.delete(this.key(namespace, name));
  }

  async reconcileWorkload(spec: EksWorkloadSpec): Promise<EksRuntimeObservation> {
    const key = this.key(spec.namespace, spec.name);
    const current = this.workloads.get(key);
    if (current && (current.generation > spec.generation || (current.generation === spec.generation && current.desiredHash !== spec.desiredHash))) {
      throw new Error("generation conflict");
    }
    this.lastWorkload = structuredClone(spec);
    this.workloads.set(key, { state: "ready", generation: spec.generation, desiredHash: spec.desiredHash });
    return { state: "ready", endpointRef: `k8s:deployment:${key}` };
  }

  async inspectWorkload(namespace: string, name: string): Promise<EksRuntimeObservation | undefined> {
    const workload = this.workloads.get(this.key(namespace, name));
    return workload ? { state: workload.state, endpointRef: `k8s:deployment:${namespace}/${name}` } : undefined;
  }

  async destroyWorkload(namespace: string, name: string, generation: number): Promise<void> {
    const key = this.key(namespace, name);
    const current = this.workloads.get(key);
    if (current && generation < current.generation) throw new Error("generation conflict");
    this.workloads.delete(key);
  }

  close(): void {
    this.closeCalls += 1;
  }
}

function verifier(): AwsIdentityVerifier {
  return {
    async verify(token) {
      if (token !== "aws-conformance-token") throw new Error("invalid");
      return {
        sub: "user-conformance-a",
        "custom:tenant_id": "tenant-conformance-a",
        "cognito:groups": ["operators"],
        exp: 1_786_032_000,
      };
    },
  };
}

function harness() {
  const api = new InMemoryAwsApi();
  const eks = new InMemoryEksRuntime();
  let uuidCounter = 0;
  const profile = createAwsDeploymentProfile({
    apiFactory: () => api,
    eksFactory: async () => eks,
    identityVerifierFactory: verifier,
    uuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
  });
  const registry = new DeploymentProfileRegistry();
  registry.register(profile);
  return { api, eks, profile, registry };
}

test("AWS-001: the AWS package declares all protocol-v1 capabilities without changing core imports", () => {
  const { registry } = harness();
  const manifest = registry.resolve("aws-eks");
  assert.equal(manifest.provider, "aws");
  assert.equal(manifest.capabilities.length, 7);
  assert.deepEqual(manifest.supportedArchitectures, ["linux-amd64", "linux-arm64"]);
});

test("AWS-002: deterministic AWS and EKS fakes pass PROFILE-001 through PROFILE-011", async () => {
  const { registry, api, eks } = harness();
  const report = await runDeploymentProfileConformance(registry, "aws-eks", {
    validConfig: VALID_CONFIG,
    invalidConfig: { ...VALID_CONFIG, accessToken: "aws-secret-must-not-escape" },
    scopeA: { tenantId: "tenant-conformance-a" },
    scopeB: { tenantId: "tenant-conformance-b" },
    identityAssertion: {
      issuer: VALID_CONFIG.identityIssuer,
      audience: VALID_CONFIG.identityAudienceRef,
      subjectToken: "aws-conformance-token",
    },
    expectedIdentity: { tenantId: "tenant-conformance-a", userId: "user-conformance-a" },
    migrationFromVersion: "0.0.0",
    now: () => new Date("2026-08-06T12:00:00.000Z"),
  });
  assert.equal(report.passed, true, JSON.stringify(report.scenarios));
  assert.equal(report.scenarios.filter((scenario) => scenario.outcome === "passed").length, 11);
  assert.equal(api.closeCalls, 1);
  assert.equal(eks.closeCalls, 1);
});

test("AWS-003: provider runners fail closed until a mounted EKS credential capsule exists", async () => {
  const { registry, eks, api } = harness();
  const handle = await registry.instantiate("aws-eks", VALID_CONFIG);
  const desired = {
    workloadRef: "workload:runner",
    kind: "provider_runner" as const,
    generation: 1,
    releaseDigest: `sha256:${"1".repeat(64)}`,
    resourcePolicyRef: "policy:resources",
    networkPolicyRef: "policy:network",
    storagePolicyRef: "policy:storage",
  };
  await assert.rejects(() => handle.drivers.workloadRuntime!.reconcile({ tenantId: "tenant-a" }, desired), DeploymentDriverConflictError);
  await handle.drivers.credentialCapsule!.reconcile({ tenantId: "tenant-a" }, {
    capsuleRef: "capsule:runner",
    workloadRef: desired.workloadRef,
    generation: 1,
    storagePolicyRef: "policy:capsule-storage",
  });
  const lostLinkKey = [...api.records.entries()].find(([, record]) => record.sk.startsWith("capsule-link#"))?.[0];
  assert.ok(lostLinkKey);
  api.records.delete(lostLinkKey);
  await handle.drivers.credentialCapsule!.reconcile({ tenantId: "tenant-a" }, {
    capsuleRef: "capsule:runner",
    workloadRef: desired.workloadRef,
    generation: 1,
    storagePolicyRef: "policy:capsule-storage",
  });
  const ready = await handle.drivers.workloadRuntime!.reconcile({ tenantId: "tenant-a" }, desired);
  assert.equal(ready.state, "ready");
  assert.match(eks.lastWorkload?.capsuleClaimName ?? "", /^oc-capsule-/u);
  await handle.close();
});

test("AWS-004: telemetry rejects credential-shaped attributes before CloudWatch", async () => {
  const { registry, api } = harness();
  const handle = await registry.instantiate("aws-eks", VALID_CONFIG);
  await assert.rejects(() => handle.drivers.telemetry!.emit([{
    type: "unsafe",
    occurredAt: "2026-08-06T12:00:00.000Z",
    attributes: { accessToken: "must-not-log" },
  }]), DeploymentDriverConflictError);
  assert.equal(api.logs.length, 0);
  await handle.close();
});

test("AWS-005: drivers close with the profile and do not retain a usable cloud surface", async () => {
  const { registry } = harness();
  const handle = await registry.instantiate("aws-eks", VALID_CONFIG);
  const artifact = handle.drivers.artifactStore!;
  await handle.close();
  await assert.rejects(() => artifact.head({ tenantId: "tenant-a" }, "artifact:a"), DeploymentProfileClosedError);
});

test("AWS-006: AWS SDK binding uses S3 preconditions, strong DynamoDB reads, secret binary, and CloudWatch batches", async () => {
  const commands: Array<{ client: string; name: string; input: Record<string, unknown> }> = [];
  function client(name: string, output: (commandName: string) => unknown): AwsSdkClientSet["s3"] {
    return {
      async send(command) {
        const typed = command as { constructor: { name: string }; input: Record<string, unknown> };
        commands.push({ client: name, name: typed.constructor.name, input: typed.input });
        return output(typed.constructor.name);
      },
    };
  }
  const api = new AwsSdkProfileApi({
    s3: client("s3", (name) => name === "HeadObjectCommand"
      ? { Metadata: { "opencloudos-digest": `sha256:${"a".repeat(64)}` }, ContentLength: 3 }
      : name === "GetObjectCommand" ? { Body: new Uint8Array([1, 2, 3]) } : {}),
    secretsManager: client("secrets", () => ({ ARN: "arn:aws:secretsmanager:us-west-2:123:secret:test", VersionId: "version-id" })),
    dynamodb: client("dynamodb", (name) => name === "GetItemCommand"
      ? { Item: { pk: { S: "pk" }, sk: { S: "sk" }, version: { N: "1" }, deleted: { BOOL: false }, payload: { S: "{}" } } }
      : {}),
    cloudWatchLogs: client("logs", () => ({})),
  });
  await api.putArtifactImmutable("bucket", "key", `sha256:${"a".repeat(64)}`, new Uint8Array([1, 2, 3]));
  await api.getStateRecord("table", "pk", "sk");
  await api.putStateRecord("table", { pk: "pk", sk: "sk", version: 2, deleted: false, payload: "{}" }, { kind: "version", version: 1 });
  await api.createSecret("name", new Uint8Array([1]), "00000000-0000-4000-8000-000000000001");
  await api.putLogEvents("group", "stream", [{ timestamp: 1, message: "event" }]);
  assert.equal(commands.find((entry) => entry.name === "PutObjectCommand")?.input.IfNoneMatch, "*");
  assert.equal(commands.find((entry) => entry.name === "GetItemCommand")?.input.ConsistentRead, true);
  assert.equal(commands.find((entry) => entry.name === "PutItemCommand")?.input.ConditionExpression, "#version = :expected");
  assert.ok(commands.find((entry) => entry.name === "CreateSecretCommand")?.input.SecretBinary instanceof Uint8Array);
  assert.deepEqual(commands.find((entry) => entry.name === "PutLogEventsCommand")?.input.logEvents, [{ timestamp: 1, message: "event" }]);
});
