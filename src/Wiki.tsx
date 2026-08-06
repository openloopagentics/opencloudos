import { useEffect, useMemo, useRef, useState } from "react";

type NavItem = {
  id: string;
  label: string;
  group: string;
  keywords: string;
};

const navItems: NavItem[] = [
  { id: "brief", label: "Executive brief", group: "Start here", keywords: "summary opportunity upstream fork" },
  { id: "system", label: "What the system is", group: "Start here", keywords: "cloudflare os gadget blueprint gatekeeper" },
  { id: "language", label: "Domain language", group: "Foundations", keywords: "tenant workspace gadget capability placement prepared action glossary" },
  { id: "model", label: "Operating model", group: "Foundations", keywords: "kernel shell process driver mapping" },
  { id: "upstream", label: "Upstream anatomy", group: "Foundations", keywords: "packages frontend backend durable object" },
  { id: "gap", label: "Portability gap", group: "Architecture", keywords: "workerd local disk cluster distributed" },
  { id: "target", label: "Target architecture", group: "Architecture", keywords: "gateway runtime shard postgres object storage" },
  { id: "modules", label: "Module design", group: "Architecture", keywords: "gateway placement registry shard controller runtime host capability broker audit ledger" },
  { id: "state", label: "State ownership", group: "Architecture", keywords: "postgres sqlite object store consistency recovery" },
  { id: "flows", label: "Flows & failure model", group: "Architecture", keywords: "workspace gadget mutation recovery failure consistency" },
  { id: "contracts", label: "Portable contracts", group: "Architecture", keywords: "adapters s3 gcs azure oidc telemetry" },
  { id: "security", label: "Security invariants", group: "Trust", keywords: "capability sandbox approval audit egress" },
  { id: "gatekeepers", label: "Gatekeepers", group: "Trust", keywords: "prepare preview commit reject human loop" },
  { id: "roadmap", label: "Program overview", group: "Plan", keywords: "phase docker kubernetes managed cloud actor" },
  { id: "workstreams", label: "Workstreams", group: "Plan", keywords: "upstream runtime state identity capabilities placement operations security documentation" },
  { id: "milestones", label: "Milestones & gates", group: "Plan", keywords: "foundation feasibility preview kubernetes alpha multicloud beta release" },
  { id: "backlog", label: "First execution queue", group: "Plan", keywords: "tracer bullet issues priority sequence" },
  { id: "release-gates", label: "Definition of done", group: "Plan", keywords: "release gates acceptance evidence metrics" },
  { id: "decisions", label: "Architecture decisions", group: "Records", keywords: "adr workerd kubernetes active shard" },
  { id: "validation", label: "Conformance suite", group: "Records", keywords: "tests differential isolation recovery" },
  { id: "governance", label: "Documentation policy", group: "Records", keywords: "wiki pull request project log source of truth" },
  { id: "project-log", label: "Project log", group: "Records", keywords: "history shipped research plan" },
  { id: "providers", label: "Provider matrix", group: "Operate", keywords: "aws gcp azure self hosted" },
  { id: "risks", label: "Risks & open questions", group: "Operate", keywords: "name trademark upstream storage websocket" },
  { id: "sources", label: "Primary sources", group: "Operate", keywords: "references documentation github" },
];

const groups = [...new Set(navItems.map((item) => item.group))];

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="external-link" href={href} target="_blank" rel="noreferrer">
      {children}<span aria-hidden="true">↗</span>
    </a>
  );
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="section-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children && <p className="section-lede">{children}</p>}
    </header>
  );
}

function CopyAnchor({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button className="copy-anchor" onClick={copy} aria-label={`Copy link to ${id}`}>
      {copied ? "Copied" : "Link"}
    </button>
  );
}

function WikiSection({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section className="wiki-section" id={id} data-section>
      <CopyAnchor id={id} />
      {children}
    </section>
  );
}

