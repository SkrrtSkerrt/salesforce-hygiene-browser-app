# Browser App Boundaries

This public beta keeps Salesforce metadata checks inside a static browser-only boundary.

## Allowed now

- Static HTML/CSS/JS.
- Browser File API.
- In-memory file summaries, parsing, coverage rows, and findings.
- Client-only bounded ZIP content extraction for safe relative entries.
- Local JSON/HTML report downloads generated with browser blobs only.
- GitHub Pages static deployment.
- GitHub issue-template feedback without scan-data, filename, local-path, metadata, or report prefill.
- Plain optional PayPal donation link with no scripts, iframe, form action, telemetry, or scan-data handoff.
- Release checks: redaction sweep, package allowlist checks, and package dry run.
- Fictional fixtures and synthetic metadata for tests.

## Not allowed now

- `fetch`, XHR, WebSocket, EventSource, beacon.
- Remote CDN assets.
- Donation/payment scripts, iframes, hosted forms, tracking pixels, or runtime payment logic.
- ZIP absolute paths, traversal paths, encrypted entries, unsupported compression methods, over-limit archives, over-limit entry counts, and over-limit extracted text.
- Analytics.
- Service worker.
- localStorage/sessionStorage/IndexedDB for scan data.
- Salesforce OAuth/API/SOQL.
- Customer metadata in tests.
- Hosted upload, hosted intake, external processors, package-registry publication, or stronger assurance/compliance claims without a later exact gate.

## User-facing promise

Files stay in this browser tab. The public beta does not upload metadata or reports to a server.
