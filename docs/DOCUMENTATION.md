# Documentation Policy

Documentation is part of the OpenCloudOS product and its engineering control system. The wiki is not a retrospective marketing artifact; it is how maintainers discover current intent, review changes, operate releases, and avoid repeating rejected designs.

## Sources of truth

1. `LICENSE` owns the MIT terms for original project work; `THIRD_PARTY_NOTICES.md` owns the high-level provenance boundary.
2. `CONTEXT.md` owns domain language and relationships.
3. `docs/adr/` owns hard-to-reverse decisions and their rationale.
4. `docs/ARCHITECTURE.md` owns current system shape, invariants, state, flows, and failure behavior.
5. `docs/EXECUTION_PLAN.md` owns milestones, workstreams, sequencing, and exit gates.
6. `docs/SUBSCRIPTION_AUTH.md` owns agent-provider connection, credential-isolation, billing-authority, and AUTH behavior.
7. `docs/PROVIDER_COMPATIBILITY.md` owns the time-sensitive provider support and policy matrix.
8. `docs/DEPLOYMENT_PROFILES.md` owns the profile protocol, capabilities, configuration, reconciliation, migration, cloud mapping, and PROFILE conformance contract.
9. `docs/AWS_PROFILE.md` owns AWS bootstrap, configuration, IAM/RBAC, service behavior, recovery, cost, limitations, and promotion evidence.
10. `docs/PROJECT_LOG.md` owns the chronological record of completed work.
11. The public wiki renders the important parts of these records for readers.

When code and documentation disagree, the pull request must resolve the disagreement before merge. Neither side silently wins.

## Required update by change type

| Change | Required documentation |
|---|---|
| New domain concept or renamed concept | `CONTEXT.md` and wiki language section |
| Hard-to-reverse architectural choice | New or superseding ADR and wiki decision registry |
| Module interface or invariant change | `docs/ARCHITECTURE.md` and relevant wiki section |
| Milestone scope or dependency change | `docs/EXECUTION_PLAN.md` and wiki execution plan |
| Deployment Profile protocol, driver, or operational behavior | `docs/DEPLOYMENT_PROFILES.md`, the provider-specific support record, architecture, conformance, compatibility, and runbook content |
| Security behavior | Threat model, conformance scenario, and relevant ADR |
| Agent provider authentication, entitlement, or billing behavior | `docs/SUBSCRIPTION_AUTH.md`, architecture, compatibility matrix, conformance scenario, and relevant ADR |
| Project license or imported-source provenance | `LICENSE`, `THIRD_PARTY_NOTICES.md`, architecture, package metadata, relevant ADR, and wiki license section |
| User-visible capability | Product model, acceptance criteria, and project log |
| Any merged pull request | `docs/PROJECT_LOG.md` entry or explicit `docs-not-needed` rationale |

## Definition of documented

A change is documented when a maintainer unfamiliar with the implementation can determine:

- what changed and why;
- which module owns the behavior;
- which interface callers depend on;
- what invariants must remain true;
- what new failure modes exist;
- how the behavior is verified;
- how the change affects rollout, recovery, and compatibility;
- which decision record authorizes a hard-to-reverse tradeoff.

## Pull request workflow

1. Start with a vertical outcome and acceptance evidence.
2. Update domain language before introducing a new project-specific term.
3. Add or update the architectural record while the design is being made.
4. Add conformance scenarios at the same seam used by callers.
5. Update the public wiki in the same pull request.
6. Add a project-log entry describing the shipped outcome.
7. Review documentation and implementation as one change.

## Decision records

Create an ADR only when a decision is hard to reverse, surprising without context, and the result of a real tradeoff. Do not use ADRs as meeting minutes or implementation logs. Supersede an ADR rather than rewriting history.

## Project log format

Each entry includes:

- date;
- status (`planned`, `in progress`, `shipped`, `superseded`);
- outcome;
- decisions or assumptions introduced;
- verification performed;
- links to related ADRs and code.

## Enforcement plan

Milestone 0 adds a documentation check to continuous integration. It will verify that material changes either update documentation paths or carry an approved `docs-not-needed` label with a rationale. Security, runtime, and deployment changes cannot use the exemption.
