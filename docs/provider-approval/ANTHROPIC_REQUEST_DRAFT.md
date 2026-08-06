# Draft: Anthropic Third-Party Subscription Authentication Approval Request

**Status:** draft only — not sent  
**Owner:** project maintainer to assign  
**Prepared:** 2026-08-05

## Suggested subject

Request for approval: user-bound Claude subscription authentication in the open-source OpenCloudOS agent runtime

## Draft request

Hello Anthropic team,

OpenCloudOS is an open-source, provider-neutral distribution inspired by the open-sourced Cloudflare OS architecture. It gives users private agent workspaces and sandboxed generated applications on infrastructure selected by the operator.

We would like written approval and implementation guidance for allowing each OpenCloudOS user to connect an eligible Claude Pro, Max, Team, or Enterprise subscription to a user-scoped Claude Agent SDK or Claude Code runner.

We are requesting separate guidance for:

1. an open-source, self-hosted distribution operated by the user or their organization; and
2. a possible future hosted, multi-tenant OpenCloudOS offering.

We understand the current Claude Agent SDK documentation to require prior approval before a third-party product offers Claude.ai login or subscription rate limits. We will keep subscription mode disabled until Anthropic confirms the permitted product modes and authentication path in writing.

## Proposed safeguards

- Every Claude subscription connection belongs to exactly one tenant and one user.
- Personal subscription usage is never pooled, resold, delegated, or spent by a collaborator.
- A collaborator's agent turn uses their own connection or an explicitly tenant-funded API/cloud connection.
- The official Claude client owns authentication, credential storage, refresh, and logout.
- OpenCloudOS does not implement undocumented Anthropic OAuth endpoints, reuse Anthropic client identifiers, scrape credential stores, or accept arbitrary browser session tokens.
- Credentials live in an isolated per-user Credential Capsule outside workspace, model, Gadget, and tool-process reach.
- Provider billing mode is explicit. A subscription connection never falls back to Anthropic API billing without user consent.
- Rate limits, expiration, reauthorization, logout, and revocation are visible states.
- No raw credentials, prompt contents, or provider responses enter logs, traces, metrics, audit payloads, or product metadata.
- The open-source release will include executable cross-user, login-replay, credential-isolation, recovery, revocation, and billing-safety tests.

## Requested clarification and approval

Please confirm:

1. Whether the self-hosted distribution may initiate Claude.ai subscription login through the official Claude Agent SDK or Claude Code client.
2. Whether a future hosted multi-tenant distribution requires a different agreement, client registration, security review, or commercial relationship.
3. Which interactive login Interface Anthropic wants third-party hosts to use.
4. Whether `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN` may be used in a user-scoped third-party runner after explicit user authorization.
5. Whether such a token may be stored in encrypted per-user capsule storage, and the required rotation, expiration, logout, and provider-side revocation behavior.
6. Which subscription plans, organization policies, and regions may participate.
7. Whether Anthropic can provide test accounts or a sandbox for automated authentication and rate-limit conformance.
8. Which branding, disclosure, telemetry, usage-policy, and support requirements must appear in the product and documentation.
9. How Anthropic wants an approval reference represented in release records so operators can verify that the mode remains permitted.

We can provide a threat model, data-flow diagram, runnable synthetic conformance suite, and source review. We will not enable Claude subscription mode based solely on technical feasibility.

Thank you.

## Attachments to prepare before sending

- [Subscription-backed Agent Provider design](../SUBSCRIPTION_AUTH.md)
- [Agent Provider compatibility matrix](../PROVIDER_COMPATIBILITY.md)
- [ADR-0008](../adr/0008-provider-owned-subscription-auth.md)
- Provider Runtime Broker package and AUTH-001 through AUTH-010 test report
- Credential Capsule data-flow and threat-model diagram once the production runner design exists
- Repository URL and license after the upstream source strategy is accepted

## Maintainer checklist

- [ ] Assign a named owner and reply address.
- [ ] Confirm the repository name/brand before external outreach.
- [ ] Link the public repository and current commit.
- [ ] Decide whether the request covers self-hosted only or both requested modes.
- [ ] Attach or link the current threat model and test evidence.
- [ ] Have counsel or a policy owner review the wording if a hosted offering is included.
- [ ] Send through an Anthropic-approved developer, partnerships, or support channel.
- [ ] Record the date, channel, case/reference number, scope, and exact response in this file and `docs/PROVIDER_COMPATIBILITY.md`.
- [ ] Do not replace the approval requirement with a verbal or inferred response.

## Source basis

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Agent SDK subscription usage update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Anthropic commercial terms](https://www.anthropic.com/legal/commercial-terms)
- [Anthropic usage policy](https://www.anthropic.com/legal/aup)
