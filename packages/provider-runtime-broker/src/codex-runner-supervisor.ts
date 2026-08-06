import { randomUUID } from "node:crypto";
import {
  CODEX_APP_SERVER_CLIENT_VERSION,
  CODEX_APP_SERVER_SCHEMA_REVISION,
  CodexAppServerClient,
  type CodexAppServerTransport,
} from "./codex-app-server-client.js";
import {
  CodexRunnerManifestError,
  CodexRunnerNotFoundError,
  CodexRunnerStartupError,
  CodexRunnerStateError,
} from "./errors.js";
import type { UserScope } from "./contracts.js";

export type CodexRunnerState = "starting" | "ready" | "degraded" | "stopping" | "stopped" | "failed";
export type CodexCapsuleState = "sealed" | "mounted" | "destroyed";

export interface CodexRunnerLaunchSpec {
  capsuleRef: string;
  executableDigest: string;
  clientVersion: string;
  schemaRevision: string;
  workspaceMountRef: string;
  sandboxPolicyRef: string;
  egressPolicyRef: string;
  resourcePolicyRef: string;
}

export interface CodexRunnerManifest extends UserScope, CodexRunnerLaunchSpec {
  runnerRef: string;
  connectionRef: string;
  generation: number;
}

export interface CodexCapsuleBinding extends UserScope {
  runnerRef: string;
  connectionRef: string;
  capsuleRef: string;
  generation: number;
}

export interface CodexCapsuleLease {
  close(): Promise<void>;
}

export interface CodexCredentialCapsuleDriver {
  open(binding: CodexCapsuleBinding, signal: AbortSignal): Promise<CodexCapsuleLease>;
  destroy(binding: CodexCapsuleBinding): Promise<void>;
}

export interface CodexRunnerProcessExit {
  code?: number;
  signal?: string;
}

export interface CodexRunnerProcessHandle {
  transport: CodexAppServerTransport;
  onExit(handler: (exit: CodexRunnerProcessExit) => void): () => void;
  stop(): Promise<void>;
  kill(): Promise<void>;
}

export interface CodexRunnerRuntimeDriver {
  start(manifest: CodexRunnerManifest, signal: AbortSignal): Promise<CodexRunnerProcessHandle>;
}

export interface CodexRunnerSnapshot extends UserScope {
  runnerRef: string;
  connectionRef: string;
  capsuleRef: string;
  state: CodexRunnerState;
  capsuleState: CodexCapsuleState;
  generation: number;
  clientVersion: string;
  schemaRevision: string;
  failureCode?: "process_exited" | "startup_failed" | "startup_timeout";
  createdAt: string;
  updatedAt: string;
}

export interface CodexRunnerAuditEvent extends UserScope {
  type:
    | "codex.runner.starting"
    | "codex.runner.ready"
    | "codex.runner.degraded"
    | "codex.runner.stopped"
    | "codex.runner.destroyed";
  runnerRef: string;
  connectionRef: string;
  generation: number;
  outcome: string;
  occurredAt: string;
}

export interface CodexRunnerAuditSink {
  append(event: CodexRunnerAuditEvent): Promise<void>;
}

export class InMemoryCodexRunnerAuditSink implements CodexRunnerAuditSink {
  readonly events: CodexRunnerAuditEvent[] = [];

