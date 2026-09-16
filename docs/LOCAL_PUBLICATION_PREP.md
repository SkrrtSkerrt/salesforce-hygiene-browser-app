# A5 Local Publication Prep

## Status

Local-only prep artifact. No public repo, push, publish, deploy, GitHub Pages change, analytics, hosted upload, OAuth, Salesforce access, customer-data handling, or feedback auto-prefill is authorized by this file.

## Purpose

A5 local publication prep checks whether the current static browser app tree is clean enough to be considered for a later public beta release gate.

This file does not authorize release. It only defines local checks and stop conditions.

## Public allowlist

Allowed in a later public app repository, after a separate exact publish authorization:

- `index.html`
- `src/`
- `docs/`
- `.github/ISSUE_TEMPLATE/browser-app-feedback.yml`
- `tests/`
- `README.md`
- `package.json`
- future license/security policy files, if reviewed before publication

## Public denylist

Do not include any of these in a later public copy:

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

## Required local checks

Run before any later public release authorization:

1. `npm test`
2. static runtime boundary check
3. public-copy guardrail check
4. redaction/private-data sweep over the staged public tree
5. package allowlist check
6. local package dry run only: `npm pack --dry-run --json`
7. private repo redaction scan
8. independent read-only review

## Publication blockers

Stop before any public action if any check finds:

- network API usage in runtime code
- remote scripts, fonts, styles, images, or CDNs
- localStorage, sessionStorage, IndexedDB, cookies, or service workers for scan data
- hosted upload language or server-processing implication
- Salesforce login, OAuth, CLI, API, Tooling API, Metadata API, or SOQL dependency
- analytics or telemetry
- customer metadata, source code, org identifiers, report content, screenshots, logs, credentials, tokens, URLs, filenames, or local paths in feedback paths
- private repo paths, milestone packets, evidence packets, operator notes, or commercial validation ledgers in public artifacts

## Next gate

A later exact gate must name the public action explicitly before any repo creation, commit, push, deploy, Pages configuration, or public URL verification.
