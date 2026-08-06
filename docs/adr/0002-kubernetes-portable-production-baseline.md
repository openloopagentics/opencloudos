---
status: proposed
---

# Use Kubernetes as the portable production baseline

OpenCloudOS will use Kubernetes as its first supported production substrate, with Docker Compose for local evaluation. Kubernetes offers a common workload, networking, identity, and durable-volume model across providers; the cost is operational complexity and a deliberate decision not to support provider-native serverless platforms in 1.0.

## Consequences

Provider deployment profiles may choose managed databases, object stores, secrets, and ingress, but core product and runtime modules remain identical. A Kubernetes abstraction must not hide provider constraints that affect recovery or security; those differences belong in profile documentation and conformance evidence.
