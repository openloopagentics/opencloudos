import { CodexAppServerProtocolError } from "./errors.js";

export const CODEX_APP_SERVER_CLIENT_VERSION = "0.146.1";
export const CODEX_APP_SERVER_SCHEMA_REVISION = `codex-cli-${CODEX_APP_SERVER_CLIENT_VERSION}`;

export interface CodexAppServerNotification {
  method: string;
  params?: unknown;
}

export interface CodexAppServerTransport {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  onNotification?(handler: (notification: CodexAppServerNotification) => void): () => void;
}

export type CodexAccount =
  | { type: "chatgpt"; planType: string }
  | { type: "apiKey" }
  | { type: "amazonBedrock" };

export interface CodexAccountState {
  requiresOpenaiAuth: boolean;
  account: CodexAccount | null;
}

export interface CodexDeviceLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  resetsAt?: number;
  windowDurationMins?: number;
}

export interface CodexRateLimitState {
  planType?: string;
  limitId?: string;
  limitName?: string;
  rateLimitReachedType?: string;
  spendControlReached?: boolean;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
}

export interface CodexLoginCompleted {
  loginId?: string;
  success: boolean;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CodexAppServerProtocolError(`${context} must be an object`);
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CodexAppServerProtocolError(`${context} must be a non-empty string`);
  }
  return value;
}

function requiredHttpsUrl(value: unknown, context: string): string {
  const input = requiredString(value, context);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new CodexAppServerProtocolError(`${context} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new CodexAppServerProtocolError(`${context} must use HTTPS`);
  }
  return parsed.toString();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function parseWindow(value: unknown): CodexRateLimitWindow | undefined {
  if (value === null || value === undefined) return undefined;
  const input = record(value, "Codex rate-limit window");
  const usedPercent = optionalInteger(input.usedPercent);
  if (usedPercent === undefined) {
    throw new CodexAppServerProtocolError("Codex rate-limit usedPercent must be an integer");
  }
  return {
    usedPercent,
    ...(optionalInteger(input.resetsAt) === undefined ? {} : { resetsAt: optionalInteger(input.resetsAt) }),
    ...(optionalInteger(input.windowDurationMins) === undefined
      ? {}
      : { windowDurationMins: optionalInteger(input.windowDurationMins) }),
  };
}

/**
 * A narrow, allowlisting client for the authentication portion of Codex app-server.
 * The transport must live inside the user-scoped Provider Runner. Raw app-server
 * responses never leave this class.
 */
export class CodexAppServerClient {
  readonly #transport: CodexAppServerTransport;
  readonly #clientName: string;
  readonly #clientVersion: string;
  #initializeAttempt?: Promise<void>;

  constructor(
    transport: CodexAppServerTransport,
    options: { clientName?: string; clientVersion?: string } = {},
  ) {
    this.#transport = transport;
    this.#clientName = options.clientName ?? "opencloudos-provider-runner";
    this.#clientVersion = options.clientVersion ?? "0.1.0";
  }

  initialize(): Promise<void> {
    this.#initializeAttempt ??= this.#performInitialize().catch((error: unknown) => {
      this.#initializeAttempt = undefined;
      throw error;
    });
    return this.#initializeAttempt;
  }

  async readAccount(refreshToken = false): Promise<CodexAccountState> {
    await this.initialize();
    const response = record(
      await this.#transport.request("account/read", { refreshToken }),
      "account/read response",
    );
    if (typeof response.requiresOpenaiAuth !== "boolean") {
      throw new CodexAppServerProtocolError("account/read requiresOpenaiAuth must be boolean");
    }
    if (response.account === null || response.account === undefined) {
      return { requiresOpenaiAuth: response.requiresOpenaiAuth, account: null };
    }

    const account = record(response.account, "account/read account");
    const type = requiredString(account.type, "account/read account type");
    if (type === "chatgpt") {
      return {
        requiresOpenaiAuth: response.requiresOpenaiAuth,
        account: {
          type,
          planType: requiredString(account.planType, "account/read ChatGPT planType"),
        },
      };
    }
    if (type === "apiKey" || type === "amazonBedrock") {
      return { requiresOpenaiAuth: response.requiresOpenaiAuth, account: { type } };
    }
    throw new CodexAppServerProtocolError(`account/read returned unsupported account type ${type}`);
  }

  async startDeviceLogin(): Promise<CodexDeviceLogin> {
    await this.initialize();
    const response = record(
      await this.#transport.request("account/login/start", { type: "chatgptDeviceCode" }),
      "account/login/start response",
    );
    if (response.type !== "chatgptDeviceCode") {
      throw new CodexAppServerProtocolError("account/login/start did not return a device-code challenge");
    }
    return {
      loginId: requiredString(response.loginId, "device loginId"),
      verificationUrl: requiredHttpsUrl(response.verificationUrl, "device verificationUrl"),
      userCode: requiredString(response.userCode, "device userCode"),
    };
  }

  async readRateLimits(): Promise<CodexRateLimitState> {
    await this.initialize();
    const response = record(
      await this.#transport.request("account/rateLimits/read"),
      "account/rateLimits/read response",
    );
    const rateLimits = record(response.rateLimits, "account/rateLimits/read rateLimits");
    const primary = parseWindow(rateLimits.primary);
    const secondary = parseWindow(rateLimits.secondary);
    return {
      ...(optionalString(rateLimits.planType) ? { planType: optionalString(rateLimits.planType) } : {}),
      ...(optionalString(rateLimits.limitId) ? { limitId: optionalString(rateLimits.limitId) } : {}),
      ...(optionalString(rateLimits.limitName) ? { limitName: optionalString(rateLimits.limitName) } : {}),
      ...(optionalString(rateLimits.rateLimitReachedType)
        ? { rateLimitReachedType: optionalString(rateLimits.rateLimitReachedType) }
        : {}),
      ...(optionalBoolean(rateLimits.spendControlReached) === undefined
        ? {}
        : { spendControlReached: optionalBoolean(rateLimits.spendControlReached) }),
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
    };
  }

  async logout(): Promise<void> {
    await this.initialize();
    record(await this.#transport.request("account/logout"), "account/logout response");
  }

  onLoginCompleted(handler: (event: CodexLoginCompleted) => void): () => void {
    if (!this.#transport.onNotification) return () => undefined;
    return this.#transport.onNotification((notification) => {
      if (notification.method !== "account/login/completed") return;
      const params = record(notification.params, "account/login/completed params");
      if (typeof params.success !== "boolean") {
        throw new CodexAppServerProtocolError("account/login/completed success must be boolean");
      }
      handler({
        success: params.success,
        ...(optionalString(params.loginId) ? { loginId: optionalString(params.loginId) } : {}),
      });
    });
  }

  async #performInitialize(): Promise<void> {
    const response = record(
      await this.#transport.request("initialize", {
        clientInfo: {
          name: this.#clientName,
          title: "OpenCloudOS Provider Runner",
          version: this.#clientVersion,
        },
        capabilities: { experimentalApi: false },
      }),
      "initialize response",
    );
    requiredString(response.codexHome, "initialize codexHome");
    requiredString(response.platformFamily, "initialize platformFamily");
    requiredString(response.platformOs, "initialize platformOs");
    requiredString(response.userAgent, "initialize userAgent");
    await this.#transport.notify("initialized", {});
  }
}
