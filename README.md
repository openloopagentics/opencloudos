# OpenCloudOS architecture wiki

A living research and architecture guide for building a portable, self-hosted
distribution of [Cloudflare OS](https://github.com/cloudflare/cloudflare-os).

The wiki documents the upstream system, its portability gap, the proposed
cross-cloud architecture, security invariants, detailed execution plan,
provider profiles, decisions, and chronological project record.

## Project documentation

- [Domain language](./CONTEXT.md)
- [Documentation index](./docs/INDEX.md)
- [System architecture](./docs/ARCHITECTURE.md)
- [Execution plan](./docs/EXECUTION_PLAN.md)
- [Subscription-backed agent providers](./docs/SUBSCRIPTION_AUTH.md)
- [Architecture decisions](./docs/adr/README.md)
- [Documentation policy](./docs/DOCUMENTATION.md)
- [Project log](./docs/PROJECT_LOG.md)

Every material change must update the relevant source document, the public
wiki, and the project log in the same pull request.

> **Naming note:** OpenCloudOS is already the name of an established Linux
> distribution. This repository name should be treated as a working codename
> until brand and legal review are complete.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The local URL is printed in the terminal.

## Build

```bash
npm run build
```

The static site is written to `dist/` and is compatible with GitHub Pages.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and publishes the site on
pushes to `main`. In the repository settings, set **Pages → Source** to
**GitHub Actions**.

## Research snapshot

The current content reflects upstream Cloudflare OS commit
[`aedcda8`](https://github.com/cloudflare/cloudflare-os/commit/aedcda8b3066ff666f57ae28ecef7341d6c2dee7),
inspected on August 5, 2026.
