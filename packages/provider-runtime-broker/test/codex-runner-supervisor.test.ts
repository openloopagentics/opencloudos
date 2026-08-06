import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_APP_SERVER_CLIENT_VERSION,
  CODEX_APP_SERVER_SCHEMA_REVISION,
  CodexRunnerManifestError,
  CodexRunnerNotFoundError,
  CodexRunnerStartupError,
  CodexRunnerStateError,
  CodexRunnerSupervisor,
  InMemoryCodexRunnerAuditSink,
  type CodexAppServerTransport,
  type CodexCapsuleBinding,
  type CodexCapsuleLease,
  type CodexCredentialCapsuleDriver,
  type CodexRunnerLaunchSpec,
  type CodexRunnerManifest,
  type CodexRunnerProcessExit,
  type CodexRunnerProcessHandle,
  type CodexRunnerRuntimeDriver,
  type UserScope,
} from "../src/index.js";

const OWNER: UserScope = { tenantId: "tenant-a", userId: "user-a" };
const OTHER: UserScope = { tenantId: "tenant-a", userId: "user-b" };
const DIGEST = `sha256:${"0".repeat(64)}`;

function launchSpec(overrides: Partial<CodexRunnerLaunchSpec> = {}): CodexRunnerLaunchSpec {
  return {
    capsuleRef: "capsule:codex:user-a",
    executableDigest: DIGEST,
    clientVersion: CODEX_APP_SERVER_CLIENT_VERSION,
    schemaRevision: CODEX_APP_SERVER_SCHEMA_REVISION,
    workspaceMountRef: "workspace:session-a",
    sandboxPolicyRef: "sandbox:restricted-v1",
    egressPolicyRef: "egress:codex-v1",
    resourcePolicyRef: "resources:small-v1",
    ...overrides,
  };
}

class FixtureTransport implements CodexAppServerTransport {
  readonly requests: string[] = [];
  readonly notifications: string[] = [];

  constructor(public initializeMode: "ready" | "hang" | "reject" = "ready") {}

  async request(method: string): Promise<unknown> {
    this.requests.push(method);
    if (method !== "initialize") throw new Error("fixture only supports initialize");
    if (this.initializeMode === "hang") return new Promise<never>(() => undefined);
    if (this.initializeMode === "reject") throw new Error("synthetic-runtime-secret-must-not-escape");
    return {
      codexHome: "/synthetic/credential/path/must-not-escape",
      platformFamily: "unix",
      platformOs: "linux",
      userAgent: `codex_cli_rs/${CODEX_APP_SERVER_CLIENT_VERSION}`,
    };
  }

  async notify(method: string): Promise<void> {
    this.notifications.push(method);
  }
}

class FixtureProcess implements CodexRunnerProcessHandle {
  readonly transport: FixtureTransport;
  stopCalls = 0;
  killCalls = 0;
  stopMode: "ready" | "hang" = "ready";
  readonly #handlers = new Set<(exit: CodexRunnerProcessExit) => void>();
  readonly #history: Array<(exit: CodexRunnerProcessExit) => void> = [];

  constructor(initializeMode: "ready" | "hang" | "reject" = "ready") {
    this.transport = new FixtureTransport(initializeMode);
  }

