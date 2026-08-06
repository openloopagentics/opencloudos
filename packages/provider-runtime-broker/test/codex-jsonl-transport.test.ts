import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  CodexAppServerClient,
  CodexAppServerProtocolError,
  CodexAppServerRpcError,
  CodexJsonlRpcTransport,
  CodexTransportClosedError,
  NodeStreamCodexLineChannel,
  type CodexAppServerNotification,
  type CodexLineChannel,
} from "../src/index.js";

class FixtureLineChannel implements CodexLineChannel {
  readonly sent: string[] = [];
  readonly #lineHandlers = new Set<(line: string) => void>();
  readonly #closeHandlers = new Set<(cause?: Error) => void>();
  #closed = false;
  #rejectWrites = false;

  async send(line: string): Promise<void> {
    if (this.#closed) throw new CodexTransportClosedError();
    if (this.#rejectWrites) throw new CodexTransportClosedError("fixture write failed");
    this.sent.push(line);
  }

  onLine(handler: (line: string) => void): () => void {
    this.#lineHandlers.add(handler);
    return () => this.#lineHandlers.delete(handler);
  }

  onClose(handler: (cause?: Error) => void): () => void {
    this.#closeHandlers.add(handler);
    return () => this.#closeHandlers.delete(handler);
  }

  async close(): Promise<void> {
    this.fail(new CodexTransportClosedError("fixture channel closed"));
  }

  receive(message: unknown): void {
    this.receiveLine(JSON.stringify(message));
  }

  receiveLine(line: string): void {
    for (const handler of this.#lineHandlers) handler(line);
  }

  fail(cause: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const handler of this.#closeHandlers) handler(cause);
    this.#lineHandlers.clear();
    this.#closeHandlers.clear();
  }

  rejectWrites(): void {
    this.#rejectWrites = true;
  }
}

function frame(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("RUNNER-001: app-server initialization uses correlated JSONL without a jsonrpc header", async () => {
  const channel = new FixtureLineChannel();
  const transport = new CodexJsonlRpcTransport(channel);
  const client = new CodexAppServerClient(transport, { clientVersion: "0.1.0-test" });

  const initializing = client.initialize();
  assert.equal(channel.sent.length, 1);
  const request = frame(channel.sent[0] ?? "");
  assert.equal(request.method, "initialize");
  assert.equal(request.id, 1);
  assert.equal("jsonrpc" in request, false);
  channel.receive({
    id: request.id,
    result: {
      codexHome: "/credential-capsule/codex",
      platformFamily: "unix",
      platformOs: "linux",
      userAgent: "codex_cli_rs/0.146.1",
    },
  });
  await initializing;

  assert.deepEqual(frame(channel.sent[1] ?? ""), { method: "initialized", params: {} });
  await transport.close();
});

test("RUNNER-002: concurrent requests resolve by response id while notifications stay out-of-band", async () => {
  const channel = new FixtureLineChannel();
  const transport = new CodexJsonlRpcTransport(channel);
  const notifications: CodexAppServerNotification[] = [];
  transport.onNotification((notification) => notifications.push(notification));

  const account = transport.request("account/read", { refreshToken: false });
  const limits = transport.request("account/rateLimits/read");
  const accountId = frame(channel.sent[0] ?? "").id;
  const limitsId = frame(channel.sent[1] ?? "").id;

  channel.receive({ method: "account/updated", params: { authMode: "chatgpt", planType: "plus" } });
  channel.receive({ id: limitsId, result: { rateLimits: { planType: "plus" } } });
  channel.receive({ id: accountId, result: { account: null, requiresOpenaiAuth: true } });

  assert.deepEqual(await limits, { rateLimits: { planType: "plus" } });
  assert.deepEqual(await account, { account: null, requiresOpenaiAuth: true });
  assert.deepEqual(notifications, [{
    method: "account/updated",
    params: { authMode: "chatgpt", planType: "plus" },
  }]);
  await transport.close();
});

test("RUNNER-003: server-initiated approval requests are rejected without echoing params or accepting", async () => {
  const channel = new FixtureLineChannel();
  const transport = new CodexJsonlRpcTransport(channel);

  channel.receive({
    id: "approval-fixture-1",
    method: "item/commandExecution/requestApproval",
    params: {
      command: "print synthetic-secret-must-not-escape",
      availableDecisions: ["accept", "decline"],
    },
  });
  await tick();

  assert.equal(channel.sent.length, 1);
  assert.deepEqual(frame(channel.sent[0] ?? ""), {
    id: "approval-fixture-1",
    error: {
      code: -32601,
      message: "OpenCloudOS Provider Runner rejects unsupported server requests",
    },
  });
  assert.equal(channel.sent[0]?.includes("synthetic-secret-must-not-escape"), false);
  assert.equal(channel.sent[0]?.includes('"accept"'), false);
  await transport.close();
});

test("RUNNER-004: RPC failures retain method and code but redact provider-controlled messages", async () => {
  const channel = new FixtureLineChannel();
  const transport = new CodexJsonlRpcTransport(channel);
  const pending = transport.request("account/read", { refreshToken: false });
  const requestId = frame(channel.sent[0] ?? "").id;

  channel.receive({
    id: requestId,
    error: {
      code: -32000,
      message: "synthetic-provider-error-with-token-fixture",
      data: { accessToken: "must-not-escape" },
    },
  });

  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CodexAppServerRpcError);
    assert.equal(error.method, "account/read");
    assert.equal(error.rpcCode, -32000);
    assert.equal(String(error).includes("synthetic-provider-error-with-token-fixture"), false);
    assert.equal(JSON.stringify(error).includes("must-not-escape"), false);
    return true;
  });
  await transport.close();
});

test("RUNNER-005: malformed JSONL closes the transport and rejects every pending request", async () => {
  const channel = new FixtureLineChannel();
  const transport = new CodexJsonlRpcTransport(channel);
  const first = transport.request("account/read");
  const second = transport.request("account/rateLimits/read");

  channel.receiveLine("{not-json");

  await assert.rejects(first, CodexAppServerProtocolError);
  await assert.rejects(second, CodexAppServerProtocolError);
  await assert.rejects(() => transport.request("account/read"), CodexTransportClosedError);
});

test("RUNNER-006: an unknown response id fails closed instead of being misattributed", async () => {
  const channel = new FixtureLineChannel();
  const transport = new CodexJsonlRpcTransport(channel);
  const pending = transport.request("account/read");

  channel.receive({ id: 999, result: {} });

  await assert.rejects(pending, CodexAppServerProtocolError);
  await assert.rejects(() => transport.notify("initialized", {}), CodexTransportClosedError);
});

test("RUNNER-007: the Node stream channel reassembles fragmented frames and writes exactly one frame", async () => {
  const appServerStdout = new PassThrough();
  const appServerStdin = new PassThrough();
  const channel = new NodeStreamCodexLineChannel(appServerStdout, appServerStdin);
  const lines: string[] = [];
  const writes: string[] = [];
  channel.onLine((line) => lines.push(line));
  appServerStdin.on("data", (chunk: Buffer) => writes.push(chunk.toString("utf8")));

  appServerStdout.write('{"id":1,"res');
  appServerStdout.write('ult":{}}\n{"method":"warning","params":{}}\r\n');
  await channel.send('{"method":"initialized","params":{}}\n');

  assert.deepEqual(lines, ['{"id":1,"result":{}}', '{"method":"warning","params":{}}']);
  assert.equal(writes.join(""), '{"method":"initialized","params":{}}\n');
  await assert.rejects(
    () => channel.send('{"id":1}\n{"id":2}\n'),
    CodexAppServerProtocolError,
  );
  await channel.close();
});

test("RUNNER-008: oversized or incomplete stdout frames close the bounded channel", async () => {
  const oversizedStdout = new PassThrough();
  const oversizedStdin = new PassThrough();
  const oversized = new NodeStreamCodexLineChannel(oversizedStdout, oversizedStdin, { maxLineBytes: 1024 });
  const oversizedClose = new Promise<Error | undefined>((resolve) => oversized.onClose(resolve));
  oversizedStdout.write("x".repeat(1025));
  assert.ok((await oversizedClose) instanceof CodexAppServerProtocolError);
  await assert.rejects(() => oversized.send("{}\n"), CodexTransportClosedError);

  const incompleteStdout = new PassThrough();
  const incompleteStdin = new PassThrough();
  const incomplete = new NodeStreamCodexLineChannel(incompleteStdout, incompleteStdin);
  const incompleteClose = new Promise<Error | undefined>((resolve) => incomplete.onClose(resolve));
  incompleteStdout.end('{"id":1');
  assert.ok((await incompleteClose) instanceof CodexAppServerProtocolError);

  const invalidUtf8Stdout = new PassThrough();
  const invalidUtf8Stdin = new PassThrough();
  const invalidUtf8 = new NodeStreamCodexLineChannel(invalidUtf8Stdout, invalidUtf8Stdin);
  const invalidUtf8Close = new Promise<Error | undefined>((resolve) => invalidUtf8.onClose(resolve));
  invalidUtf8Stdout.write(Buffer.from([0xff, 0x0a]));
  assert.ok((await invalidUtf8Close) instanceof CodexAppServerProtocolError);
});

test("a response with both result and error fails the correlated request and closes", async () => {
  const channel = new FixtureLineChannel();
  const transport = new CodexJsonlRpcTransport(channel);
  const pending = transport.request("account/read");
  const requestId = frame(channel.sent[0] ?? "").id;

  channel.receive({ id: requestId, result: {}, error: { code: -32000 } });

  await assert.rejects(pending, CodexAppServerProtocolError);
  await assert.rejects(() => transport.request("account/read"), CodexTransportClosedError);
});

test("a failed stdio write closes the transport and rejects pending work", async () => {
  const channel = new FixtureLineChannel();
  const transport = new CodexJsonlRpcTransport(channel);
  channel.rejectWrites();

  await assert.rejects(() => transport.request("account/read"), CodexTransportClosedError);
  await assert.rejects(() => transport.request("account/rateLimits/read"), CodexTransportClosedError);
});

test("an externally closed stdout pipe closes the line channel", async () => {
  const appServerStdout = new PassThrough();
  const appServerStdin = new PassThrough();
  const channel = new NodeStreamCodexLineChannel(appServerStdout, appServerStdin);
  const closed = new Promise<Error | undefined>((resolve) => channel.onClose(resolve));

  appServerStdout.destroy();

  assert.ok((await closed) instanceof CodexTransportClosedError);
  await assert.rejects(() => channel.send("{}\n"), CodexTransportClosedError);
});
