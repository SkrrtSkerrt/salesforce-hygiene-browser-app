# No-CLI Metadata Guide

Use this when you want to try the public beta without installing Salesforce CLI.

## 30-second fictional test

1. Download or save `docs/samples/Fictional_Blank_Description.validationRule-meta.xml`.
2. Or download `docs/samples/fictional-validation-rule-metadata.zip`.
3. Open the GitHub Pages app.
4. Select the XML file or ZIP from your machine.
5. Expect one `VALIDATION-001-BROWSER` blank-description finding.

The sample is fictional. It contains no org ID, customer data, credentials, logs, reports, or local paths.

## Real metadata without Salesforce CLI

Use a metadata ZIP or source folder you already have from one of these sources:

- an admin or developer who can export metadata for you;
- a release package;
- a backup;
- a Git repository your team already uses.

Ask for the smallest useful slice first:

```text
Please send a small Salesforce metadata ZIP containing ValidationRule metadata only.
Do not include record data, logs, screenshots, credentials, org IDs, reports, or unrelated metadata.
```

Useful entries usually look like this:

```text
unpackaged/objects/Account/validationRules/Example.validationRule-meta.xml
force-app/main/default/objects/Account/validationRules/Example.validationRule-meta.xml
```

## Read the result

- Limitations: what this public beta did and did not check.
- Coverage rows: files or ZIP entries that were accepted, checked, skipped, rejected, or not assessed.
- Findings: issues emitted by the currently implemented browser rule.
- Rejected: unsafe or unsupported paths/files ignored before checking.
- Not Assessed: recognized input that is outside the current browser rule scope.

Do not post metadata, source code, org IDs, screenshots, logs, credentials, tokens, URLs, report content, filenames, or local paths in public feedback.
