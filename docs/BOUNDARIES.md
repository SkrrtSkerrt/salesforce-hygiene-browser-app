# Browser App Boundaries

This scaffold exists to build the free browser-only app safely.

## Allowed now

- Static HTML/CSS/JS.
- Browser File API.
- In-memory file summaries, parsing, coverage rows, and findings.
- Local JSON/HTML report downloads generated with browser blobs only.
- Local public-copy and static-site integration planning artifacts.
- Local publication-prep docs, redaction sweep, package allowlist checks, and package dry-run only.
- Fictional fixtures and synthetic metadata only.

## Not allowed now

- `fetch`, XHR, WebSocket, EventSource, beacon.
- Remote CDN assets.
- Analytics.
- Service worker.
- localStorage/sessionStorage/IndexedDB for scan data.
- Salesforce OAuth/API/SOQL.
- Customer metadata in tests.
- Public repo creation, commit, push, publish, deploy, GitHub Pages changes, or public URL verification without a later exact public-action gate.

## User-facing promise

Files stay in this browser tab. The MVP does not upload metadata or reports to a server.
