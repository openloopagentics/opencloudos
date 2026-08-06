export const BROKER_ADAPTER_PROTOCOL_VERSION = 1;

export type ProviderName = "codex" | "claude" | "synthetic";
export type ProviderMode = "subscription" | "api_key" | "cloud";
export type BillingMode = "personal_subscription" | "explicit_api" | "operator_cloud" | "synthetic";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "reauth_required"
  | "rate_limited"
  | "blocked_by_policy"
  | "revoked";

export interface UserScope {
  tenantId: string;
  userId: string;
}

export interface AdapterManifest {
  provider: ProviderName;
  adapterProtocolVersion: number;
  clientName: string;
  clientVersion: string;
}

export interface ProviderPolicyDecision {
  provider: ProviderName;
  mode: ProviderMode;
  disposition: "enabled" | "blocked_by_policy";
  reason: string;
  reviewedAt: string;
  approvalReference?: string;
}

export interface RateLimitSnapshot {
  resetAt: string;
  label?: string;
}

export interface ProviderConnection {
  connectionRef: string;
  tenantId: string;
  userId: string;
  provider: ProviderName;
  mode: ProviderMode;
  billingMode: BillingMode;
  state: ConnectionState;
  providerIdentityLabel?: string;
  planLabel?: string;
  reauthorizationReason?: string;
  blockedReason?: string;
  rateLimit?: RateLimitSnapshot;
  clientName?: string;
  clientVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionChallenge {
  kind: "device_code" | "browser";
  loginRef: string;
  verificationUri: string;
  userCode?: string;
  expiresAt: string;
}

export type BeginConnectionResult =
  | { kind: "challenge"; connection: ProviderConnection; challenge: ConnectionChallenge }
  | { kind: "connected"; connection: ProviderConnection }
  | { kind: "blocked"; connection: ProviderConnection; reason: string };

export interface AdapterConnectionContext extends UserScope {
  connectionRef: string;
  mode: ProviderMode;
}

export interface AdapterConnectionSnapshot {
  state: ConnectionState;
  providerIdentityLabel?: string;
  planLabel?: string;
  reauthorizationReason?: string;
  rateLimit?: RateLimitSnapshot;
}

export type AdapterBeginConnectionResult =
  | { kind: "challenge"; providerLoginRef: string; challenge: Omit<ConnectionChallenge, "loginRef">; snapshot: AdapterConnectionSnapshot }
  | { kind: "connected"; snapshot: AdapterConnectionSnapshot };

export interface ProviderTurnRequest {
  providerSessionRef: string;
  agentSessionRef: string;
  prompt: string;
  toolPolicyRef: string;
}

export type ProviderEvent =
  | { type: "message"; text: string }
  | { type: "tool_request"; tool: string; requestRef: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "rate_limit"; resetAt: string; label?: string }
  | { type: "completed"; providerSessionRef: string }
  | { type: "failed"; code: string; retryable: boolean };

export interface ProviderAdapter {
  readonly manifest: AdapterManifest;
  beginConnection(context: AdapterConnectionContext): Promise<AdapterBeginConnectionResult>;
  completeConnection(context: AdapterConnectionContext, providerLoginRef: string): Promise<AdapterConnectionSnapshot>;
  readConnection(context: AdapterConnectionContext): Promise<AdapterConnectionSnapshot>;
  beginTurn(context: AdapterConnectionContext, request: ProviderTurnRequest): AsyncIterable<ProviderEvent>;
  cancelTurn(context: AdapterConnectionContext, providerSessionRef: string): Promise<void>;
  logout(context: AdapterConnectionContext): Promise<AdapterConnectionSnapshot>;
  revoke(context: AdapterConnectionContext): Promise<void>;
}

export interface ProviderPolicyRegistry {
  read(provider: ProviderName, mode: ProviderMode): ProviderPolicyDecision;
}

export interface ProviderConnectionStore {
  put(connection: ProviderConnection): Promise<void>;
  get(connectionRef: string): Promise<ProviderConnection | undefined>;
  list(scope: UserScope): Promise<ProviderConnection[]>;
}

export interface BrokerAuditEvent extends UserScope {
  type:
    | "provider.connection.started"
    | "provider.connection.completed"
    | "provider.connection.blocked"
    | "provider.turn.started"
    | "provider.turn.completed"
    | "provider.turn.failed"
    | "provider.connection.logged_out"
    | "provider.connection.revoked";
  connectionRef: string;
  provider: ProviderName;
  mode: ProviderMode;
  outcome: string;
  occurredAt: string;
}

export interface BrokerAuditSink {
  append(event: BrokerAuditEvent): Promise<void>;
}

export interface BrokerDependencies {
  adapters: ProviderAdapter[];
  policies: ProviderPolicyRegistry;
  connections: ProviderConnectionStore;
  audit: BrokerAuditSink;
  now?: () => Date;
  createRef?: () => string;
}
