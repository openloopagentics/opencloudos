import type {
  ProviderMode,
  ProviderName,
  ProviderPolicyDecision,
  ProviderPolicyRegistry,
} from "./contracts.js";

function key(provider: ProviderName, mode: ProviderMode): string {
  return `${provider}:${mode}`;
}

export class StaticProviderPolicyRegistry implements ProviderPolicyRegistry {
  readonly #decisions = new Map<string, ProviderPolicyDecision>();

  constructor(decisions: ProviderPolicyDecision[]) {
    for (const decision of decisions) {
      this.#decisions.set(key(decision.provider, decision.mode), structuredClone(decision));
    }
  }

  read(provider: ProviderName, mode: ProviderMode): ProviderPolicyDecision {
    const decision = this.#decisions.get(key(provider, mode));
    if (decision) return structuredClone(decision);

    return {
      provider,
      mode,
      disposition: "blocked_by_policy",
      reason: "No reviewed provider policy enables this mode",
      reviewedAt: "unreviewed",
    };
  }
}
