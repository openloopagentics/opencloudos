import type { Readable, Writable } from "node:stream";
import type {
  CodexAppServerNotification,
  CodexAppServerTransport,
} from "./codex-app-server-client.js";
import {
  CodexAppServerProtocolError,
  CodexAppServerRpcError,
  CodexTransportClosedError,
} from "./errors.js";

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const SERVER_REQUEST_UNSUPPORTED = -32601;

type JsonRecord = Record<string, unknown>;
type ResponseId = number | string;

export interface CodexLineChannel {
  send(line: string): Promise<void>;
  onLine(handler: (line: string) => void): () => void;
  onClose(handler: (cause?: Error) => void): () => void;
  close(): Promise<void>;
}

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isResponseId(value: unknown): value is ResponseId {
  return (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && value.length > 0 && value.length <= 128)
  );
}

/**
 * Bidirectional app-server JSONL transport. It correlates client requests,
 * forwards notifications, and rejects every server-initiated request until a
 * separately reviewed approval/tool handler exists.
 */
export class CodexJsonlRpcTransport implements CodexAppServerTransport {
  readonly #channel: CodexLineChannel;
  readonly #maxLineBytes: number;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #notificationHandlers = new Set<(notification: CodexAppServerNotification) => void>();
  readonly #unsubscribeLine: () => void;
  readonly #unsubscribeClose: () => void;
  #nextRequestId = 1;
  #closed = false;

