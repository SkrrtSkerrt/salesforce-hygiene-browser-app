# Salesforce Hygiene Browser App Public Beta

Static browser-only public beta for the free Salesforce Hygiene app.

## Boundary

- No server upload.
- No Salesforce login.
- No OAuth.
- No analytics.
- No remote scripts.
- No scan-data persistence.
- One browser rule only.
- Local report downloads use browser blobs only.
- Public feedback uses the GitHub issue template only; do not include metadata, source, org IDs, screenshots, logs, credentials, tokens, URLs, report content, filenames, or local paths.
- The npm package remains marked private to block package-registry publication.

## Current state

Public beta. It classifies selected local files, folders, and ZIP entry names into coverage rows. It runs one browser-native ValidationRule XML check on directly selected local files and bounded client-only ZIP entries. It can download JSON and HTML reports from the current in-memory browser result using local blobs only.

Implemented rule:

- `VALIDATION-001-BROWSER` - direct `description` element exists but is blank.

## Try it on the GitHub Pages app

1. Open the GitHub Pages app.
2. For a 30-second synthetic test, use `docs/samples/Fictional_Blank_Description.validationRule-meta.xml` or `docs/samples/fictional-validation-rule-metadata.zip`. One blank-description finding should appear.
3. For real metadata without Salesforce CLI, follow `docs/NO_CLI_METADATA_GUIDE.md` and use a metadata ZIP or source folder from an admin, release package, backup, or Git repo. The useful files currently end in `.validationRule-meta.xml`.
4. If you do not have metadata yet, ask an admin or dev team for a small ZIP containing ValidationRule metadata only. The browser app cannot inspect an org by itself.
5. Select the ZIP, folder, or XML files in the page.
6. Read Limitations first, then Coverage rows, then Findings.
7. Download the JSON or HTML report if you need local evidence.

## Verify boundary and classifier

```bash
npm test
```

## Run locally

```bash
python -m http.server 8123
# open local port 8123 in a browser
```

## Public beta docs

- `docs/PUBLIC_COPY.md`
- `docs/STATIC_SITE_INTEGRATION.md`
- `docs/LOCAL_PUBLICATION_PREP.md`
- `docs/NO_CLI_METADATA_GUIDE.md`
- `docs/samples/Fictional_Blank_Description.validationRule-meta.xml`
- `docs/samples/fictional-validation-rule-metadata.zip`
- `.github/ISSUE_TEMPLATE/browser-app-feedback.yml`

The app is published as a static GitHub Pages beta. Do not add hosted upload, auth, analytics, remote assets, feedback auto-prefill, Salesforce API/CLI access, or customer-data handling without a separate gate.

## Next slice

Keep the public beta narrow: ZIP extraction is client-only and bounded, unsupported metadata is Not Assessed, and findings are limited to the implemented ValidationRule check. A later gate must explicitly authorize more rule families, hosted intake, analytics, customer-data handling, or any stronger assurance/compliance claim.
