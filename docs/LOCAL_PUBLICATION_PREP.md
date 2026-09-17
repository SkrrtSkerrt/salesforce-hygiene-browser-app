# Public Beta Release Gate Record

## Status

Public beta is authorized for the static GitHub Pages app. This record does not authorize analytics, hosted upload, OAuth, Salesforce access, customer-data handling, feedback auto-prefill, package-registry publication, or stronger assurance/compliance claims.

## Purpose

This file records the release gate checks that keep the public beta inside the browser-only no-upload boundary.

## Public allowlist

Allowed in the public app repository:

- `index.html`
- `src/`
- `docs/`
- `.github/ISSUE_TEMPLATE/browser-app-feedback.yml`
- `tests/`
- `README.md`
- `package.json`
- future license/security policy files, if reviewed before publication

## Public denylist

Do not include any of these in the public beta:

- private planning history
- private milestone state
- evidence packets
- Developer Org evidence, raw or redacted
- customer material
- operator notes
- credentials, tokens, secrets, cookies, or auth artifacts
- Salesforce CLI config
- private M7 validation ledgers
- local machine paths or filenames from a user scan
- generated report content from real metadata

## Required release checks

Run before public beta updates:

1. `npm test`
2. static runtime boundary check
3. public-copy guardrail check
4. redaction/private-data sweep over the public tree
5. package allowlist check
6. local package dry run: `npm pack --dry-run --json`
7. private repo redaction scan when private evidence is updated
8. independent read-only review for boundary-sensitive changes

## Publication blockers

Stop before any public beta update if any check finds:

- network API usage in runtime code
- remote scripts, fonts, styles, images, or CDNs
- localStorage, sessionStorage, IndexedDB, cookies, or service workers for scan data
- hosted upload language or server-processing implication
- Salesforce login, OAuth, CLI, API, Tooling API, Metadata API, or SOQL dependency
- analytics or telemetry
- customer metadata, source code, org identifiers, report content, screenshots, logs, credentials, tokens, URLs, filenames, or local paths in feedback paths
- private repo paths, milestone packets, evidence packets, operator notes, or commercial validation ledgers in public artifacts

## Next gate

A later exact gate must name any expanded beta action explicitly before decompression, additional rule families, hosted intake, analytics, Salesforce API/CLI access, customer-data handling, package-registry publication, or stronger assurance/compliance claims.
