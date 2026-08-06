## Outcome

<!-- What user, operator, or contributor outcome does this change deliver? -->

## Verification

<!-- List automated and manual evidence. Link conformance scenarios where applicable. -->

## Architecture and security

- [ ] The owning module and its interface are clear.
- [ ] Invariants, error modes, retries, ordering, and recovery are tested.
- [ ] Tenant, capability, credential, audit, and egress effects were reviewed.
- [ ] Agent-provider changes preserve per-user connection ownership, official-client credential custody, explicit billing mode, and vendor-policy gates.
- [ ] Provider-specific behavior remains inside an adapter at a real seam.
- [ ] Deployment Profile changes preserve exact manifests/configuration, capability parity, generation fencing, checkpointed migration, and PROFILE conformance.
- [ ] No new hard-to-reverse decision was made, or an ADR is linked below.

## Wiki and records

- [ ] `CONTEXT.md` reflects new or changed domain language.
- [ ] `docs/ARCHITECTURE.md` reflects module or runtime behavior changes.
- [ ] `docs/EXECUTION_PLAN.md` reflects milestone, dependency, or scope changes.
- [ ] `docs/DEPLOYMENT_PROFILES.md` reflects profile protocol or driver changes.
- [ ] The public wiki exposes the material change.
- [ ] `docs/PROJECT_LOG.md` includes the shipped outcome.
- [ ] Documentation is not required; rationale: <!-- explain, not allowed for security/runtime/deployment changes -->

## Decisions

<!-- Link new, accepted, superseded, or affected ADRs. -->

## Rollout and recovery

<!-- Describe migration, compatibility, rollback, recovery, and operator actions. -->
