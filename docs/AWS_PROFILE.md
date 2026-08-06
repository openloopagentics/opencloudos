# AWS EKS Deployment Profile

**Support status:** experimental implementation. The package contains real AWS SDK and in-cluster Kubernetes API bindings and passes the reusable Deployment Profile suite against deterministic AWS/EKS fakes. It has not run against an ephemeral AWS account, has no supported infrastructure module, and must not yet be advertised as production-supported.

**Package:** `packages/profile-aws`  
**Profile ID:** `aws-eks`  
**Profile version:** `0.1.0`  
**Protocol:** Deployment Profile v1  
**Architectures:** Linux amd64 and arm64

## What is implemented

| Capability | AWS implementation | Enforced behavior |
|---|---|---|
| Artifact Store | Amazon S3 general-purpose bucket | SHA-256 verification, `If-None-Match: *` conditional creation, tenant-hashed keys, read verification, immutable conflict detection |
| Secret Store | AWS Secrets Manager | Binary secret versions, unique physical name after destruction, opaque workload binding, no read/export method, force-delete lifecycle |
| Credential Capsule | Amazon EKS PVC backed by an operator-selected EFS CSI StorageClass | One PVC per tenant/capsule, one workload link, `ReadWriteMany`, mount/seal/destroy, PVC and DynamoDB generation fences |
| Control Metadata | Amazon DynamoDB | Strongly consistent reads, conditional `PutItem`, durable tombstones, monotonic record versions, tenant-hashed partition keys |
| Identity | Amazon Cognito user-pool ID token | Signature/expiry/pool/client verification through `aws-jwt-verify`; normalized tenant, user, groups, and expiry; token is not returned |
| Workload Runtime | Amazon EKS Deployment through the in-cluster Kubernetes API | Digest-pinned image, restricted container security context, policy labels, required capsule for Provider Runners, durable and Kubernetes generation fences |
| Telemetry | Amazon CloudWatch Logs | Sorted/bounded batches, no sequence-token dependency, rejection of credential-shaped attribute names |

The whole-profile reconciler records which pre-provisioned S3, DynamoDB, and EKS resources belong to a Deployment Generation. Version `0.1.0` does not create or destroy shared AWS infrastructure.

## Why this mapping

The AWS profile keeps the first production substrate aligned with ADR-0002: EKS remains Kubernetes rather than introducing an AWS-only scheduler. EFS CSI supplies a mutable filesystem attachment for official-client credential caches; S3 remains an immutable artifact and backup service, not a live credential filesystem. DynamoDB is used for this profile's compact generation and compare-and-swap records because conditional writes directly implement protocol-v1 fencing.

S3 conditional puts return a precondition failure when an object already exists. DynamoDB condition expressions make writes contingent on the current record version. EKS PVCs and Deployments carry the desired generation and hash as annotations, so a stale controller cannot overwrite a newer object even if its process-local state was lost.

## Bootstrap boundary

The operator must provision these resources before installing the profile:

1. An EKS cluster with Linux EC2 nodes. The current dynamic EFS capsule path is not compatible with EKS Fargate.
2. The EKS Pod Identity Agent for the OpenCloudOS controller's AWS role, or an equivalent default AWS SDK credential-chain configuration. No static AWS key belongs in profile configuration.
3. The Amazon EFS CSI add-on, its dedicated IAM role, an encrypted EFS file system with mount targets, and an EFS access-point StorageClass.
4. A general-purpose S3 artifact bucket. Enable default encryption, versioning, public-access blocking, and the required retention policy outside the profile.
5. A DynamoDB table with string partition key `pk` and string sort key `sk`. On-demand capacity and point-in-time recovery are the recommended experimental defaults.
6. A CloudWatch Logs group and stream. This version writes events but does not create either resource.
7. A Cognito user pool and app client. ID tokens must contain the string custom attribute `custom:tenant_id`; optional `cognito:groups` values become normalized groups.
8. Namespace-level NetworkPolicies matching the hash label `opencloudos.io/network-policy`. The included default-deny example intentionally permits no provider egress until an operator adds an explicit policy.
9. An immutable runtime image in ECR or another registry, addressable as `repository@sha256:digest` by every EKS node architecture in use.

