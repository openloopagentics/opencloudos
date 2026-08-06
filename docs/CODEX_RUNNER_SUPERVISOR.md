# Codex Provider Runner Supervisor

**Implementation status:** lifecycle contract implemented against injected synthetic runtime and Credential Capsule drivers. It does not spawn `codex app-server`, create encrypted storage, use a provider account, or prove process isolation. The next slice must implement the local runtime and capsule drivers behind this contract.

## Purpose

The supervisor binds one pinned Codex app-server generation and one opaque Credential Capsule reference to one user-owned Provider Connection. It is the only component allowed to hold the app-server process handle, capsule lease, raw transport, or initialized `CodexAppServerClient`.

The contract solves five problems before any cloud implementation exists:

1. ownership checks do not depend on knowing whether a runner reference exists;
2. credentials cannot enter a process manifest as a token, environment map, or filesystem path;
3. a runner is not ready until the pinned app-server completes `initialize` and the host sends `initialized`;
4. a crashed process cannot mutate a replacement generation;
5. stop, recovery, and credential destruction have distinct, testable meanings.

The app-server Interface is experimental. This supervisor therefore admits only the `codex-cli 0.146.1` client and `codex-cli-0.146.1` schema revision already captured by the authentication spike. The supervisor receives one trusted release SHA-256 digest at construction and rejects any launch manifest that does not match it. The runtime driver must still verify the executable bytes before launch.

## Boundary

```text
Provider Runtime Broker
        |
        | tenant + user + Provider Connection + opaque policy refs
        v
CodexRunnerSupervisor
        |                         |
        | safe launch manifest    | opaque capsule binding
        v                         v
RuntimeDriver                CredentialCapsuleDriver
        |                         |
        | private process handle  | private lease
        +------------+------------+
                     |
              codex app-server
                 local stdio
```

The public snapshot contains only tenant and user ownership, runner/connection/capsule references, lifecycle state, generation, pinned client/schema revisions, sanitized failure code, and timestamps. It never contains the executable digest, workspace path, transport, process handle, capsule lease, credential path, environment, stdout/stderr, or provider-controlled error.

The runtime driver receives:

- owner and connection references;
- runner generation;
- opaque capsule, workspace, sandbox, egress, and resource-policy references;
- exact client and schema revisions;
- executable SHA-256 digest;
- an abort signal for startup cancellation.

The capsule driver receives an opaque owner/runner/connection/generation binding plus an abort signal. It does not return a credential path. Its lease can only be closed; destruction is a separate irreversible operation.

Runtime validation rejects unknown fields. Even a caller that bypasses TypeScript and supplies `env`, `token`, or another extra property fails before either driver runs.

## Lifecycle

Runner and capsule state are separate:

```text
runner:  starting -> ready -> stopping -> stopped
             |        |
             v        v
           failed   degraded
             |        |
             +-- explicit recover --+ -> starting (generation + 1)

capsule: sealed -> mounted -> sealed -> destroyed
                                      (irreversible)
```

### Start

1. Validate the exact manifest shape, client/schema pin, digest, and opaque references.
2. Serialize lifecycle work by Provider Connection.
3. Create generation 1 and write a secret-free `starting` audit event.
4. Open the capsule through its driver.
5. Start the runtime through its driver.
6. register the generation-fenced exit callback before initialization;
7. initialize the allowlisting app-server client;
8. expose the client only after `initialize` and `initialized` complete;
9. move to `ready` and emit a secret-free audit event.

Concurrent identical starts converge on one process. A second manifest for an already-bound connection is rejected. Starting a stopped, failed, or degraded record is also rejected; callers must use explicit recovery so the generation change is visible.

### Crash and recovery

An unexpected exit removes the client and private handle, closes the capsule lease, moves the record to `degraded`, and exposes only `process_exited`. Exit code, signal, stderr, and provider-controlled text do not enter the snapshot or audit record.

Recovery is explicit. It waits for any prior capsule close, increments the generation, reopens the same opaque capsule binding, starts the same pinned manifest, and completes initialization again. Every exit callback captures its generation and process-handle identity. A late callback from generation N is ignored after generation N+1 becomes current.

There is no automatic restart loop in this slice. Backoff, retry budgets, orphan reconciliation, and durable supervisor metadata belong to the runtime-driver implementation and must preserve the same generation fence.

### Stop and destroy

Stop first removes client access, then requests graceful process shutdown. If the shutdown deadline expires, the supervisor requests a forced kill. It closes the capsule lease and leaves the capsule `sealed`, allowing an explicit recovery later.

