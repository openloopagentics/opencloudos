import assert from "node:assert/strict";
import test from "node:test";
import {
  AdapterProtocolError,
  ConnectionNotFoundError,
  ConnectionNotReadyError,
  InMemoryBrokerAuditSink,
  InMemoryProviderConnectionStore,
  LoginBindingError,
  ProviderRuntimeBroker,
  RateLimitReachedError,
  StaticProviderPolicyRegistry,
  SyntheticProviderAdapter,
  type BeginConnectionResult,
  type ProviderAdapter,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderPolicyDecision,
  type UserScope,
} from "../src/index.js";

const alice: UserScope = { tenantId: "tenant-a", userId: "alice" };
const bob: UserScope = { tenantId: "tenant-a", userId: "bob" };

function enabledSyntheticPolicy(): ProviderPolicyDecision {
  return {
    provider: "synthetic",
    mode: "subscription",
    disposition: "enabled",
    reason: "Synthetic conformance mode",
    reviewedAt: "2026-08-05",
  };
}

function harness(options: {
  adapters?: ProviderAdapter[];
  policies?: ProviderPolicyDecision[];
  store?: InMemoryProviderConnectionStore;
} = {}) {
  let sequence = 0;
  const adapter = new SyntheticProviderAdapter();
  const audit = new InMemoryBrokerAuditSink();
  const store = options.store ?? new InMemoryProviderConnectionStore();
  const broker = new ProviderRuntimeBroker({
    adapters: options.adapters ?? [adapter],
    policies: new StaticProviderPolicyRegistry(options.policies ?? [enabledSyntheticPolicy()]),
    connections: store,
    audit,
    now: () => new Date("2026-08-05T12:00:00.000Z"),
    createRef: () => `ref-${++sequence}`,
  });
  return { adapter, audit, broker, store };
}

function challenge(result: BeginConnectionResult) {
  assert.equal(result.kind, "challenge");
  return result;
}

async function connect(
  broker: ProviderRuntimeBroker,
  scope: UserScope,
): Promise<ProviderConnection> {
  const started = challenge(await broker.beginConnection(scope, "synthetic", "subscription"));
  return broker.completeConnection(scope, started.connection.connectionRef, started.challenge.loginRef);
}

