import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CODEX_APP_SERVER_CLIENT_VERSION,
  CODEX_APP_SERVER_SCHEMA_REVISION,
  CodexAppServerClient,
  CodexAppServerProtocolError,
  CodexProviderAdapter,
  CodexTurnProtocolUnavailableError,
  InMemoryBrokerAuditSink,
  InMemoryProviderConnectionStore,
  ProviderRuntimeBroker,
  StaticProviderPolicyRegistry,
  type AdapterConnectionContext,
  type CodexAppServerNotification,
  type CodexAppServerTransport,
  type ProviderEvent,
} from "../src/index.js";

type Fixture = {
  metadata: {
    cliVersion: string;
    schemaRevision: string;
    generatedWith: string;
    transport: string;
    interfaceStatus: string;
  };
  initialize: unknown;
  loggedOutAccount: unknown;
  chatgptAccount: unknown;
  apiKeyAccount: unknown;
  deviceLogin: unknown;
  healthyRateLimits: unknown;
  reachedRateLimits: unknown;
  logout: unknown;
};

const fixture = JSON.parse(
  fs.readFileSync(
    "packages/provider-runtime-broker/fixtures/codex-app-server-0.146.1/auth-protocol.json",
    "utf8",
  ),
) as Fixture;

type RecordedCall = { kind: "request" | "notify"; method: string; params?: unknown };

class FixtureTransport implements CodexAppServerTransport {
  readonly calls: RecordedCall[] = [];
  readonly #responses = new Map<string, unknown[]>();
  readonly #handlers = new Set<(notification: CodexAppServerNotification) => void>();

