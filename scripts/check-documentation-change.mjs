import { execFileSync } from "node:child_process";

const [baseSha, headSha] = process.argv.slice(2);
if (!baseSha || !headSha || /^0+$/.test(baseSha)) {
  console.log("documentation change policy: no comparable base revision; structural checks still apply");
  process.exit(0);
}

const changed = execFileSync("git", ["diff", "--name-only", `${baseSha}...${headSha}`], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const material = changed.filter((file) =>
  file.startsWith("packages/") ||
  file.startsWith("scripts/") ||
  file.startsWith(".github/workflows/") ||
  file === "LICENSE" ||
  file === "THIRD_PARTY_NOTICES.md" ||
  file === "package.json" ||
  file === "package-lock.json" ||
  file.startsWith("tsconfig") ||
  (file.startsWith("src/") && file !== "src/Wiki.tsx" && file !== "src/styles.css"),
);

if (material.length === 0) {
  console.log("documentation change policy: no material implementation or operational change");
  process.exit(0);
}

const exemptionRequested = process.env.DOCS_NOT_NEEDED === "true";
const exemptionForbidden = material.some((file) =>
  file.startsWith("packages/") ||
  file.startsWith(".github/workflows/") ||
  file === "LICENSE" ||
  file === "THIRD_PARTY_NOTICES.md" ||
  file === "package-lock.json",
);

if (exemptionRequested && !exemptionForbidden) {
  console.log("documentation change policy: approved docs-not-needed exemption detected");
  process.exit(0);
}

const missing = [];
if (!changed.includes("docs/PROJECT_LOG.md")) missing.push("docs/PROJECT_LOG.md");
if (!changed.includes("src/Wiki.tsx")) missing.push("src/Wiki.tsx");

const architecturalRecords = new Set([
  "CONTEXT.md",
  "docs/ARCHITECTURE.md",
  "docs/EXECUTION_PLAN.md",
  "docs/SUBSCRIPTION_AUTH.md",
]);
const hasArchitectureRecord = changed.some(
  (file) => architecturalRecords.has(file) || /^docs\/adr\/\d{4}-.*\.md$/.test(file),
);
if (!hasArchitectureRecord) missing.push("an architecture, execution, subscription-auth, context, or ADR record");

if (missing.length > 0) {
  console.error(`documentation change policy: material files changed: ${material.join(", ")}`);
  console.error(`documentation change policy: missing ${missing.join(", ")}`);
  if (exemptionRequested && exemptionForbidden) {
    console.error("documentation change policy: docs-not-needed is forbidden for runtime, security, dependency, or deployment changes");
  }
  process.exit(1);
}

console.log(`documentation change policy: ${material.length} material files have wiki, project-log, and architecture records`);