  constructor(channel: CodexLineChannel, options: { maxLineBytes?: number } = {}) {
    this.#channel = channel;
    this.#maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    if (!Number.isSafeInteger(this.#maxLineBytes) || this.#maxLineBytes < 1024) {
      throw new CodexAppServerProtocolError("Codex JSONL maxLineBytes must be an integer of at least 1024");
    }
    this.#unsubscribeLine = channel.onLine((line) => this.#receiveLine(line));
    this.#unsubscribeClose = channel.onClose(() => {
      this.#transitionClosed(new CodexTransportClosedError("Codex app-server stdio closed"));
    });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.#assertOpen();
    if (!method) throw new CodexAppServerProtocolError("Codex request method must be non-empty");
    const id = this.#nextRequestId++;
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { method, resolve, reject });
    });

    try {
      await this.#channel.send(this.#serialize({ method, id, ...(params === undefined ? {} : { params }) }));
    } catch {
      this.#closeAfterFailure(new CodexTransportClosedError("Codex app-server request could not be written"));
    }
    return response;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.#assertOpen();
    if (!method) throw new CodexAppServerProtocolError("Codex notification method must be non-empty");
    try {
      await this.#channel.send(this.#serialize({ method, ...(params === undefined ? {} : { params }) }));
    } catch {
      const error = new CodexTransportClosedError("Codex app-server notification could not be written");
      this.#closeAfterFailure(error);
      throw error;
    }
  }

  onNotification(handler: (notification: CodexAppServerNotification) => void): () => void {
    this.#assertOpen();
    this.#notificationHandlers.add(handler);
    return () => this.#notificationHandlers.delete(handler);
  }

  async close(): Promise<void> {
    this.#transitionClosed(new CodexTransportClosedError("Codex app-server transport closed by runner"));
    await this.#channel.close();
  }

  #receiveLine(line: string): void {
    if (this.#closed) return;
    if (Buffer.byteLength(line, "utf8") > this.#maxLineBytes) {
      this.#failProtocol("Codex app-server message exceeded the JSONL size limit");
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.#failProtocol("Codex app-server emitted malformed JSONL");
      return;
    }
    if (!isRecord(message)) {
      this.#failProtocol("Codex app-server JSONL message must be an object");
      return;
    }

    try {
      if (typeof message.method === "string" && hasOwn(message, "id")) {
        this.#rejectServerRequest(message);
        return;
      }
      if (hasOwn(message, "id")) {
        this.#resolveResponse(message);
        return;
      }
      if (typeof message.method === "string") {
        for (const handler of this.#notificationHandlers) {
          handler({
            method: message.method,
            ...(hasOwn(message, "params") ? { params: message.params } : {}),
          });
        }
        return;
      }
      throw new CodexAppServerProtocolError("Codex app-server JSONL message has no method or response id");
    } catch (error) {
      this.#failProtocol(
        error instanceof CodexAppServerProtocolError
          ? error.message
          : "Codex app-server message handling failed closed",
      );
    }
  }

  #resolveResponse(message: JsonRecord): void {
    if (typeof message.id !== "number" || !Number.isSafeInteger(message.id)) {
      throw new CodexAppServerProtocolError("Codex response id must be a safe integer");
    }
    const pending = this.#pending.get(message.id);
    if (!pending) throw new CodexAppServerProtocolError("Codex response id does not match a pending request");
    const hasResult = hasOwn(message, "result");
    const hasError = hasOwn(message, "error");
    if (hasResult === hasError) {
      throw new CodexAppServerProtocolError("Codex response must contain exactly one of result or error");
    }

    if (hasResult) {
      this.#pending.delete(message.id);
      pending.resolve(message.result);
      return;
    }
    if (!isRecord(message.error) || typeof message.error.code !== "number" || !Number.isSafeInteger(message.error.code)) {
      throw new CodexAppServerProtocolError("Codex RPC error has an invalid code");
    }
    this.#pending.delete(message.id);
    pending.reject(new CodexAppServerRpcError(pending.method, message.error.code));
  }

  #rejectServerRequest(message: JsonRecord): void {
    if (!isResponseId(message.id)) {
      throw new CodexAppServerProtocolError("Codex server-request id is invalid");
    }
    const rejection = this.#serialize({
      id: message.id,
      error: {
        code: SERVER_REQUEST_UNSUPPORTED,
        message: "OpenCloudOS Provider Runner rejects unsupported server requests",
      },
    });
    void this.#channel.send(rejection).catch(() => {
      this.#closeAfterFailure(new CodexTransportClosedError("Codex server-request rejection could not be written"));
    });
  }

  #serialize(message: JsonRecord): string {
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, "utf8") > this.#maxLineBytes) {
      throw new CodexAppServerProtocolError("Codex client message exceeded the JSONL size limit");
    }
    return line;
  }

  #assertOpen(): void {
    if (this.#closed) throw new CodexTransportClosedError();
  }

  #failProtocol(message: string): void {
    this.#closeAfterFailure(new CodexAppServerProtocolError(message));
  }

  #closeAfterFailure(error: Error): void {
    this.#transitionClosed(error);
    void this.#channel.close().catch(() => undefined);
  }

  #transitionClosed(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribeLine();
    this.#unsubscribeClose();
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#notificationHandlers.clear();
  }
}

/**
 * Converts local app-server stdout/stdin streams into bounded JSONL lines.
 * The owning Provider Runner remains responsible for process and filesystem
 * isolation; this class never spawns a process or selects a credential home.
 */
export class NodeStreamCodexLineChannel implements CodexLineChannel {
  readonly #stdout: Readable;
  readonly #stdin: Writable;
  readonly #maxLineBytes: number;
  readonly #lineHandlers = new Set<(line: string) => void>();
  readonly #closeHandlers = new Set<(cause?: Error) => void>();
  #buffer = Buffer.alloc(0);
  #closed = false;