export function Wiki() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState("brief");
  const [menuOpen, setMenuOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return navItems;
    return navItems.filter((item) => `${item.label} ${item.group} ${item.keywords}`.toLowerCase().includes(needle));
  }, [query]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveId(visible.target.id);
      },
      { rootMargin: "-18% 0px -70% 0px", threshold: 0 },
    );
    document.querySelectorAll("[data-section]").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(distance > 0 ? (window.scrollY / distance) * 100 : 0);
    };
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setMenuOpen(false);
        searchRef.current?.blur();
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("keydown", handleKey);
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  function navigate(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    window.history.replaceState(null, "", `#${id}`);
    setMenuOpen(false);
  }

  return (
    <div className="site-shell">
      <div className="reading-progress" style={{ width: `${progress}%` }} />

      <header className="mobile-header">
        <a href="#brief" className="mobile-brand"><span className="brand-mark">OC</span> OpenCloudOS</a>
        <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>
          {menuOpen ? "Close" : "Contents"}
        </button>
      </header>

      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-block">
          <a href="#brief" className="brand"><span className="brand-mark">OC</span><span>OpenCloudOS</span></a>
          <p>Architecture field guide</p>
        </div>

        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a topic"
            aria-label="Find a topic"
          />
          <kbd>⌘K</kbd>
        </label>

        <nav className="wiki-nav" aria-label="Wiki sections">
          {groups.map((group) => {
            const items = filteredItems.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group}>
                <p>{group}</p>
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={activeId === item.id ? "active" : ""}
                    onClick={() => navigate(item.id)}
                  >
                    <span className="nav-indicator" />{item.label}
                  </button>
                ))}
              </div>
            );
          })}
          {filteredItems.length === 0 && <p className="no-results">No matching topics.</p>}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" /> Planning baseline
          <strong>05 AUG 2026</strong>
        </div>
      </aside>

      <main className="main-content">
        <WikiSection id="brief">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="release-pill"><span /> Architecture + execution · v0.2</div>
              <h1>A portable operating system for <em>agentic work.</em></h1>
              <p className="hero-lede">
                A technical blueprint for taking Cloudflare OS beyond one provider—without losing the Gadget model,
                capability security, or lightweight <code>workerd</code> isolation that make it interesting.
              </p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => navigate("workstreams")}>Open the execution plan <span>↓</span></button>
                <ExternalLink href="https://github.com/cloudflare/cloudflare-os">View upstream</ExternalLink>
              </div>
            </div>
            <aside className="thesis-card">
              <p className="card-kicker">The thesis</p>
              <blockquote>Do not rebuild Cloudflare OS. Build the missing portable control plane around its open runtime.</blockquote>
              <dl>
                <div><dt>Upstream</dt><dd>Apache-2.0</dd></div>
                <div><dt>Runtime</dt><dd>workerd</dd></div>
                <div><dt>Baseline</dt><dd>Kubernetes</dd></div>
                <div><dt>State</dt><dd>Shard-local</dd></div>
                <div><dt>Plan</dt><dd>15 iterations</dd></div>
              </dl>
            </aside>
          </div>

          <div className="signal-strip">
            <div><span className="signal-number">26</span><span>upstream packages</span></div>
            <div><span className="signal-number">66</span><span>files importing runtime APIs</span></div>
            <div><span className="signal-number">62</span><span>files referencing Durable Objects</span></div>
            <div><span className="signal-number accent">01</span><span>portable control plane needed</span></div>
          </div>

          <div className="callout callout-warning">
            <span className="callout-icon">!</span>
            <div><strong>Important change in premise</strong><p>Cloudflare OS was open-sourced on August 5, 2026. The project opportunity is a portable production distribution—not a clean-room clone.</p></div>
          </div>
        </WikiSection>

        <WikiSection id="system">
          <SectionHeading eyebrow="01 · Product model" title="What the system actually is">
            Cloudflare OS is an AI productivity environment built around private, user-modifiable applications and narrowly scoped access to company systems.
          </SectionHeading>
          <div className="feature-grid three-up">
            <article className="feature-card"><span className="feature-index">01</span><h3>Agent workspace</h3><p>A general-purpose agent UI preloaded with organizational context, model access, and collaboration primitives.</p></article>
            <article className="feature-card featured"><span className="feature-index">02</span><h3>Gadgets</h3><p>Small, private applications generated by AI. Each has its own code, sandbox, state, API, and sharing policy.</p></article>
            <article className="feature-card"><span className="feature-index">03</span><h3>Gatekeepers</h3><p>Capability-scoped service connectors that authorize, constrain, audit, preview, and approve external actions.</p></article>
          </div>
          <div className="principle-row"><span>Core product principle</span><p>Every user runs their own copy of an application and can safely ask an agent to change it.</p></div>
        </WikiSection>

        <WikiSection id="language">
          <SectionHeading eyebrow="02 · Canonical language" title="Name the system precisely">
            The glossary is an engineering control. Product behavior, module interfaces, issues, tests, and operator documentation use these terms consistently.
          </SectionHeading>
          <div className="glossary-grid">
            {[
              ["Tenant", "An organization whose users, workspaces, policy, credentials, and audit history are isolated."],
              ["Workspace", "The durable collaboration and execution scope that owns agent sessions, Gadgets, and capabilities."],
              ["Gadget", "A user-owned application whose generated code and state run in an isolated sandbox."],
              ["Blueprint", "A versioned, shareable snapshot from which a new Gadget is created."],
              ["Capability", "Narrow authority to perform defined operations against one resource scope."],
              ["Introduction", "The deliberate act of granting a capability to one Agent Session or Gadget."],
              ["Gatekeeper", "A driver enforcing scope, approval, execution, and audit rules for an external system."],
              ["Prepared Action", "A validated but uncommitted mutation with stable identity, preview, scope, and expiry."],
              ["Runtime Shard", "A single-active workerd runtime and durable volume hosting assigned workspaces."],
              ["Placement", "The authoritative assignment of one Workspace to one Runtime Shard for an epoch."],
              ["Placement Lease", "A time-bounded, epoch-fenced claim allowing one Runtime Shard to serve a Workspace."],
              ["Deployment Profile", "Provider-specific adapters and infrastructure defaults satisfying portable interfaces."],
            ].map(([term, definition]) => <article key={term}><code>{term}</code><p>{definition}</p></article>)}
          </div>
          <div className="callout"><span className="callout-icon">L</span><div><strong>Canonical source</strong><p>New or changed project-specific language must update the domain context before it appears in implementation.</p><ExternalLink href="https://github.com/openloopagentics/opencloudos/blob/main/CONTEXT.md">Read CONTEXT.md</ExternalLink></div></div>
        </WikiSection>

        <WikiSection id="model">
          <SectionHeading eyebrow="03 · Mental model" title="The operating-system analogy is real" />
          <div className="mapping-table" role="table" aria-label="Operating system mapping">
            <div className="mapping-head" role="row"><span>Traditional OS</span><span>Cloudflare OS</span><span>Responsibility</span></div>
            {[
              ["Kernel", "workshop-backend", "Isolation, routing, access, lifecycle"],
              ["Shell", "workshop-frontend", "User interaction and workspace UI"],
              ["Process", "Gadget", "A running personal application"],
              ["Executable", "Blueprint", "Shareable application code"],
              ["Device driver", "Gatekeeper", "Controlled external system access"],
              ["ACL / capability", "Introduction", "Explicit, narrow authority"],
              ["Process supervisor", "Overseer DO", "Workspace state and child lifecycle"],
            ].map(([left, center, right]) => <div className="mapping-row" role="row" key={left}><strong>{left}</strong><code>{center}</code><span>{right}</span></div>)}
          </div>
        </WikiSection>

        <WikiSection id="upstream">
          <SectionHeading eyebrow="03 · Codebase" title="Upstream anatomy">
            The user experience is portable today. The kernel is intentionally coupled to advanced Workers runtime primitives.
          </SectionHeading>
          <div className="layer-stack">
            <div className="layer layer-ui"><span>Experience</span><strong>workshop-frontend</strong><small>Chat · Gadgets · Blueprints · collaboration</small></div>
            <div className="layer layer-kernel"><span>Kernel</span><strong>workshop-backend</strong><small>Users · Overseers · auth · agent execution · sharing</small></div>
            <div className="layer layer-services"><span>Drivers</span><strong>gatekeeper-*</strong><small>GitHub · Google · Slack · Notion · MCP · Supabase · more</small></div>
            <div className="layer layer-runtime"><span>Runtime</span><strong>Cloudflare Workers primitives</strong><small>Durable Objects · Facets · Worker Loader · RPC · KV · R2</small></div>
          </div>
          <p className="source-note">Snapshot inspected at upstream commit <ExternalLink href="https://github.com/cloudflare/cloudflare-os/commit/aedcda8b3066ff666f57ae28ecef7341d6c2dee7">aedcda8</ExternalLink>.</p>
        </WikiSection>

        <WikiSection id="gap">
          <SectionHeading eyebrow="04 · Constraint" title="The portability gap">
            <code>workerd</code> can run almost anywhere, but standalone <code>workerd</code> is not Cloudflare’s distributed platform.
          </SectionHeading>
          <div className="split-panel">
            <article><p className="panel-label positive">What is portable</p><ul className="check-list"><li>V8 isolate execution</li><li>Workers JavaScript APIs</li><li>Dynamic Worker loading</li><li>Durable Object Facets</li><li>Cap’n Web RPC</li><li>Cloudflare OS application code</li></ul></article>
            <article><p className="panel-label negative">What is missing</p><ul className="x-list"><li>Cluster-wide object placement</li><li>Distributed single ownership</li><li>Automatic state migration</li><li>Managed durable storage</li><li>Global request routing</li><li>Production self-hosting tooling</li></ul></article>
          </div>
          <div className="quote-card"><span>From the runtime source</span><blockquote>“TODO(someday): Support distributing objects across a cluster. At present, objects are always local to one instance of the runtime.”</blockquote><ExternalLink href="https://github.com/cloudflare/workerd/blob/main/src/workerd/server/workerd.capnp#L705-L736">workerd.capnp</ExternalLink></div>
        </WikiSection>

        <WikiSection id="target">
          <SectionHeading eyebrow="05 · Reference design" title="Target architecture">
            Preserve <code>workerd</code> as the sandbox. Add workspace placement, durable routing, portable storage, and operational recovery around it.
          </SectionHeading>
          <div className="architecture-diagram" aria-label="Target architecture diagram">
            <div className="arch-node users"><span>Clients</span><strong>Browser · API · agents</strong></div>
            <div className="arch-arrow">↓</div>
            <div className="arch-node gateway"><span>Control edge</span><strong>Gateway · OIDC · workspace router</strong><small>Authenticates, resolves ownership, forwards WebSockets and RPC</small></div>
            <div className="arch-arrow branching">↓</div>
            <div className="shard-row">
              {["A", "B", "N"].map((name) => <div className="arch-node shard" key={name}><span>Runtime shard {name}</span><strong>workerd</strong><small>Overseer · Gadgets · Gatekeepers</small><i>Persistent volume</i></div>)}
            </div>
            <div className="arch-rail"><span /><em>Portable service contracts</em><span /></div>
            <div className="service-row">
              <div className="arch-service"><strong>PostgreSQL</strong><span>placement + metadata</span></div>
              <div className="arch-service"><strong>Object store</strong><span>blueprints + assets</span></div>
              <div className="arch-service"><strong>Secrets</strong><span>credentials + keys</span></div>
              <div className="arch-service"><strong>OTel</strong><span>logs + traces + metrics</span></div>
            </div>
          </div>
          <div className="callout"><span className="callout-icon">i</span><div><strong>Deliberate first tradeoff</strong><p>Use one active pod per runtime shard. Recover by recreating the pod and reattaching its volume. Do not promise active-active semantics before fencing and state migration exist.</p></div></div>
        </WikiSection>

        <WikiSection id="modules">
          <SectionHeading eyebrow="06 · Deep modules" title="Concentrate complexity behind small interfaces">
            Each module owns behavior, invariants, failure modes, and verification. Callers do not learn provider mechanics or workerd configuration details.
          </SectionHeading>
          <div className="module-map">
            {[
              ["Request Gateway", "Authenticate and deliver a request to the valid Workspace owner.", "OIDC validation · placement cache · WebSocket proxy · bounded retry", "Never cross tenants; attach epoch to every request"],
              ["Placement Registry", "Own Workspace-to-Shard assignment and lease epoch.", "Postgres transactions · allocation policy · lease expiry · moves", "At most one valid owner; epochs only increase"],
              ["Shard Controller", "Reconcile healthy runtime capacity and durable volumes.", "StatefulSets · readiness · drain · rollout · volume attachment", "One read-write mount; stop renewal before shutdown"],
              ["Runtime Host", "Deliver placed execution to upstream code inside workerd.", "DO namespaces · Facets · bindings · local SQLite · process supervision", "Reject stale epochs; Gadget egress denied by default"],
              ["Capability Broker", "Create, attenuate, invoke, and revoke authority.", "Gatekeeper discovery · credential lookup · staging · idempotency", "No raw credentials; delegated scope never widens"],
              ["Artifact Repository", "Publish immutable Blueprints, exports, and large assets.", "Streaming · digest keys · provider storage · retention · restore", "Content exists before metadata becomes visible"],
              ["Identity", "Normalize provider identity into Tenant and User context.", "OIDC · group mapping · local development identity · invalidation", "Identity grants no Gadget capability"],
              ["Audit Ledger", "Append and query security-relevant causal facts.", "Durable append · redaction · integrity · retention · export", "Privileged commit fails closed if audit cannot append"],
              ["Conformance Harness", "Compare observable behavior across deployment targets.", "Provision · execute scenario · normalize evidence · teardown", "Tests the same interface callers use"],
            ].map(([name, purpose, hidden, invariant]) => (
              <article className="module-card" key={name}>
                <div><code>{name}</code><span>Module</span></div>
                <h3>{purpose}</h3>
                <dl><dt>Hides</dt><dd>{hidden}</dd><dt>Invariant</dt><dd>{invariant}</dd></dl>
              </article>
            ))}
          </div>
          <p className="source-note">Detailed interfaces, error modes, and invariants: <ExternalLink href="https://github.com/openloopagentics/opencloudos/blob/main/docs/ARCHITECTURE.md">System architecture</ExternalLink>.</p>
        </WikiSection>

        <WikiSection id="state">
          <SectionHeading eyebrow="07 · Data design" title="Every state has one authoritative owner">
            The system preserves shard-local transactions for Workspace execution while using PostgreSQL for placement and deployment coordination.
          </SectionHeading>
          <div className="state-table">
            <div className="state-head"><span>State</span><span>Owner</span><span>Consistency</span><span>Recovery rule</span></div>
            {[
              ["Tenant + User mapping", "Identity / PostgreSQL", "Strong", "Point-in-time database restore"],
              ["Placement + epoch", "Placement Registry", "Serializable mutation", "Fence old epoch before reassignment"],
              ["Chats + Workspace metadata", "Runtime Shard SQLite", "Single writer", "Recover the owning volume"],
              ["Gadget code + live state", "Gadget Sandbox Facet", "Single writer", "Same volume as its supervisor"],
              ["Blueprint content", "Artifact Repository", "Immutable", "Replicate, version, verify checksum"],
              ["Capability grant", "Workspace + Gatekeeper reference", "Workspace transaction", "Restore then revalidate external identity"],
              ["Prepared Action", "Gatekeeper state", "Strong + expiring", "Resume, reject, or expire—never infer approval"],
              ["Approval Decision", "Gatekeeper + Audit Ledger", "Append-only", "Replay the recorded decision"],
              ["Deployment status", "Shard Controller", "Eventually reconciled", "Reconcile from desired state"],
            ].map((row) => <div className="state-row" key={row[0]}>{row.map((cell, index) => index === 0 ? <strong key={cell}>{cell}</strong> : <span key={cell}>{cell}</span>)}</div>)}
          </div>
          <div className="security-rule"><span>STATE RULE</span><strong>Missing shard state is an outage, never permission to create an empty Workspace.</strong></div>
        </WikiSection>

        <WikiSection id="flows">
          <SectionHeading eyebrow="08 · Runtime behavior" title="Flows and failure semantics">
            Cross-module work uses explicit state machines, placement epochs, and idempotency—not distributed transactions or optimistic hand-waving.
          </SectionHeading>
          <div className="flow-catalog">
            {[
              ["Open a Workspace", ["Authenticate Tenant + User", "Resolve or allocate Placement", "Forward with epoch", "Runtime Host verifies epoch", "Open supervisor + respond"]],
              ["Run a Gadget", ["Bundle versioned source", "Load Dynamic Worker", "Attach isolated Facet state", "Inject introductions only", "Serve RPC to sandboxed iframe"]],
              ["Commit a mutation", ["Invoke scoped Capability", "Prepare + fingerprint", "Return explicit simulation", "Record Approval Decision", "Revalidate + commit once", "Append outcome"]],
              ["Recover a Shard", ["Stop routing", "Expire or revoke leases", "Detach old volume", "Start replacement", "Issue new epochs", "Reconnect + probe"]],
            ].map(([title, steps]) => <article key={title as string}><h3>{title as string}</h3><ol>{(steps as string[]).map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></article>)}
          </div>
          <div className="failure-grid">
            {[
              ["PostgreSQL unavailable", "No placement mutation or privileged approval. Existing placed sessions may continue only within policy."],
              ["Runtime crash", "Restart against the same volume. Lose at most an unacknowledged in-flight turn."],
              ["Split brain", "Older epoch rejects state open and privileged requests. Raise a fencing violation."],
              ["Volume unavailable", "Keep the Workspace offline. Never attach a new empty volume as recovery."],
              ["External timeout", "Retain Prepared Action and resolve ambiguity through its idempotency identity."],
              ["Audit unavailable", "Fail privileged commits closed; retain the uncommitted Prepared Action."],
            ].map(([failure, behavior]) => <article key={failure}><span>Failure</span><h3>{failure}</h3><p>{behavior}</p></article>)}
          </div>
        </WikiSection>

        <WikiSection id="contracts">
          <SectionHeading eyebrow="06 · Interfaces" title="Portable contracts, not cloud conditionals" />
          <div className="contract-list">
            {[
              ["ObjectStore", "Blueprints, exports, avatars", "S3 / R2 · GCS · Azure Blob · MinIO"],
              ["MetadataStore", "Placement, tenancy, recovery", "PostgreSQL"],
              ["SecretStore", "OAuth and service credentials", "Vault · KMS providers · K8s Secrets"],
              ["IdentityProvider", "Human and service identity", "Generic OIDC"],
              ["ModelProvider", "Inference and embeddings", "Anthropic · OpenAI · Google · hosted models"],
              ["BrowserRuntime", "Rendering and browser tasks", "Playwright service · provider adapters"],
              ["TelemetrySink", "Logs, metrics, traces", "OpenTelemetry / OTLP"],
              ["WorkspacePlacement", "Single-shard ownership", "PostgreSQL + fencing lease"],
              ["GadgetRuntime", "Untrusted generated code", "workerd first; contract remains explicit"],
            ].map(([name, purpose, implementations]) => <article className="contract-row" key={name}><code>{name}</code><p>{purpose}</p><span>{implementations}</span></article>)}
          </div>
        </WikiSection>

        <WikiSection id="security">
          <SectionHeading eyebrow="07 · Trust model" title="Security invariants">
            Portability is successful only if the new runtime preserves the upstream authority model—not merely the UI and feature list.
          </SectionHeading>
          <div className="invariant-grid">
            {[
              ["Deny by default", "A new Gadget or agent begins with no ambient authority."],
              ["Explicit introduction", "Every external resource is granted deliberately and narrowly."],
              ["No direct egress", "Generated code reaches external systems only through capabilities."],
              ["Capability attenuation", "A child can receive less authority, never silently gain more."],
              ["Human control", "Material side effects can be reviewed before they become real."],
              ["Complete audit", "Actor, scope, preview, decision, execution, and result are recorded."],
            ].map(([title, body], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{body}</p></article>)}
          </div>
          <div className="security-rule"><span>RULE 0</span><strong>Generated code never receives raw long-lived credentials.</strong></div>
        </WikiSection>

        <WikiSection id="gatekeepers">
          <SectionHeading eyebrow="08 · Capability layer" title="Gatekeepers are the differentiator">
            Treat every consequential external action as a staged protocol rather than an ordinary tool call.
          </SectionHeading>
          <div className="flow-line">
            {[
              ["01", "Request", "Agent calls a narrow capability"],
              ["02", "Prepare", "Gatekeeper validates scope"],
              ["03", "Preview", "Synthetic result feeds the agent"],
              ["04", "Approve", "Human reviews staged effects"],
              ["05", "Commit", "Approved action executes once"],
              ["06", "Audit", "Outcome becomes immutable history"],
            ].map(([number, title, body]) => <article key={number}><span>{number}</span><strong>{title}</strong><p>{body}</p></article>)}
          </div>
          <div className="callout callout-warning"><span className="callout-icon">!</span><div><strong>Simulation is not a transaction</strong><p>Many external APIs cannot guarantee atomic preview-and-commit. Each Gatekeeper must document idempotency, drift detection, replay behavior, and compensation.</p></div></div>
        </WikiSection>

        <WikiSection id="roadmap">
          <SectionHeading eyebrow="12 · Program" title="Execution at a glance">
            Baseline planning assumes four engineers, two-week iterations, and a shared product/security reviewer. Sequence and exit evidence matter more than calendar dates.
          </SectionHeading>
          <div className="program-baseline">
            <div><strong>4</strong><span>core engineers</span></div><div><strong>2 wk</strong><span>iterations</span></div><div><strong>15</strong><span>planned iterations</span></div><div><strong>6</strong><span>milestones</span></div><div><strong>9</strong><span>workstreams</span></div>
          </div>
          <div className="roadmap-list">
            {[
              ["0", "Program foundation", "Iteration 1", "Accept language and decisions; establish upstream, threat-model, conformance, CI, and documentation baselines."],
              ["1", "Runtime feasibility", "Iterations 2–3", "Run upstream through production workerd, persist one Gadget, and classify every runtime semantic."],
              ["2", "Secure single-node preview", "Iterations 4–6", "OIDC, artifacts, Gatekeeper authority, audit, backup/restore, and Docker Compose."],
              ["3", "Kubernetes alpha", "Iterations 7–10", "Gateway, placement epochs, three shards, WebSockets, Helm, and fault-tested recovery."],
              ["4", "Multi-cloud beta", "Iterations 11–13", "Self-hosted, AWS, GCP, and Azure profiles using the identical application release."],
              ["5", "1.0 release candidate", "Iterations 14–15", "Security review, disaster recovery, compatibility evidence, support policy, and operator validation."],
            ].map(([phase, title, timing, body]) => <article key={phase}><div className="phase-number">P{phase}</div><div><span>{timing}</span><h3>{title}</h3><p>{body}</p></div></article>)}
          </div>
          <div className="callout callout-warning"><span className="callout-icon">?</span><div><strong>First program gate</strong><p>Do not fund the distributed control plane until Milestone 1 proves that standalone workerd can preserve the required persistence, isolation, RPC, and recovery semantics.</p></div></div>
        </WikiSection>

        <WikiSection id="workstreams">
          <SectionHeading eyebrow="13 · Delivery system" title="Nine workstreams with evidence">
            Workstreams can progress concurrently only after their dependencies are real. Security conformance and documentation run through the entire program.
          </SectionHeading>
          <div className="critical-path" aria-label="Critical path">
            <div><span>WS0</span><strong>Upstream</strong></div><i>→</i><div><span>WS1</span><strong>Runtime</strong></div><i>→</i><div className="critical-fan"><span>WS2–4</span><strong>State · identity · capabilities</strong></div><i>→</i><div><span>WS5</span><strong>Placement</strong></div><i>→</i><div><span>WS6</span><strong>Profiles</strong></div>
          </div>
          <div className="workstream-grid">
            {[
              ["WS0", "Upstream + releases", "Pinned source, diff reports, signed releases, provenance", "Rehearsed upstream import with classified conflicts", "—"],
              ["WS1", "Runtime compatibility", "Runtime Host, workerd config, DO/Facet/RPC/WebSocket inventory", "Gadget survives process restart without Cloudflare", "WS0"],
              ["WS2", "State + artifacts", "Volume layout, object adapters, snapshot and restore", "Clean restore verifies every durable state class", "WS1"],
              ["WS3", "Identity + tenancy", "OIDC, local identity, tenant mapping, workload identity", "Two tenants expose no cross-tenant identifiers or authority", "WS0"],
              ["WS4", "Capabilities + Gatekeepers", "Capability Broker, staged actions, first three Gatekeepers", "Read cannot write; approved write commits exactly once", "WS1 + WS3"],
              ["WS5", "Placement + routing", "Gateway, Placement Registry, Shard Controller, fencing", "Stale shard cannot acknowledge a Workspace write", "WS1–4"],
              ["WS6", "Profiles + operations", "Compose, Helm, four profiles, SLOs, runbooks", "Independent operator installs, upgrades, backs up, restores", "WS1–5"],
              ["WS7", "Security + conformance", "Threat model, target adapters, signed evidence, scanning", "Every stable release publishes passing evidence", "Continuous"],
              ["WS8", "Docs + community", "Wiki, ADRs, contributor guide, compatibility matrix", "Every release change traces from outcome to operation", "Continuous"],
            ].map(([id, name, deliverables, evidence, depends]) => <article key={id}><div><code>{id}</code><span>Depends: {depends}</span></div><h3>{name}</h3><p>{deliverables}</p><footer><strong>Exit evidence</strong>{evidence}</footer></article>)}
          </div>
        </WikiSection>

        <WikiSection id="milestones">
          <SectionHeading eyebrow="14 · Exit criteria" title="Milestones are gates, not dates">
            A milestone exits only when its risky behavior is demonstrated and documented. Partial feature completion does not substitute for evidence.
          </SectionHeading>
          <div className="milestone-table">
            {[
              ["M0", "Foundation", "I1", "Language, ADRs, upstream strategy, threat model, CI", "Contributor can run, explain, and select a scoped issue"],
              ["M1", "Runtime feasibility", "I2–3", "Production workerd + one persistent Gadget", "TB-001/002 pass; missing primitives classified"],
              ["M2", "Single-node preview", "I4–6", "OIDC, artifact adapters, Gatekeeper, audit, restore", "Security suite green; no critical threat finding"],
              ["M3", "Kubernetes alpha", "I7–10", "Gateway, epochs, three Shards, Helm, recovery", "Repeated fault injection; stale owner rejected"],
              ["M4", "Multi-cloud beta", "I11–13", "Four profiles, signed artifacts, observability, upgrades", "Same release passes every profile"],
              ["M5", "1.0 candidate", "I14–15", "Security review, DR, support and operator docs", "Two operators complete lifecycle from wiki alone"],
            ].map(([id, name, timing, outcome, gate]) => <article key={id}><div className="milestone-id">{id}<small>{timing}</small></div><div><h3>{name}</h3><p>{outcome}</p></div><div><span>Exit gate</span><strong>{gate}</strong></div></article>)}
          </div>
        </WikiSection>

        <WikiSection id="backlog">
          <SectionHeading eyebrow="15 · First queue" title="Execute uncertainty first">
            The first implementation queue is ordered to prove runtime and security assumptions before investing in platform breadth.
          </SectionHeading>
          <div className="tracer-grid">
            {[
              ["TB-001", "Boot upstream without Cloudflare", "Pinned OCI image, health check, one command, no Cloudflare credentials"],
              ["TB-002", "Persist one Gadget", "Code and state survive restart; missing storage fails visibly"],
              ["TB-003", "Introduce one repository", "Scoped read, prepared write, rejection safety, approval once, complete audit"],
              ["TB-004", "Route across three Shards", "Tenant validation, epoch on every request, WebSocket, capacity behavior"],
              ["TB-005", "Recover a failed Shard", "Old epoch fenced, volume reused, Prepared Actions preserved"],
              ["TB-006", "Prove four profiles", "One application release; only adapters and infrastructure values vary"],
            ].map(([id, outcome, acceptance]) => <article key={id}><code>{id}</code><h3>{outcome}</h3><p>{acceptance}</p></article>)}
          </div>
          <div className="queue-list">
            {[
              "Track upstream source with license and patch provenance",
              "Build pinned workerd image and minimal production configuration",
              "Inventory every upstream runtime primitive and binding",
              "Define Runtime Host from observed caller needs and failures",
              "Ship TB-001 with smoke evidence",
              "Specify volume layout, state manifest, and corruption behavior",
              "Ship TB-002 with restart conformance",
              "Build filesystem and S3-compatible Artifact adapters",
              "Build local and OIDC Identity adapters",
              "Enforce default-deny Gadget egress",
              "Port GitHub Gatekeeper through Capability Broker",
              "Implement Prepared Action, Approval Decision, and Audit state",
              "Ship Docker Compose preview with backup and restore",
              "Build and property-test placement epoch fencing",
              "Add Gateway, Shard Controller, Helm, and fault injection",
            ].map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></div>)}
          </div>
        </WikiSection>

        <WikiSection id="release-gates">
          <SectionHeading eyebrow="16 · Quality system" title="Definition of done and release gates">
            A successful build is necessary but radically insufficient for a portable agent operating system.
          </SectionHeading>
          <div className="done-grid">
            {[
              ["Outcome", "User or operator behavior is demonstrated end to end."],
              ["Interface", "Owning Module, invariants, errors, retries, and ordering are clear."],
              ["Security", "Tenant, authority, credential, egress, and audit effects are verified."],
              ["Recovery", "Upgrade, rollback, interrupted execution, and restore effects are known."],
              ["Evidence", "Tests cross the same seam used by callers; conformance target passes."],
              ["Documentation", "Context, architecture, plan, wiki, ADRs, and Project Log are current."],
            ].map(([name, body], index) => <article key={name}><span>{index + 1}</span><h3>{name}</h3><p>{body}</p></article>)}
          </div>
          <div className="gate-list">
            {[
              "Reproducible source, dependency, type, and image builds",
              "License notices, SBOM, provenance, and signed images",
              "Required Conformance Scenarios pass or publish an approved deviation",
              "Gadget egress and Capability attenuation tests pass",
              "Clean-environment backup restore succeeds",
              "Migrations prove forward, rollback, and interrupted execution",
              "No critical vulnerability or threat-model finding remains",
              "Runbooks match the released failure behavior",
              "GitHub Pages deploy publishes current records",
            ].map((gate) => <div key={gate}><span>✓</span>{gate}</div>)}
          </div>
          <p className="source-note">Complete workstream, milestone, risk, metric, and release detail: <ExternalLink href="https://github.com/openloopagentics/opencloudos/blob/main/docs/EXECUTION_PLAN.md">Execution plan</ExternalLink>.</p>
        </WikiSection>

        <WikiSection id="decisions">
          <SectionHeading eyebrow="10 · ADR index" title="Architecture decisions">
            Initial decisions to formalize before implementation begins.
          </SectionHeading>
          <div className="decision-table">
            {[
              ["ADR-001", "Track upstream with explicit portability patches", "Proposed"],
              ["ADR-002", "Use Kubernetes as the portable production baseline", "Proposed"],
              ["ADR-003", "Retain workerd as the Gadget sandbox", "Proposed"],
              ["ADR-004", "Use single-active Runtime Shards with epoch fencing", "Proposed"],
              ["ADR-005", "Split control metadata from shard-local Workspace state", "Proposed"],
              ["ADR-006", "Put provider variation behind real seams", "Proposed"],
              ["ADR-007", "Make conformance and documentation release gates", "Proposed"],
            ].map(([id, title, status]) => <div key={id}><code>{id}</code><strong>{title}</strong><span>{status}</span></div>)}
          </div>
          <p className="source-note">Review full rationale and consequences in the <ExternalLink href="https://github.com/openloopagentics/opencloudos/tree/main/docs/adr">ADR registry</ExternalLink>.</p>
        </WikiSection>

        <WikiSection id="validation">
          <SectionHeading eyebrow="11 · Quality bar" title="Differential conformance suite">
            Run the same behavioral scenarios against upstream Cloudflare deployment and the portable runtime.
          </SectionHeading>
          <div className="test-grid">
            {[
              ["Isolation", "Gadget cannot access network, parent state, sibling state, or undeclared bindings."],
              ["Authority", "Introductions remain resource-scoped through agent and Gadget delegation."],
              ["Approval", "Rejected staged actions produce zero external side effects."],
              ["Recovery", "Workspace state, collaboration, and pending approvals survive shard restart."],
              ["Tenancy", "Users, collaborators, share links, and imported Blueprints retain boundaries."],
              ["Audit", "Every privileged operation yields a complete, correlated, tamper-evident record."],
            ].map(([title, body]) => <article key={title}><div className="test-status">MUST PASS</div><h3>{title}</h3><p>{body}</p></article>)}
          </div>
        </WikiSection>

        <WikiSection id="governance">
          <SectionHeading eyebrow="19 · Documentation system" title="The wiki is part of done">
            Documentation is written while decisions crystallize, reviewed with implementation, and shipped as part of the same change.
          </SectionHeading>
          <div className="truth-stack">
            {[
              ["CONTEXT.md", "Owns canonical domain language and relationships"],
              ["docs/adr/", "Owns hard-to-reverse decisions and rationale"],
              ["ARCHITECTURE.md", "Owns modules, interfaces, invariants, state, flows, and failure behavior"],
              ["EXECUTION_PLAN.md", "Owns workstreams, milestones, dependencies, risk, and release gates"],
              ["PROJECT_LOG.md", "Owns the chronological record of material work"],
              ["Public wiki", "Makes the important parts navigable to contributors and operators"],
            ].map(([source, ownership], index) => <article key={source}><span>{index + 1}</span><code>{source}</code><p>{ownership}</p></article>)}
          </div>
          <div className="doc-rule-grid">
            {[
              ["New domain term", "Update CONTEXT.md and the language page"],
              ["Hard decision", "Add or supersede an ADR; never rewrite history"],
              ["Module behavior", "Update architecture and Conformance Scenarios"],
              ["Scope or sequence", "Update execution plan and milestone gate"],
              ["Operational effect", "Update profile, runbook, recovery, and SLO content"],
              ["Every merged change", "Add a Project Log entry or an approved rationale"],
            ].map(([change, record]) => <article key={change}><strong>{change}</strong><p>{record}</p></article>)}
          </div>
          <div className="security-rule"><span>MERGE RULE</span><strong>A material change is incomplete until behavior, decision, verification, operation, and history agree.</strong></div>
          <p className="source-note"><ExternalLink href="https://github.com/openloopagentics/opencloudos/blob/main/docs/DOCUMENTATION.md">Documentation policy</ExternalLink> · <ExternalLink href="https://github.com/openloopagentics/opencloudos/blob/main/.github/pull_request_template.md">Pull request checklist</ExternalLink></p>
        </WikiSection>

        <WikiSection id="project-log">
          <SectionHeading eyebrow="20 · Living record" title="Project log">
            A chronological, append-only view of material research, design, implementation, and operational changes.
          </SectionHeading>
          <div className="project-timeline">
            <article><div><span>05 AUG 2026</span><i>Shipped</i></div><h3>Detailed execution design</h3><p>Added canonical language, deep module design, state and failure semantics, nine workstreams, six milestones, tracer bullets, release gates, documentation policy, and seven initial ADRs.</p><footer>Evidence · production build · Pages subpath build · cross-record consistency review</footer></article>
            <article><div><span>05 AUG 2026</span><i>Shipped</i></div><h3>Architecture field guide launched</h3><p>Documented the upstream product model, workerd portability gap, target shard architecture, capability security, provider matrix, and initial roadmap.</p><footer>Evidence · static build · GitHub Pages deployment · HTTP 200</footer></article>
            <article><div><span>05 AUG 2026</span><i>Shipped</i></div><h3>Repository initialized</h3><p>Created the OpenCloudOS repository and established the project codename.</p><footer>Evidence · initial commit</footer></article>
          </div>
          <p className="source-note">Append future entries in <ExternalLink href="https://github.com/openloopagentics/opencloudos/blob/main/docs/PROJECT_LOG.md">PROJECT_LOG.md</ExternalLink>.</p>
        </WikiSection>

        <WikiSection id="providers">
          <SectionHeading eyebrow="12 · Deployment" title="Provider matrix" />
          <div className="provider-table">
            <div className="provider-head"><span>Capability</span><span>AWS</span><span>GCP</span><span>Azure</span><span>Self-hosted</span></div>
            {[
              ["Compute", "EKS", "GKE", "AKS", "Kubernetes"],
              ["Metadata", "RDS Postgres", "Cloud SQL", "Azure Postgres", "PostgreSQL"],
              ["Objects", "S3", "GCS", "Blob Storage", "MinIO"],
              ["Secrets", "Secrets Manager", "Secret Manager", "Key Vault", "Vault"],
              ["Ingress", "ALB / NLB", "Cloud Load Balancing", "App Gateway", "Ingress controller"],
              ["Telemetry", "OTLP exporter", "OTLP exporter", "OTLP exporter", "OTel Collector"],
            ].map((row) => <div className="provider-row" key={row[0]}>{row.map((cell, index) => index === 0 ? <strong key={cell}>{cell}</strong> : <span key={cell}>{cell}</span>)}</div>)}
          </div>
          <p className="table-caption">Provider services are deployment profiles. Core application packages must not import provider SDKs.</p>
        </WikiSection>

        <WikiSection id="risks">
          <SectionHeading eyebrow="13 · Unknowns" title="Risks and open questions" />
          <div className="risk-list">
            {[
              ["Critical", "Distributed ownership", "How are stale shard owners fenced before a replacement accepts traffic?"],
              ["Critical", "State portability", "Which Durable Object SQL and storage semantics are observable by upstream code?"],
              ["High", "WebSocket recovery", "What session state must survive pod replacement versus reconnect from the browser?"],
              ["High", "Upstream velocity", "How much runtime coupling will new Cloudflare OS releases add?"],
              ["High", "Gatekeeper semantics", "Which integrations support preview, idempotency, drift checks, and compensation?"],
              ["Medium", "Product naming", "OpenCloudOS already names an established Linux distribution and community."],
            ].map(([severity, title, body]) => <article key={title}><span className={`severity ${severity.toLowerCase()}`}>{severity}</span><div><h3>{title}</h3><p>{body}</p></div></article>)}
          </div>
          <div className="callout callout-warning"><span className="callout-icon">N</span><div><strong>Naming requires resolution</strong><p>“OpenCloudOS” is already used by a Linux distribution. Treat the repository name as a working codename until legal and brand review are complete.</p><ExternalLink href="https://opencloudos.org/">Existing OpenCloudOS project</ExternalLink></div></div>
        </WikiSection>

        <WikiSection id="sources">
          <SectionHeading eyebrow="14 · Evidence" title="Primary sources" />
          <div className="source-list">
            {[
              ["Cloudflare OS repository", "Product model, packages, license, local runtime, self-hosting status", "https://github.com/cloudflare/cloudflare-os"],
              ["Cloudflare OS README", "Gadgets, Gatekeepers, architecture analogy, deployment status", "https://github.com/cloudflare/cloudflare-os#readme"],
              ["workerd repository", "Open runtime, supported systems, configuration and production process model", "https://github.com/cloudflare/workerd"],
              ["workerd configuration schema", "Local Durable Object persistence and current cluster limitation", "https://github.com/cloudflare/workerd/blob/main/src/workerd/server/workerd.capnp#L705-L736"],
              ["Dynamic Workers documentation", "Runtime-loaded sandbox code and explicit bindings", "https://developers.cloudflare.com/dynamic-workers/getting-started/"],
              ["Durable Object Facets", "Per-Gadget isolated SQLite state under a supervisor", "https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/"],
              ["Kubernetes concepts", "Portable workload and service orchestration baseline", "https://kubernetes.io/docs/concepts/index.html"],
              ["OpenTelemetry documentation", "Vendor-neutral telemetry APIs and OTLP", "https://opentelemetry.io/docs/"],
              ["Dapr actor runtime", "Reference model for portable actor placement and failover", "https://docs.dapr.io/developing-applications/building-blocks/actors/actors-features-concepts/"],
            ].map(([title, note, href], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><ExternalLink href={href}>{title}</ExternalLink><p>{note}</p></div></article>)}
          </div>
          <footer className="page-footer"><div><span className="brand-mark">OC</span><strong>OpenCloudOS field guide</strong></div><p>Architecture + execution baseline v0.2 · August 5, 2026 · Every change documented.</p><a href="#brief">Back to top ↑</a></footer>
        </WikiSection>
      </main>
    </div>
  );
}
