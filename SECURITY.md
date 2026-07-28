# Security Policy

## Supported Scope

- `main` branch
- most recent tagged release

## Local Runtime Behavior

- The CLI reads only files or streams explicitly passed to it.
- Verification runs locally and does not call external models.
- The project does not use a hosted database.
- Optional style memory is local-only by default.

## Local Style Memory

- Optional memory may store accepted outputs, rejected outputs, rewrite patterns, violation codes, metrics, and receipt hashes.
- Do not store secrets, credentials, private keys, regulated data, or confidential examples in local memory.
- Delete the local memory directory, usually `.laconic/`, to remove local memory examples.
- Memory can guide style retrieval. It does not decide verifier pass/fail.

## Reporting a Vulnerability

- Use GitHub Security Advisories (`Security` tab -> `Report a vulnerability`) for private disclosure.
- Include affected commit/tag, reproduction steps, expected impact, and proposed mitigation if available.
- Do not open public issues for unpatched vulnerabilities.

## Response Targets

- initial triage: within 5 business days
- remediation for confirmed high/critical issues: next patch release window