  onExit(handler: (exit: CodexRunnerProcessExit) => void): () => void {
    this.#handlers.add(handler);
    this.#history.push(handler);
    return () => this.#handlers.delete(handler);
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.stopMode === "hang") return new Promise<never>(() => undefined);
  }

  async kill(): Promise<void> {
    this.killCalls += 1;
  }

  crash(): void {
    for (const handler of [...this.#handlers]) handler({ code: 17 });
  }

  emitStaleExit(): void {
    for (const handler of this.#history) handler({ signal: "SIGKILL" });
  }
}

class FixtureRuntime implements CodexRunnerRuntimeDriver {
  readonly manifests: CodexRunnerManifest[] = [];
  readonly processes: FixtureProcess[] = [];
  nextInitializeMode: "ready" | "hang" | "reject" = "ready";

  async start(manifest: CodexRunnerManifest): Promise<CodexRunnerProcessHandle> {
    this.manifests.push(structuredClone(manifest));
    const process = new FixtureProcess(this.nextInitializeMode);
    this.nextInitializeMode = "ready";
    this.processes.push(process);
    return process;
  }
}

class FixtureCapsules implements CodexCredentialCapsuleDriver {
  readonly opened: CodexCapsuleBinding[] = [];
  readonly destroyed: CodexCapsuleBinding[] = [];
  closes = 0;

  async open(binding: CodexCapsuleBinding): Promise<CodexCapsuleLease> {
    this.opened.push(structuredClone(binding));
    return { close: async () => { this.closes += 1; } };
  }

  async destroy(binding: CodexCapsuleBinding): Promise<void> {
    this.destroyed.push(structuredClone(binding));
  }
}

function fixture(options: { startupTimeoutMs?: number; shutdownTimeoutMs?: number } = {}) {
  const runtime = new FixtureRuntime();
  const capsules = new FixtureCapsules();
  const audit = new InMemoryCodexRunnerAuditSink();
  const supervisor = new CodexRunnerSupervisor({
    runtime,
    capsules,
    audit,
    pinnedExecutableDigest: DIGEST,
    startupTimeoutMs: options.startupTimeoutMs ?? 100,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 100,
    createRef: () => "fixture-runner",
    now: () => new Date("2026-08-05T12:00:00.000Z"),
  });
  return { supervisor, runtime, capsules, audit };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("SUPERVISOR-001: unknown and cross-user runner access fail with the same hidden-ownership error", async () => {
  const { supervisor } = fixture();
  await supervisor.start(OWNER, "connection-a", launchSpec());

  let wrongOwner: unknown;
  let unknown: unknown;
  try { supervisor.read(OTHER, "connection-a"); } catch (error) { wrongOwner = error; }
  try { supervisor.read(OTHER, "connection-missing"); } catch (error) { unknown = error; }
  assert.ok(wrongOwner instanceof CodexRunnerNotFoundError);
  assert.ok(unknown instanceof CodexRunnerNotFoundError);
  assert.equal(wrongOwner.code, unknown.code);
  assert.equal(wrongOwner.message, unknown.message);
  assert.throws(() => supervisor.client(OTHER, "connection-a"), CodexRunnerNotFoundError);
  await assert.rejects(supervisor.stop(OTHER, "connection-a"), CodexRunnerNotFoundError);
  assert.equal(supervisor.read(OWNER, "connection-a").state, "ready");
});

test("SUPERVISOR-002: pins and the exact secret-free manifest shape are validated before drivers run", async () => {
  const { supervisor, runtime, capsules } = fixture();
  const invalid: unknown[] = [
    launchSpec({ clientVersion: "latest" }),
    launchSpec({ schemaRevision: "unreviewed-schema" }),
    launchSpec({ executableDigest: "codex-latest" }),
    launchSpec({ executableDigest: `sha256:${"1".repeat(64)}` }),
    { ...launchSpec(), env: { OPENAI_API_KEY: "synthetic-secret" } },
    { ...launchSpec(), token: "synthetic-secret" },
  ];

  for (const [index, spec] of invalid.entries()) {
    await assert.rejects(
      async () => supervisor.start(OWNER, `connection-invalid-${index}`, spec as CodexRunnerLaunchSpec),
      CodexRunnerManifestError,
    );
  }
  assert.equal(runtime.manifests.length, 0);
  assert.equal(capsules.opened.length, 0);
});

test("SUPERVISOR-003: readiness requires capsule mount plus one app-server initialization and exposes metadata only", async () => {
  const { supervisor, runtime, capsules, audit } = fixture();
  const snapshot = await supervisor.start(OWNER, "connection-a", launchSpec());

  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.capsuleState, "mounted");
  assert.equal(runtime.processes[0]?.transport.requests.filter((method) => method === "initialize").length, 1);
  assert.deepEqual(runtime.processes[0]?.transport.notifications, ["initialized"]);
  assert.equal(capsules.opened.length, 1);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "capsuleRef", "capsuleState", "clientVersion", "connectionRef", "createdAt", "generation",
    "runnerRef", "schemaRevision", "state", "tenantId", "updatedAt", "userId",
  ]);
  const serialized = JSON.stringify({ snapshot, events: audit.events });
  assert.equal(serialized.includes("credential/path"), false);
  assert.equal(serialized.includes("transport"), false);
  assert.equal(serialized.includes("executableDigest"), false);
});

test("SUPERVISOR-004: concurrent identical starts create one generation while manifest rebinding is rejected", async () => {
  const { supervisor, runtime, capsules } = fixture();
  const [first, second] = await Promise.all([
    supervisor.start(OWNER, "connection-a", launchSpec()),
    supervisor.start(OWNER, "connection-a", launchSpec()),
  ]);

  assert.equal(first.runnerRef, second.runnerRef);
  assert.equal(first.generation, 1);
  assert.equal(runtime.manifests.length, 1);
  assert.equal(capsules.opened.length, 1);
  await assert.rejects(
    supervisor.start(OWNER, "connection-a", launchSpec({ capsuleRef: "capsule:different" })),
    CodexRunnerManifestError,
  );
});

