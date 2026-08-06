# Deployment Profile SDK

This package is the provider-neutral extension framework for OpenCloudOS infrastructure. Operator-installed profile packages register a versioned manifest, declarative configuration schema, capability drivers, deployment reconciler, and migration graph. Core modules discover capabilities without importing AWS, GCP, Azure, Kubernetes, or self-hosted SDKs.

Implemented capabilities:

- immutable artifact storage;
- sealed secret ingress and opaque workload binding with no read/export Interface;
- generation-fenced Credential Capsule mount, seal, inspection, and irreversible destruction;
- tenant-scoped control metadata with compare-and-swap;
- normalized identity;
- generation-fenced workload reconciliation;
- normalized telemetry;
- generation-fenced whole-profile reconciliation;
- checkpointed, resumable, reversible migration planning;
- strict configuration validation that reports field/reason codes without submitted values;
- PROFILE-001 through PROFILE-011 reusable conformance scenarios.

The included `synthetic-conformance` profile implements every capability without cloud credentials or external resources. It is test evidence, not a production deployment profile.

## Profile package convention

A production adapter should be a separately versioned operator-installed package such as:

```text
@opencloudos/profile-aws
@opencloudos/profile-gcp
@opencloudos/profile-azure
@opencloudos/profile-kubernetes
@opencloudos/profile-self-hosted
```

Each package exports a factory returning `DeploymentProfile`. OpenCloudOS registers trusted packages during process startup; it does not download or execute profile code from a request, manifest URL, workspace, or Gadget.

Configuration is flat and declarative. Secret material is not configuration: schemas may accept opaque secret references, while trusted bootstrap or administration paths seal the underlying value directly into the profile's `SecretStoreDriver`.

Run the package and Broker contracts with `npm run test:contracts` from the repository root.
