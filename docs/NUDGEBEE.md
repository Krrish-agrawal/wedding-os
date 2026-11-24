# NudgeBee: what was found, and why there is no integration yet

Researched 2026-11-22 from public pages only (docs.nudgebee.com, the NudgeBee GitHub repo and website). **No integration code was written, and nothing in the app claims one.**

## What NudgeBee is
An "AI Agents & Agentic Workflow Platform for SRE, CloudOps and Support teams" (Kubernetes, AWS/Azure/GCP incident investigation, FinOps, runbooks). Cloud SaaS (app.nudgebee.com), self-hosted Community edition (BSL 1.1 server), and Enterprise.

## What is documented that a third-party app could call
- **GraphQL API:** `POST https://<domain>/api/graphql`, `Authorization: Bearer <API token>`; operations are named actions such as `accounts_list`, `events_list_v2`, `recommendations_list`. Documented examples are reads of cloud accounts, events and recommendations.
- **JSON-RPC:** `POST https://app.nudgebee.com/api/rpc` with the same token.
- **API tokens:** created in the UI (avatar menu, API Tokens); `sk-nb-` prefix; shown once; expiry 30/90/365 days or never.
- **Webhooks:** inbound alert sources (Prometheus Alertmanager, Datadog, Grafana, PagerDuty, a generic "Event Webhook", an "Automation Webhook"). The webhook page was not read, so paths and auth are unknown.
- **MCP integration:** NudgeBee can connect to external MCP servers.
- **No SDK** was found. **No hackathon requirements or sponsor brief** were found on any page.

## Why nothing was built
- Everything documented concerns cloud-operations data. None of it is a reminder, notification or scheduling service for a wedding, so a "payment reminder" or "vendor follow-up" integration would mean inventing endpoints or calling an ops API for something it is not for.
- The hackathon's actual requirement for NudgeBee (what the judges expect it to do) is not public in anything found.

## Genuinely possible options (need a decision from the project owner)
1. **Wedding OS as an MCP server that NudgeBee agents can call** (read wedding status, list overdue payments). Real, documented direction (NudgeBee supports external MCP servers), but untested: needs a NudgeBee instance.
2. **Wedding OS emits events to a NudgeBee Event Webhook** (e.g. "payment due in 3 days"). Needs the Webhooks page contract and a NudgeBee workspace.
3. **Use NudgeBee to observe Wedding OS itself** (alerts about the server): fits the product, not the wedding use case.

To proceed: provide the hackathon's NudgeBee brief (or the NudgeBee workspace URL and an API token / webhook URL). Credentials go in server env vars only. Until then the planning-reminder feature in the dashboard is computed locally from WeddingState and labelled as such, not as a NudgeBee feature.
