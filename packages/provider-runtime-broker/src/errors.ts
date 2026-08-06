export class BrokerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AdapterProtocolError extends BrokerError {
  constructor(message: string) {
    super("adapter_protocol_incompatible", message);
  }
}

export class CodexAppServerProtocolError extends BrokerError {
  constructor(message: string) {
    super("codex_app_server_protocol_error", message);
  }
}

export class CodexAppServerRpcError extends BrokerError {
  constructor(
    public readonly method: string,
    public readonly rpcCode: number,
  ) {
    super("codex_app_server_rpc_error", `Codex app-server rejected ${method} with RPC code ${rpcCode}`);
  }
}

export class CodexTransportClosedError extends BrokerError {
  constructor(message = "Codex app-server transport is closed") {
    super("codex_transport_closed", message);
  }
}

export class CodexTurnProtocolUnavailableError extends BrokerError {
  constructor() {
    super(
      "codex_turn_protocol_unavailable",
      "Codex turn execution is not implemented by the authentication protocol spike",
    );
  }
}

export class CodexRunnerNotFoundError extends BrokerError {
  constructor() {
    super("codex_runner_not_found", "Codex Provider Runner not found");
  }
}

export class CodexRunnerManifestError extends BrokerError {
  constructor(message: string) {
    super("codex_runner_manifest_invalid", message);
  }
}

export class CodexRunnerStateError extends BrokerError {
  constructor(message: string) {
    super("codex_runner_state_invalid", message);
  }
}

export class CodexRunnerStartupError extends BrokerError {
  constructor(code: "runner_start_failed" | "runner_startup_timeout") {
    super(code, code === "runner_startup_timeout" ? "Codex Provider Runner startup timed out" : "Codex Provider Runner failed to start");
  }
}

export class ConnectionNotFoundError extends BrokerError {
  constructor() {
    super("connection_not_found", "Provider connection not found");
  }
}

export class LoginBindingError extends BrokerError {
  constructor(message: string) {
    super("login_binding_invalid", message);
  }
}

export class ConnectionNotReadyError extends BrokerError {
  constructor(state: string) {
    super("connection_not_ready", `Provider connection is ${state}`);
  }
}

export class RateLimitReachedError extends BrokerError {
  constructor(public readonly resetAt: string) {
    super("provider_rate_limited", `Provider connection is rate limited until ${resetAt}`);
  }
}

export class IllegalConnectionTransitionError extends BrokerError {
  constructor(from: string, to: string) {
    super("illegal_connection_transition", `Provider connection cannot transition from ${from} to ${to}`);
  }
}
