import type {
  AdapterBeginConnectionResult,
  AdapterConnectionContext,
  AdapterConnectionSnapshot,
  AdapterManifest,
  ProviderAdapter,
  ProviderEvent,
  ProviderName,
  ProviderTurnRequest,
  RateLimitSnapshot,
} from "./contracts.js";

type SyntheticState = {
  state: AdapterConnectionSnapshot["state"];
  rateLimit?: RateLimitSnapshot;
};

export class SyntheticProviderAdapter implements ProviderAdapter {
  readonly manifest: AdapterManifest;
  readonly #credentials = new Map<string, string>();
  readonly #logins = new Map<string, string>();
  readonly #states = new Map<string, SyntheticState>();
  #sequence = 0;
  beginConnectionCalls = 0;

  constructor(
    provider: ProviderName = "synthetic",
    options: { adapterProtocolVersion?: number; clientVersion?: string } = {},
  ) {
    this.manifest = {
      provider,
      adapterProtocolVersion: options.adapterProtocolVersion ?? 1,
      clientName: `synthetic-${provider}-client`,
      clientVersion: options.clientVersion ?? "1.0.0-test",
    };
  }

  async beginConnection(context: AdapterConnectionContext): Promise<AdapterBeginConnectionResult> {
    this.beginConnectionCalls += 1;
    const providerLoginRef = `provider-login-${++this.#sequence}`;
    this.#logins.set(providerLoginRef, context.connectionRef);
    this.#states.set(context.connectionRef, { state: "connecting" });
    return {
      kind: "challenge",
      providerLoginRef,
      challenge: {
        kind: "device_code",
        verificationUri: "https://provider.invalid/device",
        userCode: `TEST-${this.#sequence}`,
        expiresAt: "2030-01-01T00:05:00.000Z",
      },
      snapshot: { state: "connecting" },
    };
  }

  async completeConnection(
    context: AdapterConnectionContext,
    providerLoginRef: string,
  ): Promise<AdapterConnectionSnapshot> {
    if (this.#logins.get(providerLoginRef) !== context.connectionRef) {
      return { state: "reauth_required", reauthorizationReason: "Synthetic login binding mismatch" };
    }
    this.#logins.delete(providerLoginRef);
    this.#credentials.set(context.connectionRef, `synthetic-secret:${context.connectionRef}`);
    this.#states.set(context.connectionRef, { state: "ready" });
    return {
      state: "ready",
      providerIdentityLabel: `test-user-${context.userId}`,
      planLabel: "Synthetic plan",
    };
  }

  async readConnection(context: AdapterConnectionContext): Promise<AdapterConnectionSnapshot> {
    const state = this.#states.get(context.connectionRef);
    if (!state || !this.#credentials.has(context.connectionRef)) {
      return { state: "reauth_required", reauthorizationReason: "Credential capsule must be reauthorized" };
    }
    if (state.state === "rate_limited") {
      return { state: "rate_limited", rateLimit: state.rateLimit };
    }
    return {
      state: state.state,
      providerIdentityLabel: `test-user-${context.userId}`,
      planLabel: "Synthetic plan",
    };
  }

  async *beginTurn(
    context: AdapterConnectionContext,
    request: ProviderTurnRequest,
  ): AsyncIterable<ProviderEvent> {
    if (!this.#credentials.has(context.connectionRef)) {
      yield { type: "failed", code: "reauth_required", retryable: false };
      return;
    }
    yield { type: "message", text: `Synthetic response for ${request.agentSessionRef}` };
    yield { type: "usage", inputTokens: request.prompt.length, outputTokens: 4 };
    yield { type: "completed", providerSessionRef: request.providerSessionRef };
  }

  async cancelTurn(_context: AdapterConnectionContext, _providerSessionRef: string): Promise<void> {}

  async logout(context: AdapterConnectionContext): Promise<AdapterConnectionSnapshot> {
    this.#credentials.delete(context.connectionRef);
    this.#states.set(context.connectionRef, { state: "disconnected" });
    return { state: "disconnected" };
  }

  async revoke(context: AdapterConnectionContext): Promise<void> {
    this.#credentials.delete(context.connectionRef);
    this.#states.set(context.connectionRef, { state: "revoked" });
  }

  setRateLimited(connectionRef: string, resetAt: string): void {
    this.#states.set(connectionRef, { state: "rate_limited", rateLimit: { resetAt, label: "Synthetic limit" } });
  }

  clearRateLimit(connectionRef: string): void {
    this.#states.set(connectionRef, { state: "ready" });
  }

  expireCredential(connectionRef: string): void {
    this.#credentials.delete(connectionRef);
    this.#states.set(connectionRef, { state: "reauth_required" });
  }

  restartRunner(_connectionRef: string): void {
    // A synthetic runner restart intentionally preserves capsule-owned credentials.
  }

  hasCredential(connectionRef: string): boolean {
    return this.#credentials.has(connectionRef);
  }
}
