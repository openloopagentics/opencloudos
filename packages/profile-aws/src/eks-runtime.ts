import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Agent, request } from "node:https";

export type EksWorkloadState = "starting" | "ready" | "degraded";

export interface EksCapsuleSpec {
  namespace: string;
  name: string;
  tenantHash: string;
  workloadName: string;
  generation: number;
  storageClassName: string;
  sizeGi: number;
  desiredHash: string;
}

export interface EksWorkloadSpec {
  namespace: string;
  name: string;
  tenantHash: string;
  generation: number;
  desiredHash: string;
  kind: string;
  image: string;
  serviceAccountName: string;
  resourcePolicyHash: string;
  networkPolicyHash: string;
  storagePolicyHash: string;
  capsuleClaimName?: string;
  cpuRequest: string;
  memoryRequest: string;
}

export interface EksRuntimeObservation {
  state: EksWorkloadState;
  endpointRef: string;
}

export interface EksRuntimeControl {
  reconcileCapsule(spec: EksCapsuleSpec): Promise<string>;
  inspectCapsule(namespace: string, name: string): Promise<"mounted" | "sealed" | undefined>;
  sealCapsule(namespace: string, name: string, workloadName: string, generation: number): Promise<void>;
  destroyCapsule(namespace: string, name: string, workloadName: string, generation: number): Promise<void>;
  reconcileWorkload(spec: EksWorkloadSpec, signal?: AbortSignal): Promise<EksRuntimeObservation>;
  inspectWorkload(namespace: string, name: string): Promise<EksRuntimeObservation | undefined>;
  destroyWorkload(namespace: string, name: string, generation: number): Promise<void>;
  close(): void;
}

export class EksRuntimeConflictError extends Error {
  constructor() {
    super("EKS resource generation conflicted");
    this.name = "EksRuntimeConflictError";
  }
}

export class EksRuntimeUnavailableError extends Error {
  constructor() {
    super("EKS resource operation is unavailable");
    this.name = "EksRuntimeUnavailableError";
  }
}

type KubernetesObject = {
  metadata?: {
    name?: string;
    namespace?: string;
    resourceVersion?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  status?: {
    phase?: string;
    availableReplicas?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string }>;
  };
  [key: string]: unknown;
};

interface KubernetesTransport {
  request<T extends KubernetesObject>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T | undefined>;
  close(): void;
}

class HttpsKubernetesTransport implements KubernetesTransport {
  private constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly token: string,
    private readonly agent: Agent,
  ) {}

  static async create(): Promise<HttpsKubernetesTransport> {
    const host = process.env.KUBERNETES_SERVICE_HOST;
    const port = Number(process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? process.env.KUBERNETES_SERVICE_PORT ?? "443");
    if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new EksRuntimeUnavailableError();
    try {
      const [token, ca] = await Promise.all([
        readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8"),
        readFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"),
      ]);
      if (!token.trim() || ca.byteLength === 0) throw new EksRuntimeUnavailableError();
      return new HttpsKubernetesTransport(host, port, token.trim(), new Agent({ ca, keepAlive: true, rejectUnauthorized: true }));
    } catch {
      throw new EksRuntimeUnavailableError();
    }
  }

  async request<T extends KubernetesObject>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T | undefined> {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise<T | undefined>((resolve, reject) => {
      const operation = request({
        hostname: this.host,
        port: this.port,
        path,
        method,
        agent: this.agent,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(encoded ? { "content-type": "application/json", "content-length": String(encoded.byteLength) } : {}),
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > 4 * 1024 * 1024) {
            response.destroy(new EksRuntimeUnavailableError());
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () => reject(new EksRuntimeUnavailableError()));
        response.on("end", () => {
          if (response.statusCode === 404) {
            resolve(undefined);
            return;
          }
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(response.statusCode === 409 ? new EksRuntimeConflictError() : new EksRuntimeUnavailableError());
            return;
          }
          if (chunks.length === 0) {
            resolve(undefined);
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
          } catch {
            reject(new EksRuntimeUnavailableError());
          }
        });
      });
      operation.on("error", () => reject(new EksRuntimeUnavailableError()));
      if (encoded) operation.write(encoded);
      operation.end();
    });
  }

  close(): void {
    this.agent.destroy();
  }
}

const GENERATION = "opencloudos.io/generation";
const DESIRED_HASH = "opencloudos.io/desired-hash";
const CAPSULE_STATE = "opencloudos.io/capsule-state";

function encode(value: string): string {
  return encodeURIComponent(value);
}

function generationOf(resource: KubernetesObject): number {
  const parsed = Number(resource.metadata?.annotations?.[GENERATION]);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 0;
}

