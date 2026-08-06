import type {
  BrokerAuditEvent,
  BrokerAuditSink,
  ProviderConnection,
  ProviderConnectionStore,
  UserScope,
} from "./contracts.js";

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryProviderConnectionStore implements ProviderConnectionStore {
  readonly #connections = new Map<string, ProviderConnection>();

  async put(connection: ProviderConnection): Promise<void> {
    this.#connections.set(connection.connectionRef, copy(connection));
  }

  async get(connectionRef: string): Promise<ProviderConnection | undefined> {
    const connection = this.#connections.get(connectionRef);
    return connection ? copy(connection) : undefined;
  }

  async list(scope: UserScope): Promise<ProviderConnection[]> {
    return [...this.#connections.values()]
      .filter((connection) => connection.tenantId === scope.tenantId && connection.userId === scope.userId)
      .map(copy);
  }
}

export class InMemoryBrokerAuditSink implements BrokerAuditSink {
  readonly #events: BrokerAuditEvent[] = [];

  async append(event: BrokerAuditEvent): Promise<void> {
    this.#events.push(copy(event));
  }

  events(): BrokerAuditEvent[] {
    return this.#events.map(copy);
  }
}
