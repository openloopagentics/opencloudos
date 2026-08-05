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
  { id: "model", label: "Operating model", group: "Foundations", keywords: "kernel shell process driver mapping" },
  { id: "upstream", label: "Upstream anatomy", group: "Foundations", keywords: "packages frontend backend durable object" },
  { id: "gap", label: "Portability gap", group: "Architecture", keywords: "workerd local disk cluster distributed" },
  { id: "target", label: "Target architecture", group: "Architecture", keywords: "gateway runtime shard postgres object storage" },
  { id: "contracts", label: "Portable contracts", group: "Architecture", keywords: "adapters s3 gcs azure oidc telemetry" },
  { id: "security", label: "Security invariants", group: "Trust", keywords: "capability sandbox approval audit egress" },
  { id: "gatekeepers", label: "Gatekeepers", group: "Trust", keywords: "prepare preview commit reject human loop" },
  { id: "roadmap", label: "Delivery roadmap", group: "Build", keywords: "phase docker kubernetes managed cloud actor" },
  { id: "decisions", label: "Architecture decisions", group: "Build", keywords: "adr workerd kubernetes active shard" },
  { id: "validation", label: "Conformance suite", group: "Build", keywords: "tests differential isolation recovery" },
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
          <span className="status-dot" /> Research snapshot
          <strong>05 AUG 2026</strong>
        </div>
      </aside>

      <main className="main-content">
        <WikiSection id="brief">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="release-pill"><span /> Research brief · v0.1</div>
              <h1>A portable operating system for <em>agentic work.</em></h1>
              <p className="hero-lede">
                A technical blueprint for taking Cloudflare OS beyond one provider—without losing the Gadget model,
                capability security, or lightweight <code>workerd</code> isolation that make it interesting.
              </p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => navigate("target")}>Explore the architecture <span>↓</span></button>
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

        <WikiSection id="model">
          <SectionHeading eyebrow="02 · Mental model" title="The operating-system analogy is real" />
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
          <SectionHeading eyebrow="09 · Execution" title="Delivery roadmap" />
          <div className="roadmap-list">
            {[
              ["0", "Tracking downstream", "Now", "Preserve history, notices, package boundaries, and an automated upstream merge report."],
              ["1", "Portable single node", "First release", "OCI image, local persistence, generic OIDC, BYOK models, backup and restore. No Cloudflare account."],
              ["2", "Kubernetes production", "Core milestone", "Helm, gateway, placement, sharded StatefulSets, Postgres, object-store adapters, network policy."],
              ["3", "Managed-cloud profiles", "Adoption", "AWS, GCP, Azure, and self-hosted deployment profiles without application forks."],
              ["4", "Distributed actor runtime", "Scale", "Fencing, draining, rebalancing, remote invocation, durable timers, and regional recovery."],
            ].map(([phase, title, timing, body]) => <article key={phase}><div className="phase-number">P{phase}</div><div><span>{timing}</span><h3>{title}</h3><p>{body}</p></div></article>)}
          </div>
        </WikiSection>

        <WikiSection id="decisions">
          <SectionHeading eyebrow="10 · ADR index" title="Architecture decisions">
            Initial decisions to formalize before implementation begins.
          </SectionHeading>
          <div className="decision-table">
            {[
              ["ADR-001", "Track upstream; do not clean-room rewrite", "Proposed"],
              ["ADR-002", "Use Kubernetes as the portable compute baseline", "Proposed"],
              ["ADR-003", "Retain workerd as the Gadget sandbox", "Proposed"],
              ["ADR-004", "Assign every workspace to one active shard", "Proposed"],
              ["ADR-005", "Use PostgreSQL for control-plane metadata", "Proposed"],
              ["ADR-006", "Expose cloud services only behind domain contracts", "Proposed"],
              ["ADR-007", "Make capability conformance a release gate", "Proposed"],
            ].map(([id, title, status]) => <div key={id}><code>{id}</code><strong>{title}</strong><span>{status}</span></div>)}
          </div>
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
          <footer className="page-footer"><div><span className="brand-mark">OC</span><strong>OpenCloudOS field guide</strong></div><p>Research snapshot · August 5, 2026 · Built as a living architecture document.</p><a href="#brief">Back to top ↑</a></footer>
        </WikiSection>
      </main>
    </div>
  );
}
