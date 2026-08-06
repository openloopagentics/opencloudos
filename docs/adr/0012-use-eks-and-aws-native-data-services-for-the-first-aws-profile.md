# ADR-0012: Use EKS and AWS-native data services for the first AWS profile

- **Status:** Proposed
- **Date:** 2026-08-06
- **Owners:** OpenCloudOS maintainers
- **Related:** ADR-0002, ADR-0005, ADR-0006, ADR-0007, ADR-0010, ADR-0011

## Context

Deployment Profile protocol v1 makes AWS a package-level implementation choice, but it does not choose the AWS substrate. The first implementation must preserve the Kubernetes production baseline, give Provider Runners a mutable isolated Credential Capsule, enforce durable generation fences, and keep AWS credentials out of ordinary configuration.

The initial architecture table mapped AWS control metadata to managed PostgreSQL. Protocol v1 only requires strongly conflicting compare-and-swap records for the profile's deployment state; it does not require those profile-internal records to share the product control-plane database. DynamoDB conditional writes provide a smaller first adapter for this seam. Product Tenant, Workspace, policy, audit, and collaboration metadata remain PostgreSQL responsibilities under ADR-0005.

## Decision

Implement profile `aws-eks` version `0.1.0` as follows:

- EKS Deployments are the Workload Runtime, managed from an in-cluster controller through narrow namespace RBAC;
- EFS CSI dynamically provisioned PVCs are Credential Capsules;
- S3 is the immutable Artifact Store;
- Secrets Manager is the sealed Secret Store;
- DynamoDB strongly consistent reads and conditional writes store profile generations, links, tombstones, and protocol Control Metadata;
- Cognito ID tokens are verified and normalized by the Identity driver;
- CloudWatch Logs is the initial Telemetry sink;
- AWS SDK credentials come only from the default chain, with EKS Pod Identity preferred for the controller;
- shared AWS infrastructure is pre-provisioned outside profile v0.1.0;
- the profile remains experimental until real-resource conformance, recovery, security, cost, and operator gates pass.

Every Provider Runner reconcile requires a mounted Credential Capsule. Both DynamoDB and Kubernetes resource annotations fence generation and desired-state hash. S3, Secrets Manager, and object backups are never treated as the live official-client credential filesystem.

## Consequences

Positive:

- AWS code remains outside the core Deployment Profile SDK;
- the workload model stays aligned with GKE, AKS, and self-hosted Kubernetes profiles;
- real AWS APIs directly express immutability, compare-and-swap, sealed versioning, and managed telemetry;
- controller restart does not erase the generation fence;
- no static AWS credential becomes profile configuration.

Costs and constraints:

- the operator must bootstrap EKS, Linux nodes, EFS CSI, IAM, networking, data services, Cognito, and image distribution;
- EFS dynamic provisioning excludes the current design from Fargate-only clusters;
- a DynamoDB dependency is introduced in addition to the product's future PostgreSQL control plane;
- CloudWatch Logs is the first sink rather than the long-term OTLP portability target;
- force-deleted secrets and destroyed capsules require reauthentication or an explicitly governed backup path;
- deterministic fakes are necessary but insufficient evidence, so the public support label remains experimental.

## Rejected alternatives

### ECS/Fargate plus EFS

This could reduce Kubernetes bootstrap but would create an AWS-only scheduler and weaken the common workload contract before GCP and Azure profiles exist.

### S3 as the Credential Capsule

S3 is not a POSIX-like mutable credential cache, and mounting it would collapse the explicit distinction between immutable artifacts/backups and live official-client state.

### EBS per Provider Runner

EBS is viable for single-node `ReadWriteOnce` workloads, but the initial profile chooses EFS CSI access points for portable rescheduling and `ReadWriteMany` semantics. Live qualification must validate the security and quota consequences.

### RDS PostgreSQL for all profile state

Product control metadata is still expected to use PostgreSQL. For the adapter's narrow generation/CAS records, adding schema, pooling, and migration coupling before any AWS evidence is less direct than DynamoDB conditional writes. A later profile version may consolidate this after operational comparison.

## Validation

- AWS-001 through AWS-006 pass in `packages/profile-aws/test/aws-profile.test.ts`;
- the AWS profile passes PROFILE-001 through PROFILE-011 against deterministic AWS/EKS fakes;
- AWS SDK command construction is exercised without credentials or network calls;
- no live AWS resource, account credential, or production Provider Runner was used.

Promotion requires the live gates in `docs/AWS_PROFILE.md`.
