import {
  CloudWatchLogsClient,
  PutLogEventsCommand,
  type InputLogEvent,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export interface AwsArtifactHead {
  digest: string;
  size: number;
}

export interface AwsStateRecord {
  pk: string;
  sk: string;
  version: number;
  deleted: boolean;
  payload: string;
}

export type AwsStateCondition =
  | { kind: "absent" }
  | { kind: "version"; version: number };

export interface AwsSecretVersionResult {
  arn: string;
  versionId: string;
}

export interface AwsProfileApi {
  headArtifact(bucket: string, key: string): Promise<AwsArtifactHead | undefined>;
  putArtifactImmutable(
    bucket: string,
    key: string,
    digest: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void>;
  readArtifact(bucket: string, key: string): Promise<Uint8Array | undefined>;
  deleteArtifact(bucket: string, key: string): Promise<void>;
  createSecret(name: string, material: Uint8Array, requestToken: string): Promise<AwsSecretVersionResult>;
  putSecretVersion(secretId: string, material: Uint8Array, requestToken: string): Promise<AwsSecretVersionResult>;
  secretExists(secretId: string): Promise<boolean>;
  deleteSecret(secretId: string): Promise<void>;
  getStateRecord(tableName: string, pk: string, sk: string): Promise<AwsStateRecord | undefined>;
  putStateRecord(tableName: string, record: AwsStateRecord, condition: AwsStateCondition): Promise<void>;
  putLogEvents(logGroupName: string, logStreamName: string, events: InputLogEvent[]): Promise<void>;
  close(): void;
}

export class AwsApiConflictError extends Error {
  constructor() {
    super("AWS conditional operation conflicted");
    this.name = "AwsApiConflictError";
  }
}

export class AwsApiUnavailableError extends Error {
  constructor() {
    super("AWS operation is unavailable");
    this.name = "AwsApiUnavailableError";
  }
}

interface CommandClient {
  send(command: object, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
  destroy?(): void;
}

export interface AwsSdkClientSet {
  s3: CommandClient;
  secretsManager: CommandClient;
  dynamodb: CommandClient;
  cloudWatchLogs: CommandClient;
}

function errorName(error: unknown): string | undefined {
  return error && typeof error === "object" && "name" in error && typeof error.name === "string"
    ? error.name
    : undefined;
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("$metadata" in error)) return undefined;
  const metadata = error.$metadata;
  if (!metadata || typeof metadata !== "object" || !("httpStatusCode" in metadata)) return undefined;
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function isMissing(error: unknown): boolean {
  return statusCode(error) === 404 || ["NoSuchKey", "NotFound", "ResourceNotFoundException"].includes(errorName(error) ?? "");
}

function isConflict(error: unknown): boolean {
  return statusCode(error) === 409
    || statusCode(error) === 412
    || ["ConditionalCheckFailedException", "ConditionalRequestConflict", "PreconditionFailed"].includes(errorName(error) ?? "");
}

function asNumber(value: AttributeValue | undefined): number | undefined {
  if (!value || !("N" in value) || value.N === undefined) return undefined;
  const parsed = Number(value.N);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function asString(value: AttributeValue | undefined): string | undefined {
  return value && "S" in value ? value.S : undefined;
}

function asBoolean(value: AttributeValue | undefined): boolean | undefined {
  return value && "BOOL" in value ? value.BOOL : undefined;
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body && typeof body === "object" && "transformToByteArray" in body && typeof body.transformToByteArray === "function") {
    return new Uint8Array(await body.transformToByteArray());
  }
  throw new AwsApiUnavailableError();
}

export class AwsSdkProfileApi implements AwsProfileApi {
  constructor(private readonly clients: AwsSdkClientSet) {}

  async headArtifact(bucket: string, key: string): Promise<AwsArtifactHead | undefined> {
    try {
      const output = await this.clients.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })) as {
        Metadata?: Record<string, string>;
        ContentLength?: number;
      };
      const digest = output.Metadata?.["opencloudos-digest"];
      if (!digest || !Number.isSafeInteger(output.ContentLength) || (output.ContentLength ?? -1) < 0) {
        throw new AwsApiUnavailableError();
      }
      return { digest, size: output.ContentLength! };
    } catch (error: unknown) {
      if (isMissing(error)) return undefined;
      if (error instanceof AwsApiUnavailableError) throw error;
      throw new AwsApiUnavailableError();
    }
  }

  async putArtifactImmutable(
    bucket: string,
    key: string,
    digest: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.clients.s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ChecksumSHA256: Buffer.from(digest.slice("sha256:".length), "hex").toString("base64"),
        IfNoneMatch: "*",
        Metadata: { "opencloudos-digest": digest },
      }), { abortSignal: signal });
    } catch (error: unknown) {
      if (isConflict(error)) throw new AwsApiConflictError();
      throw new AwsApiUnavailableError();
    }
  }

  async readArtifact(bucket: string, key: string): Promise<Uint8Array | undefined> {
    try {
      const output = await this.clients.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })) as { Body?: unknown };
      return await bodyBytes(output.Body);
    } catch (error: unknown) {
      if (isMissing(error)) return undefined;
      throw new AwsApiUnavailableError();
    }
  }

  async deleteArtifact(bucket: string, key: string): Promise<void> {
    try {
      await this.clients.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      throw new AwsApiUnavailableError();
    }
  }

  async createSecret(name: string, material: Uint8Array, requestToken: string): Promise<AwsSecretVersionResult> {
    try {
      const output = await this.clients.secretsManager.send(new CreateSecretCommand({
        Name: name,
        ClientRequestToken: requestToken,
        SecretBinary: material,
        Tags: [{ Key: "opencloudos:managed", Value: "true" }],
      })) as { ARN?: string; VersionId?: string };
      if (!output.ARN || !output.VersionId) throw new AwsApiUnavailableError();
      return { arn: output.ARN, versionId: output.VersionId };
    } catch (error: unknown) {
      if (error instanceof AwsApiUnavailableError) throw error;
      if (isConflict(error) || errorName(error) === "ResourceExistsException") throw new AwsApiConflictError();
      throw new AwsApiUnavailableError();
    }
  }

  async putSecretVersion(secretId: string, material: Uint8Array, requestToken: string): Promise<AwsSecretVersionResult> {
    try {
      const output = await this.clients.secretsManager.send(new PutSecretValueCommand({
        SecretId: secretId,
        ClientRequestToken: requestToken,
        SecretBinary: material,
      })) as { ARN?: string; VersionId?: string };
      if (!output.ARN || !output.VersionId) throw new AwsApiUnavailableError();
      return { arn: output.ARN, versionId: output.VersionId };
    } catch (error: unknown) {
      if (error instanceof AwsApiUnavailableError) throw error;
      if (isConflict(error)) throw new AwsApiConflictError();
      throw new AwsApiUnavailableError();
    }
  }

  async secretExists(secretId: string): Promise<boolean> {
    try {
      await this.clients.secretsManager.send(new DescribeSecretCommand({ SecretId: secretId }));
      return true;
    } catch (error: unknown) {
      if (isMissing(error)) return false;
      throw new AwsApiUnavailableError();
    }
  }

  async deleteSecret(secretId: string): Promise<void> {
    try {
      await this.clients.secretsManager.send(new DeleteSecretCommand({ SecretId: secretId, ForceDeleteWithoutRecovery: true }));
    } catch (error: unknown) {
      if (isMissing(error)) return;
      throw new AwsApiUnavailableError();
    }
  }

  async getStateRecord(tableName: string, pk: string, sk: string): Promise<AwsStateRecord | undefined> {
    try {
      const output = await this.clients.dynamodb.send(new GetItemCommand({
        TableName: tableName,
        Key: { pk: { S: pk }, sk: { S: sk } },
        ConsistentRead: true,
      })) as { Item?: Record<string, AttributeValue> };
      if (!output.Item) return undefined;
      const version = asNumber(output.Item.version);
      const deleted = asBoolean(output.Item.deleted);
      const payload = asString(output.Item.payload);
      if (version === undefined || deleted === undefined || payload === undefined) throw new AwsApiUnavailableError();
      return { pk, sk, version, deleted, payload };
    } catch (error: unknown) {
      if (error instanceof AwsApiUnavailableError) throw error;
      throw new AwsApiUnavailableError();
    }
  }

  async putStateRecord(tableName: string, record: AwsStateRecord, condition: AwsStateCondition): Promise<void> {
    const names: Record<string, string> = { "#pk": "pk", "#version": "version" };
    const values: Record<string, AttributeValue> = {};
    const conditionExpression = condition.kind === "absent" ? "attribute_not_exists(#pk)" : "#version = :expected";
    if (condition.kind === "version") values[":expected"] = { N: String(condition.version) };
    try {
      await this.clients.dynamodb.send(new PutItemCommand({
        TableName: tableName,
        Item: {
          pk: { S: record.pk },
          sk: { S: record.sk },
          version: { N: String(record.version) },
          deleted: { BOOL: record.deleted },
          payload: { S: record.payload },
        },
        ConditionExpression: conditionExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: Object.keys(values).length > 0 ? values : undefined,
      }));
    } catch (error: unknown) {
      if (isConflict(error)) throw new AwsApiConflictError();
      throw new AwsApiUnavailableError();
    }
  }

  async putLogEvents(logGroupName: string, logStreamName: string, events: InputLogEvent[]): Promise<void> {
    try {
      await this.clients.cloudWatchLogs.send(new PutLogEventsCommand({ logGroupName, logStreamName, logEvents: events }));
    } catch {
      throw new AwsApiUnavailableError();
    }
  }

  close(): void {
    const uniqueClients = new Set(Object.values(this.clients));
    for (const client of uniqueClients) {
      try {
        client.destroy?.();
      } catch {
        // Closing one SDK client must not prevent the remaining clients from closing.
      }
    }
  }
}

export function createAwsSdkProfileApi(region: string): AwsSdkProfileApi {
  return new AwsSdkProfileApi({
    s3: new S3Client({ region }) as unknown as CommandClient,
    secretsManager: new SecretsManagerClient({ region }) as unknown as CommandClient,
    dynamodb: new DynamoDBClient({ region }) as unknown as CommandClient,
    cloudWatchLogs: new CloudWatchLogsClient({ region }) as unknown as CommandClient,
  });
}