function assertGeneration(resource: KubernetesObject | undefined, generation: number, desiredHash?: string): void {
  if (!resource) return;
  const current = generationOf(resource);
  if (current > generation) throw new EksRuntimeConflictError();
  if (current === generation && desiredHash !== undefined && resource.metadata?.annotations?.[DESIRED_HASH] !== desiredHash) {
    throw new EksRuntimeConflictError();
  }
}

function deploymentState(resource: KubernetesObject): EksWorkloadState {
  if ((resource.status?.availableReplicas ?? 0) >= 1) return "ready";
  const failed = resource.status?.conditions?.some((condition) =>
    (condition.type === "Progressing" && condition.status === "False")
    || condition.reason === "ReplicaFailure",
  );
  return failed ? "degraded" : "starting";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface InClusterEksRuntimeOptions {
  readinessTimeoutSeconds: number;
}

export class InClusterEksRuntimeControl implements EksRuntimeControl {
  private constructor(
    private readonly transport: KubernetesTransport,
    private readonly readinessTimeoutSeconds: number,
  ) {}

  static async create(options: InClusterEksRuntimeOptions): Promise<InClusterEksRuntimeControl> {
    return new InClusterEksRuntimeControl(await HttpsKubernetesTransport.create(), options.readinessTimeoutSeconds);
  }

  private collection(namespace: string, type: "deployments" | "persistentvolumeclaims"): string {
    return type === "deployments"
      ? `/apis/apps/v1/namespaces/${encode(namespace)}/deployments`
      : `/api/v1/namespaces/${encode(namespace)}/persistentvolumeclaims`;
  }

  private resource(namespace: string, type: "deployments" | "persistentvolumeclaims", name: string): string {
    return `${this.collection(namespace, type)}/${encode(name)}`;
  }

  private async upsert(
    namespace: string,
    type: "deployments" | "persistentvolumeclaims",
    name: string,
    desired: KubernetesObject,
  ): Promise<KubernetesObject> {
    const path = this.resource(namespace, type, name);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.transport.request("GET", path);
      assertGeneration(existing, generationOf(desired), desired.metadata?.annotations?.[DESIRED_HASH]);
      const document: KubernetesObject = structuredClone(desired);
      if (existing?.metadata?.resourceVersion) {
        document.metadata = {
          ...existing.metadata,
          ...document.metadata,
          resourceVersion: existing.metadata.resourceVersion,
        };
        if (type === "persistentvolumeclaims") document.spec = structuredClone(existing.spec);
      }
      delete document.status;
      try {
        const applied = existing
          ? await this.transport.request("PUT", path, document)
          : await this.transport.request("POST", this.collection(namespace, type), document);
        if (!applied) throw new EksRuntimeUnavailableError();
        return applied;
      } catch (error: unknown) {
        if (!(error instanceof EksRuntimeConflictError) || attempt === 2) throw error;
      }
    }
    throw new EksRuntimeUnavailableError();
  }

  private async waitFor(
    path: string,
    ready: (resource: KubernetesObject) => boolean,
    signal?: AbortSignal,
  ): Promise<KubernetesObject> {
    const deadline = Date.now() + this.readinessTimeoutSeconds * 1000;
    while (Date.now() <= deadline) {
      if (signal?.aborted) throw signal.reason ?? new EksRuntimeUnavailableError();
      const resource = await this.transport.request("GET", path);
      if (resource && ready(resource)) return resource;
      await sleep(1_000);
    }
    throw new EksRuntimeUnavailableError();
  }

  private async deleteAndWait(path: string): Promise<void> {
    const existing = await this.transport.request("GET", path);
    if (!existing) return;
    await this.transport.request("DELETE", path, {
      apiVersion: "v1",
      kind: "DeleteOptions",
      propagationPolicy: "Foreground",
    });
    const deadline = Date.now() + this.readinessTimeoutSeconds * 1000;
    while (Date.now() <= deadline) {
      if (!await this.transport.request("GET", path)) return;
      await sleep(1_000);
    }
    throw new EksRuntimeUnavailableError();
  }

  async reconcileCapsule(spec: EksCapsuleSpec): Promise<string> {
    const desired: KubernetesObject = {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        annotations: {
          [GENERATION]: String(spec.generation),
          [DESIRED_HASH]: spec.desiredHash,
          [CAPSULE_STATE]: "mounted",
          "opencloudos.io/tenant": spec.tenantHash,
          "opencloudos.io/workload": spec.workloadName,
        },
        labels: { "app.kubernetes.io/managed-by": "opencloudos" },
      },
      spec: {
        accessModes: ["ReadWriteMany"],
        storageClassName: spec.storageClassName,
        resources: { requests: { storage: `${spec.sizeGi}Gi` } },
        volumeMode: "Filesystem",
      },
    };
    await this.upsert(spec.namespace, "persistentvolumeclaims", spec.name, desired);
    await this.waitFor(
      this.resource(spec.namespace, "persistentvolumeclaims", spec.name),
      (resource) => resource.status?.phase === "Bound",
    );
    return `k8s:pvc:${spec.namespace}/${spec.name}`;
  }

  async inspectCapsule(namespace: string, name: string): Promise<"mounted" | "sealed" | undefined> {
    const resource = await this.transport.request("GET", this.resource(namespace, "persistentvolumeclaims", name));
    if (!resource) return undefined;
    return resource.metadata?.annotations?.[CAPSULE_STATE] === "sealed" ? "sealed" : "mounted";
  }

  async sealCapsule(namespace: string, name: string, workloadName: string, generation: number): Promise<void> {
    await this.destroyWorkload(namespace, workloadName, generation);
    const path = this.resource(namespace, "persistentvolumeclaims", name);
    const existing = await this.transport.request("GET", path);
    if (!existing) throw new EksRuntimeUnavailableError();
    assertGeneration(existing, generation);
    const updated = structuredClone(existing);
    if (updated.metadata) {
      updated.metadata.annotations = {
        ...updated.metadata.annotations,
        [GENERATION]: String(generation),
        [CAPSULE_STATE]: "sealed",
      };
    }
    delete updated.status;
    await this.transport.request("PUT", path, updated);
  }

  async destroyCapsule(namespace: string, name: string, workloadName: string, generation: number): Promise<void> {
    await this.destroyWorkload(namespace, workloadName, generation);
    const path = this.resource(namespace, "persistentvolumeclaims", name);
    const existing = await this.transport.request("GET", path);
    if (!existing) return;
    assertGeneration(existing, generation);
    await this.deleteAndWait(path);
  }

  async reconcileWorkload(spec: EksWorkloadSpec, signal?: AbortSignal): Promise<EksRuntimeObservation> {
    const labels = {
      "app.kubernetes.io/managed-by": "opencloudos",
      "app.kubernetes.io/name": "opencloudos-runtime",
      "opencloudos.io/workload": createHash("sha256").update(spec.name).digest("hex").slice(0, 32),
      "opencloudos.io/network-policy": spec.networkPolicyHash,
    };
    const desired: KubernetesObject = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        annotations: {
          [GENERATION]: String(spec.generation),
          [DESIRED_HASH]: spec.desiredHash,
          "opencloudos.io/tenant": spec.tenantHash,
          "opencloudos.io/resource-policy": spec.resourcePolicyHash,
          "opencloudos.io/storage-policy": spec.storagePolicyHash,
        },
        labels,
      },
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: { "opencloudos.io/workload": labels["opencloudos.io/workload"] } },
        template: {
          metadata: { labels, annotations: { [GENERATION]: String(spec.generation) } },
          spec: {
            serviceAccountName: spec.serviceAccountName,
            automountServiceAccountToken: false,
            securityContext: { runAsNonRoot: true, fsGroup: 1000, seccompProfile: { type: "RuntimeDefault" } },
            containers: [{
              name: "runtime",
              image: spec.image,
              imagePullPolicy: "IfNotPresent",
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
              resources: { requests: { cpu: spec.cpuRequest, memory: spec.memoryRequest } },
              env: [
                { name: "OPENCLOUDOS_WORKLOAD_KIND", value: spec.kind },
                { name: "OPENCLOUDOS_WORKLOAD_GENERATION", value: String(spec.generation) },
              ],
              ...(spec.capsuleClaimName ? {
                volumeMounts: [{ name: "credential-capsule", mountPath: "/var/lib/opencloudos/capsule" }],
              } : {}),
            }],
            ...(spec.capsuleClaimName ? {
              volumes: [{ name: "credential-capsule", persistentVolumeClaim: { claimName: spec.capsuleClaimName } }],
            } : {}),
          },
        },
      },
    };
    await this.upsert(spec.namespace, "deployments", spec.name, desired);
    const resource = await this.waitFor(
      this.resource(spec.namespace, "deployments", spec.name),
      (candidate) => deploymentState(candidate) !== "starting",
      signal,
    );
    return { state: deploymentState(resource), endpointRef: `k8s:deployment:${spec.namespace}/${spec.name}` };
  }

  async inspectWorkload(namespace: string, name: string): Promise<EksRuntimeObservation | undefined> {
    const resource = await this.transport.request("GET", this.resource(namespace, "deployments", name));
    return resource ? { state: deploymentState(resource), endpointRef: `k8s:deployment:${namespace}/${name}` } : undefined;
  }

  async destroyWorkload(namespace: string, name: string, generation: number): Promise<void> {
    const path = this.resource(namespace, "deployments", name);
    const existing = await this.transport.request("GET", path);
    if (!existing) return;
    assertGeneration(existing, generation);
    await this.deleteAndWait(path);
  }

  close(): void {
    this.transport.close();
  }
}
