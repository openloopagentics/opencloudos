# OpenCloudOS Domain Context

OpenCloudOS is a portable distribution of Cloudflare OS for running agent workspaces and AI-generated applications on infrastructure chosen by the operator. This language keeps product, runtime, security, and operations discussions consistent.

## Language

### Product

**Tenant**:
An organization whose users, workspaces, credentials, policy, and audit history are isolated from every other organization.
_Avoid_: Customer, account, organization

**User**:
A human identity authenticated within exactly one tenant context for a request.
_Avoid_: Account, principal

**Workspace**:
The durable collaboration and execution scope that owns chats, gadgets, capabilities, and active sessions.
_Avoid_: Project, room, agent

**Gadget**:
A user-owned application whose generated code and state execute in an isolated sandbox.
_Avoid_: App, tool, process

**Blueprint**:
A versioned, shareable snapshot from which a new gadget is created.
_Avoid_: Template, executable

**Agent Session**:
A bounded conversation and execution history through which an agent acts for a user inside a workspace.
_Avoid_: Agent, chat, run

### Authority

**Capability**:
Narrow authority to perform defined operations against one resource scope.
_Avoid_: Permission, token, connector

**Introduction**:
The deliberate act of granting an agent session or gadget a capability.
_Avoid_: Binding, connection, authorization

**Gatekeeper**:
A driver that authenticates an external system and enforces capability scope, approval, execution, and audit rules.
_Avoid_: Connector, MCP server, integration

**Prepared Action**:
A validated but uncommitted external mutation with a stable identity, preview, scope, and expiry.
_Avoid_: Pending action, dry run, simulation

**Approval Decision**:
A user's immutable decision to commit or reject a prepared action.
_Avoid_: Confirmation, permission

**Audit Event**:
An append-only fact describing security-relevant intent, authority, decision, or outcome.
_Avoid_: Log line, activity

### Runtime

**Control Plane**:
The modules that authenticate requests, assign workspace ownership, coordinate shards, and manage deployment state.
_Avoid_: Backend, management service

**Runtime Shard**:
A single-active workerd runtime and durable volume that host an assigned set of workspaces.
_Avoid_: Worker, pod, node

**Placement**:
The authoritative assignment of one workspace to one runtime shard for an epoch.
_Avoid_: Route, location, mapping

**Placement Lease**:
A time-bounded, epoch-fenced claim allowing one runtime shard to serve a workspace.
_Avoid_: Lock, ownership record

**Gadget Sandbox**:
The workerd isolate and Facet state in which one gadget executes without ambient network access.
_Avoid_: Container, VM, process

**Deployment Profile**:
A provider-specific set of adapters and infrastructure defaults satisfying the portable module interfaces.
_Avoid_: Fork, edition, environment

**Conformance Scenario**:
An end-to-end behavioral assertion executed against upstream Cloudflare OS and OpenCloudOS.
_Avoid_: Unit test, parity test

## Relationships

- A **Tenant** contains one or more **Users** and one or more **Workspaces**
- A **Workspace** is served by exactly one valid **Placement** at a time
- A **Placement** names one **Runtime Shard** and is protected by one current **Placement Lease**
- A **Workspace** contains zero or more **Gadgets** and **Agent Sessions**
- A **Blueprint** creates a new **Gadget** but never shares the source gadget's state or capabilities
- An **Introduction** grants exactly one **Capability** to one **Agent Session** or **Gadget**
- A **Gatekeeper** realizes one or more capability types for an external system
- A side-effecting capability call produces a **Prepared Action** before an **Approval Decision**
- Every authority transition and external outcome produces one or more **Audit Events**
- A **Deployment Profile** provides adapters without changing product or security semantics
- A **Conformance Scenario** verifies the same invariant across runtime implementations

## Example dialogue

> **Developer:** "Can the gadget use the user's GitHub account after sign-in?"
>
> **Domain expert:** "No. Sign-in identifies the user. The gadget gets no authority until the user makes an introduction that grants a repository-scoped capability through the GitHub gatekeeper."
>
> **Developer:** "What happens when that gadget attempts to merge a pull request?"
>
> **Domain expert:** "The gatekeeper creates a prepared action. The user records an approval decision, and only then may the gatekeeper commit it and append the outcome to the audit history."

## Flagged ambiguities

- "Agent" previously meant both the durable workspace actor and a conversation; resolved: use **Workspace** for durable ownership and **Agent Session** for one conversation and execution history.
- "Binding" previously meant runtime dependency injection and user-granted authority; resolved: use adapter configuration for runtime wiring and **Introduction** for authority.
- "Account" previously meant tenant, user identity, and connected external identity; resolved: use **Tenant**, **User**, or a gatekeeper's external identity explicitly.
- "App" previously meant the overall product and a generated application; resolved: use OpenCloudOS for the product and **Gadget** for generated applications.