Destroy first applies stop semantics, then calls the capsule driver's irreversible destroy operation. The record remains as sanitized tombstone metadata with capsule state `destroyed`. It cannot be recovered and cannot expose a client. Provider-side logout or revocation remains a separate Adapter responsibility.

### Deadlines and failures

Capsule open, runtime start, app-server initialization, and graceful stop are bounded. Capsule and runtime drivers receive an abort signal so work that has not returned a handle can cancel on expiry. If an initialized process handle exists when startup fails or expires, the supervisor kills it and closes the lease.

Public startup failures are restricted to `runner_start_failed` or `runner_startup_timeout`; persisted failure codes are `startup_failed` or `startup_timeout`. Driver errors are never forwarded.

## Multi-cloud implementation seam

The supervisor contains no Kubernetes, AWS, GCP, Azure, container, or local-process SDK. Deployment profiles provide two narrow drivers:

| Driver | Local development | Kubernetes / cloud profile |
|---|---|---|
| Runtime | Spawn a pinned local executable with dedicated uid, namespaces, limits, and local stdio | Create or attach one isolated Provider Runner workload with workload identity, policy, limits, and authenticated local transport |
| Capsule | Encrypted per-connection directory or OS credential facility mounted only into that runner | Encrypted per-connection volume or provider secret facility mounted only into that workload |

Every driver must honor abort, prove handle/lease cleanup, preserve opaque references, avoid placing provider credentials in process environment, and implement idempotent cleanup. Cloud-specific resource identity must not become part of the Broker Interface.

## Executable conformance

The synthetic suite contains no real provider credential or process:

| Scenario | Required evidence |
|---|---|
| SUPERVISOR-001 Hidden ownership | Unknown and cross-user references return the same public error; only the owner can read, use, stop, recover, or destroy |
| SUPERVISOR-002 Manifest boundary | Client/schema drift, malformed or nonmatching release digests, and extra token/environment fields fail before capsule or runtime code runs |
| SUPERVISOR-003 Readiness and sanitation | One capsule open plus one app-server initialization precede readiness; public metadata exposes no private runtime field |
| SUPERVISOR-004 Concurrency and binding | Concurrent identical starts create one generation; a connection cannot be rebound to another capsule or manifest |
| SUPERVISOR-005 Crash fencing | Crash removes client access; recovery increments generation; stale exit callbacks cannot degrade the replacement |
| SUPERVISOR-006 Stop and destruction | Stop preserves a sealed capsule; destruction is idempotent, irreversible, and blocks recovery |
| SUPERVISOR-007 Startup deadline | Hung initialization kills the process, closes the lease, seals the capsule, and publishes only a generic failure |
| SUPERVISOR-008 Shutdown deadline | Hung graceful shutdown forces kill, closes the lease, and records a sanitized forced outcome |

Additional coverage proves a process exit during initialization fails startup rather than publishing a dead runner as ready.

Run these scenarios with `npm run test:broker`.

## Remaining production gates

- implement a local runtime driver that actually launches the pinned `codex app-server --listen stdio://` process;
- adapt the Deployment Profile `workload_runtime` and `credential_capsule` capabilities to schedule and attach the isolated Provider Runner envelope;
- implement encrypted per-connection capsule storage that cannot be read by workspace or tool processes;
- persist supervisor metadata and reconcile orphan processes and mounts after host restart;
- enforce dedicated uid/container boundaries, filesystem mounts, default-deny egress, resource limits, and crash-dump controls;
- bind the existing bounded JSONL transport to real child-process streams;
- implement logout/destruction ordering with clear provider-side revocation status;
- map app-server thread/turn events and route every command, file, permission, and MCP request through the Capability Broker;
- run AUTH-001 through AUTH-010 plus malicious-repository isolation tests on local, Kubernetes, AWS, GCP, Azure, and self-hosted profiles;
- use only provider-approved test accounts and obtain independent security review.

## Primary source

- [OpenAI Codex app-server](https://learn.chatgpt.com/docs/app-server) — experimental host Interface, stdio transport, initialization, bidirectional requests, threads, turns, interruption, and authentication methods.
- [Codex authentication](https://learn.chatgpt.com/docs/auth) — official ChatGPT login, device-code flow, credential persistence, logout, and authentication modes.

Related records: [subscription-backed providers](./SUBSCRIPTION_AUTH.md), [Codex auth spike](./CODEX_ADAPTER_SPIKE.md), [stdio transport](./CODEX_RUNNER_TRANSPORT.md), [ADR-0008](./adr/0008-provider-owned-subscription-auth.md), [ADR-0009](./adr/0009-use-local-stdio-and-reject-unbound-provider-requests.md), and [ADR-0010](./adr/0010-bind-runner-generation-and-capsule-to-provider-connection.md).