[`packages/profile-aws/examples/eks-bootstrap.yaml`](../packages/profile-aws/examples/eks-bootstrap.yaml) is a reviewable starting point for namespace RBAC, two service accounts, EFS StorageClass, and default-deny networking. Replace all placeholders and add explicit DNS/provider egress before use. It is not an infrastructure installer.

## Configuration

Profile configuration contains names and policy references, never AWS access keys, session tokens, Cognito tokens, client secrets, or official-agent credential material.

| Field | Required/default | Meaning |
|---|---|---|
| `region` | required | AWS SDK region |
| `artifactBucketRef` | required | Existing S3 bucket name or access-point reference |
| `artifactPrefix` | `opencloudos` | Tenant artifact key prefix |
| `metadataTableRef` | required | Existing DynamoDB table name |
| `secretPrefix` | `opencloudos` | Physical Secrets Manager name prefix |
| `telemetryLogGroupRef` | required | Existing CloudWatch Logs group |
| `telemetryLogStreamRef` | required | Existing CloudWatch Logs stream |
| `eksNamespace` | required | Existing namespace in which the controller may manage Deployments and PVCs |
| `eksServiceAccountRef` | required | Service account assigned to managed runtime workloads |
| `capsuleStorageClassRef` | required | EFS CSI StorageClass name |
| `capsuleSizeGi` | `5` | PVC request; EFS remains elastic but Kubernetes requires a request |
| `workloadImageRepository` | required | Repository without tag or digest; the desired release digest is appended |
| `workloadCpuRequest` | `500m` | Runtime container CPU request |
| `workloadMemoryRequest` | `1Gi` | Runtime container memory request |
| `workloadResourcePolicyRef` | required | Only accepted resource-policy reference |
| `workloadNetworkPolicyRef` | required | Only accepted network-policy reference; its hash labels the Pod |
| `workloadStoragePolicyRef` | required | Only accepted workload-storage reference |
| `capsuleStoragePolicyRef` | required | Only accepted capsule-storage reference |
| `readinessTimeoutSeconds` | `120` | PVC binding, Deployment availability, and deletion deadline |
| `identityIssuer` | required | Exact Cognito issuer URL |
| `identityAudienceRef` | required | Cognito app client ID checked as ID-token audience |
| `identityUserPoolRef` | required | Cognito user-pool ID used to load and cache its JWKS |

Example registration and instantiation:

```ts
import { DeploymentProfileRegistry } from "./packages/deployment-profile-sdk/src/index.js";
import { createAwsDeploymentProfile } from "./packages/profile-aws/src/index.js";

const registry = new DeploymentProfileRegistry();
registry.register(createAwsDeploymentProfile());

const profile = await registry.instantiate("aws-eks", {
  region: "us-west-2",
  artifactBucketRef: "opencloudos-artifacts",
  metadataTableRef: "opencloudos-control",
  telemetryLogGroupRef: "/aws/opencloudos/profile",
  telemetryLogStreamRef: "control",
  eksNamespace: "opencloudos-system",
  eksServiceAccountRef: "opencloudos-runtime",
  capsuleStorageClassRef: "efs-opencloudos",
  workloadImageRepository: "123456789012.dkr.ecr.us-west-2.amazonaws.com/opencloudos-runtime",
  workloadResourcePolicyRef: "policy:resources",
  workloadNetworkPolicyRef: "policy:network",
  workloadStoragePolicyRef: "policy:storage",
  capsuleStoragePolicyRef: "policy:capsule-storage",
  identityIssuer: "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_EXAMPLE",
  identityAudienceRef: "cognito-app-client-id",
  identityUserPoolRef: "us-west-2_EXAMPLE"
});
```

The default factory reads the controller Pod's mounted Kubernetes service-account token and CA certificate and uses the AWS SDK default credential chain. Tests and specialized operators can inject the same narrow AWS, EKS, and identity ports; profile behavior does not branch on the fake.

## IAM and Kubernetes authority

Attach the least-privilege AWS policy to the **profile controller** Pod Identity role, not the Provider Runner workload. The reviewed action set is:

