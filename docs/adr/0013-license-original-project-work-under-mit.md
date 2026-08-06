# ADR-0013: License original project work under MIT while preserving upstream terms

- **Status:** Accepted
- **Date:** 2026-08-06
- **Owners:** OpenCloudOS maintainers
- **Related:** ADR-0001, ADR-0007

## Context

The repository did not declare a root project license, leaving contributors and
downstream users without explicit permission to use, modify, or redistribute
its original code and documentation. OpenCloudOS also tracks Cloudflare OS as
an upstream project under Apache-2.0 and depends on separately licensed
packages. A project-level license must not erase those provenance boundaries.

## Decision

License copyrightable original work contributed to this repository under the
MIT License, using SPDX identifier `MIT` and the canonical license text in the
root `LICENSE` file. Package metadata declares the same identifier.

The MIT grant applies only where OpenCloudOS contributors hold the relevant
rights. Cloudflare OS source and every other third-party component remain under
their applicable upstream terms. When upstream material is copied or modified,
maintainers must preserve required copyright, attribution, modification,
license, and NOTICE records. `THIRD_PARTY_NOTICES.md`, the software bill of
materials, and release provenance expose that boundary to redistributors.

## Consequences

Positive:

- users receive a short, permissive, OSI-approved license for original project work;
- package tooling and repository hosts can identify the project license as `MIT`;
- contributors have one clear default for new original code and documentation;
- the explicit provenance boundary prevents the MIT label from being read as a relicense of upstream work.

Costs and constraints:

- release engineering must inventory every imported or bundled component;
- files copied from Apache-2.0 or other sources may require notices beyond the root MIT text;
- maintainers must not remove upstream notices or describe the entire dependency graph as MIT;
- the license does not resolve the separate OpenCloudOS naming and trademark risk.

## Rejected alternatives

### Leave the repository without an explicit license

Public source availability alone does not grant the permissions needed for an
open-source project and would make reuse unnecessarily uncertain.

### License all repository contents only under Apache-2.0

Apache-2.0 remains appropriate for Cloudflare OS material, but the project has
chosen the simpler MIT grant for its own original work. Retaining component
licenses provides the correct boundary without pretending all contents have one
origin.

## Validation

- the root `LICENSE` contains canonical MIT terms;
- `package.json` and the root lockfile package declare SPDX identifier `MIT`;
- `THIRD_PARTY_NOTICES.md` records Cloudflare OS as Apache-2.0;
- CI documentation checks verify the license files, package metadata, ADR, wiki, and project log together.
