# Codex app-server Authentication Protocol Spike

**Status:** implemented and fixture-tested on 2026-08-05. This is an authentication protocol spike, not production Codex subscription support.

**Inspected client:** `codex-cli 0.146.1`

**Schema revision:** `codex-cli-0.146.1`

**Transport boundary:** app-server stdio JSONL behind an injected Provider Runner transport

**Interface stability:** experimental

## Outcome

OpenCloudOS now has an allowlisting Codex app-server client and a provider-neutral Codex Adapter for the documented managed ChatGPT authentication lifecycle. It proves initialization, account-state sanitation, device-code challenge mapping, rate-limit normalization, login completion, and logout without reading a maintainer's existing account, starting a real login, parsing `auth.json`, or handling raw access and refresh tokens.

The code lives in `packages/provider-runtime-broker`. A minimal protocol fixture captured from the installed CLI's generated schemas lives at `packages/provider-runtime-broker/fixtures/codex-app-server-0.146.1/auth-protocol.json`.

## Protocol evidence

The installed CLI was inspected with:

```text
codex --version
codex app-server --help
codex app-server generate-json-schema --out <temporary-directory>
```

The generated authentication schemas establish these v2 shapes:

| Purpose | Method | OpenCloudOS mapping |
|---|---|---|
| Negotiate one connection | `initialize`, then `initialized` | Fixed client identity; `experimentalApi: false`; response paths are discarded |
| Read login state | `account/read` | Allowlist account type, ChatGPT plan, and `requiresOpenaiAuth`; discard email and unknown fields |
| Start remote-friendly login | `account/login/start` with `chatgptDeviceCode` | Opaque provider login ID, verification URL, and one-time user code |
| Observe completion | `account/login/completed` | Allowlist login ID and success; provider error text never crosses the Adapter |
| Read limits | `account/rateLimits/read` | Normalize reached state, label, and reset timestamp; never change billing mode |
| Sign out | `account/logout` | Return `disconnected`; capsule destruction remains a Provider Runner responsibility |

The Adapter does not use `chatgptAuthTokens`. The inspected schema marks that variant unstable and for OpenAI internal use only. It also rejects API-key or Bedrock account state when the selected Broker mode is `subscription`.

## Security boundary

`CodexAppServerClient` accepts an injected request/notification transport. That abstraction is deliberate: only a user-scoped Provider Runner inside the Credential Capsule may own a real app-server process and its stdio. The Broker, Runtime Host, workspace, Gadgets, tool subprocesses, logs, and database must never receive that transport or app-server's raw responses.

The client copies provider input through explicit field allowlists:

- account email is not returned because the Broker does not need it to authorize or bill a turn;
- unknown response fields are dropped, including fixture token sentinels;
- initialization paths such as `codexHome` are validated only by app-server and not surfaced;
- login failures become a generic reauthorization reason;
- device authorization links must be valid HTTPS URLs before they cross the client boundary;
- rate-limit state carries only a label and reset time;
- no method accepts an access token, refresh token, API key, or credential-cache path.

The fixture uses reserved `.invalid` and `.example` values. It contains no provider credential and CI never reads the current machine's Codex account.

## Executable evidence

| Scenario | Evidence |
|---|---|
| CODEX-001 Version boundary | Captured fixture matches the pinned CLI, schema revision, stdio transport, and experimental status |
| CODEX-002 Handshake and device login | Exactly one initialization precedes account calls; experimental API is disabled; only device-code login is requested |
| CODEX-003 Account sanitation | Email, unknown fields, and token sentinels do not enter the sanitized account state |
| CODEX-004 Plan and limits | ChatGPT plan and provider-reported limit/reset map to provider-neutral state |
| CODEX-005 Completion sanitation | Login outcome is bound by provider login ID; raw provider error and unknown fields do not escape |
| CODEX-006 Logout | Adapter invokes official app-server logout and returns disconnected |
| CODEX-007 Billing separation | API-key state cannot satisfy a subscription connection |
| CODEX-008 Fail-closed execution | Agent turns throw a typed unavailable error until the execution protocol and capsule are implemented |

Run the suite with `npm run test:broker`.

## Deliberately not implemented

This spike does not:

- spawn or supervise `codex app-server`;
- store any provider credential;
- create the encrypted per-user Credential Capsule;
- perform a real ChatGPT login or spend a subscription;
- implement `thread/start`, `turn/start`, streamed turn events, tool requests, interruption, or session resume;
- prove runner restart, credential refresh, local destruction, hostile-tool isolation, or cloud deployment profiles;
- make an experimental Interface a stable release promise.

The device challenge expiry is currently a local 15-minute Broker deadline because the inspected response schema supplies no expiry field. It limits replay inside OpenCloudOS but must not be presented as the provider's actual device-code lifetime.

## Next execution slice

1. **Implemented:** add the bounded stdio JSONL transport, redacted failures, and fail-closed server requests described in [Codex Provider Runner transport](./CODEX_RUNNER_TRANSPORT.md).
2. Build the Provider Runner supervisor around that transport and a pinned app-server artifact.
3. Create one encrypted Credential Capsule per Provider Connection with separate filesystem, environment, process, and transport authority.
4. Implement initialization recovery, process health, crash restart, and capsule deletion.
5. Map Codex thread/turn requests and notifications into the provider-neutral event stream with explicit tool policy.
6. Run two provider-approved test accounts through login, interleaved turns, limits, logout, restart, and revocation.
7. Run hostile-repository tests against files, environment, process inspection, logs, traces, crash dumps, and tool subprocesses.
8. Reinspect generated schemas, update the compatibility matrix, and rerun RUNNER, CODEX, and AUTH suites on every client bump.

Production support remains gated on TB-007, AUTH-001 through AUTH-010 against the real isolated runner, operational runbooks, and independent security review.

## Primary sources

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens)