  constructor(stdout: Readable, stdin: Writable, options: { maxLineBytes?: number } = {}) {
    this.#stdout = stdout;
    this.#stdin = stdin;
    this.#maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    if (!Number.isSafeInteger(this.#maxLineBytes) || this.#maxLineBytes < 1024) {
      throw new CodexAppServerProtocolError("Codex stdio maxLineBytes must be an integer of at least 1024");
    }
    stdout.on("data", this.#onData);
    stdout.once("end", this.#onEnd);
    stdout.once("close", this.#onStdoutClose);
    stdout.once("error", this.#onStdoutError);
    stdin.once("close", this.#onStdinClose);
    stdin.once("error", this.#onStdinError);
  }

  async send(line: string): Promise<void> {
    if (this.#closed) throw new CodexTransportClosedError();
    if (!line.endsWith("\n") || line.slice(0, -1).includes("\n")) {
      throw new CodexAppServerProtocolError("Codex stdio writes must contain exactly one JSONL frame");
    }
    if (Buffer.byteLength(line, "utf8") > this.#maxLineBytes) {
      throw new CodexAppServerProtocolError("Codex stdio write exceeded the JSONL size limit");
    }
    await new Promise<void>((resolve, reject) => {
      this.#stdin.write(line, (error) => {
        if (error) reject(new CodexTransportClosedError("Codex app-server stdin write failed"));
        else resolve();
      });
    });
  }

  onLine(handler: (line: string) => void): () => void {
    if (this.#closed) throw new CodexTransportClosedError();
    this.#lineHandlers.add(handler);
    return () => this.#lineHandlers.delete(handler);
  }

  onClose(handler: (cause?: Error) => void): () => void {
    if (this.#closed) throw new CodexTransportClosedError();
    this.#closeHandlers.add(handler);
    return () => this.#closeHandlers.delete(handler);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#emitClose(new CodexTransportClosedError("Codex stdio channel closed by runner"));
  }

  readonly #onData = (chunk: Buffer | string): void => {
    if (this.#closed) return;
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.#buffer = Buffer.concat([this.#buffer, incoming]);

    let newline = this.#buffer.indexOf(0x0a);
    while (newline >= 0) {
      let frame = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (frame.at(-1) === 0x0d) frame = frame.subarray(0, -1);
      if (frame.byteLength > this.#maxLineBytes) {
        this.#emitClose(new CodexAppServerProtocolError("Codex stdout frame exceeded the JSONL size limit"));
        return;
      }
      let line: string;
      try {
        line = new TextDecoder("utf-8", { fatal: true }).decode(frame);
      } catch {
        this.#emitClose(new CodexAppServerProtocolError("Codex stdout contained invalid UTF-8"));
        return;
      }
      try {
        for (const handler of this.#lineHandlers) handler(line);
      } catch {
        this.#emitClose(new CodexAppServerProtocolError("Codex stdout line handler failed closed"));
        return;
      }
      if (this.#closed) return;
      newline = this.#buffer.indexOf(0x0a);
    }

    if (this.#buffer.byteLength > this.#maxLineBytes) {
      this.#emitClose(new CodexAppServerProtocolError("Codex stdout frame exceeded the JSONL size limit"));
    }
  };

  readonly #onEnd = (): void => {
    if (this.#buffer.byteLength > 0) {
      this.#emitClose(new CodexAppServerProtocolError("Codex stdout ended with an incomplete JSONL frame"));
      return;
    }
    this.#emitClose(new CodexTransportClosedError("Codex app-server stdout ended"));
  };

  readonly #onStdoutError = (): void => {
    this.#emitClose(new CodexTransportClosedError("Codex app-server stdout failed"));
  };

  readonly #onStdoutClose = (): void => {
    if (this.#buffer.byteLength > 0) {
      this.#emitClose(new CodexAppServerProtocolError("Codex stdout closed with an incomplete JSONL frame"));
      return;
    }
    this.#emitClose(new CodexTransportClosedError("Codex app-server stdout closed"));
  };

  readonly #onStdinError = (): void => {
    this.#emitClose(new CodexTransportClosedError("Codex app-server stdin failed"));
  };

  readonly #onStdinClose = (): void => {
    this.#emitClose(new CodexTransportClosedError("Codex app-server stdin closed"));
  };

  #emitClose(cause: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stdout.off("data", this.#onData);
    this.#stdout.off("end", this.#onEnd);
    // Keep the one-shot error listeners attached while the pipe shuts down so
    // a late stream error cannot become an uncaught process-level exception.
    if (!this.#stdin.destroyed) this.#stdin.end();
    const handlers = [...this.#closeHandlers];
    this.#lineHandlers.clear();
    this.#closeHandlers.clear();
    for (const handler of handlers) handler(cause);
  }
}
