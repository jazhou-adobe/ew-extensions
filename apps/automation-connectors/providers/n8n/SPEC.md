# Spec: Automation Connectors: n8n community node (provider)

Ticket: jazhou-adobe/ew-extensions#9 (this spec: #47). Blocked by #7 (Automation Connectors relay + Zapier app; spec in `apps/automation-connectors/SPEC.md`, spec task #45), which in turn rests on #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). Sibling: #8 (Make app), same relay.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #7 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/n8n/Cloudflare.

Vocabulary follows #1, #2 and #7 exactly: *extension* = one folder `apps/<name>/`; *relay* = the worker in `apps/automation-connectors/worker/`; *connector* = a third-party automation product (here n8n); *relay credential* = the per-site secret the relay issues for a connector to call the relay (not an Adobe credential); *site connection*, *event*, *hook / subscription* as defined in the #7 spec. This spec **implements against the #7 provider/connector interface and does not redesign it**: the interface is the connector API v1 (`/v1/me`, `/v1/hooks`, `/v1/events`, `/v1/pages*`), the event envelope, the relay-credential scopes, the `SUBSCRIBER_HOSTS` allowlist, and the folder rule "vendor follow-ups live in `providers/<vendor>/`" (#7 Decisions 12, 23, 25, 28; Build Analysis section 4). New terms:

- **Node package** = the npm package built in this folder. n8n calls the unit of installation a *community node package*.
- **EW Automation Trigger** and **EW Automation** = the two n8n nodes in the package (a trigger node and an action node). *Working names*; see Open Question 6.
- **n8n credential** = n8n's stored secret record of type "EW Automation API". It holds a **relay credential** (and the relay URL). It never holds an Adobe credential.
- **Webhook URL** = the URL n8n generates for a trigger node; n8n distinguishes a *test* URL and a *production* URL [VERIFIED: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/workflow-development.md].
- **Publish / unpublish a workflow** = n8n's current wording for what older docs call activate / deactivate [VERIFIED wording on the page above].

Primary sources read (all 2026-11-16): n8n creator docs https://docs.n8n.io/connect/create-nodes/overview.md and the pages cited inline (n8n-node CLI, node building styles, node types, credentials files, error handling, UX guidelines, verification guidelines, submitting nodes, private nodes, community-node installation, linter, environment variables); n8n source on GitHub (`n8n-io/n8n` `packages/nodes-base/nodes/Calendly/v2/CalendlyTriggerV2.node.ts`, `packages/cli/src/webhooks/webhook.service.ts`, `packages/cli/src/webhooks/live-webhooks.ts`, `packages/cli/src/webhooks/webhook-helpers.ts`, `packages/workflow/src/node-helpers.ts`; `n8n-io/n8n-nodes-starter` `package.json` and `.github/workflows/publish.yml`); the npm registry (`npm view`); Cloudflare Wrangler commands https://developers.cloudflare.com/workers/wrangler/commands/workers/; the #7, #2 and #1 specs in this repo.

---

## Problem Statement

Teams that self-host their automation stack on **n8n** want the same behaviour #7 gives Zapier users: a workflow that starts when a page is published, previewed or updated in Experience Workspace (EW), and workflow steps that create a page from a template, preview it, and publish it. Today they would have to call the relay's REST API by hand with n8n's generic HTTP Request and Webhook nodes, work out the subscribe/unsubscribe lifecycle themselves, and re-create the same error handling in every workflow.

Specific problems:

