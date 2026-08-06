import {
  BROKER_ADAPTER_PROTOCOL_VERSION,
  type AdapterBeginConnectionResult,
  type AdapterConnectionContext,
  type AdapterConnectionSnapshot,
  type AdapterManifest,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderTurnRequest,
  type RateLimitSnapshot,
} from "./contracts.js";
import {
  CODEX_APP_SERVER_CLIENT_VERSION,
  CodexAppServerClient,
  type CodexAccountState,
  type CodexLoginCompleted,
  type CodexRateLimitState,
} from "./codex-app-server-client.js";
import {
  CodexAppServerProtocolError,
  CodexTurnProtocolUnavailableError,
} from "./errors.js";

export type CodexAppServerClientFactory = (context: AdapterConnectionContext) => CodexAppServerClient;

function planLabel(planType: string): string {
  const labels: Record<string, string> = {
    free: "ChatGPT Free",
    go: "ChatGPT Go",
    plus: "ChatGPT Plus",
    pro: "ChatGPT Pro",
    prolite: "ChatGPT Pro Lite",
    team: "ChatGPT Team",
    self_serve_business_usage_based: "ChatGPT Business (usage based)",
    business: "ChatGPT Business",
    ent26: "ChatGPT Enterprise",
    enterprise_cbp_usage_based: "ChatGPT Enterprise (usage based)",
    enterprise: "ChatGPT Enterprise",
    edu: "ChatGPT Edu",
    unknown: "ChatGPT plan unknown",
  };
  return labels[planType] ?? "ChatGPT plan unknown";
}

function resetAt(rateLimits: CodexRateLimitState): string {
  const unixSeconds = rateLimits.primary?.resetsAt ?? rateLimits.secondary?.resetsAt;
  return unixSeconds === undefined ? "unknown" : new Date(unixSeconds * 1000).toISOString();
}

function rateLimitSnapshot(rateLimits: CodexRateLimitState): RateLimitSnapshot | undefined {
  if (!rateLimits.rateLimitReachedType && rateLimits.spendControlReached !== true) return undefined;
  return {
    resetAt: resetAt(rateLimits),
    label: rateLimits.limitName ?? rateLimits.rateLimitReachedType ?? "Codex limit reached",
  };
}

/**
 * Authentication-only Codex Adapter spike. It intentionally does not implement
 * thread/turn execution until the Provider Runner and Credential Capsule exist.
 */
export class CodexProviderAdapter implements ProviderAdapter {
  readonly manifest: AdapterManifest = {
    provider: "codex",
    adapterProtocolVersion: BROKER_ADAPTER_PROTOCOL_VERSION,
    clientName: "codex-app-server",
    clientVersion: CODEX_APP_SERVER_CLIENT_VERSION,
  };

  readonly #factory: CodexAppServerClientFactory;
  readonly #clients = new Map<string, CodexAppServerClient>();
  readonly #pendingLogins = new Map<string, string>();
  readonly #loginOutcomes = new Map<string, CodexLoginCompleted>();
  readonly #challengeTtlMs: number;
  readonly #now: () => Date;

  constructor(
    factory: CodexAppServerClientFactory,
    options: { challengeTtlMs?: number; now?: () => Date } = {},
  ) {
    this.#factory = factory;
    this.#challengeTtlMs = options.challengeTtlMs ?? 15 * 60 * 1000;
    this.#now = options.now ?? (() => new Date());
  }

