# Static Site Integration

Public beta deployment is active on GitHub Pages.

## Target shape

- Static files served from the app root.
- No build step required for the current beta.
- No server intake route.
- No hosted upload endpoint.
- No analytics script.
- No remote font, script, image, or CDN dependency.
- No service worker.
- No runtime persistence for scan data.

## Public route

The browser app is published at:

- `/salesforce-hygiene-browser-app/`

Do not wire this route to a backend, proxy, worker, form handler, telemetry collector, upload bucket, or external scanner.

## Site entry copy requirements

The public entry must show the trust boundary before file selection:

1. Files stay in this browser tab.
2. No Salesforce login or OAuth.
3. No server upload.
4. No analytics or telemetry.
5. Unsupported metadata appears as Not Assessed coverage.
6. The current beta is narrow and point-in-time only.

## Feedback route

Use GitHub issues only. The app must not auto-open or auto-prefill an issue URL with scan data, filenames, findings, org names, report content, telemetry, local paths, or local labels.

Any feedback link must be a plain link to the repository issue page or a manually filled issue template. No query-string prefill from runtime state.

## Release checklist

Run these checks before public beta updates:

1. `npm test`
2. Runtime deny-pattern scan for network and persistence APIs.
3. Browser smoke: load static page, select fictional fixtures, download JSON and HTML reports.
4. Browser network check: no requests after initial static file load during selection, scan, and download.
5. Public copy review: no hosted-processing, auth, completeness, compliance, or official-Salesforce claims.
6. Issue-template review: no request for metadata, source, org IDs, screenshots, logs, credentials, tokens, URLs, reports, filenames, or local paths.
7. Secret/private-data scan before public commits.

## Stop conditions

Stop before release changes if the implementation requires any hosted intake, Salesforce auth, API access, telemetry, analytics, remote assets, scan-data persistence, customer data, external LLM/subprocessor, or public claim stronger than local point-in-time hygiene.