  async append(event: CodexRunnerAuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

export interface CodexRunnerSupervisorDependencies {
  runtime: CodexRunnerRuntimeDriver;
  capsules: CodexCredentialCapsuleDriver;
  audit: CodexRunnerAuditSink;
  pinnedExecutableDigest: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  now?: () => Date;
  createRef?: () => string;
}

interface RunnerRecord extends CodexRunnerSnapshot {
  spec: CodexRunnerLaunchSpec;
  client?: CodexAppServerClient;
  handle?: CodexRunnerProcessHandle;
  lease?: CodexCapsuleLease;
  unsubscribeExit?: () => void;
  leaseClosing?: Promise<void>;
}

const SPEC_KEYS = new Set<keyof CodexRunnerLaunchSpec>([
  "capsuleRef",
  "executableDigest",
  "clientVersion",
  "schemaRevision",
  "workspaceMountRef",
  "sandboxPolicyRef",
  "egressPolicyRef",
  "resourcePolicyRef",
]);
const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

function validateLaunchSpec(input: CodexRunnerLaunchSpec, pinnedExecutableDigest: string): CodexRunnerLaunchSpec {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CodexRunnerManifestError("Runner launch spec must be an object");
  }
  for (const key of Object.keys(input)) {
    if (!SPEC_KEYS.has(key as keyof CodexRunnerLaunchSpec)) {
      throw new CodexRunnerManifestError("Runner launch spec contains an unsupported field");
    }
  }
  for (const key of SPEC_KEYS) {
    if (typeof input[key] !== "string" || input[key].length === 0) {
      throw new CodexRunnerManifestError(`Runner launch spec ${key} must be a non-empty string`);
    }
  }
  for (const key of ["capsuleRef", "workspaceMountRef", "sandboxPolicyRef", "egressPolicyRef", "resourcePolicyRef"] as const) {
    if (!OPAQUE_REF.test(input[key])) {
      throw new CodexRunnerManifestError(`Runner launch spec ${key} must be an opaque reference`);
    }
  }
  if (!SHA256_DIGEST.test(input.executableDigest)) {
    throw new CodexRunnerManifestError("Runner executable must be pinned by a lowercase SHA-256 digest");
  }
  if (input.executableDigest !== pinnedExecutableDigest) {
    throw new CodexRunnerManifestError("Runner executable digest does not match the trusted release pin");
  }
  if (input.clientVersion !== CODEX_APP_SERVER_CLIENT_VERSION) {
    throw new CodexRunnerManifestError("Runner Codex client version does not match the tested protocol fixture");
  }
  if (input.schemaRevision !== CODEX_APP_SERVER_SCHEMA_REVISION) {
    throw new CodexRunnerManifestError("Runner Codex schema revision does not match the tested protocol fixture");
  }
  return { ...input };
}

function sameSpec(left: CodexRunnerLaunchSpec, right: CodexRunnerLaunchSpec): boolean {
  return [...SPEC_KEYS].every((key) => left[key] === right[key]);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new CodexRunnerStartupError("runner_startup_timeout"));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class CodexRunnerSupervisor {
  readonly #runtime: CodexRunnerRuntimeDriver;
  readonly #capsules: CodexCredentialCapsuleDriver;
  readonly #audit: CodexRunnerAuditSink;
  readonly #pinnedExecutableDigest: string;
  readonly #startupTimeoutMs: number;
  readonly #shutdownTimeoutMs: number;
  readonly #now: () => Date;
  readonly #createRef: () => string;
  readonly #records = new Map<string, RunnerRecord>();
  readonly #operations = new Map<string, Promise<unknown>>();

  constructor(dependencies: CodexRunnerSupervisorDependencies) {
    this.#runtime = dependencies.runtime;
    this.#capsules = dependencies.capsules;
    this.#audit = dependencies.audit;
    this.#pinnedExecutableDigest = dependencies.pinnedExecutableDigest;
    this.#startupTimeoutMs = dependencies.startupTimeoutMs ?? 10_000;
    this.#shutdownTimeoutMs = dependencies.shutdownTimeoutMs ?? 5_000;
    this.#now = dependencies.now ?? (() => new Date());
    this.#createRef = dependencies.createRef ?? randomUUID;
    if (!SHA256_DIGEST.test(this.#pinnedExecutableDigest)) {
      throw new CodexRunnerManifestError("Trusted runner executable pin must be a lowercase SHA-256 digest");
    }
    if (this.#startupTimeoutMs <= 0 || this.#shutdownTimeoutMs <= 0) {
      throw new CodexRunnerManifestError("Runner timeouts must be positive");
    }
  }

  start(scope: UserScope, connectionRef: string, input: CodexRunnerLaunchSpec): Promise<CodexRunnerSnapshot> {
    const spec = validateLaunchSpec(input, this.#pinnedExecutableDigest);
    return this.#exclusive(connectionRef, async () => {
      const existing = this.#records.get(connectionRef);
      if (existing) {
        this.#assertOwner(existing, scope);
        if (!sameSpec(existing.spec, spec)) {
          throw new CodexRunnerManifestError("Provider Connection is already bound to a different runner manifest");
        }
        if (existing.state === "ready") return this.#snapshot(existing);
        throw new CodexRunnerStateError(`Codex Provider Runner cannot start from ${existing.state}; use recovery`);
      }

      const now = this.#timestamp();
      const record: RunnerRecord = {
        runnerRef: `codex-runner:${this.#createRef()}`,
        connectionRef,
        tenantId: scope.tenantId,
        userId: scope.userId,
        capsuleRef: spec.capsuleRef,
        state: "starting",
        capsuleState: "sealed",
        generation: 1,
        clientVersion: spec.clientVersion,
        schemaRevision: spec.schemaRevision,
        createdAt: now,
        updatedAt: now,
        spec,
      };
      this.#records.set(connectionRef, record);
      await this.#emit(record, "codex.runner.starting", "requested");
      await this.#boot(record);
      return this.#snapshot(record);
    });
  }

  read(scope: UserScope, connectionRef: string): CodexRunnerSnapshot {
    return this.#snapshot(this.#owned(scope, connectionRef));
  }

  client(scope: UserScope, connectionRef: string): CodexAppServerClient {
    const record = this.#owned(scope, connectionRef);
    if (record.state !== "ready" || !record.client) {
      throw new CodexRunnerStateError(`Codex Provider Runner client is unavailable while ${record.state}`);
    }
    return record.client;
  }

  recover(scope: UserScope, connectionRef: string): Promise<CodexRunnerSnapshot> {
    return this.#exclusive(connectionRef, async () => {
      const record = this.#owned(scope, connectionRef);
      if (record.capsuleState === "destroyed") {
        throw new CodexRunnerStateError("Destroyed credential capsules cannot be recovered");
      }
      if (!(["degraded", "failed", "stopped"] as CodexRunnerState[]).includes(record.state)) {
        throw new CodexRunnerStateError(`Codex Provider Runner cannot recover from ${record.state}`);
      }
      if (record.leaseClosing) await record.leaseClosing;
      record.generation += 1;
      record.state = "starting";
      record.capsuleState = "sealed";
      delete record.failureCode;
      record.updatedAt = this.#timestamp();
      await this.#emit(record, "codex.runner.starting", "recovery_requested");
      await this.#boot(record);
      return this.#snapshot(record);
    });
  }

  stop(scope: UserScope, connectionRef: string): Promise<CodexRunnerSnapshot> {
    return this.#exclusive(connectionRef, async () => {
      const record = this.#owned(scope, connectionRef);
      await this.#stopRecord(record);
      return this.#snapshot(record);
    });
  }

  destroy(scope: UserScope, connectionRef: string): Promise<CodexRunnerSnapshot> {
    return this.#exclusive(connectionRef, async () => {
      const record = this.#owned(scope, connectionRef);
      if (record.capsuleState === "destroyed") return this.#snapshot(record);
      await this.#stopRecord(record);
      await this.#capsules.destroy(this.#binding(record));
      record.capsuleState = "destroyed";
      record.updatedAt = this.#timestamp();
      await this.#emit(record, "codex.runner.destroyed", "capsule_destroyed");
      return this.#snapshot(record);
    });
  }

  async #boot(record: RunnerRecord): Promise<void> {
    let lease: CodexCapsuleLease | undefined;
    let handle: CodexRunnerProcessHandle | undefined;
    try {
      const capsuleAbort = new AbortController();
      lease = await withTimeout(
        this.#capsules.open(this.#binding(record), capsuleAbort.signal),
        this.#startupTimeoutMs,
        () => capsuleAbort.abort(),
      );
      record.lease = lease;
      record.capsuleState = "mounted";
      const runtimeAbort = new AbortController();
      handle = await withTimeout(
        this.#runtime.start(this.#manifest(record), runtimeAbort.signal),
        this.#startupTimeoutMs,
        () => runtimeAbort.abort(),
      );
      record.handle = handle;
      const generation = record.generation;
      let rejectStartupExit: (() => void) | undefined;
      const startupExit = new Promise<never>((_resolve, reject) => {
        rejectStartupExit = () => reject(new CodexRunnerStartupError("runner_start_failed"));
      });
      record.unsubscribeExit = handle.onExit(() => {
        const current = this.#records.get(record.connectionRef);
        if (current?.generation === generation && current.handle === handle && current.state === "starting") {
          rejectStartupExit?.();
          return;
        }
        this.#handleUnexpectedExit(record.connectionRef, generation, handle!);
      });
      const client = new CodexAppServerClient(handle.transport);
      await withTimeout(Promise.race([client.initialize(), startupExit]), this.#startupTimeoutMs);
      record.client = client;
      record.state = "ready";
      record.updatedAt = this.#timestamp();
      await this.#emit(record, "codex.runner.ready", "initialized");
    } catch (error: unknown) {
      record.unsubscribeExit?.();
      delete record.unsubscribeExit;
      delete record.client;
      delete record.handle;
      if (handle) await this.#bestEffort(() => handle!.kill());
      if (lease) await this.#bestEffort(() => lease!.close());
      delete record.lease;
      record.capsuleState = "sealed";
      record.state = "failed";
      const timedOut = error instanceof CodexRunnerStartupError && error.code === "runner_startup_timeout";
      record.failureCode = timedOut ? "startup_timeout" : "startup_failed";
      record.updatedAt = this.#timestamp();
      await this.#emit(record, "codex.runner.degraded", record.failureCode);
      throw new CodexRunnerStartupError(timedOut ? "runner_startup_timeout" : "runner_start_failed");
    }
  }

  #handleUnexpectedExit(connectionRef: string, generation: number, handle: CodexRunnerProcessHandle): void {
    const record = this.#records.get(connectionRef);
    if (!record || record.generation !== generation || record.handle !== handle || record.state !== "ready") return;
    record.unsubscribeExit?.();
    delete record.unsubscribeExit;
    delete record.handle;
    delete record.client;
    record.state = "degraded";
    record.failureCode = "process_exited";
    record.capsuleState = "sealed";
    record.updatedAt = this.#timestamp();
    const lease = record.lease;
    delete record.lease;
    if (lease) {
      record.leaseClosing = this.#bestEffort(() => lease.close()).finally(() => {
        delete record.leaseClosing;
      });
    }
    void this.#emit(record, "codex.runner.degraded", "process_exited");
  }

  async #stopRecord(record: RunnerRecord): Promise<void> {
    if (record.capsuleState === "destroyed" || record.state === "stopped") return;
    record.state = "stopping";
    record.updatedAt = this.#timestamp();
    record.unsubscribeExit?.();
    delete record.unsubscribeExit;
    delete record.client;
    const handle = record.handle;
    delete record.handle;
    let outcome = "graceful";
    if (handle) {
      try {
        await withTimeout(handle.stop(), this.#shutdownTimeoutMs);
      } catch {
        outcome = "forced";
        await this.#bestEffort(() => handle.kill());
      }
    }
    if (record.leaseClosing) await record.leaseClosing;
    const lease = record.lease;
    delete record.lease;
    if (lease) await this.#bestEffort(() => lease.close());
    record.capsuleState = "sealed";
    record.state = "stopped";
    delete record.failureCode;
    record.updatedAt = this.#timestamp();
    await this.#emit(record, "codex.runner.stopped", outcome);
  }

  #manifest(record: RunnerRecord): CodexRunnerManifest {
    return {
      runnerRef: record.runnerRef,
      connectionRef: record.connectionRef,
      tenantId: record.tenantId,
      userId: record.userId,
      generation: record.generation,
      ...record.spec,
    };
  }

  #binding(record: RunnerRecord): CodexCapsuleBinding {
    return {
      runnerRef: record.runnerRef,
      connectionRef: record.connectionRef,
      tenantId: record.tenantId,
      userId: record.userId,
      capsuleRef: record.capsuleRef,
      generation: record.generation,
    };
  }

  #owned(scope: UserScope, connectionRef: string): RunnerRecord {
    const record = this.#records.get(connectionRef);
    if (!record || record.tenantId !== scope.tenantId || record.userId !== scope.userId) {
      throw new CodexRunnerNotFoundError();
    }
    return record;
  }

  #assertOwner(record: RunnerRecord, scope: UserScope): void {
    if (record.tenantId !== scope.tenantId || record.userId !== scope.userId) {
      throw new CodexRunnerNotFoundError();
    }
  }

  #snapshot(record: RunnerRecord): CodexRunnerSnapshot {
    return {
      runnerRef: record.runnerRef,
      connectionRef: record.connectionRef,
      tenantId: record.tenantId,
      userId: record.userId,
      capsuleRef: record.capsuleRef,
      state: record.state,
      capsuleState: record.capsuleState,
      generation: record.generation,
      clientVersion: record.clientVersion,
      schemaRevision: record.schemaRevision,
      ...(record.failureCode ? { failureCode: record.failureCode } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  async #emit(record: RunnerRecord, type: CodexRunnerAuditEvent["type"], outcome: string): Promise<void> {
    await this.#audit.append({
      type,
      runnerRef: record.runnerRef,
      connectionRef: record.connectionRef,
      tenantId: record.tenantId,
      userId: record.userId,
      generation: record.generation,
      outcome,
      occurredAt: this.#timestamp(),
    });
  }

  async #bestEffort(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch {
      // Cleanup errors are deliberately redacted and do not replace the lifecycle outcome.
    }
  }

  #exclusive<T>(connectionRef: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#operations.get(connectionRef) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#operations.set(connectionRef, current);
    return current.finally(() => {
      if (this.#operations.get(connectionRef) === current) this.#operations.delete(connectionRef);
    });
  }
}