  async beginConnection(context: AdapterConnectionContext): Promise<AdapterBeginConnectionResult> {
    this.#assertSubscription(context);
    const client = this.#client(context);
    const account = await client.readAccount(false);
    if (account.account?.type === "chatgpt") {
      return { kind: "connected", snapshot: await this.#readySnapshot(client, account) };
    }
    if (account.account) {
      return {
        kind: "connected",
        snapshot: {
          state: "reauth_required",
          reauthorizationReason: "Codex is authenticated with a non-subscription billing mode",
        },
      };
    }

    const login = await client.startDeviceLogin();
    this.#pendingLogins.set(context.connectionRef, login.loginId);
    return {
      kind: "challenge",
      providerLoginRef: login.loginId,
      challenge: {
        kind: "device_code",
        verificationUri: login.verificationUrl,
        userCode: login.userCode,
        expiresAt: new Date(this.#now().getTime() + this.#challengeTtlMs).toISOString(),
      },
      snapshot: { state: "connecting" },
    };
  }

  async completeConnection(
    context: AdapterConnectionContext,
    providerLoginRef: string,
  ): Promise<AdapterConnectionSnapshot> {
    this.#assertSubscription(context);
    if (this.#pendingLogins.get(context.connectionRef) !== providerLoginRef) {
      throw new CodexAppServerProtocolError("Codex login reference does not match the pending connection");
    }

    const outcome = this.#loginOutcomes.get(providerLoginRef);
    if (outcome && !outcome.success) {
      this.#pendingLogins.delete(context.connectionRef);
      this.#loginOutcomes.delete(providerLoginRef);
      return { state: "reauth_required", reauthorizationReason: "Codex device login failed" };
    }

    const client = this.#client(context);
    const account = await client.readAccount(false);
    this.#pendingLogins.delete(context.connectionRef);
    this.#loginOutcomes.delete(providerLoginRef);
    if (account.account?.type !== "chatgpt") {
      return {
        state: "reauth_required",
        reauthorizationReason: account.account
          ? "Codex login selected a non-subscription billing mode"
          : "Codex device login did not produce a ChatGPT account",
      };
    }
    return this.#readySnapshot(client, account);
  }

  async readConnection(context: AdapterConnectionContext): Promise<AdapterConnectionSnapshot> {
    this.#assertSubscription(context);
    const client = this.#client(context);
    const account = await client.readAccount(false);
    if (account.account?.type !== "chatgpt") {
      return {
        state: "reauth_required",
        reauthorizationReason: account.account
          ? "Codex is authenticated with a non-subscription billing mode"
          : "Codex ChatGPT authorization is required",
      };
    }
    return this.#readySnapshot(client, account);
  }

  async *beginTurn(
    _context: AdapterConnectionContext,
    _request: ProviderTurnRequest,
  ): AsyncIterable<ProviderEvent> {
    throw new CodexTurnProtocolUnavailableError();
  }

  async cancelTurn(_context: AdapterConnectionContext, _providerSessionRef: string): Promise<void> {
    throw new CodexTurnProtocolUnavailableError();
  }

  async logout(context: AdapterConnectionContext): Promise<AdapterConnectionSnapshot> {
    const client = this.#client(context);
    await client.logout();
    this.#pendingLogins.delete(context.connectionRef);
    return { state: "disconnected" };
  }

  async revoke(context: AdapterConnectionContext): Promise<void> {
    const client = this.#client(context);
    await client.logout();
    this.#pendingLogins.delete(context.connectionRef);
    this.#clients.delete(context.connectionRef);
  }

  #client(context: AdapterConnectionContext): CodexAppServerClient {
    let client = this.#clients.get(context.connectionRef);
    if (!client) {
      client = this.#factory(context);
      client.onLoginCompleted((event) => {
        if (event.loginId) this.#loginOutcomes.set(event.loginId, event);
      });
      this.#clients.set(context.connectionRef, client);
    }
    return client;
  }

  async #readySnapshot(
    client: CodexAppServerClient,
    account: CodexAccountState,
  ): Promise<AdapterConnectionSnapshot> {
    if (account.account?.type !== "chatgpt") {
      throw new CodexAppServerProtocolError("A ready Codex subscription requires a ChatGPT account");
    }
    const limits = await client.readRateLimits();
    const limited = rateLimitSnapshot(limits);
    return {
      state: limited ? "rate_limited" : "ready",
      providerIdentityLabel: "ChatGPT account",
      planLabel: planLabel(account.account.planType),
      ...(limited ? { rateLimit: limited } : {}),
    };
  }

  #assertSubscription(context: AdapterConnectionContext): void {
    if (context.mode !== "subscription") {
      throw new CodexAppServerProtocolError("The Codex subscription Adapter accepts only subscription mode");
    }
  }
}
