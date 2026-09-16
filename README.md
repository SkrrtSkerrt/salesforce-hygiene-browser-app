# Salesforce Hygiene Browser App Scaffold

Static browser-only scaffold for the free Salesforce Hygiene app.

## Boundary

- No server upload.
- No Salesforce login.
- No OAuth.
- No analytics.
- No remote scripts.
- No scan-data persistence.
- One A2 browser rule only.
- Local A3 report downloads use browser blobs only.
- A4 public copy and static-site integration are staged locally only; no deploy is authorized.
- A5 local publication prep artifacts and checks are staged locally only; no public action is authorized.

## Current state

A5 local-prep scaffold. It classifies selected local files, folders, and ZIP entry names into coverage rows. It runs one browser-native ValidationRule XML check on directly selected local files only. ZIP entries remain classification-only until a later authorized decompression slice. It can download JSON and HTML reports from the current in-memory browser result using local blobs only. A4 added public copy, static-site integration planning, and a safe GitHub issue-template draft without creating or publishing a public repo. A5 local prep adds local publication-prep docs, redaction/private-data sweep, package allowlist checks, and local package dry-run readiness only.

Implemented rule:

- `VALIDATION-001-BROWSER` - direct `description` element exists but is blank.

## Verify boundary and classifier

```bash
npm test
```

## Run locally

```bash
python -m http.server 8123
# open local port 8123 in a browser
```

## Public-copy and static-site docs

- `docs/PUBLIC_COPY.md`
- `docs/STATIC_SITE_INTEGRATION.md`
- `docs/LOCAL_PUBLICATION_PREP.md`
- `.github/ISSUE_TEMPLATE/browser-app-feedback.yml`

These are local staging artifacts only. Do not publish, deploy, create a public repo, push, configure Pages, or verify a public URL without a later exact public-action gate.

## Next slice

A5 local publication prep is limited to local artifacts and checks. A later gate must explicitly authorize any public repo creation, commit, push, publish, deploy, GitHub Pages change, public URL verification, analytics, hosted uploads, feedback auto-prefill, or customer-data handling.
