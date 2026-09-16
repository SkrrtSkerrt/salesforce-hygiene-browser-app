# Public Copy Packet

Use this copy when the A4 site integration is later authorized for a public static page. This is copy only; it does not authorize a public repo, deploy, analytics, hosted uploads, or customer-data handling.

## Hero

Salesforce Hygiene Browser App

A free, local-first Salesforce metadata hygiene checker that runs in your browser tab.

No Salesforce login. No server upload. No analytics. No scan-data storage.

## Short description

Select Salesforce metadata files from your machine and get a point-in-time local report. The current browser MVP checks a narrow ValidationRule condition and shows unsupported metadata as coverage rows instead of pretending to scan everything.

## Trust boundary

Your files stay in your browser tab. The app does not upload metadata, reports, filenames, scan results, telemetry, or local labels to a server.

The MVP does not use Salesforce OAuth, Salesforce CLI, Metadata API, Tooling API, SOQL, hosted intake, analytics, remote scripts, cookies, service workers, localStorage, sessionStorage, or IndexedDB for scan data.

## Current capability

- Accepts local file, folder, and ZIP selection through the Browser File API.
- Classifies supported, unsupported, and rejected inputs.
- Runs `VALIDATION-001-BROWSER` only on directly selected local `*.validationRule-meta.xml` files.
- Keeps ZIP contents classification-only until a later authorized decompression slice.
- Downloads local JSON and HTML reports with browser blobs.
- Shows limitations and coverage before findings.

## Required limitation copy

This is not a complete Salesforce security audit. It is not a compliance certification. It does not connect to your org. It does not prove org-wide coverage. Unsupported metadata is reported as Not Assessed.

## Feedback copy

Feedback is manual through the public issue template only. Do not paste metadata, source code, org IDs, emails, customer names, screenshots, logs, credentials, tokens, URLs, reports, findings, filenames, or local paths.

## Footer copy

Salesforce is a trademark of Salesforce, Inc. This project is independent and not affiliated with, endorsed by, or sponsored by Salesforce.
