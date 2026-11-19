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
- Optional tips use a plain PayPal donation link and do not change the browser-only scan boundary.
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

## Feedback and optional tips

- Safe feedback issue template: https://github.com/SkrrtSkerrt/salesforce-hygiene-browser-app/issues/new?template=browser-app-feedback.yml
- Optional tip link: https://www.paypal.com/donate/?hosted_button_id=J9SKEQNJFEV4W

Do not include Salesforce metadata, source code, org IDs, emails, customer names, screenshots, logs, credentials, tokens, URLs, report content, finding details, filenames, or local paths in public feedback. Tips are handled by PayPal on PayPal's site; the browser app still does not upload metadata, reports, scan results, or local labels.

## Verify boundary and classifier

```bash
npm test
```

This gate includes classifier/ZIP, XML, scanner-contract, UI race/export, report,
publication, redaction, and static network/persistence checks. The UI VM harness
uses Node's `--experimental-vm-modules` flag; its experimental warning is expected.

Real-browser acceptance uses Python Playwright and installed browser binaries.
The harness does not install dependencies. Run each engine at desktop and mobile
layout sizes:

```bash
for browser in chromium firefox webkit; do
  python tests/browser-acceptance.py --browser "$browser" --output "/tmp/salesforce-browser-acceptance/$browser-desktop"
  python tests/browser-acceptance.py --browser "$browser" --mobile --output "/tmp/salesforce-browser-acceptance/$browser-mobile"
done
```

The harness starts an ephemeral loopback-only static server, uses fictional inputs,
and saves real JSON/HTML Blob downloads, hashes, screenshots, engine versions and
acceptance/privacy evidence. It covers native file/folder inputs, stored/deflated
ZIPs, unsafe paths, malformed/invalid UTF-8 inputs, foreign namespaces, actual
rule-execution summaries, stale completions, export gates, safe error recovery and
observed network/storage behavior. Controlled File API gates supplement native
browser scenarios. Mobile means a 390×844 touch viewport, not a physical-device
or operating-system certification. Missing engines or unsupported native controls
are reported explicitly, never counted as passes. No real customer data is used.

To run the same checks against a deployment, add
`--base-url https://skrrtskerrt.github.io/salesforce-hygiene-browser-app/ --cache-key RELEASE_SHA`.
Only the app's allowlisted static GETs are permitted; the harness adds cache-busting
query strings and blocks unexpected requests. It does not deploy or contact
Salesforce. On hosts needing compatibility libraries, isolate them outside this
repository and scope the launcher/environment to browser tests; do not substitute
incompatible system-library symlinks.

## Hardening contract and remaining limitations

- This is a conservative XML 1.0 subset reader, not Salesforce schema validation:
  ASCII QNames, bounded nesting, no DTD or XML 1.1. Unsupported syntax produces
  explicit coverage rather than a finding.
- Roots and their direct `description` must share the canonical Salesforce
  namespace `http://soap.sforce.com/2006/04/metadata`, or both use the explicitly
  supported legacy empty namespace. Prefixes and inherited default namespaces are
  resolved. Foreign/shadowed fields are Not Assessed; duplicate direct description
  lookalikes remain ambiguous even across namespaces. Unbound prefixes are malformed.
- Direct XML and extracted ZIP content require valid UTF-8 bytes. Read/decode
  failures produce Not Assessed coverage and do not count as a rule execution.
  This is not general XML encoding autodetection or full schema validation.
- `Accepted` denotes input classification/eligibility, not a completed assessment.
  Classification rows and rule outcomes are separate; recognized non-ValidationRule
  metadata is Not Assessed in scan reports. `rules_evaluated` lists only invoked
  evaluators (including invocations returning malformed/Not Assessed), and is empty
  if none ran. `input_summary.classificationCounts` and `ruleOutcomeCounts` separate
  classification from rule outcome counts; total coverage rows are not file counts.
- ZIP limits apply both per archive and across the entire selection. Per archive:
  10 MiB input, 200 directory entries, 4 MiB extracted content; per entry: 1 MiB
  extracted content. Per selection: 10 archives read, 20 MiB input, 400 inspected
  entries and 8 MiB extraction-work reservations. Reservations persist after
  failed extraction so malformed input cannot reset the work budget. Archives are
  processed in selection order; over-budget inputs receive explicit coverage.
  `input_summary.zipUsage` exposes conservative reserved work, not exact successful
  extraction totals. Native stream chunks are checked after receipt; these limits
  do not prove a zero-overshoot native allocation or CPU cap. They do prevent new
  extraction attempts once a work budget is exhausted. These ZIP limits do not
  impose a selection-wide limit on directly selected non-ZIP files.
- Reports omit raw XML but retain relative metadata names/paths. They are not
  anonymized and must not be posted as public feedback.

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
