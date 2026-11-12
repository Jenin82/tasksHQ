# Security Policy

## Supported versions

TasksHQ is released from the `main` branch. Security fixes land on `main` only. If you self-host, keep your deployment up to date with `main` (see "Upgrading an existing deployment" in the README).

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Older commits | No |

## Reporting a vulnerability

Report vulnerabilities privately through GitHub Security Advisories: open the [Security tab](https://github.com/Jenin82/tasksHQ/security) of the repository and choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for a suspected vulnerability.

If the **Report a vulnerability** button is missing, private vulnerability reporting is not enabled yet. Open a public issue that asks a maintainer to contact you, without any vulnerability details. (Maintainers: enable it under **Settings → Code security → Private vulnerability reporting**; the issue template's security link depends on it.)

Include:

- The affected component (web app, MCP server, OAuth flow, shared domain code) and commit.
- Steps to reproduce or a proof of concept.
- The impact you expect, for example data exposure across organizations or projects, privilege escalation, or token misuse.

The maintainers will acknowledge the report, investigate, and coordinate a fix and disclosure with you through the advisory. Please give us reasonable time to release a fix before disclosing publicly.

## Scope

In scope: code in this repository, including access rules, authentication, MCP OAuth and token introspection, and image and share-link handling.

Out of scope: vulnerabilities in a specific self-hosted deployment's configuration (for example leaked `secrets.env` values), in Cloudflare, Google or other third-party services, and denial of service through volume alone.
