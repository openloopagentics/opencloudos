import {
  BROKER_ADAPTER_PROTOCOL_VERSION,
  type AdapterConnectionContext,
  type AdapterConnectionSnapshot,
  type BeginConnectionResult,
  type BillingMode,
  type BrokerDependencies,
  type ConnectionChallenge,
  type ConnectionState,
  type ProviderAdapter,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderMode,
  type ProviderName,
  type UserScope,
} from "./contracts.js";
import {
  AdapterProtocolError,
  ConnectionNotFoundError,
  ConnectionNotReadyError,
  IllegalConnectionTransitionError,
  LoginBindingError,
  RateLimitReachedError,
} from "./errors.js";

type LoginBinding = UserScope & {
  connectionRef: string;
  providerLoginRef: string;
  consumed: boolean;
};

const transitions: Record<ConnectionState, ReadonlySet<ConnectionState>> = {
  disconnected: new Set(["connecting", "revoked"]),
  connecting: new Set(["connecting", "ready", "reauth_required", "blocked_by_policy", "disconnected", "revoked"]),
  ready: new Set(["ready", "reauth_required", "rate_limited", "disconnected", "revoked"]),
  reauth_required: new Set(["reauth_required", "connecting", "ready", "disconnected", "revoked"]),
  rate_limited: new Set(["rate_limited", "ready", "reauth_required", "disconnected", "revoked"]),
  blocked_by_policy: new Set(["blocked_by_policy", "revoked"]),
  revoked: new Set(["revoked"]),
};

function billingMode(mode: ProviderMode): BillingMode {
  if (mode === "subscription") return "personal_subscription";
  if (mode === "api_key") return "explicit_api";
  return "operator_cloud";
}

function normalizeSnapshot(snapshot: AdapterConnectionSnapshot): AdapterConnectionSnapshot {
  return {
    state: snapshot.state,
    ...(snapshot.providerIdentityLabel ? { providerIdentityLabel: snapshot.providerIdentityLabel.slice(0, 160) } : {}),
    ...(snapshot.planLabel ? { planLabel: snapshot.planLabel.slice(0, 80) } : {}),
    ...(snapshot.reauthorizationReason ? { reauthorizationReason: snapshot.reauthorizationReason.slice(0, 240) } : {}),
    ...(snapshot.rateLimit
      ? {
          rateLimit: {
            resetAt: snapshot.rateLimit.resetAt,
            ...(snapshot.rateLimit.label ? { label: snapshot.rateLimit.label.slice(0, 80) } : {}),
          },
        }
      : {}),
  };
}

function normalizeEvent(event: ProviderEvent): ProviderEvent {
  switch (event.type) {
    case "message":
      return { type: "message", text: event.text };
    case "tool_request":
      return { type: "tool_request", tool: event.tool, requestRef: event.requestRef };
    case "usage":
      return {
        type: "usage",
        ...(event.inputTokens === undefined ? {} : { inputTokens: event.inputTokens }),
        ...(event.outputTokens === undefined ? {} : { outputTokens: event.outputTokens }),
      };
    case "rate_limit":
      return {
        type: "rate_limit",
        resetAt: event.resetAt,
        ...(event.label ? { label: event.label.slice(0, 80) } : {}),
      };
    case "completed":
      return { type: "completed", providerSessionRef: event.providerSessionRef };
    case "failed":
      return { type: "failed", code: event.code, retryable: event.retryable };
  }
}

export class ProviderRuntimeBroker {
  readonly #adapters = new Map<ProviderName, ProviderAdapter>();
  readonly #loginBindings = new Map<string, LoginBinding>();
  readonly #dependencies: BrokerDependencies;
  readonly #now: () => Date;
  readonly #createRef: () => string;

  constructor(dependencies: BrokerDependencies) {
    this.#dependencies = dependencies;
    this.#now = dependencies.now ?? (() => new Date());
    this.#createRef = dependencies.createRef ?? (() => crypto.randomUUID());

    for (const adapter of dependencies.adapters) {
      if (adapter.manifest.adapterProtocolVersion !== BROKER_ADAPTER_PROTOCOL_VERSION) {
        throw new AdapterProtocolError(
          `${adapter.manifest.provider} Adapter protocol ${adapter.manifest.adapterProtocolVersion} is incompatible with Broker protocol ${BROKER_ADAPTER_PROTOCOL_VERSION}`,
        );
      }
      if (this.#adapters.has(adapter.manifest.provider)) {
        throw new AdapterProtocolError(`Duplicate Adapter for ${adapter.manifest.provider}`);
      }
      this.#adapters.set(adapter.manifest.provider, adapter);
    }
  }