1. **n8n has no way to know about the relay.** A native n8n trigger must create its subscription when a workflow is published and remove it when the workflow stops. Without a purpose-built trigger node, users register hooks manually, forget to remove them, and every edit risks leaving stale subscriptions that keep receiving events.
2. **Self-hosted n8n is not where Zapier is.** Zapier hooks all arrive from one well-known host that the relay allowlists. A self-hosted n8n instance has an arbitrary hostname, often behind NAT on a laptop. The relay refuses subscriber URLs that are not public HTTPS on port 443 and not on its host allowlist (#7 Decision 9). That is the central design problem of this ticket (see Implementation Decision 9 and Risk R1).
3. **Credentials.** The user must authenticate to the relay per site, but n8n is a *server-side* product that stores secrets itself. The ticket requires that no Adobe vendor credential ever reaches the browser or the connector and that unauthenticated calls to the relay are rejected.
4. **Packaging.** n8n's own tooling, language (TypeScript), lint config (ESLint 9) and Node floor (24) differ from this repo's pinned conventions (JS, ESLint 8, Node 22). The package must build, install into a local n8n and pass CI without disturbing the rest of the repo.

The maintainer needs an **n8n community node package** that (a) exposes the same three triggers and three actions as the Zapier app, (b) rides the relay unchanged, (c) works for a self-hosting team with a documented, honest setup, and (d) is covered by tests that run without n8n Cloud, Adobe login or a live relay.

## Solution

Ship an npm package, built in `providers/n8n/` inside the existing `automation-connectors` extension (a vendor follow-up, per the owner convention), containing:

- **One credential type, "EW Automation API"**: two fields (relay URL, relay credential), sent as a bearer header; n8n's credential **Test** button calls the relay's "who am I" route and shows success or a plain failure.
- **EW Automation Trigger** (webhook trigger node): the user selects one or more of Page Published, Page Previewed, Page Updated and an optional path prefix. When the workflow is published, the node subscribes to the relay (one subscription per selected event, all pointing at the node's webhook URL); when the workflow is unpublished, edited or deleted, it unsubscribes. Each relay delivery starts a workflow run with the event envelope as the output item. Events the relay redelivers (the relay is at-least-once on ambiguous failures, #7 Decision 7) can be skipped by event `id`.
- **EW Automation** (action node): resource Page; operations **Create from Template**, **Preview**, **Publish**; each maps 1:1 to a relay connector route and turns relay error codes into readable n8n errors.

The relay itself is **not changed** except for registration: the n8n webhook hostnames of the teams that use the relay are added to the relay's subscriber-host allowlist (a configuration entry, not code). A README in the provider folder and a vendor section in the extension README document credentials, host registration, how to expose a local n8n over HTTPS for testing, and the fact that this connector reads no EW site config.

What the user sees: issue a credential in the EW "Connections" console (#7), paste it into n8n, drop **EW Automation Trigger** onto a canvas, publish the workflow, publish a page in EW, and within about two minutes (#7's documented latency) the workflow runs with `path`, `urls.live`, `user` and the rest of the envelope available to later nodes.

## User Stories

n8n user building workflows:

1. As an n8n user, I want a workflow to start when a page is published in EW, so that I can announce it, index it or sync it without anyone doing it by hand.
2. As an n8n user, I want a workflow to start when a page is previewed, so that reviewers are notified that a page is ready.
3. As an n8n user, I want a workflow to start when a page's content is updated, so that translation, search indexing and SEO checks stay in sync.
4. As an n8n user, I want to select several events in one trigger node, so that one workflow can handle published and previewed pages without duplicating nodes.
5. As an n8n user, I want to restrict the trigger to a path prefix (for example `/blog/`), so that only the section I care about starts the workflow.
6. As an n8n user, I want the trigger output to include the event id, type, path, preview/live/edit URLs, acting user and time, so that downstream nodes have useful fields without extra lookups.
7. As an n8n user, I want a trigger event to run my workflow once, so that Slack, email or tickets are not duplicated; I want to know exactly when a duplicate can still happen.
8. As an n8n user, I want publishing the workflow to subscribe and unpublishing it to unsubscribe automatically, so that I never manage relay hooks by hand.
9. As an n8n user, I want editing the trigger (changing events or path prefix) to update the subscriptions, so that stale hooks do not keep firing.
10. As an n8n user, I want the "Listen for test event" button to work on the trigger, so that I can build the workflow against a real event and pin it.
11. As an n8n user, I want a node that creates a page from a template path, so that a form submission or CRM record can open a new page ready for authors.
12. As an n8n user, I want a node that previews a page, so that automation can refresh the preview after an upstream change.
13. As an n8n user, I want a node that publishes a page, with an option to preview first, so that an approval in another tool can publish content.
14. As an n8n user, I want a clear choice for what happens when the target page already exists (fail, or create a unique name), so that my workflow does not silently overwrite content.
15. As an n8n user, I want the action nodes to run once per incoming item and to honour "Continue on fail", so that bulk workflows behave like every other n8n node.
16. As an n8n user, I want errors in plain language (page already exists, template not found, credential lacks the scope, site not supported, relay unreachable), so that I can fix the workflow without reading relay logs.
17. As an n8n user, I want errors to show the relay's request id, so that I can give a maintainer something to look up.
18. As an n8n user, I want the node's inputs and labels to follow n8n's conventions, so that it feels like any other n8n node.
19. As an n8n user with several EW sites, I want one n8n credential per site, named after the site, so that each workflow only touches the site I chose.
20. As an n8n user, I want the node to tell me which relay scope each operation needs, so that I can issue a credential with only those scopes.

n8n credential setup:

21. As an n8n user, I want a single credential form with the relay URL (with a sensible default) and the relay credential as a masked field, so that setup is two fields.
22. As an n8n user, I want the credential's Test button to prove the credential works and say which site it belongs to, so that I know before building a workflow.
23. As an n8n user, I want a revoked or wrong credential to fail with an obvious message, so that I know to re-issue it.

Self-hosting n8n admin:

24. As a self-hosting admin, I want a README that lists exactly what has to be true for the relay to deliver to my n8n (public HTTPS on port 443, hostname registered with the relay), so that I do not debug opaque failures.
25. As a self-hosting admin, I want to know how to expose a *local* n8n over HTTPS for testing and which environment variable tells n8n its public URL, so that I can run a live workflow on my laptop.
26. As a self-hosting admin, I want to install the package into my n8n by one documented route (private tarball or npm), so that I can use it without n8n Cloud.
27. As a self-hosting admin, I want to understand the security statement for community nodes (unverified code runs with access to my workflow data), so that I can decide whether to install it.
28. As a self-hosting admin running n8n's optional SSRF protection, I want the README to say which allow-list setting my relay host needs, so that the node is not blocked by my own hardening.
29. As a self-hosting admin, I want n8n restarts not to create duplicate subscriptions, so that restarts are safe.

EW site admin:

30. As an EW site admin, I want the connector to use the same per-site relay credential and scopes as Zapier, so that I manage one credential model.
31. As an EW site admin, I want to issue a credential with only `events:read` for a trigger-only workflow, so that a leaked credential cannot publish.
32. As an EW site admin, I want to see the n8n subscriptions in the console subscription list and to see them disappear when the workflow is unpublished, so that I can verify the connector is clean.
33. As an EW site admin, I want revoking the credential in the console to cut n8n off immediately, so that a lost n8n instance is not a standing risk.
34. As an EW site admin, I want the README to say that the relay holds the site's Admin API key and n8n never sees it, so that I can decide with correct information.

Maintainer / operator:

35. As the maintainer, I want the n8n node to need no new relay route, so that #7's relay stays vendor-neutral and #8/#9 do not diverge.
36. As the maintainer, I want the only change outside the provider folder to be the relay's subscriber-host registration plus documentation and CI wiring, so that the extension shell is untouched. (#9 AC3)
37. As the maintainer, I want the package to build and install into a real local n8n and to be tested against it in CI, so that "works in n8n" is an automated claim.
38. As the maintainer, I want unit tests for the subscription lifecycle, event filtering, de-duplication and error mapping that need neither n8n nor a relay, so that core logic regressions are caught in seconds. (#9 AC7)
39. As the maintainer, I want the package to be ready for n8n's verification process (no runtime dependencies, no env/file-system access, MIT licence, English only, provenance-capable publish), even though submission is out of scope, so that going public is a checklist and not a rewrite.
40. As the maintainer, I want n8n's tooling (TypeScript, ESLint 9, Node 24) isolated in the provider folder, so that it cannot break the repo's ESLint 8, JS-only, Node 22 conventions.
41. As the maintainer, I want the relay conformance for n8n-shaped subscribers (webhook URL shapes, 200 acknowledgements, 404 from stopped workflows) written as tests, so that the known gaps are documented by code.
42. As the maintainer, I want no Adobe or relay secret in the package, its tests, its CI or its fixtures, so that nothing leaks through npm or the public repo.

## Implementation Decisions

(No file paths or code. Layout and contract tables are in the Build Analysis.)

**Provider shape and scope**

1. **One package, two nodes, one credential type.** A single npm package integrates a single service (the EW relay), as n8n's verification guidelines require: "Each package should integrate one third-party service ... You can include a trigger node for the same service alongside the main node" [VERIFIED: https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md]. Nodes: a trigger node and an action node; credential: one type. The package is a vendor follow-up and lives entirely in the provider folder of the existing extension (owner convention; #9 AC3).
2. **The relay interface is consumed as is; no new relay routes.** The trigger uses `GET /v1/me`, `POST /v1/hooks`, `DELETE /v1/hooks/{id}`; the action node uses `POST /v1/pages`, `POST /v1/pages/preview`, `POST /v1/pages/publish`; the credential test uses `GET /v1/me`. `GET /v1/events` is not used (no "perform list" concept in n8n; see Out of Scope for a possible Get Many operation). Contract details are in Build Analysis section 4.
3. **Both nodes are written in the programmatic style.** The trigger must be programmatic: "The declarative style doesn't support trigger nodes" [VERIFIED: https://docs.n8n.io/connect/create-nodes/plan-your-node/choose-a-node-building-style.md]. For the action node n8n's guidance is declarative-first, with programmatic reserved for cases such as nodes that "transform data beyond what routing handles" [VERIFIED, same page]. This spec nevertheless chooses programmatic for the action node because (a) the relay's error messages are *fixed generic strings* (#2 Decision 9: "Messages are fixed strings; no input echo"), so the user-facing text has to be produced in the node from the error `code`, matching the Zapier app's requirement to translate relay codes into readable English (#7 Decision 24); (b) one shared client and error mapper for both nodes keeps the mapping in one tested place; (c) a programmatic `execute` can be unit-tested at the node boundary without n8n's routing engine. Whether declarative `postReceive` hooks could do the same mapping is not verified [ASSUMPTION]; the choice is reversible without user impact (same node name, parameters and version), and is Open Question 15.
4. **Event set = the Zapier app's three triggers.** Page Published (`page.published`), Page Previewed (`page.previewed`), Page Updated (`page.updated`). `page.unpublished` exists in the relay but is deliberately not exposed, for parity with #7 (its Open Question 11); adding it later is one more option value.
5. **The EW console and EW SDK are not involved.** No new app, no library plugin, no config-sheet row, no SDK action. The only EW touchpoint is the existing console where an admin issues the credential. Consequently "works in EW with `ref=local` and with a branch ref" (#9 AC5) means: a credential issued by the console loaded from either ref, against the relay that console talks to, works in n8n unchanged (relay URL is the only difference). See Build Analysis section 2.

**Trigger node behaviour**

6. **Subscription lifecycle (n8n hooks).** n8n runs a trigger's hook methods in this order when a workflow is published: *check exists*, and only if that returns false, *create*; on unpublish, *delete*. This is how n8n's own webhook triggers work [VERIFIED: https://github.com/n8n-io/n8n/blob/master/packages/cli/src/webhooks/webhook.service.ts, `createWebhookIfNotExists` and `deleteWebhook`; prior art https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Calendly/v2/CalendlyTriggerV2.node.ts]. Decisions:
   - **check exists always answers "no".** The relay has no "list my hooks" route and `POST /v1/hooks` is idempotent per (credential, event, target URL) (#7 contract), so running *create* on every publish and on every n8n restart is safe and removes the failure mode "n8n thinks the hook exists but the relay lost it".
   - **create** first calls `GET /v1/me` (validates the credential, learns org/site, reads capabilities), refuses with a clear message when Page Updated is selected and the site reports `capabilities.updated = false` (legacy-site gap, #7 Decision 3a), then posts one subscription per selected event with the node's webhook URL as the target and the optional path prefix. It stores `{ site, targetUrl, hooks: { event: id } }` in the node's workflow static data. Before posting it best-effort deletes any previously stored subscription whose event is no longer selected or whose target URL changed (n8n's public URL changed, or the user edited the node). If any subscription fails, the ones created in this call are deleted again (best effort) and the error is raised, so publishing a workflow never leaves a half-subscribed state.
   - **delete** removes every stored subscription (`DELETE` is idempotent, `204` even when the id is unknown) and clears the stored state. A relay `401` on delete (credential revoked) or a `404` is treated as "nothing left to delete". Any other failure keeps the stored ids, returns "not deleted" to n8n and logs nothing sensitive; the next publish's *create* then cleans them up. [OPEN: a revoked credential's subscriptions may still exist on the relay; #7 does not say, see Open Question 4.]
   - The webhook URL is taken **verbatim from n8n** for both modes: the test URL while the user listens for a test event (n8n registers it for a bounded time, then calls *delete*) and the production URL for a published workflow [VERIFIED test-mode timer exists in https://github.com/n8n-io/n8n/blob/master/packages/cli/src/webhooks/test-webhooks.ts; 120-second window per https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/workflow-development.md].
7. **One relay subscription per selected event; one webhook URL for all.** The relay's subscription takes a single event; n8n gives the node one URL. The node identifies the event from the envelope `type`.
8. **Inbound handling.** The trigger's webhook handler accepts only a JSON object envelope with a string `id` and a `type` that is one of the node's selected events and, when the node knows the site (from create), an `org`/`site` equal to the stored one. Anything else is acknowledged without starting a workflow (type or site mismatch) or rejected `400` (not an envelope). It answers immediately (n8n "on received" response mode) so the relay sees a fast `2xx`. The output is one item per delivery containing the envelope unchanged (ISO 8601 dates, `urls`, `user`, `source`, `change` as the relay sends them). A handler result without workflow data starts no execution [VERIFIED reading: https://github.com/n8n-io/n8n/blob/master/packages/cli/src/webhooks/webhook-helpers.ts, `workflowData !== undefined` gate; proven by smoke test NS5].
9. **Subscriber-host registration (the "register the provider" step), and what it does not solve.** The relay accepts a subscription only if the target host is on `SUBSCRIBER_HOSTS`, HTTPS, port 443, no IP literal (#7 Decision 9; test SB4). For n8n the provider contributes **exact hostnames** to that allowlist: for production, the hostnames of the n8n instances that are allowed to receive events; for local testing, the host of a public HTTPS tunnel. This is a configuration edit to the relay's non-secret `vars`, not a code change, which satisfies #9 AC3 literally. It does not make arbitrary self-hosted instances work without the relay operator's involvement. That limitation is the main open design question (Open Question 1) and is documented plainly. The node performs **no client-side URL validation** of its own: the relay is the single authority, and a refusal (`400 bad_target_url`) is turned into an actionable message listing the three causes (not public HTTPS on 443, host not registered, URL contains credentials). A client-side check would also break the hermetic smoke tier, which uses plain HTTP between containers.
10. **De-duplication.** The relay is at-least-once on ambiguous failures and every payload has a stable `id` (#7 Decision 7). The trigger offers a **"Skip Duplicate Events"** option, on by default, that remembers the last 200 event ids in the node's workflow static data and acknowledges a repeated id without starting a workflow. n8n saves static data after a live webhook execution [VERIFIED: https://github.com/n8n-io/n8n/blob/master/packages/cli/src/webhooks/live-webhooks.ts, `saveStaticData` after `executeWebhook`]. Test-mode executions are not covered (they are manual). The README states the exact claim: "once per event id per workflow, while the workflow is published and n8n is not reset".
11. **Trust model for inbound requests.** The relay does not sign deliveries (hardening backlog in #7); Zapier's model, and now n8n's, is an unguessable target URL. n8n webhook URLs for nodes that have a `webhookId` contain that UUID in the path [VERIFIED: https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/node-helpers.ts, `getNodeWebhookPath`]. Defence in depth is the structural validation in Decision 8. If the owner wants signatures, it is a relay feature (Open Question 14), not something this node can add alone.

**Credentials and authentication**

12. **The n8n credential holds the relay credential, not an Adobe credential.** Fields: relay URL (default: the production relay origin, a constant decided in #7 Open Question 18) and the relay credential (masked, password-type as n8n's UX rules require: "API key and sensitive credentials should always be password fields" [VERIFIED: https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines.md]). Authentication: `Authorization: Bearer <credential>`. Test: `GET /v1/me`. The relay credential belongs to exactly one `{org}/{site}` (#7 Decision 12), so there is one n8n credential per site; the README tells users to name it `org/site`. This is the same trust placement as the Zapier app (#7 Decision 31: "holds only the user's relay credential inside Zapier's own censored credential store"); n8n encrypts credentials at rest with its encryption key [VERIFIED: https://docs.n8n.io/connect/create-nodes/build-your-node/reference/credentials-files.md, "n8n encrypts the data that's stored using credentials using an encryption key"]. Reading of #9 AC6: "vendor credentials" = Adobe credentials (the site's Admin API key), which stay only in the relay. [OPEN: owner confirms this reading, Open Question 5.]
13. **Scopes per operation.** Trigger: `events:read`. Create from Template: `pages:create`. Preview: `pages:preview`. Publish: `pages:publish` (when "Preview First" is on the relay also previews; #7 Decision 18; the scope for that implicit preview is [OPEN] in #7, Open Question 16 here). The node documents these in parameter descriptions and the README; a missing scope surfaces as the relay's `403 credential_scope` mapped to a message naming the needed scope.
14. **Unauthenticated calls to the relay are rejected by the relay, not by this package.** The package's job is to never weaken that: it sends the bearer on every relay request, never sends an `Origin` header (n8n runs server-side; the relay refuses requests with an `Origin`, #7 Decision 13), never forwards the credential anywhere but the configured relay URL, and never includes it in errors, outputs or logs.

**Actions**

15. **Operations and parameters.** Resource: Page. *Create from Template*: Template Path (required), Page Path (required), Collision (options: "Fail If The Page Exists" default, "Create A Unique Name"); it does not preview or publish (#7 Decision 17). *Preview*: Page Path. *Publish*: Page Path, Preview First (boolean, default true; #7 Decision 18, its Open Question 10). Output: the relay's JSON result (`path`, `urls`, and `status` for preview/publish). The action node is **not** marked usable as an AI tool in v1: a publish action reachable by an LLM agent is a deliberate decision, not a default (Open Question 13).
16. **No retries inside the node.** The relay already retries the Admin API with backoff (#7 Decision 20) and these POSTs are not safe to repeat blindly (create would conflict, publish may be duplicate work). n8n's per-node "Retry On Fail" is left to the user.
17. **Error surface.** All relay errors have the shape `{ error: { code, message, requestId } }` (#2 Decision 9). The node maps `code` (and HTTP status when the code is unknown) to a short plain-English message plus a description, includes the `requestId`, and never includes the credential. Table in Build Analysis section 4. Network failures and timeouts become a "relay unreachable" message that names the relay host only.

**Packaging and tooling**

18. **TypeScript, ESLint 9 and Node 24 live only inside the provider folder.** n8n's tooling is the official `n8n-node` CLI, which scaffolds TypeScript, bundles ESLint 9 config (peer `eslint >= 9`) and builds with `tsc` [VERIFIED: https://docs.n8n.io/connect/create-nodes/build-your-node/using-the-n8n-node-tool.md; npm registry `@n8n/node-cli` 0.56.4 `peerDependencies.eslint '>= 9'`, observed 2026-11-16]. n8n's docs state a minimum Node.js of 24 [VERIFIED: https://docs.n8n.io/connect/create-nodes/build-your-node/tutorial-build-a-programmatic-style-node.md] and the current `n8n` package declares `engines.node >=24.0.0` (version 2.47.7, observed via `npm view`). This conflicts with the repo-level pins (JS-only, ESLint 8 + helix, Node 22); the package therefore has its own `package.json` and lock file (same pattern as `providers/zapier/` in #7), its own CI job on Node 24, and the root ESLint run ignores the folder. The owner approved the repo-level pins; whether this isolated exception is acceptable is Open Question 8. Tests, by contrast, follow the repo convention: plain JS with the Node built-in test runner, run against the compiled output.
19. **Zero runtime dependencies.** `n8n-workflow` is a peer dependency only (as in the starter [VERIFIED: https://github.com/n8n-io/n8n-nodes-starter/blob/master/package.json]); no `dependencies`; no `process.env`, file-system or child-process use. These are n8n's verification rules ("must not interact with environment variables or attempt to read/write files"; "verified community nodes aren't allowed to use any run-time dependencies" [VERIFIED: verification-guidelines and submit-community-nodes pages]) and are enforced by tests so the package stays verification-capable.
20. **Distribution in this ticket = a built, installable package, not a publication.** #9 AC2 requires that the package builds and installs into a local n8n. The supported install routes proven here are: the tarball produced by `npm pack` installed into n8n's custom-nodes folder, and the private-node Docker image recipe [VERIFIED: https://docs.n8n.io/integrations/community-nodes/installation-and-management/manual-installation.md; https://docs.n8n.io/connect/create-nodes/deploy-your-node/install-private-nodes.md]. Publishing to npm, the Creator Portal submission and n8n verification are out of scope (they require ownership, a licence, a trademark decision and a GitHub-Actions provenance publish, none of which this ticket decides), but the package is built to pass them.
21. **Package identity (working).** npm name `n8n-nodes-ew-automation` (name format `n8n-nodes-<name>` is required [VERIFIED: https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md]; the name returned `E404` from `npm view` on 2026-11-16, i.e. unclaimed [VERIFIED by command]); keyword `n8n-community-node-package`; licence MIT (n8n verification requires MIT; the repo licence is still open from #1, Open Question 7); node display names "EW Automation Trigger" and "EW Automation". "Experience Workspace" and "Adobe" are Adobe marks, so the working names avoid them, as #7 R13 does for Zapier.
22. **Compatibility policy.** Built against `n8n-workflow` 2.x; tested in CI against one pinned n8n 2.x image; `n8nNodesApiVersion` 1 and `strict: true` as scaffolded by the CLI [VERIFIED: starter package.json]. A moving target: the docs already reference n8n 3.0 behaviour for `n8n-node dev` (runs n8n in a container from 3.0) [VERIFIED on the n8n-node page], while the latest `n8n` on npm was 2.47.7 on 2026-11-16 [VERIFIED by command]. A second CI run against the next major is a follow-up once it exists.

**Documentation and repo integration**

23. **Documentation placement (#9 AC4).** A README in the provider folder (full vendor setup: credentials, scopes, relay URL, host registration, local HTTPS exposure, install, example workflows, errors, security notes) plus a short vendor section in the extension README that links to it. The README's "site config keys" statement is: *none*; the extension reads no EW site config and per-site relay settings live in the relay console (#7 Decision 29).
24. **Repo wiring kept to the minimum.** Outside the provider folder this ticket touches only: the relay's `SUBSCRIBER_HOSTS` entries (and a dev note on overriding them locally), the extension README vendor section, the CI workflow (new jobs), and the root lint ignore for the provider folder. `.hlxignore` already hides `**/providers/` (#7 Build Analysis section 5), so nothing in the package is served from the code bus.
25. **English only.** Interface text, errors and docs are English, as n8n verification requires [VERIFIED: verification-guidelines].

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given a fake relay and a fake n8n context, assert what the node sends to the relay (route, method, headers, body, count and order), what it stores for the next run, what it returns to n8n (output items, thrown errors' messages), and what it never does (leak the credential, send an `Origin` header, start a run for an unselected event). Never assert internal helper names or how many internal functions ran. The negative properties are asserted across every path: "the canary relay credential appears in no output item, no error text, no log call and no request to any host other than the configured relay URL"; "no `Origin` header on any relay request".

**Proposed seams** (recorded instead of asked, per #47). Reused seams first; two new ones, both at the highest practical point; the relay's own seams are reused, not extended.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| N1 | **n8n node boundary**: the compiled node classes as n8n itself calls them: `execute` for the action node; `webhookMethods.default.{checkExists, create, delete}` and `webhook` for the trigger node | **new** (the n8n analogue of #7's Z1) | Unit tests of every behaviour in decisions 6 to 17 | A hand-built `this` implementing only the n8n context methods the node uses (parameters, credentials, node webhook URL, workflow static data, body/headers, response object, execution helpers) with a recording relay at the `httpRequestWithAuthentication` helper; real `n8n-workflow` error classes |
| N2 | **Real n8n runtime**: the packed tarball installed in a real n8n container, driven through n8n's own HTTP surface | **new** (the n8n analogue of #7's W2 smoke tier; highest possible point for node behaviour) | Install, credential test, publish/unpublish lifecycle, delivery start-to-finish, restart, action workflows, secret-leak scan | A fake relay (Node HTTP server implementing the #7 connector contract from the shared golden fixtures) that also plays the delivering relay by POSTing envelopes to the webhook URL the node subscribed with |
| C1 | Relay contract fixtures | reused from #7 (`worker/contract/`, read by relative path, the same same-extension dependency the Zapier app has) | N1 and N2 fake relays; static route-conformance test | Golden JSON files |
| W1 / R1 | Relay worker boundary: `worker.fetch` and `worker.scheduled` | reused from #7 | Provider-specific relay conformance suite (n8n-shaped subscribers) | #7's fakes: fake IMS, fake Admin API, fake subscriber, fake clock, in-memory store |
| S3 | Repo convention check | reused from #1/#2/#7 | CI lint job | Temp-dir fixtures |

Why N1 and N2 both: N1 gives fast, exhaustive behaviour matrices (error mapping, partial failure, de-duplication) with no Docker; N2 is the only place the n8n engine's real behaviour (hook order, test vs production URLs, static-data persistence, "no workflow data means no run") is exercised, which is exactly where assumptions in this spec live. The real relay, real EW and a real tunnel are covered only by manual verification (they need Adobe login, Cloudflare and a public hostname).

**Modules tested:** relay client and URL handling, relay error mapper, credential definition, trigger lifecycle (check/create/delete), trigger inbound handler (filter, site match, de-duplication), action node (three operations), package metadata and verification rules, relay conformance for n8n-shaped subscribers, README consistency.

**Prior art.** #7 spec (seams W1, R1, Z1, test kit, golden fixtures, `providers/zapier/` layout); #2 spec (`node:test` + injected fakes, canary-secret property test, smoke tier driving a real runtime); #1 spec (S3 convention check). n8n's own trigger node `CalendlyTriggerV2` for the hook lifecycle shape [VERIFIED link above]. The n8n starter's lint/build/release scripts [VERIFIED: starter package.json].

## Out of Scope

- Publishing to npm, n8n Creator Portal submission, n8n verification, n8n Cloud availability (this ticket makes the package verification-ready and documents the checklist; Open Questions 6, 7, 9).
- Any relay change beyond the subscriber-host registration: no new routes, no signed deliveries, no wildcard allowlist entries, no per-site allowlist in the console, no local-only insecure-subscriber flag, no automatic disabling of failing subscriptions. Gaps found are recorded as requirements on #7 (R-N1 to R-N3 in the Build Analysis), not built here.
- A **polling** trigger mode (`GET /v1/events` on n8n's schedule) that would remove the HTTPS/allowlist requirement for self-hosters; recommended as a follow-up (Open Question 2).
- A "Page Unpublished" trigger event; "Get Many Events" and other read operations; update-content, delete, or search operations; resources other than Page.
- n8n "usable as AI tool" support (Decision 15) and n8n credential sharing/OAuth. The relay has no OAuth scheme (#7 Decision 22).
- Testing against n8n Cloud, against n8n queue mode, or against more than one pinned n8n version in CI.
- Changes to the EW console, to the Zapier app, or to the event envelope.
- The Adobe outside-activity/IP policy and security review (flagged in #1 R1, #2 R1, #7 R1; unchanged by this ticket).

## Further Notes

- **#7 is a spec, not code, today.** `apps/automation-connectors/` contains only `SPEC.md`; there is no relay, no `worker/contract/` fixtures and no console. This ticket is blocked by #7 for that reason. Where this spec names a fixture or a relay behaviour it names what #7's spec promises; every such place is covered by a contract test so drift is caught when #7 lands.
- **Webhook URL shape seen from the relay.** For a trigger node that has a `webhookId`, the production path is `{base}/webhook/{webhookId}/{path}`; the test path uses `webhook-test` [VERIFIED path construction: `getNodeWebhookPath` source above; endpoint path names `webhook` and `webhook-test` per https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/endpoints.md]. The public base is set with `N8N_WEBHOOK_URL`; `WEBHOOK_URL` is a deprecated alias from n8n 2.35.0 [VERIFIED on the same page]. The relay requires port 443, so an n8n instance reachable only at `:5678` needs a reverse proxy or tunnel [consequence of #7 Decision 9; test SB4].
- **n8n's own tunnel is development-only.** n8n documents a cloudflared-based tunnel "for local development and testing. It isn't safe to use it in production" [VERIFIED: https://docs.n8n.io/deploy/host-n8n/install-options/install-with-npm.md#n8n-with-tunnel]. A quick tunnel gets a fresh hostname per run, so for local testing the relay needs that hostname added to `SUBSCRIBER_HOSTS` every time. For `wrangler dev` this can be done per run with `--var` [VERIFIED flag: https://developers.cloudflare.com/workers/wrangler/commands/workers/, "`--var` `key:value[]` ... makes the variables available in your Worker's `env`"]; whether a list value with commas survives the CLI parsing is [ASSUMPTION], settled in spike S-N5. A stable named hostname avoids the churn.
- **n8n's optional SSRF protection** is off by default and, when on, blocks private/loopback ranges for requests to user-controllable targets; `N8N_SSRF_ALLOWED_HOSTNAMES` and `N8N_SSRF_ALLOWED_IP_RANGES` open specific targets [VERIFIED: https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/ssrf-protection.md]. Whether it applies to a node's credential-authenticated relay requests is [ASSUMPTION]; the README says what to allow if a private relay host is blocked.
- **Stopped workflows answer `404`, not `410`.** [ASSUMPTION from how n8n unregisters webhooks; proven or refuted by spike S-N5.] The relay removes a subscription only on `410` (#7 Decision 8). If a workflow is unpublished while the relay is unreachable, its subscription survives and its deliveries fail until the retry schedule is exhausted. Mitigations in this ticket: *create* cleans up stale ids, and the console shows failed deliveries. The proper fix (treat `404` from registered n8n hosts as gone, or auto-disable after N consecutive failures) is a requirement on #7 (R-N2).
- **Personal data.** The envelope can carry the acting user's email (#7 Decision 10, its Open Question 13). n8n stores execution data in its database by default, so that email lands in the user's n8n execution history. The README says so; whether to omit it by default is #7's decision.
- **n8n community-node risk statement.** n8n states that installing a community node means "installing unverified code from a public source" with access to workflow data and the host [VERIFIED: https://docs.n8n.io/integrations/community-nodes/risks.md]; the README repeats it and explains that the package has no runtime dependencies and makes requests only to the configured relay.
- `apps/automation-connectors/providers/n8n/SPEC.md` is a planning artefact; keep or delete it when the package is built, as decided for the other specs [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

```
 n8n instance (self-hosted; Docker/npm)                                    Relay (#7)                                  EW
 ┌───────────────────────────────────────────────────────────┐            ┌─────────────────────────────────┐        ┌────────────────────────────┐
 │ node package  n8n-nodes-ew-automation   (this ticket)      │            │ Cloudflare Worker + D1           │        │ EW console (existing)      │
 │  • credential "EW Automation API": relayUrl + relay cred   │  HTTPS     │ connector routes (bearer cred)   │  IMS   │ issues the per-site relay  │
 │  • EW Automation Trigger  ── publish ──► GET /v1/me        │ ─────────► │ /v1/me /v1/hooks /v1/pages*      │ ◄───── │ credential, shows once     │
 │        (webhook trigger)     publish ──► POST /v1/hooks×N  │            │ cron tick: poll log, scan, ledger│        └────────────────────────────┘
 │        ◄── POST envelope ── relay delivers to webhook URL  │ ◄───────── │ outbox → https POST to allowlisted│
 │        unpublish ─────────► DELETE /v1/hooks/{id}×N        │            │ host (SUBSCRIBER_HOSTS)          │
 │  • EW Automation (actions) ─► POST /v1/pages[/preview|/publish]          │ holds Admin API keys (encrypted) │
 └───────────────────────────────────────────────────────────┘            └─────────────────────────────────┘
        n8n public URL must be HTTPS:443 and its host registered with the relay (config), otherwise deliveries are refused
```

Responsibility split:

| Concern | n8n node package | n8n runtime (core) | Relay (#7) |
|---|---|---|---|
| Relay credential | declares the credential type and how it is sent | stores it encrypted, injects it into requests | issues, hashes, authenticates, scopes, revokes |
| Admin API key / Adobe credentials | never seen | never seen | stores encrypted, uses, never returns |
| Subscription lifecycle | create/delete logic, state in static data | calls the hooks at publish/unpublish/test/restart | idempotent subscribe, delete, allowlist, SSRF defence |
| Event detection, dedupe ledger, retry, 410 handling | none | none | all |
| Redelivery duplicates | optional skip by event id | persists static data after live webhook runs | stable `id`, at-least-once |
| Page actions | forwards parameters, maps errors | runs the node per item | validates paths, calls Admin API |
| Webhook endpoint (inbound) | validation of the envelope | HTTP endpoint, UUID path, response mode | sender |

## 2. EW integration points

- **Type: none new.** The provider adds no `apps` sheet row, no `library` tab row, no SDK action and no UI in EW. (Owner convention: type comes from the config-sheet row; this provider has no row.) The only EW-side artefact it uses is the existing #7 "Connections" console, a fullscreen app registered by #7.
- **Config-sheet rows:** none. **Site config keys read:** none (#7 Decision 29); the extension README states this (AC4).
- **`ref=local` vs branch ref (AC5).** The console page loaded at `...?ref=local` (served from `localhost:3000`) talks to the *local* relay at `localhost:8787` (`wrangler dev`); a branch ref (`...?ref=<branch>`) talks to the *deployed* relay (#7 Build Analysis section 2: relay origin is a constant selected by host). A credential is valid only on the relay that issued it. The n8n credential's **Relay URL** therefore differs between the two checks: `http://localhost:8787` (or `host.docker.internal:8787` when n8n runs in Docker) for the `ref=local` check, the deployed `workers.dev` URL for the branch check. In both, the relay delivers to n8n over a public HTTPS URL whose host was registered with that relay. No node code differs between the two checks; this is what AC5 proves.
- **Reachable from host (EW):** unchanged: console at `https://da.live/apps#/{org}/{site}` once #7's `apps` row exists.

## 3. External APIs and auth flows

| API | Use | Auth | Source / status |
|---|---|---|---|
| Relay connector API v1 (`GET /v1/me`; `POST /v1/hooks {event, targetUrl, pathPrefix?}` → `201 {id}`; `DELETE /v1/hooks/{id}` → `204`; `POST /v1/pages {templatePath, path, collision?}` → `201 {path, urls}`; `POST /v1/pages/preview {path}` and `POST /v1/pages/publish {path, previewFirst?}` → `200 {path, urls, status}`); error shape `{error:{code,message,requestId}}` | everything the nodes do | `Authorization: Bearer <relay credential>`, scopes `events:read`, `pages:create`, `pages:preview`, `pages:publish`; requests carrying `Origin` are refused | [VERIFIED as specified] `apps/automation-connectors/SPEC.md` Build Analysis section 4; `shared/worker-template/SPEC.md` Decision 9. Not implemented yet; fixtures arrive with #7 |
| n8n trigger hook contract: `webhookMethods.default.{checkExists, create, delete}`, `webhook()`, `getNodeWebhookUrl('default')`, `getWorkflowStaticData('node')`, `webhooks: [{ name:'default', httpMethod:'POST', responseMode:'onReceived', path:'webhook' }]` | trigger lifecycle | n/a | [VERIFIED by source] https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Calendly/v2/CalendlyTriggerV2.node.ts ; hook order https://github.com/n8n-io/n8n/blob/master/packages/cli/src/webhooks/webhook.service.ts . The API is not in the creator docs; the source is the contract, so it can change between n8n versions (R7) |
| n8n webhook runtime: workflow data `undefined` → no run; static data saved after a live webhook run | filter and de-dupe design | n/a | [VERIFIED by source] https://github.com/n8n-io/n8n/blob/master/packages/cli/src/webhooks/webhook-helpers.ts ; https://github.com/n8n-io/n8n/blob/master/packages/cli/src/webhooks/live-webhooks.ts . Interpretation proven by N2 (NS5, NS8) |
| n8n credential file contract: `name`, `displayName`, `properties`, `authenticate` (generic header), `test` (request with `baseURL`, `url`) | credential type | n/a | [VERIFIED] https://docs.n8n.io/connect/create-nodes/build-your-node/reference/credentials-files.md |
| n8n errors: `NodeApiError`, `NodeOperationError` | error surface | n/a | [VERIFIED] https://docs.n8n.io/connect/create-nodes/build-your-node/reference/error-handling.md |
| n8n-node CLI: `new`, `build`, `dev`, `lint`, `release`; templates; node name format; `dev` runs n8n locally (container from n8n 3.0; `--external-n8n` otherwise) | scaffold, build, lint, local dev | n/a | [VERIFIED] https://docs.n8n.io/connect/create-nodes/build-your-node/using-the-n8n-node-tool.md ; https://docs.n8n.io/connect/create-nodes/test-your-node/run-your-node-locally.md |
| n8n package metadata: name `n8n-nodes-*`, keyword `n8n-community-node-package`, `n8n` attribute listing nodes and credentials, `n8nNodesApiVersion`, `strict`, peer `n8n-workflow` | package.json | n/a | [VERIFIED] https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md ; https://github.com/n8n-io/n8n-nodes-starter/blob/master/package.json |
| n8n installation routes: manual (`~/.n8n/nodes`, `npm i`, restart), GUI (npm package name, owner/admin only), env-managed, private Docker image (`N8N_CUSTOM_EXTENSIONS`, `NODE_PATH`) | AC2 install proof | n/a | [VERIFIED] manual-installation, gui-installation, environment-variable-installation, install-private-nodes pages under https://docs.n8n.io/ (links in Decision 20) |
| n8n verification guidelines; publish workflow with provenance (from May 1 2026 for verified nodes) | package shape now, publish later | npm trusted publishing or token | [VERIFIED] https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md ; https://github.com/n8n-io/n8n-nodes-starter/blob/master/.github/workflows/publish.yml |
| n8n webhook URLs: `N8N_WEBHOOK_URL` (alias `WEBHOOK_URL` deprecated from 2.35.0), `webhook` and `webhook-test` path segments, tunnel for local dev, optional SSRF protection variables | self-hosting docs, local live test | n/a | [VERIFIED] endpoints, install-with-npm, ssrf-protection pages under https://docs.n8n.io/deploy/host-n8n/... (links in Further Notes) |
| npm registry facts: `n8n` 2.47.7 `engines.node >=24.0.0`; `n8n-workflow` 2.16.0; `@n8n/node-cli` 0.56.4 (`peerDependencies.eslint >= 9`); `n8n-nodes-ew-automation` unclaimed | version pins and tooling floor | n/a | [VERIFIED by `npm view` 2026-11-16] |
| Wrangler `--var key:value` for `wrangler dev` | local allowlist override | n/a | [VERIFIED flag] https://developers.cloudflare.com/workers/wrangler/commands/workers/ ; list-value parsing [ASSUMPTION], S-N5 |
| Cloudflare quick tunnel without an account | optional local HTTPS exposure | n/a | [ASSUMPTION] n8n's own docs route through its cloudflared tunnel service; account need not verified |

**Auth flows.**
1. *Issue (outside this package):* admin opens the #7 console (any ref), chooses label `n8n` and scopes, copies the relay credential once.
2. *n8n credential:* user pastes it into n8n's credential form with the relay URL. n8n stores it encrypted. **Test** → `GET /v1/me` with the bearer from n8n's server → `200 {org, site, label, scopes, capabilities}`.
3. *Publish workflow (trigger):* n8n runs *check exists* (no) then *create* → `GET /v1/me`, then `POST /v1/hooks` per event with target = n8n's production webhook URL → relay validates (HTTPS, 443, allowlisted host, no credentials/IP) → `201 {id}`; ids and site go to static data.
4. *Event:* relay tick detects an event, outbox POSTs the envelope to the webhook URL, n8n's webhook endpoint calls the node's handler, n8n answers `200` immediately and runs the workflow.
5. *Unpublish / edit:* n8n runs *delete* → `DELETE /v1/hooks/{id}` per stored id.
6. *Actions:* `execute` per item → `POST /v1/pages...` with the bearer; relay uses the stored Admin API key server-side.
No flow places an Adobe credential, IMS token or Admin API key in n8n, in the package, or in any request the package makes.

## 4. Data contracts

Behaviour contracts; field names are the contract.

**n8n credential "EW Automation API"**

| Field | Type | Notes |
|---|---|---|
| Relay URL | string | default: production relay origin (constant decided in #7 Open Question 18; [OPEN] until then); no trailing slash required (normalised) |
| Relay Credential | string, masked (password type) | the value issued by the console; format has the recognisable prefix defined by #7 (`ewr_` appears in #7's hardening backlog as the secret-scanning prefix [ASSUMPTION that it is the issued prefix]) |
| authentication | `Authorization: Bearer <Relay Credential>` | n8n injects it; the node never builds the header itself |
| test | `GET {Relay URL}/v1/me` | success when `200` |

**Trigger node parameters**

| Parameter | Type / default | Notes |
|---|---|---|
| Events | multi-select, required, default Page Published | values `page.published`, `page.previewed`, `page.updated` |
| Options → Path Prefix | string, optional | sent as `pathPrefix` if set; relay validates; leading `/` required by relay |
| Options → Skip Duplicate Events | boolean, default true | Decision 10 |

**Trigger state (workflow static data, node scope).** `site` = `{org, site}` from `GET /v1/me`; `targetUrl` = webhook URL used at create; `hooks` = map event → relay subscription id; `seen` = most recent 200 event ids (ring). Nothing secret is stored.

**Trigger output (one item per accepted delivery).** The relay envelope unchanged: `id`, `type`, `occurredAt`, `detectedAt`, `org`, `site`, `ref`, `path`, `user`, `change`, `urls {preview, live, edit}`, `source` (#7 Build Analysis section 4).

**Relay calls per trigger lifecycle step**

| Step | Calls (in order) | Failure handling |
|---|---|---|
| check exists | none | always returns "does not exist" |
| create | `GET /v1/me`; (stale cleanup `DELETE`s); `POST /v1/hooks` ×N | any failure → delete what this call created, raise mapped error |
| delete | `DELETE /v1/hooks/{id}` ×N | `204`, `401`, `404` = done; others keep state and report not deleted |
| webhook | none | filter/validate, optional dedupe |

**Action node operations**

| Operation | Parameters | Relay call | Scope | Output |
|---|---|---|---|---|
| Create from Template | Template Path*, Page Path*, Collision (fail default / unique) | `POST /v1/pages {templatePath, path, collision?}` | `pages:create` | `{path, urls}` |
| Preview | Page Path* | `POST /v1/pages/preview {path}` | `pages:preview` | `{path, urls, status}` |
| Publish | Page Path*, Preview First (default true) | `POST /v1/pages/publish {path, previewFirst}` | `pages:publish` | `{path, urls, status}` |

**Relay error → n8n message** (`code` from `error.code`; unknown codes fall back to the HTTP status class). Every message appends the relay `requestId` and never contains the credential.

| Relay result | n8n message (summary) | Used by |
|---|---|---|
| `401 unauthorized` | credential invalid or revoked: issue a new one in the Connections console and update the n8n credential | all |
| `403 credential_scope` | credential lacks the scope needed for this operation (names the scope) | all |
| `403 forbidden_origin` | the relay refused the request because it carried an `Origin` header (unexpected for n8n; reports it) | all |
| `400 bad_target_url` | the relay refused this n8n webhook URL: it must be public HTTPS on port 443 without credentials and the n8n hostname must be registered with the relay | trigger |
| `409 subscription_limit` | the site has reached its subscription limit; remove unused subscriptions in the console | trigger |
| `400 bad_request` | the relay rejected an input (path rules: leading `/`, no `..`, max length) | actions, trigger (path prefix) |
| `404` (template or page not found; exact code is #7's) | template or page not found | actions |
| `409 conflict` | a page already exists at that path; choose another path or set Collision to create a unique name | create |
| `501 unsupported_for_site` | creating pages is not supported for this site (legacy Admin API) | create |
| `invalid_admin_key` / `admin_key_insufficient_role` | the site's Admin API key was rejected: a site admin must rotate it in the console | actions, trigger |
| `429 rate_limited` | the relay is rate limited; retry later (includes `Retry-After` when present) | all |
| `502 upstream_unavailable` | the relay could not reach the AEM Admin API; retry | actions |
| network failure / timeout | relay unreachable (names the relay host) | all |

**Operational constants:** inbound dedupe ring = 200 ids; request timeout per relay call = n8n's default HTTP helper timeout (not overridden) [ASSUMPTION; spike S-N2]; no node-level retries.

## 5. Folder layout (proposed; fits the #1 convention, the #2 template and #7)

```
apps/automation-connectors/providers/n8n/
├─ SPEC.md                                  this file
├─ README.md                                vendor setup (AC4); linked from apps/automation-connectors/README.md
├─ package.json  package-lock.json          own package: name, keyword, `n8n` attribute, peer n8n-workflow, scripts (build, lint, test, dev)
├─ tsconfig.json  eslint.config.mjs         generated by the n8n-node CLI; not edited (the linter docs say not to edit the ESLint config)
├─ LICENSE                                  MIT (Open Question 7)
├─ credentials/EwAutomationApi.credentials.ts
├─ nodes/
│  ├─ EwAutomationTrigger/EwAutomationTrigger.node.ts (+ .node.json codex)
│  ├─ EwAutomation/EwAutomation.node.ts (+ .node.json codex)
│  ├─ shared/                               relay client + URL normalisation, error mapper, event table, dedupe ring
│  └─ icon (SVG, node folders)
├─ test/
│  ├─ unit/                                 N1 tests (node:test, plain JS, run against dist/)
│  ├─ contract/                             static conformance (ND*), reads ../../../worker/contract/ by relative path
│  ├─ relay-conformance/                    RC* tests; import relay seams W1/R1 from ../../../worker/ and the #2 test kit
│  └─ smoke/                                N2: Dockerfile, harness, fake relay, workflow JSON, secret-leak scan
(no CI files live inside the folder; the CI jobs are in the repo workflow)
apps/automation-connectors/worker/ (wrangler config)   gains n8n entries in SUBSCRIBER_HOSTS (registration) and the dev override note
apps/automation-connectors/README.md                   gains a short "n8n" vendor section linking to the provider README
.github/workflows/ (existing CI)                       gains jobs `n8n-node`, `n8n-smoke`; relay-unit includes RC*
.eslintignore (root)                                   ignores providers/n8n/ (n8n-node lint owns it)
```

Rules: `.hlxignore` already hides `**/providers/` and `**/test/`, so nothing here is served from the code bus [per #7]. The package's `files` list is `dist` only. The folder is an npm package root, not a root-workspace member (own lock file, like `providers/zapier/`).

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Allowlist vs self-hosting.** The relay delivers only to registered exact hostnames on HTTPS:443. A self-hosting team's hostname is unknown to the relay operator, so each team needs the operator to register it (config + deploy). This reduces the value of the connector for the "self-hosting teams" the ticket targets, and shows why wildcard/per-site allowlists were deferred in #7. | High (product) | Decision 9: exact hostnames, documented honestly. Options for the owner (Open Question 1): keep as is, ask #7 to support wildcard or per-site (console-managed) allowlists (R-N1), or add a polling trigger mode (Open Question 2). |
| R2 | **Public reachability of a local n8n.** Local n8n is not reachable by the relay without an HTTPS tunnel or reverse proxy on :443; quick-tunnel hostnames change every run and must be re-registered. | Medium (dev/AC2 live proof) | README recipe; spike S-N5; stable hostname recommended; hermetic CI uses a fake relay. |
| R3 | **Stopped workflow answers `404`, relay removes only on `410`;** orphan subscriptions (relay unreachable at unpublish) keep failing until retries are exhausted. | Medium | Create cleans stale ids; console shows failures; R-N2 asks #7 to treat `404` from registered subscribers as gone or to auto-disable after N failures. Test RC3 documents the current behaviour. |
| R4 | **Tooling conflict with repo conventions:** TypeScript vs JS-only; ESLint 9 (CLI peer) vs ESLint 8 + helix; Node 24 vs Node 22; own lock file. | Medium | Isolated folder, own CI job (Node 24), root lint ignores the folder, tests in plain JS. Open Question 8. |
| R5 | **#7 is unbuilt:** no relay, fixtures or console exist; a changed relay contract breaks this package. | Medium | Blocked-by relationship; every relay assumption is a contract/conformance test (ND2, RC*); fixtures read from `worker/contract/` so drift fails CI. |
| R6 | **n8n hook API is internal.** The trigger lifecycle contract is read from source, not documented in the creator docs, and n8n is on a fast cadence (2.47.7; 3.0 is referenced in docs). | Medium | Pin n8n image in the smoke tier; follow-up run against the next major; N2 proves behaviour against the real engine. |
| R7 | **`N8N_WEBHOOK_URL` misconfigured** (n8n generates `localhost` or `http` URLs): the relay refuses the subscription. | Medium (support) | Mapped `bad_target_url` message lists the causes; README troubleshooting; NS test shows the exact error text. |
| R8 | **Verification and publishing constraints** (MIT licence vs open repo licence; GitHub-Actions provenance publish from a monorepo sub-folder; repository URL must match; trademark "Experience Workspace"/"Adobe"; "no logic or proxy nodes" rule might read this connector as a proxy to a relay). | Medium (only if publishing) | Out of scope; package built to verification rules (ND1, ND6, ND7); Open Questions 6, 7, 9. |
| R9 | **At-least-once delivery.** Ambiguous relay failures can resend; dedupe is by `id` within static data (200 ids, published workflows only). | Low-Med | Decision 10; documented claim; NS8. |
| R10 | **Static data on queue mode / multi-main** (not verified). | Low | Out of scope; README says single-instance tested. |
| R11 | **Webhook handler semantics** (`workflowData` undefined → no run; static data persistence) are read from current source. | Low-Med | N2 tests NS5, NS8 prove them on the pinned image; spike S-N1 first. |
| R12 | **Credential on the wire to the relay** if a user sets an `http://` relay URL (non-localhost). | Medium | README warns; the node does not enforce (Decision 9 rationale for no client-side checks) [OPEN: the owner may prefer a warning-only check for non-loopback `http://`]. |
| R13 | **Personal data** (acting user email) lands in n8n execution history. | Medium | Documented; #7 decides omission (its Open Question 13). |
| R14 | **n8n SSRF protection** (if enabled by the user) might block a private relay host. | Low | README allow-list note; [ASSUMPTION] applicability, S-N2. |
| R15 | **Event-type drift:** if #7 renames or adds event types, the node's option values go stale. | Low | ND4 compares option values to the contract's event enum. |
| R16 | **Docker in CI** for the smoke tier (availability, timing, image pull flakiness, rate limits). | Low-Med | Pin the image digest; keep smoke separate (`n8n-smoke`); advisory vs required follows Open Question 12. |

**Requirements recorded against #7 (inputs to its owner; nothing here changes #7 without that decision):**
- **R-N1** (optional, removes R1): allowlist entries accept an exact host or a single leading-wildcard label, strictly anchored; or a per-site allowlist managed in the console. Without it the n8n provider works with exact hosts only.
- **R-N2** (reduces R3): treat `404` from a registered subscriber host as "subscription gone", or auto-disable a subscription after N consecutive failed deliveries; define what happens to a revoked credential's subscriptions.
- **R-N3** (optional): a local-only flag that lets `wrangler dev` deliver to `http://localhost` subscribers so that the real relay can be tested against the real n8n in CI. It must be absent from the production config (#7 UR5 analogue). Not needed for this ticket's acceptance.

**Spikes (build-plan step 1; recorded in the README and as fixtures):**
- **S-N1** In the pinned n8n: confirm hook order and re-calls (publish, unpublish, edit while published, restart), test-mode URL and delete timing, `workflowData` undefined = no run, static data persisted after a live webhook run, and the exact `getNodeWebhookUrl` value behind a tunnel with `N8N_WEBHOOK_URL`.
- **S-N2** What the user sees for a relay error body `{error:{code,message,requestId}}`; request timeout default of the credentialed HTTP helper; the credential **Test** runs server-side and sends no `Origin`; whether SSRF protection affects credentialed relay requests.
- **S-N3** How to automate setup in a throwaway n8n container (owner creation, credential create, workflow import, publish/unpublish, run, read execution data) with the least-fragile interface, for the smoke tier.
- **S-N4** Scaffold with `npm create @n8n/node` inside the provider folder: `n8n-node lint` and `build` pass in the subfolder, root ESLint ignore, tarball install into `~/.n8n/nodes`, node appears.
- **S-N5** With the real relay (#7) and a tunnel: n8n-shaped webhook URL accepted for a registered host; delivery gets `200`; what status a stopped workflow's URL returns; `wrangler dev --var` list-value parsing for `SUBSCRIBER_HOSTS`.
- **S-N6** Whether a deliberately failing `delete` leaves a recoverable state across n8n restart (R3 check).

## 7. Ordered build plan (sized to #9's acceptance criteria)

0. **Prerequisites (owner):** #7 built enough to run: relay deployable and local, console issuing credentials, `worker/contract/` fixtures, a connected hlx6 test site (per #7 Open Question 1); Docker; a way to expose a local n8n over HTTPS (tunnel or domain); Open Questions 1, 2, 5, 8 answered.
1. **Spikes S-N1 to S-N6** against a throwaway n8n (not committed); record results and golden fixtures. Gate: if S-N1 or S-N5 contradict Decisions 6 to 10, revise before coding the trigger.
2. **Scaffold (AC2, AC3, AC7 groundwork):** CLI-generated package in the provider folder; package metadata; lint and build green with empty nodes; root lint ignore; `n8n-node` CI job on Node 24; no dependency other than the peer.
3. **Relay client, URL handling, error mapper**, test-first through N1 (ER1 to ER6). Credential type and its tests (CD1 to CD4).
4. **Trigger node, test-first through N1 (AC1 trigger):** lifecycle TR1 to TR10; inbound WH1 to WH7.
5. **Action node, test-first through N1 (AC1 actions):** AX1 to AX7.
6. **Static conformance (AC3, AC7):** ND1 to ND7 (metadata, verification rules, route and event conformance against the shared fixtures).
7. **Relay registration and conformance (AC3, AC6):** add the n8n host entries to the relay config (production placeholder list and the local override documented), add RC1 to RC5 to `relay-unit`.
8. **Real-runtime smoke (AC2):** image from the pinned n8n plus the packed tarball; harness automation from S-N3; NS1 to NS11.
9. **README and extension README vendor section (AC4):** credentials, scopes, host registration, local HTTPS exposure, install routes, example workflows, error table, security notes, "no site config keys", publication checklist; docs tests DOC1, DOC2.
10. **CI (AC7):** jobs `n8n-node` and `n8n-smoke`, RC* in `relay-unit`; S3 repo checks UR-N1 to UR-N4.
11. **Manual verification MN0 to MN9 (AC2, AC5, AC6):** live workflow end to end on a local n8n with `ref=local`, then with a branch ref and the deployed relay; record observed latency, host registration steps and the real stopped-workflow status in the README.
12. **Hand-off:** list the R-N1 to R-N3 outcomes for #7, the Make parallels for #8, and the publication checklist.

---

# Testing Requirements

## 1. Node unit tests (seam N1; Node built-in test runner against the compiled `dist/`)

**Fixtures/mocks.** `fakeThis` builders for the two node kinds: parameters by name and item index, credentials `{relayUrl, credential}` with a **canary** credential value (`canary-ewr-<random>`), `getNodeWebhookUrl`, a mutable workflow static data object, `getBodyData`/`getHeaderData`/`getResponseObject`, `getNode`, `continueOnFail`, `helpers.httpRequestWithAuthentication` backed by a **recording fake relay** (scripted responses per route: statuses, bodies in the `{error:{code,message,requestId}}` shape, thrown network errors and timeouts, idempotent `POST /v1/hooks` that returns the same id for the same (event, targetUrl)); real `n8n-workflow` error classes; a captured logger. Golden envelopes, `me` and error bodies come from the #7 contract fixtures (C1). Every test calls the node's public methods and asserts on what the fake relay received, what static data holds, outputs and thrown errors.

### 1.1 Trigger lifecycle (AC1, AC7)

| ID | Behaviour asserted |
|---|---|
| TR1 | create with events `[published, previewed]`: `GET /v1/me`, then exactly one `POST /v1/hooks` per event with the node's webhook URL as `targetUrl`, bearer header, `pathPrefix` only when set; static data holds the site, target URL and both ids; returns true |
| TR2 | create with Page Updated selected and `capabilities.updated = false`: raises a clear message and sends no `POST /v1/hooks` |
| TR3 | check exists always returns false, makes no request, and leaves static data untouched |
| TR4 | create run twice (publish, then restart): second run posts the same bodies again, the fake relay returns the same ids, static data ends with one id per event (no growth) |
| TR5 | create after the webhook URL changed: previously stored ids are deleted (best effort) before new ones are posted; a failing cleanup `DELETE` does not stop create |
| TR6 | create after the event selection shrank: ids of removed events are deleted and dropped from static data |
| TR7 | create where the second `POST` fails: the first created id is deleted again, static data is not left half-written, the error is raised |
| TR8 | create error mapping: `400 bad_target_url`, `401`, `403 credential_scope` (names `events:read`), `409 subscription_limit`, `429`, `502`, network error and timeout each raise the documented message with the request id; none contains the canary |
| TR9 | delete: one `DELETE` per stored id, static data cleared, returns true; `204` for unknown ids, `401` and `404` count as done; a `500` keeps the stored ids and returns false without throwing |
| TR10 | the node uses the webhook URL exactly as n8n supplies it for both a test-mode context and a production context (no rewriting) |
| TR11 | relay URL normalisation: trailing slash, extra path segments and whitespace produce the same request URL; an empty or non-string relay URL raises a configuration error before any request |
| TR12 | across TR1 to TR10 the canary appears in no thrown message, no static data, no log call, no request to a host other than the relay URL's host, and no request carries an `Origin` header |

### 1.2 Trigger inbound (AC1)

| ID | Behaviour asserted |
|---|---|
| WH1 | a valid published envelope for the stored site yields exactly one output item equal to the envelope (golden fixture), and a fast acknowledgement |
| WH2 | an envelope whose `type` is not among the selected events yields no output and an acknowledgement (no workflow run) |
| WH3 | non-object bodies, arrays, missing or non-string `id` or `type`, oversize garbage: rejected with `400`, no output |
| WH4 | an envelope whose `org`/`site` differs from the stored site is acknowledged without output |
| WH5 | with Skip Duplicate Events on, a repeated `id` yields output once; with it off, twice; the ring keeps only the most recent 200 ids (the 201st-oldest id is delivered again) |
| WH6 | the output item contains no fields beyond the envelope and keeps ISO 8601 date-times and nested `urls` untouched |
| WH7 | before create has run (no stored site), a valid envelope of a selected type is accepted (site check skipped) and still de-duplicated |

### 1.3 Action node (AC1)

| ID | Behaviour asserted |
|---|---|
| AX1 | Create from Template: one `POST /v1/pages` with `templatePath`, `path`, and `collision` only when "Create A Unique Name" is chosen; bearer header; output equals the relay `201` body |
| AX2 | Preview: one `POST /v1/pages/preview {path}`; output equals the `200` body including `status` |
| AX3 | Publish: one `POST /v1/pages/publish {path, previewFirst}` with the default true and with it switched off; output equals the body |
| AX4 | multiple input items produce one request per item, in order, and output items are linked to their inputs |
| AX5 | error mapping for each operation: `409 conflict`, `501 unsupported_for_site`, `403 credential_scope` (names the right scope for the operation), `404`, `400 bad_request`, `429` with `Retry-After`, `502`, `invalid_admin_key`, network error, timeout, unknown code: documented message plus request id; no canary |
| AX6 | "Continue on fail": a failing item yields an error item and processing continues; with it off the first error stops the run |
| AX7 | no retries inside the node (one request per item even on `502`); the canary and `Origin` properties of TR12 hold for every operation |

### 1.4 Error mapper and client (shared)

| ID | Behaviour asserted |
|---|---|
| ER1 | table-driven: every row of the Build Analysis error table maps to its message and keeps the request id |
| ER2 | unknown `code` falls back by HTTP status class (4xx generic input error, 5xx generic relay error) and still includes code and request id |
| ER3 | a response body that is not the relay error shape (HTML from a proxy, empty body) maps to a generic "unexpected response from the relay" message naming the status, never echoing the body |
| ER4 | messages are fixed English strings; the relay's own `message` text is never concatenated into node output (no input echo, parity with #2) |
| ER5 | `Retry-After` in seconds and HTTP-date form is surfaced for `429` |
| ER6 | request-building: base URL join, JSON bodies, no extra headers other than content type and the bearer injection by n8n |

### 1.5 Credential definition

| ID | Behaviour asserted |
|---|---|
| CD1 | the credential type has the two fields; the credential field is password-typed |
| CD2 | authentication is a generic header `Authorization: Bearer {credential}` and nothing else (no query or body use of the credential) |
| CD3 | the test request is `GET /v1/me` against the relay URL |
| CD4 | the relay URL default equals the constant from the #7 contract fixture (or the documented placeholder until it exists) |

## 2. Static conformance (no n8n runtime; run in the `n8n-node` CI job)

| ID | Behaviour asserted |
|---|---|
| ND1 | `package.json`: name matches `n8n-nodes-*`; keyword `n8n-community-node-package`; `n8n.nodes` and `n8n.credentials` list files that exist after build and whose class names equal file names; `n8nNodesApiVersion` and `strict` set; `files` is `dist`; licence MIT; `repository` present; `peerDependencies` only `n8n-workflow`; no `dependencies` |
| ND2 | route conformance: every relay route the nodes call exists in the #7 route table fixture with the same method, required body fields and the scope the node documents; no node calls a route outside the table |
| ND3 | scope documentation: parameter descriptions and the README scope table name exactly the scopes in ND2 |
| ND4 | the trigger's event option values are a subset of the contract's event-type enum and equal to the Zapier triggers' three events |
| ND5 | UX conformance (cheap string checks over the node descriptions): Title Case for node and parameter names, sentence case for descriptions and actions, English ASCII-only text, no node description mentions a second service |
| ND6 | verification rules over `dist/`: no `process.env`, no `fs`/`child_process`/`eval`/`Function` constructor, no network call other than through n8n helpers |
| ND7 | every `require`/`import` in `dist/` resolves to `n8n-workflow` or the package's own files (no runtime dependency, no node built-ins that touch the environment) |

## 3. Relay conformance for n8n-shaped subscribers (seams W1 and R1; Node 22 `relay-unit` job)

Fixtures: #7's fakes and test kit (fake IMS, fake Admin API, in-memory store, fake clock); a fake **n8n subscriber** at a host the test registers via `SUBSCRIBER_HOSTS`, answering like n8n: `200` with a small JSON body for an active workflow, `404` for a stopped one.

| ID | Behaviour asserted |
|---|---|
| RC1 | a subscription whose `targetUrl` is `https://{registered host}/webhook/{uuid}/webhook` is accepted; the same with `/webhook-test/{uuid}/webhook` is accepted; the same URL on an unregistered host, on port 5678, over `http`, with credentials or with an IP literal gives `400 bad_target_url` with no outbound request (provider-specific rows of SB4) |
| RC2 | an event for the subscription is delivered once to the n8n-shaped subscriber with `Content-Type: application/json`, the envelope body, no `Authorization` and no relay credential; a `200` marks it done and later ticks do not resend |
| RC3 | a subscriber answering `404` is retried on the documented schedule, then marked failed; the subscription is **retained** (current #7 behaviour; the test is flipped if R-N2 is accepted) |
| RC4 | a credential with only `events:read` can subscribe and delete; calling any page route gives `403 credential_scope`; a credential with only page scopes cannot subscribe |
| RC5 | the registration entries added for the provider are present in the relay's config for the local and production environments without removing the Zapier entry; the local override documented in the README is accepted by the config parser |

## 4. Real n8n smoke tier (seam N2; Docker; no n8n Cloud, no Adobe login, no real relay)

Setup: build the package, `npm pack`, build an image from the pinned n8n 2.x image with the tarball installed into n8n's custom-nodes folder (manual-install route), start it with `N8N_WEBHOOK_URL` pointing at the harness-visible URL, start the **fake relay** (contract-validating, plays the delivering relay), drive n8n through its HTTP interface as decided in S-N3, read execution data back.

| ID | Behaviour asserted |
|---|---|
| NS1 | the tarball installs into a real n8n, the instance starts, and both nodes and the credential type are listed by the instance (AC2 install proof) |
| NS2 | credential **Test** against the fake relay: `200 /v1/me` shows success; a fake `401` shows the plain credential message |
| NS3 | publishing a workflow with the trigger (events published + previewed): the fake relay saw `GET /v1/me` and one `POST /v1/hooks` per event with the real production webhook URL; the fake relay then delivers a published envelope to that URL: exactly one execution runs and its trigger item equals the envelope |
| NS4 | unpublishing the workflow: the fake relay receives one `DELETE` per subscription id; editing the event selection while published updates subscriptions (stale id deleted) |
| NS5 | delivering an envelope with an unselected `type` starts no execution and returns `2xx`; delivering a non-envelope body returns `400` and starts no execution |
| NS6 | restarting n8n with the workflow published: the fake relay sees the subscribe calls again, still resolves to one subscription per event, and a later delivery runs the workflow once |
| NS7 | an action workflow (Manual Trigger → Create from Template → Preview → Publish): the fake relay received the exact bodies with the bearer; outputs equal the fake responses; a fake `409` makes the node fail with the readable conflict message; with "Continue on fail" the workflow completes with an error item |
| NS8 | delivering the same envelope `id` twice: with Skip Duplicate Events on, one execution; with it off, two |
| NS9 | the listen-for-test-event flow, if automatable (S-N3): the subscribe call carries the test webhook URL and the unsubscribe happens after the test window or cancel; otherwise verified manually in MN2 |
| NS10 | secret-leak scan: the canary credential appears in no execution data, no workflow JSON export, no n8n log line captured from the container, and no request the fake relay received other than as the bearer header |
| NS11 | every request the fake relay received from n8n carries no `Origin` header and uses only the contract routes |

## 5. Repo and documentation checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR-N1 | the provider folder has `package.json`, a lock file, README, SPEC, unit/contract/relay-conformance/smoke test folders and source folders named as in the layout; no tracked `.env*`, `.dev.vars*` or secret-looking file inside the folder |
| UR-N2 | the root ESLint run ignores the provider folder and the provider's own `lint` script is green; the root `.hlxignore` still hides `**/providers/` and `**/test/` |
| UR-N3 | CI defines the jobs `n8n-node` (Node 24) and `n8n-smoke`; `relay-unit` includes `relay-conformance` |
| UR-N4 | the package contains no Adobe credential, IMS token or Admin API key patterns (secret-scan over the folder and the fixtures) |
| DOC1 | the provider README and the extension README vendor section contain the required headings: credentials, scopes, relay URL, subscriber-host registration, local HTTPS exposure, install routes, example workflows, errors, security notes, "site config keys: none" |
| DOC2 | the README scope table and error table are generated from (or compared with) the same constants the tests use, so docs and code cannot drift |

## 6. End-to-end checks inside real Experience Workspace (manual; needs Adobe login, Cloudflare, Docker, a public HTTPS hostname)

**Accounts and credentials needed:** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); an Adobe IMS identity with a DA org and a test site on the new Admin API (hlx6), with the ability to create an Admin API key (#7 prerequisites); the #7 relay deployed on Cloudflare (Workers Paid per #7 Decision 27) and its console registered in the `apps` sheet; Docker for a throwaway self-hosted n8n (current 2.x) with an owner account created locally; a public HTTPS hostname on :443 for that n8n (tunnel quick-URL for the check, or a reverse proxy) that the relay operator registers in `SUBSCRIBER_HOSTS`; Chrome. No n8n Cloud, npm, Zapier or Slack account is needed. Never paste a relay credential, IMS token or Admin API key into chat, issue comments or logs.

- **MN0 (prereq):** relay and console from #7 are running; `curl -i <relay>/v1/me` returns `401`; `docker run` the pinned n8n image with the package installed (tarball route) and `N8N_WEBHOOK_URL` set to the public HTTPS base; open n8n, create the owner; the two nodes appear in the node panel (AC2).
- **MN1 (`ref=local`, AC5, AC2):** terminal A `npm start` (port 3000); terminal B `wrangler dev` (port 8787) with `SUBSCRIBER_HOSTS` extended by the n8n host via `--var`; open `https://da.live/app/{org}/{site}/apps/automation-connectors/automation-connectors?ref=local`, accept the trust prompt, connect the site (per #7 M2), issue a credential labelled `n8n` with scopes `events:read` plus the page scopes. In n8n create the credential with Relay URL `http://localhost:8787` (use `host.docker.internal:8787` when n8n runs in Docker), name it `org/site`, press **Test** (expect success showing the site). Build the workflow "EW Automation Trigger (Page Published) → Edit Fields (map `path`, `urls.live`, `user`)", publish it, then preview and publish a page in EW. Expect the console subscription list to show one n8n subscription, and an n8n execution within about two minutes carrying the envelope. Proves AC1 (trigger), AC2 (live workflow), AC5 (local ref), AC6 (no Adobe credential in n8n).
- **MN2 (listen for test event):** in the editor press "Listen for test event", publish a page, observe the execution in the editor, then confirm the console shows the test subscription removed after the window (S-N1 result recorded). Covers NS9 if not automated.
- **MN3 (branch ref, AC5):** push branch `n8n-provider`; open the same console URL with `?ref=n8n-provider`, which talks to the deployed relay; issue a new credential; create a second n8n credential with the deployed relay URL; repeat MN1's workflow and publish a page. Record the observed host and scopes in the README. Proves AC5 (branch ref).
- **MN4 (actions, AC1):** workflow "Manual Trigger → EW Automation (Create from Template) → (Preview) → (Publish)" with a template path and a new page path; run; open the page in EW and on the live URL; run again and see the readable conflict error; run with a trigger-only credential and see the scope error naming `pages:create`.
- **MN5 (revocation, AC6):** revoke the credential in the console; the n8n credential **Test** fails with the plain credential message; an action run fails with it; a published trigger workflow no longer receives events (and, per R3, record what happens to the subscription listing).
- **MN6 (unpublish and edit):** unpublish the workflow: the console subscription disappears; edit events while published: the subscription list follows.
- **MN7 (restart):** restart the n8n container with the workflow published: one subscription per event remains, the next page publish runs the workflow once (no duplicates).
- **MN8 (secrets and rejection, AC6):** search the n8n execution data, a workflow export and the n8n container log for the credential (none); in the browser DevTools of the console confirm the credential only appeared at issue time; `curl` the relay without a bearer (`401`), with a bearer plus an `Origin` header (`403 forbidden_origin`), and with a revoked bearer (`401`).
- **MN9 (cadence):** publish a page five times; record action-to-execution latency and confirm one execution per event; compare with #7's documented interval.
- **MN10 (install routes):** repeat MN0's install via the private-node Docker image recipe and via `~/.n8n/nodes` manual install; confirm identical behaviour (AC2).

## 7. CI additions (no credentials; Cloudflare, Adobe and n8n Cloud not needed)

| Job | Steps | Notes |
|---|---|---|
| `n8n-node` | checkout, Node 24, `npm ci` in `providers/n8n/`, `npm run lint` (n8n-node), `npm run build`, unit and contract tests (TR, WH, AX, ER, CD, ND), UR-N and DOC checks | the only job on Node 24; every push and PR |
| `n8n-smoke` | same setup plus Docker; build the tarball, run the N2 harness (NS1 to NS11) with the image pinned by digest | advisory vs required follows Open Question 12 |
| `relay-unit` (existing, #7) | gains `providers/n8n/test/relay-conformance` (RC1 to RC5) | Node >= 22.12 |
| `lint` (existing) | root ESLint 8/Stylelint ignore the provider folder; UR-N2 | keeps repo conventions intact |

## 8. Acceptance-criteria traceability (ticket #9)

| # | Acceptance criterion (#9) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | n8n trigger node (published, previewed, updated) subscribes through the relay; action node creates, previews and publishes pages | TR1 to TR12 (subscribe/unsubscribe through `/v1/me` and `/v1/hooks`, cleanup, errors), WH1 to WH7 (event handling, filter, dedupe), AX1 to AX7 (create, preview, publish), ER1 to ER6, ND2 and ND4 (routes and events match the relay contract and the Zapier set), RC1 to RC2 (relay accepts and delivers to n8n-shaped subscribers), NS3 to NS8 (real n8n lifecycle and actions) | **MN1** (published, live), **MN2** (test event), **MN3**, **MN4** (actions live), **MN6**, **MN7**; previewed and updated events: repeat MN1 with the events switched, recorded in the PR |
| AC2 | Package builds and installs into a local n8n instance; a live workflow works end to end | build in the `n8n-node` job; NS1 (tarball installs and nodes appear), NS2 to NS6 (credential test, lifecycle, delivery, restart), NS7 | **MN0**, **MN1** (live workflow on a local n8n), **MN10** (both install routes) |
| AC3 | Added inside the existing `automation-connectors` extension folder as a new provider; no changes needed in the extension shell beyond registering the provider | UR-N1 (folder placement), UR-N2 (root lint/`.hlxignore` untouched), UR-N3, ND2 (no route outside the contract), RC5 (registration is only config entries, Zapier entry intact) | Review: the PR diff outside `providers/n8n/` is limited to the relay `SUBSCRIBER_HOSTS` entries, the extension README vendor section, the CI workflow and the root lint ignore (Decision 24); no relay or console source file changes |
| AC4 | Extension README documents this vendor's setup (credentials, site config keys) | DOC1 (required headings incl. "site config keys: none"), DOC2 (scope and error tables match code) | Walk the README once on a clean n8n container from install to a working credential (**MN0**, **MN1**); review that the host-registration and HTTPS-exposure sections are accurate |
| AC5 | Works in EW with `ref=local` and with a branch ref | NS11 and RC1/RC2 (the relay-facing behaviour is identical regardless of ref; only the relay URL differs); CD3/CD4 (credential test) | **MN1** (`ref=local`, local relay, local n8n), **MN3** (branch ref, deployed relay) |
| AC6 | Vendor credentials live only in this extension's worker (built from the shared worker template); the browser never receives them; unauthenticated calls to the worker are rejected | TR12, AX7 (canary credential never leaks; no `Origin` sent), NS10 (no credential in execution data, exports, logs), NS11, UR-N4 (no secrets in the package), RC4 (scope enforcement), #7's CR2/CR5/CR8 for the rejection matrix (reused, not duplicated) | **MN8** (live rejection: no bearer `401`, `Origin` `403`, revoked `401`; credential search), **MN5** (revocation), MN0 (`curl` without bearer `401`). Reading of "vendor credentials": the Adobe Admin API key never leaves the relay; the n8n credential holds only the relay credential (Decision 12, Open Question 5) |
| AC7 | Core logic covered by unit tests; lint and CI green | all N1 tests (TR, WH, AX, ER, CD), ND1 to ND7, RC1 to RC5; CI jobs `n8n-node`, `n8n-smoke`, `relay-unit`, `lint` | Review: CI green on a PR; deliberately weaken a rule on a scratch branch (select-all-events filter, drop the stale-subscription cleanup, mask nothing in an error) and see WH2, TR5 and TR12 fail |

Every acceptance criterion on #9 maps to at least one automated test or a numbered manual verification step above.

## 9. Open questions for the owner

1. **Allowlist vs self-hosting (R1).** The relay delivers only to registered exact hostnames on HTTPS:443, so each self-hosting team's n8n host must be registered by whoever runs the relay. Accept that for this ticket, or ask #7 for wildcard entries or a per-site allowlist managed in the console (R-N1)? Who is the relay operator for teams other than yours (#7 Open Question 14)?
2. **Polling mode.** Should the trigger also offer a polling mode (reads `GET /v1/events` on n8n's schedule), which needs no public URL and no allowlist and would make a laptop n8n trivial, at the cost of latency and a second code path? This spec recommends it as a follow-up; #9's AC says "subscribes through the relay", which the webhook mode satisfies literally.
3. **Event set.** Ship exactly Page Published, Page Previewed, Page Updated (parity with Zapier), or also Page Unpublished (#7 Open Question 11)?
4. **Failing and revoked subscriptions (R3, R-N2).** Should #7 treat `404` from a registered subscriber as "gone" or auto-disable after N failures, and what should happen to a revoked credential's subscriptions?
5. **Meaning of AC6 for n8n.** Confirm that "vendor credentials live only in this extension's worker" means the Adobe Admin API key, and that n8n holding the per-site relay credential (encrypted in n8n) is acceptable, as it is for Zapier.
6. **Naming and ownership.** Working package name `n8n-nodes-ew-automation` and node names "EW Automation Trigger"/"EW Automation" (unclaimed on npm today). Final names, npm scope or account, and whether a public npm publication and n8n verification are wanted at all (they need ownership, trademark clearance for "Experience Workspace" and "Adobe", and the n8n "one service per package" and "not a proxy to other services" rules).
7. **Licence.** n8n verification requires MIT; the repo licence is undecided (#1). Is MIT for this package folder acceptable, and who is the licensor?
8. **Tooling exception (R4).** Accept TypeScript, ESLint 9 (CLI-provided), Node 24 and a separate lock file inside `providers/n8n/` only, with plain-JS tests, or require a different arrangement (for example authoring in JS)?
9. **Publishing from a monorepo.** If publishing later, is a publish workflow for a sub-folder package (tag convention, npm trusted publisher, `repository.directory`) acceptable, or should the package live in its own repository for n8n's repository-URL checks?
10. **Relay URL default.** What is the production relay origin to ship as the credential default (#7 Open Question 18), and should the credential offer a dropdown (production / custom)?
11. **Duplicate skipping default.** Keep "Skip Duplicate Events" on by default (this spec), or off to avoid hidden state?
12. **CI gating.** Is Docker-based `n8n-smoke` required or advisory (flaky-image risk, R16)? Which n8n version should the matrix pin, and from which minimum version do we promise support?
13. **AI tool use.** The action node is not usable as an AI-agent tool in v1 (publishing). Do you want it enabled, perhaps only for Preview?
14. **Signed deliveries.** Payload signing is in #7's hardening backlog. Does n8n's use change its priority (a signature check is the standard defence for webhook triggers)?
15. **Declarative vs programmatic for actions.** Accept the programmatic action node (Decision 3) given fixed generic relay messages, or insist on n8n's declarative default if S-N2 shows its error surface is adequate?
16. **Preview-first scope.** When "Preview First" is on, does `pages:publish` suffice, or must the credential also carry `pages:preview` (a #7 detail the node documents)?
17. **Test infrastructure.** Who supplies the public HTTPS hostname for the live check (stable named tunnel, domain behind a reverse proxy, or per-run quick tunnel)? Do you want R-N3 (a local-only insecure-subscriber flag in the relay) so the real relay can be tested against the real n8n in CI?
18. **Personal data.** The acting user's email flows into n8n's execution history (#7 Open Question 13). Omit by default or document only?
