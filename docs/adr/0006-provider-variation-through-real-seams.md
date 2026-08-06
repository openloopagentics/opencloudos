---
status: proposed
---

# Put provider variation behind real seams

OpenCloudOS will introduce a portable seam only when at least two adapters exist or are implemented in the same milestone. The initial real seams are Artifact Repository with filesystem/MinIO and S3-compatible adapters, Identity with local and OIDC adapters, and Conformance Harness with upstream and local targets.

## Consequences

Core modules cannot import cloud-provider SDKs. A one-off adapter does not justify a public interface; provider-specific behavior stays local until real variation demonstrates the seam and the interface can hide meaningful complexity.