  async beginConnection(scope: UserScope, provider: ProviderName, mode: ProviderMode): Promise<BeginConnectionResult> {
    const reviewedPolicy = this.#dependencies.policies.read(provider, mode);
    const policy =
      provider === "claude" &&
      mode === "subscription" &&
      reviewedPolicy.disposition === "enabled" &&
      !reviewedPolicy.approvalReference
        ? {
            ...reviewedPolicy,
            disposition: "blocked_by_policy" as const,
            reason: "Claude subscription mode requires a recorded Anthropic approval reference",
          }
        : reviewedPolicy;
    const now = this.#now().toISOString();
    const connectionRef = this.#createRef();
    const adapter = this.#adapters.get(provider);

    if (!adapter) throw new ConnectionNotFoundError();

    const connection: ProviderConnection = {
      connectionRef,
      ...scope,
      provider,
      mode,
      billingMode: provider === "synthetic" ? "synthetic" : billingMode(mode),
      state: policy.disposition === "enabled" ? "connecting" : "blocked_by_policy",
      ...(policy.disposition === "blocked_by_policy" ? { blockedReason: policy.reason } : {}),
      clientName: adapter.manifest.clientName,
      clientVersion: adapter.manifest.clientVersion,
      createdAt: now,
      updatedAt: now,
    };
    await this.#dependencies.connections.put(connection);

    if (policy.disposition === "blocked_by_policy") {
      await this.#audit(scope, connection, "provider.connection.blocked", "blocked_by_policy");
      return { kind: "blocked", connection: structuredClone(connection), reason: policy.reason };
    }

    await this.#audit(scope, connection, "provider.connection.started", "connecting");
    const started = await adapter.beginConnection(this.#context(connection));
    const updated = await this.#applySnapshot(connection, started.snapshot);

    if (started.kind === "connected") {
      await this.#audit(scope, updated, "provider.connection.completed", "ready");
      return { kind: "connected", connection: updated };
    }

    const loginRef = this.#createRef();
    this.#loginBindings.set(loginRef, {
      ...scope,
      connectionRef,
      providerLoginRef: started.providerLoginRef,
      consumed: false,
    });
    const challenge: ConnectionChallenge = {
      ...started.challenge,
      loginRef,
    };
    return { kind: "challenge", connection: updated, challenge };
  }

  async completeConnection(scope: UserScope, connectionRef: string, loginRef: string): Promise<ProviderConnection> {
    const connection = await this.#owned(scope, connectionRef);
    const binding = this.#loginBindings.get(loginRef);
    if (!binding || binding.consumed) throw new LoginBindingError("Login reference is unknown, expired, or already used");
    if (
      binding.connectionRef !== connectionRef ||
      binding.tenantId !== scope.tenantId ||
      binding.userId !== scope.userId
    ) {
      throw new LoginBindingError("Login reference does not belong to this user and connection");
    }

    binding.consumed = true;
    const adapter = this.#adapter(connection.provider);
    const snapshot = await adapter.completeConnection(this.#context(connection), binding.providerLoginRef);
    const updated = await this.#applySnapshot(connection, snapshot);
    await this.#audit(scope, updated, "provider.connection.completed", updated.state);
    return updated;
  }

  async readConnection(scope: UserScope, connectionRef: string): Promise<ProviderConnection> {
    const connection = await this.#owned(scope, connectionRef);
    if (connection.state === "blocked_by_policy" || connection.state === "revoked" || connection.state === "disconnected") {
      return connection;
    }
    const snapshot = await this.#adapter(connection.provider).readConnection(this.#context(connection));
    return this.#applySnapshot(connection, snapshot);
  }

  async listConnections(scope: UserScope): Promise<ProviderConnection[]> {
    return this.#dependencies.connections.list(scope);
  }

  async *beginTurn(
    scope: UserScope,
    connectionRef: string,
    input: { agentSessionRef: string; prompt: string; toolPolicyRef: string },
  ): AsyncIterable<ProviderEvent> {
    const connection = await this.readConnection(scope, connectionRef);
    if (connection.state === "rate_limited") {
      throw new RateLimitReachedError(connection.rateLimit?.resetAt ?? "unknown");
    }
    if (connection.state !== "ready") throw new ConnectionNotReadyError(connection.state);

    const providerSessionRef = this.#createRef();
    await this.#audit(scope, connection, "provider.turn.started", "started");
    let completed = false;
    try {
      for await (const event of this.#adapter(connection.provider).beginTurn(this.#context(connection), {
        providerSessionRef,
        agentSessionRef: input.agentSessionRef,
        prompt: input.prompt,
        toolPolicyRef: input.toolPolicyRef,
      })) {
        const normalized = normalizeEvent(event);
        if (normalized.type === "completed") completed = true;
        yield normalized;
      }
      await this.#audit(scope, connection, completed ? "provider.turn.completed" : "provider.turn.failed", completed ? "completed" : "incomplete");
    } catch (error) {
      await this.#audit(scope, connection, "provider.turn.failed", "adapter_error");
      throw error;
    }
  }

  async cancelTurn(scope: UserScope, connectionRef: string, providerSessionRef: string): Promise<void> {
    const connection = await this.#owned(scope, connectionRef);
    await this.#adapter(connection.provider).cancelTurn(this.#context(connection), providerSessionRef);
  }

  async logout(scope: UserScope, connectionRef: string): Promise<ProviderConnection> {
    const connection = await this.#owned(scope, connectionRef);
    const snapshot = await this.#adapter(connection.provider).logout(this.#context(connection));
    const updated = await this.#applySnapshot(connection, snapshot);
    await this.#audit(scope, updated, "provider.connection.logged_out", updated.state);
    return updated;
  }

  async revoke(scope: UserScope, connectionRef: string): Promise<ProviderConnection> {
    const connection = await this.#owned(scope, connectionRef);
    await this.#adapter(connection.provider).revoke(this.#context(connection));
    const updated = await this.#applySnapshot(connection, { state: "revoked" });
    await this.#audit(scope, updated, "provider.connection.revoked", "revoked");
    return updated;
  }

  #adapter(provider: ProviderName): ProviderAdapter {
    const adapter = this.#adapters.get(provider);
    if (!adapter) throw new ConnectionNotFoundError();
    return adapter;
  }

  #context(connection: ProviderConnection): AdapterConnectionContext {
    return {
      connectionRef: connection.connectionRef,
      tenantId: connection.tenantId,
      userId: connection.userId,
      mode: connection.mode,
    };
  }

  async #owned(scope: UserScope, connectionRef: string): Promise<ProviderConnection> {
    const connection = await this.#dependencies.connections.get(connectionRef);
    if (!connection) throw new ConnectionNotFoundError();
    if (connection.tenantId !== scope.tenantId || connection.userId !== scope.userId) {
      // Deliberately indistinguishable from an unknown reference to prevent enumeration.
      throw new ConnectionNotFoundError();
    }
    return connection;
  }

  async #applySnapshot(connection: ProviderConnection, unsafeSnapshot: AdapterConnectionSnapshot): Promise<ProviderConnection> {
    const snapshot = normalizeSnapshot(unsafeSnapshot);
    if (!transitions[connection.state].has(snapshot.state)) {
      throw new IllegalConnectionTransitionError(connection.state, snapshot.state);
    }
    const updated: ProviderConnection = {
      ...connection,
      state: snapshot.state,
      updatedAt: this.#now().toISOString(),
    };
    delete updated.providerIdentityLabel;
    delete updated.planLabel;
    delete updated.reauthorizationReason;
    delete updated.rateLimit;
    Object.assign(updated, {
      ...(snapshot.providerIdentityLabel ? { providerIdentityLabel: snapshot.providerIdentityLabel } : {}),
      ...(snapshot.planLabel ? { planLabel: snapshot.planLabel } : {}),
      ...(snapshot.reauthorizationReason ? { reauthorizationReason: snapshot.reauthorizationReason } : {}),
      ...(snapshot.rateLimit ? { rateLimit: snapshot.rateLimit } : {}),
    });
    await this.#dependencies.connections.put(updated);
    return structuredClone(updated);
  }

  async #audit(
    scope: UserScope,
    connection: ProviderConnection,
    type: Parameters<BrokerDependencies["audit"]["append"]>[0]["type"],
    outcome: string,
  ): Promise<void> {
    await this.#dependencies.audit.append({
      ...scope,
      type,
      connectionRef: connection.connectionRef,
      provider: connection.provider,
      mode: connection.mode,
      outcome,
      occurredAt: this.#now().toISOString(),
    });
  }
}
