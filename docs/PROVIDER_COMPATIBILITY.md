# Agent Provider Compatibility

**Last reviewed:** 2026-08-05  
**Release baseline:** v0.6 M0 execution
**Rule:** this record is time-sensitive. Every stable release revalidates official documentation, provider policy, pinned client behavior, and the AUTH suite.

## Status vocabulary

- `contract_only`: the provider-neutral Interface and synthetic Adapter exist; no production credential may be used.
- `auth_protocol_spike`: a pinned official-client auth Interface has executable fixtures, but no real login, production capsule, or agent turn is supported.
- `implementation_next`: an official-client Adapter is the next technical slice but is not release-supported.
- `blocked_by_policy`: code and configuration cannot enable the mode without the required provider approval record.
- `planned`: the mode is within 1.0 scope but has not passed release gates.
- `supported`: official path, pinned client, complete AUTH suite, operational runbook, and provider-policy review all pass.

## Compatibility matrix

| Agent Provider | Mode | Official path | Current status | Client pin | Evidence still required |
|---|---|---|---|---|---|
| Codex | ChatGPT personal/workspace subscription | `codex app-server` ChatGPT-managed browser or device-code login | `auth_protocol_spike` + bounded transport | `codex-cli 0.146.1`; schema `codex-cli-0.146.1` | Process supervisor and capsule; thread/turn mapping and approval bridge; real approved accounts; AUTH-001–010 on runner; restart/revocation; independent isolation review |
| Codex | Business/Enterprise access token | `CODEX_ACCESS_TOKEN` or `codex login --with-access-token` | `planned` for trusted operator automation | Not yet pinned | Secret-manager ingress; expiry/rotation; trusted-runner profile; no public repository execution |
| Codex | OpenAI API key | Codex API-key login | `planned` as explicit pay-as-you-go | Not yet pinned | Explicit billing selection; rotation; no inheritance by subscription mode |
| Claude | Pro/Max/Team/Enterprise subscription login | Official Claude Code or Agent SDK login | `blocked_by_policy` | Not yet pinned | Written Anthropic third-party approval; approved auth Interface; provider-approved test accounts; AUTH-001–010 |
| Claude | Long-lived subscription OAuth token | `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN` | `blocked_by_policy` | Not yet pinned | Same written approval; allowed storage/refresh/revocation guidance; sealed-ingress review |
| Claude | Anthropic API key | `ANTHROPIC_API_KEY` or approved credential helper | `planned` as explicit pay-as-you-go | Not yet pinned | Secret injection; rotation; billing-label conformance; hostile-tool isolation |
| Claude | Bedrock / Google Cloud Agent Platform / Microsoft Foundry | Official cloud-provider authentication | `planned` as operator-funded modes | Not yet pinned | Deployment-profile IAM, workload identity, billing, and recovery tests |
| Synthetic | Subscription fixture | In-memory synthetic Adapter and connection store | `contract_only` | `1.0.0-test` | Never promoted to production; used only for deterministic Interface conformance |

## Current executable evidence

- Provider Runtime Broker Interface implemented in `packages/provider-runtime-broker`.
- Synthetic Adapter and in-memory connection metadata Implementation completed.
- AUTH-001 through AUTH-010 pass without real provider credentials.
- Codex initialization, device login, sanitized account state, limit mapping, and logout pass CODEX-001 through CODEX-008 against captured `codex-cli 0.146.1` schema fixtures.
- Codex stdio JSONL correlation, framing, redacted errors, bounded input, shutdown, and default server-request rejection pass RUNNER-001 through RUNNER-008.
- Codex turn execution fails closed; there is no app-server process supervisor, approval bridge, or production Credential Capsule yet.
- Unauthorized and unknown Provider Connection references return the same public error shape.
- Claude subscription mode remains blocked when an operator marks it enabled without an approval reference.
- Product metadata recovery without credential-capsule state moves to `reauth_required`; credentials are not reconstructed.

This is contract and authentication-protocol evidence, not production-provider support.

## Provider evidence

### OpenAI Codex

- [Codex authentication](https://learn.chatgpt.com/docs/auth) documents ChatGPT subscription login, device-code login, credential storage, refresh, logout, and access-token modes.
- [Codex app-server](https://learn.chatgpt.com/docs/app-server) documents the host Interface and ChatGPT-managed authentication lifecycle.
- [Codex authentication protocol spike](./CODEX_ADAPTER_SPIKE.md) records the inspected schema boundary, sanitizer, fixtures, tests, and incomplete production gates.
- [Codex Provider Runner transport](./CODEX_RUNNER_TRANSPORT.md) records the JSONL framing, correlation, fail-closed server-request policy, resource bounds, tests, and remaining supervisor work.
- [Codex access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens) limits access tokens to trusted local Business/Enterprise automation and distinguishes provider credentials from app-server transport authentication.

### Anthropic Claude

- [Claude Code authentication](https://code.claude.com/docs/en/authentication) documents subscription login, credential storage and precedence, expiration, and `claude setup-token`.
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) states that third-party products need prior approval to offer Claude.ai login or subscription rate limits.
- [Claude subscription usage update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says current third-party Agent SDK usage still draws from subscription limits while Anthropic revises its plan. This does not remove the SDK approval requirement.

## Next review triggers

Review immediately when:

- Codex app-server changes its authentication protocol or credential-store behavior;
- Anthropic answers the approval request or changes Agent SDK subscription terms;
- an official client version is selected for the first Adapter spike;
- a provider introduces or removes device-code, plan, rate-limit, logout, or token-revocation behavior;
- a supported deployment profile changes how credential capsules are encrypted or destroyed.