- `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on the configured artifact prefix;
- `dynamodb:GetItem` and `dynamodb:PutItem` on the metadata table;
- `secretsmanager:CreateSecret`, `PutSecretValue`, `DeleteSecret`, and `TagResource` on the secret prefix;
- `logs:PutLogEvents` on the configured log stream;
- KMS permissions only when the selected customer-managed keys require them.

The EFS CSI controller uses a separate role and the permissions recommended for that add-on. Cognito verification downloads public JWKS and requires network access, not AWS IAM permission. ECR image-pull authority belongs to the node/runtime image-pull path, not this profile role.

[`packages/profile-aws/examples/iam-policy.json`](../packages/profile-aws/examples/iam-policy.json) contains placeholders for the controller policy. Kubernetes RBAC grants its service account only `get`, `create`, `update`, and `delete` on Deployments and PVCs in one namespace. The runtime service account is distinct and has token automount disabled in the example.

## Lifecycle and failure behavior

### Artifacts

The driver hashes Tenant and artifact references into the key, verifies the submitted SHA-256 locally, performs a conditional S3 put, and verifies bytes again on read. A racing writer converges only when the stored digest matches; otherwise the operation returns a normalized immutable conflict.

### Secrets

Secret material is copied only for the SDK call and the copy is zeroed afterward. A logical secret points from DynamoDB to one Secrets Manager ARN/version. Destroy first writes a durable logical tombstone, then force-deletes the physical secret. A retry repeats physical deletion. Resealing uses a new UUID-suffixed physical name, so Secrets Manager's asynchronous name deletion cannot block reauthorization and a destroyed version identity is never reused.

Secrets Manager version growth is a real quota/cost concern: callers must not use `seal` as a high-frequency state write. Live qualification must prove bounded rotation behavior.

### Capsules and workloads

The controller reconciles a capsule before its Provider Runner. DynamoDB records the logical generation; the PVC and Deployment record the same generation and desired hash. Sealing deletes the bound Deployment before marking the PVC sealed. Destroying deletes the Deployment and PVC before writing tombstones. Remount requires a strictly newer generation.

The default `Recreate` Deployment strategy and one-replica selector prevent overlapping mounts for one workload name. This is necessary but not sufficient production evidence: live tests must prove pod termination, EFS access-point cleanup, node loss, controller restart, and stale-writer races.

### Identity and telemetry

The identity driver accepts only the configured issuer and audience before verifying the Cognito ID token. It emits only normalized identifiers/groups/expiry. Telemetry rejects attribute keys containing `authorization`, `password`, `secret`, or `token`, sorts events by timestamp, and stays within CloudWatch batch limits.

## Known v0.1 limitations

- Protocol v1 returns an opaque `WorkloadSecretBinding`, but `WorkloadDesiredState` has no secret-binding field. The AWS driver verifies the Secrets Manager version still exists and returns the binding; it does not inject that secret into an EKS Pod. Define the portable consumption path before claiming workload secret delivery.
- `resourcePolicyRef`, `networkPolicyRef`, and `storagePolicyRef` must exactly match configured references. The EKS workload carries their hashes as labels/annotations, but the profile does not create the corresponding admission or NetworkPolicy resources.
- A workload `endpointRef` identifies the EKS Deployment. It is not a public or app-server endpoint. The local-stdio Provider Runner supervisor and a future narrow Broker transport must live inside the workload; raw app-server stdio must never be exposed through a Kubernetes Service.
- Deployment reconciliation records pre-provisioned shared resources but does not verify or provision their complete infrastructure lifecycle.
- Deployment availability proves a restricted container is running; it does not replace the Codex supervisor's app-server initialization health check.
- CloudWatch Logs is an AWS-specific first sink. OTLP interoperability and trace/metric behavior remain future profile work.
- The in-cluster Kubernetes client supports the v0.1 Deployment/PVC shapes only. Kubernetes API version skew, watch-based convergence, throttling, and admission-webhook behavior still need live qualification.

These are published gaps, not silently accepted deviations. Any protocol change they require must update `docs/DEPLOYMENT_PROFILES.md`, conformance, ADRs, and every profile together.

## Recovery and destruction

| Incident | Recovery |
|---|---|
| Controller restart | Recreate the profile with the same configuration; strongly consistent DynamoDB state and EKS annotations preserve fences |
| Deployment or Pod loss | Reconcile the current higher generation; EKS recreates the Deployment while the capsule record selects the PVC |
| DynamoDB data loss | Restore the table with point-in-time recovery to a new table, stop all reconcilers, validate generations against EKS annotations, then resume with a newer Deployment Generation |
| S3 accidental delete | Recover a prior object version when bucket versioning/retention permits; verify SHA-256 before republishing metadata |
| Secret destruction | No credential recovery is promised; recreate the logical secret or require the official provider client to authenticate again |
| Capsule PVC destruction | Treat credentials as destroyed. Restore only an operator-approved encrypted backup into a new PVC and force provider revalidation; otherwise reauthenticate |
| EFS or Availability Zone failure | Follow the EFS regional recovery plan, then reconcile workloads; live multi-AZ and restore evidence is still missing |

`CredentialCapsule.destroy` is intentionally destructive. With the example StorageClass's `Delete` reclaim policy, deleting a PVC also asks the CSI driver to remove the access point. Operators must decide whether encrypted backups are required and must never interpret an object-store backup as a mountable live credential cache.

## Cost and quota surface

The main recurring costs are the EKS control plane and nodes, EFS storage/throughput, S3 storage/requests, DynamoDB reads/writes/storage, Secrets Manager secrets/API calls, CloudWatch ingestion/retention, NAT or private endpoints, and Cognito monthly active users. Per-user capsules can approach EFS access-point quotas before raw storage is material. Log retention, artifact lifecycle, secret rotation rate, DynamoDB capacity mode, private endpoints, and idle node capacity must be explicit operator settings before support.

No cost claim is stable enough to hard-code in this record. A supported profile needs a versioned cost worksheet populated from the target region during live qualification.

## Executable evidence

| Scenario | Current evidence |
|---|---|
| AWS-001 | All seven protocol-v1 capabilities declared by an `aws` profile; core SDK has no AWS import |
| AWS-002 | PROFILE-001 through PROFILE-011 pass against deterministic AWS/EKS fakes |
| AWS-003 | Provider Runner fails closed until its mounted capsule exists; mounted PVC reaches the EKS workload spec |
| AWS-004 | Credential-shaped telemetry attributes fail before CloudWatch |
| AWS-005 | Closing the profile closes AWS/EKS clients and all retained drivers fail closed |
| AWS-006 | AWS command binding proves S3 precondition/checksum input, strongly consistent DynamoDB read and conditional write, binary Secrets Manager input, and CloudWatch batch input |

The deterministic suite makes contract regressions cheap and proves that fake and production bindings use the same driver code. It does **not** prove IAM, networking, AWS consistency under failure, EFS semantics, Cognito JWKS access, CloudWatch quotas, or cleanup in a real account.

## Promotion gate

Change the support label from `experimental` to `supported` only after all of the following are published:

1. repeatable IaC creates and destroys an isolated AWS account/region environment;
2. the profile runs PROFILE-001 through PROFILE-011 against real S3, Secrets Manager, DynamoDB, Cognito, CloudWatch Logs, EKS, and EFS CSI resources;
3. amd64 and arm64 image pulls and Provider Runner startup pass;
4. controller restart, stale generation, concurrent reconcile, Pod/node loss, EFS remount, and AWS throttling tests pass;
5. backup/restore and irreversible secret/capsule destruction drills pass;
6. least-privilege IAM, Kubernetes RBAC, default-deny egress, KMS, CloudTrail, and log-redaction review pass;
7. quotas, regional availability, cost envelope, SLOs, alerts, and operator rollback are documented;
8. a clean operator follows only the wiki and completes install, upgrade, recovery, and removal.

## Primary AWS references

- [S3 PutObject conditional requests and checksums](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
- [Secrets Manager PutSecretValue idempotency and version behavior](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html)
- [DynamoDB conditional expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [Amazon EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)
- [Amazon EFS CSI storage on EKS](https://docs.aws.amazon.com/eks/latest/userguide/efs-csi.html)
- [Cognito JWT verification with `aws-jwt-verify`](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
- [CloudWatch Logs PutLogEvents](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html)
