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
