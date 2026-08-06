import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
}

const requiredRecords = [
  "CONTEXT.md",
  "docs/ARCHITECTURE.md",
  "docs/CODEX_ADAPTER_SPIKE.md",
  "docs/CODEX_RUNNER_TRANSPORT.md",
  "docs/DOCUMENTATION.md",
  "docs/EXECUTION_PLAN.md",
  "docs/PROJECT_LOG.md",
  "docs/PROVIDER_COMPATIBILITY.md",
  "docs/SUBSCRIPTION_AUTH.md",
  "docs/provider-approval/ANTHROPIC_REQUEST_DRAFT.md",
  "docs/adr/README.md",
];

for (const record of requiredRecords) {
  if (!fs.existsSync(path.join(root, record))) fail(`Missing required record: ${record}`);
}

const wiki = read("src/Wiki.tsx");
const navIds = [...wiki.matchAll(/\{ id: "([^"]+)", label:/g)].map((match) => match[1]);
const sectionIds = [...wiki.matchAll(/<WikiSection id="([^"]+)"/g)].map((match) => match[1]);

for (const navId of navIds) {
  if (!sectionIds.includes(navId)) fail(`Wiki navigation target has no section: ${navId}`);
}
for (const sectionId of sectionIds) {
  if (sectionIds.filter((candidate) => candidate === sectionId).length > 1) fail(`Duplicate wiki section: ${sectionId}`);
}

function markdownUnder(relativeDirectory) {
  const found = [];
  for (const entry of fs.readdirSync(path.join(root, relativeDirectory), { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...markdownUnder(relativePath));
    if (entry.isFile() && entry.name.endsWith(".md")) found.push(relativePath);
  }
  return found;
}

const markdownFiles = ["README.md", "CONTEXT.md", ...markdownUnder("docs")];

for (const relativePath of markdownFiles) {
  const markdown = read(relativePath);
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(root, path.dirname(relativePath), target);
    if (!fs.existsSync(resolved)) fail(`${relativePath} links to missing path: ${target}`);
  }
}

const adrIndex = read("docs/adr/README.md");
const adrFiles = fs.readdirSync(path.join(root, "docs/adr")).filter((name) => /^\d{4}-.*\.md$/.test(name));
for (const adrFile of adrFiles) {
  const number = adrFile.slice(0, 4);
  if (!adrIndex.includes(`[${number}]`)) fail(`ADR ${number} is missing from docs/adr/README.md`);
  if (!wiki.includes(`ADR-${number}`)) fail(`ADR ${number} is missing from the public wiki registry`);
}

const subscriptionDesign = read("docs/SUBSCRIPTION_AUTH.md");
const brokerTests = read("packages/provider-runtime-broker/test/broker.test.ts");
for (let scenario = 1; scenario <= 10; scenario += 1) {
  const id = `AUTH-${String(scenario).padStart(3, "0")}`;
  if (!subscriptionDesign.includes(id)) fail(`${id} is missing from docs/SUBSCRIPTION_AUTH.md`);
  if (!brokerTests.includes(id)) fail(`${id} is missing from the executable Broker suite`);
}

const codexSpike = read("docs/CODEX_ADAPTER_SPIKE.md");
const codexTests = read("packages/provider-runtime-broker/test/codex-adapter.test.ts");
for (let scenario = 1; scenario <= 8; scenario += 1) {
  const id = `CODEX-${String(scenario).padStart(3, "0")}`;
  if (!codexSpike.includes(id)) fail(`${id} is missing from docs/CODEX_ADAPTER_SPIKE.md`);
  if (!codexTests.includes(id)) fail(`${id} is missing from the executable Codex Adapter suite`);
}

const runnerTransport = read("docs/CODEX_RUNNER_TRANSPORT.md");
const runnerTests = read("packages/provider-runtime-broker/test/codex-jsonl-transport.test.ts");
for (let scenario = 1; scenario <= 8; scenario += 1) {
  const id = `RUNNER-${String(scenario).padStart(3, "0")}`;
  if (!runnerTransport.includes(id)) fail(`${id} is missing from docs/CODEX_RUNNER_TRANSPORT.md`);
  if (!runnerTests.includes(id)) fail(`${id} is missing from the executable Runner transport suite`);
}

if (!read("docs/PROJECT_LOG.md").includes("Provider Runtime Broker")) {
  fail("Project Log does not record the Provider Runtime Broker implementation");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`documentation check: ${failure}`);
  process.exit(1);
}

console.log(
  `documentation check: ${requiredRecords.length} records, ${sectionIds.length} wiki sections, ${adrFiles.length} ADRs, 10 AUTH scenarios, 8 CODEX scenarios, and 8 RUNNER scenarios verified`,
);