test("SUPERVISOR-005: crashes seal the capsule and recovery generation-fences stale process exits", async () => {
  const { supervisor, runtime, capsules } = fixture();
  await supervisor.start(OWNER, "connection-a", launchSpec());
  const first = runtime.processes[0];
  assert.ok(first);
  first.crash();
  assert.equal(supervisor.read(OWNER, "connection-a").state, "degraded");
  assert.equal(supervisor.read(OWNER, "connection-a").failureCode, "process_exited");
  assert.throws(() => supervisor.client(OWNER, "connection-a"), CodexRunnerStateError);

  const recovered = await supervisor.recover(OWNER, "connection-a");
  assert.equal(recovered.generation, 2);
  assert.equal(recovered.state, "ready");
  assert.equal(capsules.opened.length, 2);
  first.emitStaleExit();
  assert.equal(supervisor.read(OWNER, "connection-a").state, "ready");
});

test("SUPERVISOR-006: stop preserves a sealed capsule while destroy is irreversible", async () => {
  const { supervisor, runtime, capsules } = fixture();
  await supervisor.start(OWNER, "connection-a", launchSpec());
  const stopped = await supervisor.stop(OWNER, "connection-a");
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.capsuleState, "sealed");
  assert.equal(runtime.processes[0]?.stopCalls, 1);

  const recovered = await supervisor.recover(OWNER, "connection-a");
  assert.equal(recovered.generation, 2);
  const destroyed = await supervisor.destroy(OWNER, "connection-a");
  assert.equal(destroyed.state, "stopped");
  assert.equal(destroyed.capsuleState, "destroyed");
  assert.equal(capsules.destroyed.length, 1);
  await assert.rejects(supervisor.recover(OWNER, "connection-a"), CodexRunnerStateError);
  assert.throws(() => supervisor.client(OWNER, "connection-a"), CodexRunnerStateError);
});

test("SUPERVISOR-007: startup timeout kills the process, seals the capsule, and redacts runtime details", async () => {
  const { supervisor, runtime, capsules, audit } = fixture({ startupTimeoutMs: 10 });
  runtime.nextInitializeMode = "hang";
  let failure: unknown;
  try { await supervisor.start(OWNER, "connection-a", launchSpec()); } catch (error) { failure = error; }

  assert.ok(failure instanceof CodexRunnerStartupError);
  assert.equal(failure.code, "runner_startup_timeout");
  assert.equal(runtime.processes[0]?.killCalls, 1);
  assert.equal(capsules.closes, 1);
  const snapshot = supervisor.read(OWNER, "connection-a");
  assert.equal(snapshot.state, "failed");
  assert.equal(snapshot.capsuleState, "sealed");
  assert.equal(snapshot.failureCode, "startup_timeout");
  assert.equal(JSON.stringify({ failure: String(failure), snapshot, events: audit.events }).includes("credential/path"), false);
});

test("SUPERVISOR-008: graceful shutdown timeout forces kill and still seals the capsule", async () => {
  const { supervisor, runtime, capsules, audit } = fixture({ shutdownTimeoutMs: 10 });
  await supervisor.start(OWNER, "connection-a", launchSpec());
  const process = runtime.processes[0];
  assert.ok(process);
  process.stopMode = "hang";

  const stopped = await supervisor.stop(OWNER, "connection-a");
  assert.equal(process.stopCalls, 1);
  assert.equal(process.killCalls, 1);
  assert.equal(capsules.closes, 1);
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.capsuleState, "sealed");
  assert.equal(audit.events.at(-1)?.outcome, "forced");
});

test("a process exit during initialization fails startup instead of publishing a dead runner as ready", async () => {
  const { supervisor, runtime, capsules } = fixture();
  runtime.nextInitializeMode = "hang";
  const starting = supervisor.start(OWNER, "connection-a", launchSpec());
  await tick();
  const process = runtime.processes[0];
  assert.ok(process);
  process.crash();

  await assert.rejects(starting, (error: unknown) => {
    assert.ok(error instanceof CodexRunnerStartupError);
    assert.equal(error.code, "runner_start_failed");
    return true;
  });
  assert.equal(process.killCalls, 1);
  assert.equal(capsules.closes, 1);
  assert.equal(supervisor.read(OWNER, "connection-a").state, "failed");
});