async function collect(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const collected: ProviderEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

test("AUTH-001: Provider Connections are enumerable and usable only by their owner", async () => {
  const { broker } = harness();
  const aliceConnection = await connect(broker, alice);
  const bobConnection = await connect(broker, bob);

  assert.deepEqual((await broker.listConnections(alice)).map((item) => item.connectionRef), [aliceConnection.connectionRef]);
  assert.deepEqual((await broker.listConnections(bob)).map((item) => item.connectionRef), [bobConnection.connectionRef]);
  await assert.rejects(() => broker.readConnection(bob, aliceConnection.connectionRef), ConnectionNotFoundError);
});

test("AUTH-002: public results, events, and audit records contain no credential material", async () => {
  const { audit, broker } = harness();
  const connection = await connect(broker, alice);
  const events = await collect(broker.beginTurn(alice, connection.connectionRef, {
    agentSessionRef: "agent-session-a",
    prompt: "Summarize the repository",
    toolPolicyRef: "read-only",
  }));
  const observable = JSON.stringify({ connection, events, audit: audit.events() });

  assert.equal(observable.includes("synthetic-secret"), false);
  assert.equal(observable.includes("accessToken"), false);
  assert.equal(observable.includes("refreshToken"), false);
  assert.equal(JSON.stringify(audit.events()).includes("Summarize the repository"), false, "audit must not record prompt text");
});

test("AUTH-003: login references are bound to user, connection, and one completion", async () => {
  const { broker } = harness();
  const first = challenge(await broker.beginConnection(alice, "synthetic", "subscription"));
  const second = challenge(await broker.beginConnection(alice, "synthetic", "subscription"));

  await assert.rejects(
    () => broker.completeConnection(alice, first.connection.connectionRef, second.challenge.loginRef),
    LoginBindingError,
  );
  await broker.completeConnection(alice, first.connection.connectionRef, first.challenge.loginRef);
  await assert.rejects(
    () => broker.completeConnection(alice, first.connection.connectionRef, first.challenge.loginRef),
    LoginBindingError,
  );
  await assert.rejects(
    () => broker.completeConnection(bob, second.connection.connectionRef, second.challenge.loginRef),
    ConnectionNotFoundError,
  );
});

test("AUTH-004: runner restart preserves capsule state and credential expiry requires reauthorization", async () => {
  const { adapter, broker } = harness();
  const connection = await connect(broker, alice);

  adapter.restartRunner(connection.connectionRef);
  assert.equal((await broker.readConnection(alice, connection.connectionRef)).state, "ready");

  adapter.expireCredential(connection.connectionRef);
  const expired = await broker.readConnection(alice, connection.connectionRef);
  assert.equal(expired.state, "reauth_required");
  assert.match(expired.reauthorizationReason ?? "", /reauthorized/i);
});

test("AUTH-005: logout and revocation destroy local authority and stop new turns", async () => {
  const { adapter, broker } = harness();
  const loggedOutConnection = await connect(broker, alice);
  const loggedOut = await broker.logout(alice, loggedOutConnection.connectionRef);
  assert.equal(loggedOut.state, "disconnected");
  assert.equal(adapter.hasCredential(loggedOutConnection.connectionRef), false);
  await assert.rejects(
    () => collect(broker.beginTurn(alice, loggedOutConnection.connectionRef, {
      agentSessionRef: "agent-session-a",
      prompt: "Continue",
      toolPolicyRef: "read-only",
    })),
    ConnectionNotReadyError,
  );

  const revokedConnection = await connect(broker, alice);
  const revoked = await broker.revoke(alice, revokedConnection.connectionRef);
  assert.equal(revoked.state, "revoked");
  assert.equal(adapter.hasCredential(revokedConnection.connectionRef), false);
});

test("AUTH-006: a collaborator turn uses their connection and cannot inherit the prior user's", async () => {
  const { broker } = harness();
  const aliceConnection = await connect(broker, alice);
  const bobConnection = await connect(broker, bob);

  await assert.rejects(
    () => collect(broker.beginTurn(bob, aliceConnection.connectionRef, {
      agentSessionRef: "shared-session",
      prompt: "Continue Alice's work",
      toolPolicyRef: "read-only",
    })),
    ConnectionNotFoundError,
  );
  const events = await collect(broker.beginTurn(bob, bobConnection.connectionRef, {
    agentSessionRef: "shared-session",
    prompt: "Continue with Bob's subscription",
    toolPolicyRef: "read-only",
  }));
  assert.equal(events.at(-1)?.type, "completed");
});

test("AUTH-007: provider limits pause only the selected connection without changing billing mode", async () => {
  const { adapter, broker } = harness();
  const connection = await connect(broker, alice);
  const resetAt = "2026-08-05T13:00:00.000Z";
  adapter.setRateLimited(connection.connectionRef, resetAt);

  await assert.rejects(
    () => collect(broker.beginTurn(alice, connection.connectionRef, {
      agentSessionRef: "agent-session-a",
      prompt: "Continue",
      toolPolicyRef: "read-only",
    })),
    (error: unknown) => error instanceof RateLimitReachedError && error.resetAt === resetAt,
  );
  const limited = await broker.readConnection(alice, connection.connectionRef);
  assert.equal(limited.billingMode, "synthetic");
  assert.equal(limited.state, "rate_limited");

  adapter.clearRateLimit(connection.connectionRef);
  assert.equal((await broker.readConnection(alice, connection.connectionRef)).state, "ready");
});

test("AUTH-008: provider policy blocks Claude subscription mode before Adapter login", async () => {
  const claude = new SyntheticProviderAdapter("claude");
  const blockedPolicy: ProviderPolicyDecision = {
    provider: "claude",
    mode: "subscription",
    disposition: "enabled",
    reason: "Operator attempted to enable the Adapter",
    reviewedAt: "2026-08-05",
  };
  const { broker } = harness({ adapters: [claude], policies: [blockedPolicy] });

  const result = await broker.beginConnection(alice, "claude", "subscription");
  assert.equal(result.kind, "blocked");
  assert.equal(result.connection.state, "blocked_by_policy");
  assert.match(result.reason, /Anthropic approval reference/);
  assert.equal(claude.beginConnectionCalls, 0);
});

test("AUTH-009: restored product metadata cannot reconstruct missing capsule credentials", async () => {
  const first = harness();
  const connection = await connect(first.broker, alice);
  assert.equal(first.adapter.hasCredential(connection.connectionRef), true);

  const replacementAdapter = new SyntheticProviderAdapter();
  const restored = harness({ adapters: [replacementAdapter], store: first.store });
  const status = await restored.broker.readConnection(alice, connection.connectionRef);
  assert.equal(status.state, "reauth_required");
  assert.equal(replacementAdapter.hasCredential(connection.connectionRef), false);
});

test("AUTH-010: incompatible Adapter protocol versions fail at Broker construction", () => {
  const incompatible = new SyntheticProviderAdapter("synthetic", { adapterProtocolVersion: 2, clientVersion: "2.0.0-test" });
  assert.throws(() => harness({ adapters: [incompatible] }), AdapterProtocolError);
});