  queue(method: string, ...responses: unknown[]): this {
    this.#responses.set(method, [...(this.#responses.get(method) ?? []), ...responses]);
    return this;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ kind: "request", method, ...(params === undefined ? {} : { params }) });
    const responses = this.#responses.get(method);
    if (!responses?.length) throw new Error(`No fixture response queued for ${method}`);
    return structuredClone(responses.shift());
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.calls.push({ kind: "notify", method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(handler: (notification: CodexAppServerNotification) => void): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  emit(notification: CodexAppServerNotification): void {
    for (const handler of this.#handlers) handler(structuredClone(notification));
  }
}

const context: AdapterConnectionContext = {
  tenantId: "tenant-a",
  userId: "alice",
  connectionRef: "connection-a",
  mode: "subscription",
};

function client(transport: FixtureTransport): CodexAppServerClient {
  transport.queue("initialize", fixture.initialize);
  return new CodexAppServerClient(transport, { clientVersion: "0.1.0-test" });
}

async function collect(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const result: ProviderEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

test("CODEX-001: the captured auth fixture pins the inspected CLI and experimental stdio Interface", () => {
  assert.equal(fixture.metadata.cliVersion, CODEX_APP_SERVER_CLIENT_VERSION);
  assert.equal(fixture.metadata.schemaRevision, CODEX_APP_SERVER_SCHEMA_REVISION);
  assert.equal(fixture.metadata.generatedWith, "codex app-server generate-json-schema");
  assert.equal(fixture.metadata.transport, "stdio JSONL");
  assert.equal(fixture.metadata.interfaceStatus, "experimental");
});

test("CODEX-002: device login performs one non-experimental initialization before account methods", async () => {
  const transport = new FixtureTransport()
    .queue("account/read", fixture.loggedOutAccount)
    .queue("account/login/start", fixture.deviceLogin);
  const adapter = new CodexProviderAdapter(() => client(transport), {
    now: () => new Date("2026-08-05T12:00:00.000Z"),
  });

  const started = await adapter.beginConnection(context);
  assert.equal(started.kind, "challenge");
  assert.equal(started.providerLoginRef, "codex-login-fixture-1");
  assert.deepEqual(started.challenge, {
    kind: "device_code",
    verificationUri: "https://auth.openai.example/device",
    userCode: "OPEN-CLOUD",
    expiresAt: "2026-08-05T12:15:00.000Z",
  });
  assert.deepEqual(transport.calls.map(({ kind, method }) => `${kind}:${method}`), [
    "request:initialize",
    "notify:initialized",
    "request:account/read",
    "request:account/login/start",
  ]);
  assert.deepEqual(transport.calls[0]?.params, {
    clientInfo: {
      name: "opencloudos-provider-runner",
      title: "OpenCloudOS Provider Runner",
      version: "0.1.0-test",
    },
    capabilities: { experimentalApi: false },
  });
  assert.deepEqual(transport.calls[3]?.params, { type: "chatgptDeviceCode" });
});

test("CODEX-003: raw account fields are allowlisted and identity is deliberately non-identifying", async () => {
  const transport = new FixtureTransport().queue("account/read", fixture.chatgptAccount);
  const state = await client(transport).readAccount();
  const observable = JSON.stringify(state);

  assert.deepEqual(state, {
    requiresOpenaiAuth: true,
    account: { type: "chatgpt", planType: "plus" },
  });
  assert.equal(observable.includes("never-expose@example.invalid"), false);
  assert.equal(observable.includes("fixture-token-must-not-escape"), false);
});

test("CODEX-004: a completed ChatGPT login maps plan and provider limits without changing billing mode", async () => {
  const transport = new FixtureTransport()
    .queue("account/read", fixture.loggedOutAccount, fixture.chatgptAccount)
    .queue("account/login/start", fixture.deviceLogin)
    .queue("account/rateLimits/read", fixture.reachedRateLimits);
  const adapter = new CodexProviderAdapter(() => client(transport));
  const started = await adapter.beginConnection(context);
  assert.equal(started.kind, "challenge");

  const completed = await adapter.completeConnection(context, started.providerLoginRef);
  assert.deepEqual(completed, {
    state: "rate_limited",
    providerIdentityLabel: "ChatGPT account",
    planLabel: "ChatGPT Plus",
    rateLimit: {
      resetAt: "2026-08-05T18:00:00.000Z",
      label: "Codex five-hour limit",
    },
  });
});

test("CODEX-005: login completion notifications retain only binding and outcome fields", async () => {
  const transport = new FixtureTransport()
    .queue("account/read", fixture.loggedOutAccount)
    .queue("account/login/start", fixture.deviceLogin);
  const adapter = new CodexProviderAdapter(() => client(transport));
  const started = await adapter.beginConnection(context);
  assert.equal(started.kind, "challenge");

  transport.emit({
    method: "account/login/completed",
    params: {
      loginId: started.providerLoginRef,
      success: false,
      error: "fixture provider error",
      syntheticRefreshToken: "must-not-escape",
    },
  });
  const completed = await adapter.completeConnection(context, started.providerLoginRef);
  assert.deepEqual(completed, {
    state: "reauth_required",
    reauthorizationReason: "Codex device login failed",
  });
  assert.equal(JSON.stringify(completed).includes("fixture provider error"), false);
  assert.equal(JSON.stringify(completed).includes("must-not-escape"), false);
});

test("CODEX-006: logout calls the official app-server method and returns disconnected", async () => {
  const transport = new FixtureTransport().queue("account/logout", fixture.logout);
  const adapter = new CodexProviderAdapter(() => client(transport));

  assert.deepEqual(await adapter.logout(context), { state: "disconnected" });
  assert.deepEqual(transport.calls.map(({ kind, method }) => `${kind}:${method}`), [
    "request:initialize",
    "notify:initialized",
    "request:account/logout",
  ]);
});

test("CODEX-007: a subscription connection never accepts API-key account state", async () => {
  const transport = new FixtureTransport().queue("account/read", fixture.apiKeyAccount);
  const adapter = new CodexProviderAdapter(() => client(transport));

  const result = await adapter.beginConnection(context);
  assert.equal(result.kind, "connected");
  assert.deepEqual(result.snapshot, {
    state: "reauth_required",
    reauthorizationReason: "Codex is authenticated with a non-subscription billing mode",
  });
});

test("CODEX-008: turn execution remains fail-closed until the runner protocol is implemented", async () => {
  const adapter = new CodexProviderAdapter(() => {
    throw new Error("turn spike must not create an auth transport");
  });
  await assert.rejects(
    () => collect(adapter.beginTurn(context, {
      providerSessionRef: "provider-session-a",
      agentSessionRef: "agent-session-a",
      prompt: "Do not execute",
      toolPolicyRef: "read-only",
    })),
    CodexTurnProtocolUnavailableError,
  );
});

test("Codex app-server rejects malformed or unexpected device-login variants", async () => {
  const transport = new FixtureTransport().queue("account/login/start", {
    type: "chatgptAuthTokens",
  });
  await assert.rejects(() => client(transport).startDeviceLogin(), CodexAppServerProtocolError);
});

test("Codex app-server rejects a non-HTTPS device authorization URL", async () => {
  const transport = new FixtureTransport().queue("account/login/start", {
    ...fixture.deviceLogin as object,
    verificationUrl: "javascript:alert('fixture')",
  });
  await assert.rejects(() => client(transport).startDeviceLogin(), CodexAppServerProtocolError);
});

test("the Broker preserves personal-subscription billing when an existing Codex login is limited", async () => {
  const transport = new FixtureTransport()
    .queue("account/read", fixture.chatgptAccount)
    .queue("account/rateLimits/read", fixture.reachedRateLimits);
  const adapter = new CodexProviderAdapter(() => client(transport));
  const broker = new ProviderRuntimeBroker({
    adapters: [adapter],
    policies: new StaticProviderPolicyRegistry([{
      provider: "codex",
      mode: "subscription",
      disposition: "enabled",
      reason: "Fixture-only Codex auth spike",
      reviewedAt: "2026-08-05",
    }]),
    connections: new InMemoryProviderConnectionStore(),
    audit: new InMemoryBrokerAuditSink(),
    now: () => new Date("2026-08-05T12:00:00.000Z"),
    createRef: () => "connection-a",
  });

  const result = await broker.beginConnection(
    { tenantId: context.tenantId, userId: context.userId },
    "codex",
    "subscription",
  );
  assert.equal(result.kind, "connected");
  assert.equal(result.connection.state, "rate_limited");
  assert.equal(result.connection.billingMode, "personal_subscription");
});
