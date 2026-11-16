# Spec: Automation Connectors: Make (Integromat) app

Ticket: jazhou-adobe/ew-extensions#8 (this spec: #46). Blocked by #7 (EW event relay + Zapier app; spec in `apps/automation-connectors/SPEC.md`), which in turn is blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). Sibling vendor follow-up: #9 (n8n community node).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as #1, #2 and #7): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Make/Cloudflare.

Vocabulary follows #1, #2 and #7: *extension* = one folder `apps/<name>/`; *worker* / *relay* = the per-extension backend in `apps/automation-connectors/worker/`; *connector* = a third-party automation product (Zapier in #7, Make here, n8n in #9); *relay credential* = the per-site secret the relay issues for a connector; *event envelope*, *hook / subscription*, *site connection* as defined in #7. New terms used here:

- **Make app** = the Make *custom app* (Make's term for an integration definition made of a base, a connection, webhooks, modules, RPCs and functions) that this ticket delivers, uploaded to Make as a *private* app.
- **Module** = one block in a Make scenario: *instant trigger* (Make's webhook-driven trigger) or *action*.
- **Webhook (Make)** = a Make-side component that receives data on a Make-generated URL; the *dedicated, attached* kind registers that URL with an external service by calling an *attach* procedure and removes it with *detach* [VERIFIED: https://developers.make.com/custom-apps-documentation/app-components/webhooks/dedicated/attached.md].
- **Make zone** = a Make region (`eu1`, `eu2`, `us1`, `us2`, plus Celonis-branded zones) with its own API host and its own webhook ingress host [VERIFIED zones: https://help.make.com/allow-connections-to-and-from-make-ip-addresses].
- **Dev app** = a second private copy of the Make app whose relay base URL points at a tunnelled local relay, used only for `ref=local` verification (Implementation Decision 22).

Primary sources read (all 2026-11-16): Make Custom Apps documentation https://developers.make.com/custom-apps-documentation (index: https://developers.make.com/llms.txt) and the pages cited inline; Make Help Center https://help.make.com/webhooks, https://help.make.com/allow-connections-to-and-from-make-ip-addresses, Webhooks app https://apps.make.com/gateway.md; Make API reference (SDK Apps) https://developers.make.com/api-documentation/api-reference/sdk-apps.md and `/sdk-apps/webhooks.md`, rate limiting https://developers.make.com/api-documentation/getting-started/rate-limiting.md; Make's official custom-app skill and editor JSON schemas https://github.com/integromat/make-apps-skill (`skills/make-custom-apps/references/*.md`, `editor-schemas/`); npm registry (`@makehq/sdk`, `@makehq/cli`, `@integromat/make-cli`); this repo's #1, #2 and #7 specs.

---

## Problem Statement

A team that runs its site in Experience Workspace (EW) and automates its stack in **Make** (formerly Integromat) cannot react to EW content changes. Ticket #7 builds a vendor-neutral relay that detects page previewed, published, unpublished and updated events by polling the AEM Admin API and fans them out to subscribers, and it ships a Zapier app on top. A Make user gets nothing from that: Make has no EW module, so they would have to wire a custom webhook by hand (and could not subscribe it to the relay, because subscribing needs an authenticated call that a bare Make webhook cannot make), and could only call the Admin API directly with a raw HTTP module and an Admin API key sitting inside a Make scenario.

The ticket asks for the same triggers and actions the Zapier app offers, as a Make custom app, **without changing the relay or the console**: "added inside the existing `automation-connectors` extension folder as a new provider; no changes needed in the extension shell beyond registering the provider".

Three facts shape the work:

1. **Make is not a hosted JavaScript runtime.** A Make custom app is a set of declarative JSON-with-expressions documents (Make's IML) uploaded to Make's platform; the connector logic runs inside Make, not in this repo. [VERIFIED: https://developers.make.com/custom-apps-documentation/app-components/connections/basic-connection.md, `.../webhooks/dedicated/attached.md` show the document shapes.] Unit tests in the usual sense cannot execute it: I found no public IML evaluator (npm probe of `@integromat/*`, `imt-*`, `@makehq/*` names found only management SDKs, the deprecated VS Code CLI and an unrelated scenario simulator [VERIFIED by `npm search`/`npm view` 2026-11-16; not an exhaustive search]). So "core logic covered by unit tests" needs a deliberate test design (Testing Decisions).
2. **Make's instant triggers are exactly the relay's REST-hook model.** A *dedicated attached webhook* creates a unique HTTPS URL per webhook, calls an `attach` request with that URL when the user adds the webhook, and a `detach` request when it is removed [VERIFIED: link above]. That maps one to one onto the relay's `POST /v1/hooks` and `DELETE /v1/hooks/{id}`. Nothing new is needed on the relay except permission for Make's webhook hosts to be delivery targets.
3. **Make's delivery host, publication rules and the way they interact with the relay are only partly documented.** The exact webhook hostnames per zone, when Make calls `detach`, what Make returns for an inactive scenario, and whether Make's server calls carry an `Origin` header are not in the docs I could read. These are spikes, not assumptions the build can skip.

## Solution

Ship a **Make custom app** inside `apps/automation-connectors/providers/make/`, uploaded as a *private* app to a test Make organisation, plus the minimal relay registration and documentation. It consists of:

- **One connection** (API-key style): a single secret field for the relay credential issued in the EW Connections console. Make validates it by calling the relay's "who am I" route and labels the connection `org/site`, the same label Zapier shows.
- **Three instant triggers**: *Watch Page Published*, *Watch Page Previewed*, *Watch Page Updated*. Each is backed by its own attached webhook; adding the webhook in the Make UI subscribes the Make-generated URL to the relay for that event (optionally filtered by a path prefix); removing it unsubscribes. The trigger output is the relay's event envelope.
- **Three action modules**: *Create Page from Template*, *Preview Page*, *Publish Page*, mapped one to one to the relay's connector routes.
- **A deploy script** (management tooling, not app runtime) that validates the definitions and uploads them to Make with Make's official TypeScript SDK; dry-run by default.
- **Relay registration**: Make's webhook hosts added to the relay's subscriber-host allowlist, and nothing else in the shell.
- **README** for the Make provider (credentials, scopes, zones, setup, dedupe recipe, errors, security, Make public-review checklist) linked from the extension README; the app reads no EW site config.

What a user sees: in EW, open the Connections console, issue a credential for the site (scopes as needed), then in Make create a connection by pasting it, build a scenario "Watch Page Published → anything", activate it, publish a page in EW, and the scenario runs within about two minutes (the relay's documented polling latency, #7 Decision 4). Actions run with that site's permissions only.

## User Stories

Make user (scenario builder):

1. As a Make user, I want a Make module that starts my scenario when a page is published in EW, so that I can announce it, sync it, or kick off downstream work without writing code.
2. As a Make user, I want a module that starts my scenario when a page is previewed, so that reviewers or QA bots are notified when a page is ready.
3. As a Make user, I want a module that starts my scenario when a page's content changes, so that translation, search indexing or audits stay in sync.
4. As a Make user, I want a module that creates a page from a template path, so that a form submission, CRM record or spreadsheet row can open a new page ready for authors.
5. As a Make user, I want a module that previews a page, so that automation can refresh a preview after upstream data changes.
6. As a Make user, I want a module that publishes a page, so that an approval elsewhere can publish content.
7. As a Make user, I want the triggers to be marked INSTANT and to run as soon as the relay delivers, so that I am not waiting for a polling schedule in Make.
8. As a Make user, I want sample output on each trigger, so that I can map fields in later modules before any real event has happened.
9. As a Make user, I want each trigger bundle to include the page path, the preview, live and edit URLs, the acting user, the event type and the time, so that my next module has useful data without extra calls.
10. As a Make user, I want an optional path prefix on a trigger (for example `/blog/`), so that only the section I care about starts the scenario.
11. As a Make user, I want deleting the webhook or scenario to stop deliveries, so that I am not billed operations for scenarios I have removed.
12. As a Make user, I want to know that an event can arrive more than once, and a documented way to ignore the repeat (a stable event id plus a Data store check), so that a retry never posts to Slack twice.
13. As a Make user, I want plain-language errors from the action modules (page already exists, template not found, publish not permitted, credential lacks a scope), so that I can fix my scenario without reading logs.
14. As a Make user, I want one connection per EW site with the label `org/site`, so that I can tell connections apart in the connection picker.
15. As a Make user with several EW sites, I want to create one Make connection per site, so that each scenario only touches the site I chose.
16. As a Make user, I want the Create Page module to fail by default when the target path exists and to offer a "create unique name" choice, so that I never overwrite content by accident.
17. As a Make user, I want the Publish Page module to preview first by default and to let me switch that off, so that I can publish a freshly changed page in one step or publish only what is already previewed.
18. As a Make user, I want the modules to follow Make's normal error handling (retry on rate-limit, error handlers, incomplete executions), so that EW modules behave like any other Make app.
19. As a Make user, I want to use any Make tool (Slack, Data store, Google Sheets, HTTP) after a trigger, so that EW events reach the thousands of apps Make supports.

Site admin (EW and Make):

20. As a site admin, I want to issue a relay credential in the EW Connections console and paste it into Make once, so that Make can use my site without me running any infrastructure.
21. As a site admin, I want the README to say which scopes each Make module needs and which preset to select, so that a leaked read-only credential cannot publish and I do not hit scope errors by guessing.
22. As a site admin, I want to see Make's subscriptions (with the delivery outcomes) in the console and to revoke the credential, so that I can cut off a Make connection immediately.
23. As a site admin, I want a connection test in Make that fails with a clear message when the credential is wrong or revoked, so that I find out when I create the connection and not when a scenario fails.
24. As a site admin, I want to know which Make zones are supported and which hosts the relay delivers to, so that I can place my Make organisation in a supported zone and my network team can review the traffic.
25. As a site admin, I want the Make webhook URLs the relay stores to be treated as secrets (hidden in the console and logs), so that nobody can inject fake events into my scenarios by copying a URL from a screenshot.
26. As a site admin, I want the README to state what flows to Make (page paths, user emails when the log has them) and that Make keeps webhook and execution logs, so that I can make an informed data-protection decision.
27. As a site admin of a legacy-API site, I want the README and the module errors to say that Page Updated and Create Page need the new Admin API, so that I understand the gap (#7 R2) rather than assume a Make bug.

Maintainer / operator:

28. As the maintainer, I want the Make app to be a new provider that touches nothing in the console or relay logic except a host-allowlist entry, so that the shell stays vendor-neutral and #9 (n8n) can do the same. (#8 AC4)
29. As the maintainer, I want the Make app definitions committed as readable files and uploaded by a repeatable script, so that the app in Make is reproducible and reviewable and not hand-edited in a web editor.
30. As the maintainer, I want the upload to be a dry run by default, to read back every uploaded section, and never to publish or request review, so that a mistake cannot become a permanent public app.
31. As the maintainer, I want the definitions checked against Make's editor schemas in CI, so that invalid keys (which Make silently ignores) are caught before upload.
32. As the maintainer, I want the app's requests and mappings tested against the real relay worker with fake Admin API and fake Make ingress, so that contract drift between the relay and the Make app fails CI.
33. As the maintainer, I want every relay route the Make app uses to be rejected without a credential, derived from the definitions, so that a new module cannot dodge the "unauthenticated calls are rejected" rule. (#8 AC7)
34. As the maintainer, I want no Make-issued secret to live in the worker and the Make API key never to appear in the repo or CI, so that the secrets boundary stays "vendor credentials only in the worker, deploy keys only on the maintainer machine".
35. As the maintainer, I want the Make hook-host allowlist to be exact hostnames with look-alike tests, so that the relay cannot be turned into a request-forgery tool toward other Make hosts (for example the Make API host).
36. As the maintainer, I want Make's response codes (200 Accepted, 400 queue full, 429, 410 gone) mapped onto the relay's delivery policy and tested, so that a stopped or full scenario neither floods Make nor blocks other subscribers.
37. As the maintainer, I want the Make public-app review requirements captured as a checklist with the blockers named (own domain, trademarks, universal module, test scenarios), so that going public is a known list. (Not an #8 AC; see Out of Scope.)
38. As the maintainer, I want manual verification steps for `ref=local` and for a branch ref that go all the way through Make, so that "works in EW" is proven in both modes. (#8 AC6)
39. As the maintainer, I want CI to need no Make account, no Cloudflare login and no EW session, so that regressions are caught automatically and the live checks are a documented manual script. (#8 AC8)

EW end user:

40. As a content author, I want publishing and previewing in EW to behave exactly as before, so that the Make connector never changes how I work.
41. As a content author, I want a page published by a Make scenario to be indistinguishable from one published by hand (same Admin API operation), so that audit and downstream tooling see normal events.

## Implementation Decisions

(No file paths or code snippets; layout and shapes are in the Build Analysis. The relay contract from #7 is treated as frozen and is restated as the "provider interface" in decision 1.)

**Provider interface (what #8 consumes from #7)**

1. **The provider interface is six existing contract points, no new relay API.** #7 defines no provider registry: its Decision 25 says Make and n8n "use the same endpoints, with their own entries in the subscriber-host allowlist", and its Out of Scope reserves only "the relay seams they need (vendor-neutral events, REST-hook API, per-connector host allowlist)". So "registering the provider" means exactly: (P1) the connector API v1 and its scopes (`GET /v1/me`, `POST/DELETE /v1/hooks`, `GET /v1/events`, `POST /v1/pages`, `/v1/pages/preview`, `/v1/pages/publish`), (P2) the event envelope, (P3) the per-site bearer relay credential with scopes `events:read`, `pages:create`, `pages:preview`, `pages:publish`, (P4) the subscriber-host allowlist entry (the relay's `SUBSCRIBER_HOSTS` setting), (P5) the delivery semantics (HTTPS POST of the envelope; 2xx acknowledges; `410` ends the subscription; retries at about 0/1/5/30/120 minutes; per-subscription per-tick cap 100; stable event `id`; at-least-once on ambiguity), and (P6) the golden contract fixtures kept with the relay. If #7's build introduces an explicit registry module, Make registers there instead; this spec does not redesign it. [ASSUMPTION: #7 is implemented as written; it is unbuilt today and its spec is the contract.]
2. **Three small additions are requested of #7, none a redesign** (recorded as R-M1..R-M3 in the Build Analysis): mask the secret path token of subscriber URLs in the admin subscription list and in logs (a Make webhook URL's path is an unguessable capability, see decision 8); a machine-readable route and scope table next to the golden fixtures so this ticket's tests derive the route list instead of copying it; and treating an empty string for the optional hook and page fields as absent (defensive; the Make app also omits them).
3. **Registration is a configuration change, not code.** The Make hook hosts are added to the relay's subscriber-host setting in the relay's wrangler config, documented in the extension README and in the Make provider README, and covered by tests. Hosts are **exact hostnames, no wildcards**, so #7's look-alike matrix (suffix, punycode, trailing dot) applies unchanged. The list is one webhook-ingress host per supported Make zone. [VERIFIED forms seen: `hook.make.com` in Make's own docs https://apps.make.com/gateway.md, `hook.us1.make.com` and `hook.eu1.make.com` in Make community posts https://community.make.com/t/is-it-possible-to-white-label-the-webhook-url/4901 and https://community.make.com/t/change-domain-of-webhook-urls/4615 (not primary sources). The complete per-zone list (`hook.eu2`, `hook.us2`, Celonis zones) is [ASSUMPTION] until spike S-M1 captures a real URL in each reachable zone.] Make API hosts (`eu1.make.com` etc.) are never in the list.
4. **The provider adds no secret to the worker.** The relay never calls Make's API; it only POSTs envelopes to webhook URLs it was given. The only credential the Make provider introduces into the system is the per-site relay credential, which already exists in #7 and is held by the user's Make connection. So #8 AC7 holds by construction: no new `secrets.required`, no new `.dev.vars` key, no new outbound credential. The Make API key used by the deploy script is a maintainer-machine credential; it never enters the repo, CI, the worker or the browser.

**Make app design**

5. **One private Make custom app, versioned from the repo.** Definitions are plain files in the provider folder; the deploy script is the only writer to Make (no hand edits in the web editor, except in the dev app during spikes). The app is created as private; it is installed into a test organisation when the first scenario using it is saved [VERIFIED: https://developers.make.com/custom-apps-documentation/create-your-first-app/app-visibility.md]. Publication, invite-link sharing and review are **not** performed by this ticket: Make states that publishing is irreversible and components can no longer be deleted afterwards [VERIFIED: same page], which is a decision for the owner (Open Question 2).
6. **Connection: Make "basic" connection type, one `password`-typed field for the relay credential.** Authentication is a bearer header built from the stored value in the app's base, so every module inherits it; the relay origin is a constant in the definition, not a user-supplied field, so a crafted scenario cannot redirect the credential to another host (same rule as #2 Decision 13; Make's own guidance says to validate configurable hosts before attaching credentials [VERIFIED: https://github.com/integromat/make-apps-skill/blob/main/skills/make-custom-apps/references/base-and-connections.md]). Connection communication does not inherit the base, so the validation request carries its own full URL, header and sanitization [VERIFIED: same reference]. Validation calls the relay's "who am I" route; success stores `org/site` as the connection metadata (label) [VERIFIED mechanism: https://developers.make.com/custom-apps-documentation/app-components/connections/basic-connection.md, `response.metadata`]. Logs sanitize the authorization header in both base and connection (Make shows no request logs at all for unsanitized secrets and requires sanitization for review [VERIFIED: https://developers.make.com/custom-apps-documentation/app-components/base/sanitization.md, https://developers.make.com/custom-apps-documentation/app-review/prerequisites.md]). One connection equals one credential equals one site; there is no site field anywhere in the Make app because the relay resolves org and site from the credential (#7 Decision 12).
7. **Three triggers, three webhooks.** Make links each instant trigger to exactly one webhook definition, and the event type is fixed per trigger, so each of *Page Published*, *Page Previewed* and *Page Updated* gets its own attached dedicated webhook whose attach request hard-codes the event name, and all three share an optional text parameter "path prefix". The attach request sends the event, the Make-generated webhook URL and the prefix only when set; the relay's `201 {id}` is persisted as the webhook's remote id; the detach request deletes by that id [VERIFIED mechanism: https://developers.make.com/custom-apps-documentation/app-components/webhooks/dedicated/attached.md; Make's own skill requires persisting the remote id and not confusing it with Make's internal webhook id: https://github.com/integromat/make-apps-skill/blob/main/skills/make-custom-apps/references/webhooks-and-polling.md]. This matches the relay's semantics exactly: subscribe is idempotent per (credential, event, URL) so a repeated attach returns the same id; unsubscribe is idempotent and returns `204` even for an unknown id (#7 contract table), so a double detach or detach of an already-removed hook is harmless. Make calls attach with the webhook linked to the connection, so the subscription belongs to that connection's credential and site.
8. **A Make webhook URL is a secret capability.** Make's URL carries a long random path token (Make's docs show a 32-character token [VERIFIED: https://apps.make.com/gateway.md]); anyone holding it can post fake events into the scenario. The relay already stores it (#7 Decision 9 subscriber URLs) and lists subscriptions in the console. Hence R-M1: mask the token in admin responses and logs (host plus the last few characters of the token). Make-side IP restriction cannot help: Cloudflare Workers egress addresses are not a fixed list [ASSUMPTION], and #7 lists HMAC-signed deliveries as backlog; Make cannot verify an HMAC without custom crypto (Make's skill: "Do not import Node `crypto`" into app functions [VERIFIED: base-and-connections reference above]).
9. **The trigger output is the event envelope, unchanged.** The webhook's receiver definition processes the incoming body as one item, drops items whose `type` differs from the trigger's event (defence in depth; same as Zapier's ZT2), leaves the default Make acknowledgement (HTTP 200 "Accepted" [VERIFIED: https://help.make.com/webhooks]) and outputs the envelope fields. The trigger *interface* declares every envelope field with Make types (`id` text, `type` text, `occurredAt` and `detectedAt` date, `org`/`site`/`ref`/`path`/`user`/`change`/`source` text, `urls` as a collection of `preview`/`live`/`edit` URLs). The trigger *samples* are the relay's golden envelope. Date-times are ISO 8601 with offset as the relay sends them. No enrichment request is made (an instant trigger may make one request per item, but there is nothing to enrich [VERIFIED constraint: https://developers.make.com/custom-apps-documentation/app-components/modules/instant-trigger.md]). The webhook stores no `uid` because it is dedicated, not shared [VERIFIED: https://developers.make.com/custom-apps-documentation/app-components/webhooks/dedicated.md].
10. **At-least-once is documented, and Make has no built-in dedupe.** The relay delivers once per subscription when the subscriber acknowledges, and resends the same envelope (same `id`) on ambiguous failures (#7 Decision 7). I found no instant-trigger de-duplication in the Make docs I read [ASSUMPTION: absence of evidence; spikes S-M2 and S-M8 observe a repeated delivery]; Make's own skill says to treat duplicate delivery as possible, preserve a useful event id and document that deduplication is the consumer's job [VERIFIED: https://github.com/integromat/make-apps-skill/blob/main/skills/make-custom-apps/references/webhooks-and-polling.md, "Treat duplicate delivery as possible"]. So the README gives a recipe (a Data store lookup keyed by `id`, or a filter) and the trigger output exposes `id` first.
11. **Actions map one to one to relay routes.** *Create Page from Template* sends the template path, the new path and, only when the user chooses it, the "unique" collision behaviour; default is the relay's "fail with conflict" (#7 Decision 17). *Preview Page* sends the path. *Publish Page* sends the path and an **explicit** boolean "preview first" whose module default is true (the relay's own default is the same, #7 Decision 18, but the module does not rely on it and sends `false` rather than omitting it; tests must prove this because Make's QA guidance lists "omitted/null/empty, `0`, `false`" among the required input cases [VERIFIED: https://github.com/integromat/make-apps-skill/blob/main/skills/make-custom-apps/references/review-and-qa.md, section 4]). Outputs are the relay's `{path, urls[, status]}`. The app does no path validation of its own beyond "required"; the relay validates (#7 Decision 19) and the app passes input through verbatim so there is one authority.
12. **Errors: relay codes surfaced, not translated into guesses.** Make treats any 4xx/5xx as an error, retries `429` automatically as a rate-limit error and treats `5xx` as a temporary connection error unless overridden [VERIFIED: https://developers.make.com/custom-apps-documentation/component-blocks/api/handling-responses/error.md]. The app customises the *message* only, using the relay's error shape (code, fixed message, request id) so users see e.g. `conflict`, `credential_scope`, `invalid_admin_key`, `unsupported_for_site` with the request id for support. A response that is not in the relay shape (for example an HTML 502 from the platform) falls back to a message with only the status. Error types are left at Make's defaults except where the spike shows a better fit. [OPEN: whether `401` should use an "invalid credentials" type that makes Make mark the connection broken; read the error-types list in https://developers.make.com/custom-apps-documentation/component-blocks/api/handling-responses/error.md when building.]
13. **Timeouts.** Make requests time out after 40 seconds by default (configurable to 300) [VERIFIED: https://developers.make.com/custom-apps-documentation/app-components/base.md]. The slowest relay path is publish with preview first: two Admin API operations inside the template's 8-second retry deadline each (#2 Decision 8), well under 40 s. The app keeps the default and does not lower it.
14. **No universal module, search module, RPC or custom function in v1.** Make requires a "Make an API Call" universal module (relative-path only; "a universal module that doesn't match this condition won't be approved"), limit and pagination parameters on search/trigger modules, and test scenarios for *public* review [VERIFIED: https://developers.make.com/custom-apps-documentation/app-components/modules/universal-module.md, https://developers.make.com/custom-apps-documentation/app-review/prerequisites.md]. None of that is an #8 acceptance criterion and a private app does not need it, so these are recorded in the README's public-review checklist and Out of Scope. Adding them later is additive. [OPEN: Open Question 6.]
15. **Page Unpublished is not shipped as a trigger in v1.** The relay emits it, but #8 lists published, previewed and updated, and components of a published Make app cannot be deleted afterwards (decision 5), so adding a fourth trigger is a one-webhook-plus-one-module addition the owner can choose later (Open Question 5; same question as #7 OQ11).
16. **Scopes per module.** Triggers need `events:read`; Create needs `pages:create`; Preview needs `pages:preview`; Publish needs `pages:publish`. Make connections cannot declare scopes (only OAuth connections do [VERIFIED: https://github.com/integromat/make-apps-skill/blob/main/skills/make-custom-apps/references/base-and-connections.md]), so the README recommends one credential per Make connection with the scopes the scenarios need, and a module whose scope is missing fails with the relay's `credential_scope` message naming the missing scope.

**Deploy and environments**

17. **Upload with Make's TypeScript SDK, from a maintainer machine, dry-run by default.** The deploy script follows the contract in Make's official skill: offline mock by default; `--live` only with `MAKE_API_KEY` and `MAKE_ZONE` taken from the environment (never from arguments or files committed), zone validated as a bare hostname; create the app private and confirm it is private before writing any section; write each section then read it back and compare; automatic retries off so an uncertain create is looked up, never repeated; no publication, review request, connection creation, scenario run or provider call; reports without section contents [VERIFIED: https://github.com/integromat/make-apps-skill/blob/main/skills/make-custom-apps/references/tooling-and-release.md]. API scopes `sdk-apps:read` and `sdk-apps:write` are required [VERIFIED: https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/generation-of-your-api-key.md]. The script throttles to Make's API limit (Core 60 requests per minute, Pro 120, Teams 240, Enterprise 1000 [VERIFIED: https://developers.make.com/api-documentation/getting-started/rate-limiting.md]) because an upload is dozens of section calls.
18. **The VS Code extension route is not used.** Make marks the Make Apps Editor for VS Code deprecated and recommends an AI coding agent for new apps [VERIFIED: https://developers.make.com/custom-apps-documentation/get-started/readme.md]. The repo keeps the definitions and a small, pinned SDK script; the web editor is allowed for read-only inspection and spike experiments in the dev app. [OPEN: Open Question 8 on SDK version pin; skill baseline is `@makehq/sdk@1.8.1`, npm `latest` showed `1.17.0` with `engines.node >=20` on 2026-11-16 [VERIFIED by `npm view`].]
19. **Definitions are validated against Make's editor schemas in CI.** Make's skill bundles the editor's draft-07 schemas (MIT-style licence, byte-exact copies of https://github.com/integromat/vscode-apps-sdk `syntaxes/imljson/schemas/`) and a validator needing Ajv 8 and no network [VERIFIED: https://github.com/integromat/make-apps-skill/tree/main/skills/make-custom-apps/references/editor-schemas]. Violations are warnings in Make, and some are silent runtime bugs (for example a misspelt redirect key is ignored); some sections have no schema (a webhook's receiver and update sections) and are covered by the simulator tests and manual review instead [VERIFIED: references/editor-schema-validation.md]. The schemas are vendored with their licence and attribution, or fetched at a pinned commit; not paraphrased. [OPEN: vendoring vs pinned fetch, small.]
20. **Zones.** A private app is created in one Make zone; an invite-link (public) app can be installed from any zone [VERIFIED: app-visibility page above]. The test organisation's zone decides where the dev and production-variant apps live. The relay allowlist covers every zone the owner wants to support, not only the test zone (Open Question 14).
21. **No change to the console, no relay code, no `providers/zapier/`.** The console already issues credentials with scopes and lists subscriptions; Make users use it unchanged. If the Make provider needs a credential scope preset ("Make: all four") the console's scope picker already allows it. Anything beyond registration found necessary during the spikes is recorded in the PR and escalated to #7, not silently added to the shell.
22. **`ref=local` for a Make-backed flow needs a public relay URL.** Make's servers cannot reach `localhost`. For `ref=local` verification the relay runs locally under wrangler and is exposed through a tunnel; a **dev app** (same definitions, relay base URL replaced by the tunnel origin at upload time, never the production app) targets it. The console page at `localhost:3000` talks to the local relay at `localhost:8787` as in #2/#7. For the branch-ref flow the console page on the branch talks to the deployed relay and Make uses the production-variant app. The deploy script refuses to upload a non-production origin to the production-named app and refuses non-HTTPS origins. [ASSUMPTION: `baseUrl` cannot be an expression over app common data; if spike S-M7 shows it can, the variant mechanism becomes one common-data value and the string replacement is dropped.]

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given requests Make would send and a fake outside world (the real relay worker with a fake Admin API, a fake Make ingress, a fake clock), assert HTTP requests and responses, bundles produced, what the relay stored as a user-visible result, and what is logged; never assert on the wording of a definition file, internal helper names or the number of internal calls. Three negative properties hold across every path: **no relay credential or Make API key appears in any response, any log line, or any request to a host other than the relay**; **no request the Make app makes succeeds without the bearer credential**; **no request is made to an absolute URL outside the relay origin**.

**Proposed seams** (recorded here instead of asked). Existing seams from #1, #2 and #7 first; three new ones, the first at the highest point available.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| K1 (primary) | **Make-app-to-relay boundary:** the committed app definitions are run by a small restricted IML evaluator (the "Make simulator") that plays Make's role: validate the connection, attach/detach webhooks, receive deliveries, execute action requests. It speaks to the unmodified relay through #7's W1 (`worker.fetch`) and R1 (`worker.scheduled`) | **new** (adapter over existing W1/R1) | Trigger, action, connection, error-mapping and lifecycle tests | #7's fakes: fake IMS and env factory from the #2 test kit, fake Admin API, in-memory store, fake clock; plus a fake Make ingress that answers the relay's delivery POSTs with Make's documented codes (200 Accepted, 400 queue full, 429, 410) |
| K2 | Definitions against Make's editor schemas (static) | **new**, static only | Schema conformance of every component file | Ajv with Make's schemas; no network |
| K3 | Deploy script boundary: an injected Make SDK client | **new** (same injection pattern as `fetchImpl`/`now` in upstream's `session-auth.js`) | Dry-run, order, readback, throttling, safety rules | A recording fake client; fake clock |
| W1, R1 | Worker HTTP boundary, relay tick | reused from #2/#7 | Registration tests (host allowlist, delivery to Make hosts) | as #7 |
| S3 | Repo convention check | reused from #1/#2/#7 | Provider isolation, secrets hygiene, README doc-tests | Temp-dir fixtures |
| S1, S2 | Entry page + SDK; render module + SDK | reused from #1 | **Not used**: no browser code is added | n/a |

Why K1 is the one place logic is tested: for a declarative Make app, the "logic" is the request each module sends, the response it accepts, and the bundle it emits; those are properties of definitions executed against the relay, and the only faithful counterpart available offline is a restricted evaluator. **The evaluator is deliberately narrow:** variable lookup and property access over Make's documented variables, template interpolation, `if`, and equality. Anything else makes the test fail with "unsupported construct", which constrains the definitions to a subset that stays checkable and prevents the evaluator from silently inventing semantics. Its fidelity to Make's real evaluation is [ASSUMPTION] and is validated by the live scenario runs (L-steps), not by itself; K1 proves the *contract* between the app and the relay, not Make's internals. [OPEN: Open Question 7 asks the owner to accept this design versus structure-only assertions plus live checks.]

**What K1 cannot prove (live-only):** Make's real URL generation and zone hosts, when Make actually calls attach and detach, Make's real retry and error-type handling, how Make renders the interface and samples, plan and zone limits, whether Make's server requests carry an `Origin`, and Make's reaction to inactive or deleted webhooks. These are spikes S-M1..S-M9 and the manual verification steps.

**Modules tested:** connection validation and secret handling, three trigger webhooks (attach, detach, receive, filter, output), three action modules (request body, collision and boolean handling, outputs, error messages), the relay's acceptance of and delivery to Make hosts, the deploy script, repo hygiene and README consistency.

**Prior art:** #7 Testing Decisions (seams W1, R1, R2, Z1; test kit; golden fixtures shared by relay and connector, here also read by relative path as in #7's Zapier tests); #2 test kit (fake IMS, fake upstream, env factory, canary secret); upstream's dependency-injection pattern (`fetchImpl`, `storage`, `now`) [https://github.com/adobe-rnd/ew-extensions/blob/main/tools/brand-visibility/session-auth.js]; Make's own checks in its official skill repository (`scripts/check-custom-app-examples.mjs`, `editor-schemas/validate.mjs`) as the model for schema and structure checks, and the skill's SDK upload sample (a mock-by-default script with a typed client) as the model for K3 [https://github.com/integromat/make-apps-skill].

## Out of Scope

- Any change to the relay's detection, ledger, delivery or credential logic, to the Connections console, or to `providers/zapier/` (all #7); the three requests R-M1..R-M3 are inputs to #7, not work done here.
- Make public listing: app review request, publication, invite-link sharing, Make's QA process, logo/branding assets, trademark licences, support/partnership forms, the universal "Make an API Call" module, search modules, limit/pagination parameters, test-scenario evidence for reviewers. (The README checklist is in scope as documentation; passing review is not.)
- A fourth trigger (Page Unpublished) and any module beyond the six listed (Find page, Update page, Delete page, list-events search, dynamic sample RPC).
- Polling triggers in Make (the relay's REST-hook subscription is the event source; a Make polling trigger over `GET /v1/events` is a possible later addition).
- Webhook payload signing, replay protection and per-credential rate limits (#7 backlog); Make cannot verify an HMAC without crypto primitives.
- OAuth 2.0 connection for Make (the relay is not an OAuth server, #7 Decision 22), a "create credential from Make" flow, and Make credential requests (a Make partner/Enterprise feature [VERIFIED mention: https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/ai-coding-agent/connect-and-test-your-app.md]).
- Make White Label / on-prem zones other than naming the supported zone list; Make API keys beyond the deploy script.
- Running the relay for third-party hosting organisations (#7 OQ14).
- CI that deploys to Make or holds a Make API key; the maintainer uploads manually.
- The Adobe outside-activity/IP policy and security review (flagged in #1 R1, #7 R1; carried in Open Question 1).

## Further Notes

- **Make already delivers over HTTPS with generous limits.** A webhook accepts payloads up to 5 MB [VERIFIED: https://apps.make.com/gateway.md]; Make processes up to 300 incoming webhook requests per 10-second interval (the page does not say per webhook or per organisation) and returns 429 beyond that [VERIFIED: https://help.make.com/webhooks]; each webhook has its own queue, sized by plan (667 items per 10,000 licensed credits per month, at most 10,000) and a full queue answers `400 Queue is full` [VERIFIED: same page]. The relay's per-subscription cap of 100 per tick and envelope size of well under a kilobyte [ASSUMPTION: envelope is small] stay far inside these limits.
- **Make's responses map onto the relay's delivery policy.** Default acknowledgement is `200 Accepted`; `400 Queue is full` and `429 Too many requests` are failures the relay retries on its schedule and eventually marks failed (#7 DL3); webhooks not connected to any scenario for more than 5 days are deactivated and return `410 Gone` [VERIFIED: https://help.make.com/webhooks], which the relay already treats as "subscription gone" and deletes (#7 Decision 8, DL4). What an *inactive* or *deleted* scenario's webhook returns before those 5 days is not documented [OPEN: spike S-M4]; the relay's retry schedule bounds the cost either way.
- **Make stores webhook logs for 3 days (30 on Enterprise)** and execution data per its own settings [VERIFIED: https://help.make.com/webhooks]. Events carry the acting user's email when the admin log has it (#7 R15), so personal data lands in Make; the README says so and notes Make's confidential-data scenario option as the user's control [ASSUMPTION: option exists as described in Make's UI; not verified].
- **Make egress IP addresses are published per zone; ingress addresses are dynamic** [VERIFIED: https://help.make.com/allow-connections-to-and-from-make-ip-addresses]. The relay does not allowlist by IP (Make → relay calls come from the egress addresses and could in principle be checked; not done, #7 uses credentials; recorded as a hardening option).
- **Make's public-review prerequisites exclude service domains hosted on generic platform domains** (for example Heroku or AWS) and require that the service is not already available in Make and that only necessary credentials are requested [VERIFIED: https://developers.make.com/custom-apps-documentation/app-review/prerequisites.md]. A `workers.dev` relay hostname is a likely blocker for public listing [ASSUMPTION: Cloudflare's shared domain is treated like those]; a custom relay domain is the remedy. Whether Make already has an AEM/EW app was not determinable (Make's integrations pages returned a bot challenge to my fetcher; the Make search results did not show one) [OPEN].
- **Package and tool facts observed 2026-11-16:** `@makehq/sdk` `1.17.0`, `engines.node >=20`; `@makehq/cli` `1.4.0`; `@integromat/make-cli` `2.4.7` is the deprecated VS Code route's CLI [VERIFIED by `npm view`]. The skill documents `@makehq/sdk@1.8.1` as its tested baseline.
- `apps/automation-connectors/providers/make/SPEC.md` is a planning artefact; keep or delete it when the provider is built, as decided for the sibling specs [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

```
 EW (da.live) ── iframe ──► Connections console (existing, unchanged; issues relay credential, lists subscriptions)
                                  │  Authorization: Bearer <IMS>            (#7 admin routes)
                                  ▼
 ┌──────────────────── Relay (Cloudflare Worker, #7; only change: SUBSCRIBER_HOSTS += Make hook hosts) ───────────────────┐
 │  connector routes (relay credential): /v1/me  /v1/hooks  /v1/events  /v1/pages  /v1/pages/preview  /v1/pages/publish   │
 │  scheduled(): detect (log, scan) → ledger → outbox → deliver (HTTPS POST envelope to allowlisted host; 2xx ack; 410 stop)│
 └───────▲────────────────────────────────────────────────────────────▲─────────────────────────────────────────────────┘
         │ Make → relay (server to server; bearer credential)         │ relay → Make webhook URL (hook.<zone>.make.com/<token>)
         │ validate · attach · detach · create/preview/publish        │ envelope JSON
 ┌───────┴────────────────────────────────────────────────────────────┴──────────┐
 │ Make platform (private custom app "EW Automation", installed in a test org)   │
 │   base + connection(1) + webhooks(3, attached/dedicated) + instant triggers(3) │
 │   + action modules(3)                                                         │
 └─────────────────────────────────────────────────────────────────────────────────┘
 Maintainer machine only:  deploy script (@makehq/sdk, MAKE_API_KEY, MAKE_ZONE) ──► Make API (https://{zone}.make.com/api/v2/sdk/apps/...)
```

| Concern | Make app (runs in Make) | Relay (#7, holds secrets) | Deploy script (maintainer machine) |
|---|---|---|---|
| Relay credential | stored in the Make connection (password field, sanitized in logs); sent as bearer | issues, hashes, authenticates, scopes | never sees it |
| Admin API key / site permissions | never sees it | holds (encrypted), uses | never sees it |
| Subscribing | attach/detach requests with the webhook URL | validates URL against allowlist, stores, delivers | n/a |
| Detection, dedupe, retry | none | all | n/a |
| Page actions | forwards user input | validates paths, calls Admin API | n/a |
| Make API key | n/a | n/a | holds, in env only; never logged |
| Definitions | consumed | n/a | uploads and reads back |

## 2. EW integration points

- **Type:** none new. This provider adds **no EW app and no library plugin and no config-sheet row**. The host extension is #7's fullscreen app (an `apps` sheet row); Make users use its console to issue credentials. The extensions table row for `automation-connectors` (type `app`) from #7 gains a mention of Make in its description; no new row. [Per #1 Decision 2: type comes from the config-sheet row; a vendor provider has none of its own.]
- **SDK actions used:** none. No browser code is added; seams S1/S2 are unused.
- **Config-sheet rows / site config read:** none. The extension reads no EW site config (#7 Decision 29), and this provider adds none; the README says so. Per-site relay settings (watched prefixes, scan interval) stay in the console; the only Make-specific setting is the per-webhook "path prefix" in Make.
- **`ref=local` and branch ref (AC6):** the console behaves exactly as #7. What differs for Make is reachability: Make cannot call `localhost`, so `ref=local` runs the local relay behind a tunnel and uses the dev app (Implementation Decision 22). Branch-ref runs use the deployed relay and the production-variant app. Verification steps L3 and L4 below.
- **CORS:** connector routes refuse requests that carry an `Origin` header (#7 Decision 13). Make's server-side calls are expected to carry none [ASSUMPTION; spike S-M3 observes the relay's view of Make requests].

## 3. External APIs and auth flows

| API | Use | Auth | Source / status |
|---|---|---|---|
| Relay connector API v1 (#7) | all runtime calls from Make | `Authorization: Bearer <relay credential>` | #7 section 4, frozen; restated in decision 1 |
| Make webhook (dedicated, attached): attach and detach procedures run with the webhook linked to the connection; `webhook.url` is the generated URL; attach `response.data` persists the remote id, readable as `webhook.<field>` in detach | trigger subscribe/unsubscribe | the connection | [VERIFIED] https://developers.make.com/custom-apps-documentation/app-components/webhooks/dedicated/attached.md ; type overview https://developers.make.com/custom-apps-documentation/app-components/webhooks/dedicated.md |
| Make webhook receiver spec: `respond`, `verification`, `iterate`, `output`, `condition`, `uid`; IML variables `body`, `query`, `headers`, `parameters` | process incoming envelope | n/a | [VERIFIED] https://developers.make.com/custom-apps-documentation/app-components/webhooks.md |
| Make instant trigger module: no iterate/pagination; optional single enrichment request; static parameters only; one bundle per webhook item; samples recommended | trigger modules | n/a | [VERIFIED] https://developers.make.com/custom-apps-documentation/app-components/modules/instant-trigger.md |
| Make basic connection: parameters, one communication request, `response.metadata`, `response.data`, `log.sanitize`; `connection.*` readable from base | credential and validation | n/a | [VERIFIED] https://developers.make.com/custom-apps-documentation/app-components/connections/basic-connection.md ; https://developers.make.com/custom-apps-documentation/best-practices/connections.md (validation endpoint rule) |
| Make base: `baseUrl`, headers, error handling, sanitization; default 40 s timeout up to 300 s | inherited by modules | n/a | [VERIFIED] https://developers.make.com/custom-apps-documentation/app-components/base.md ; https://developers.make.com/custom-apps-documentation/app-components/base/error-handling.md |
| Make error directive: `response.error` message/type, defaults per status (429 rate-limit retried, 5xx connection error) | action error mapping | n/a | [VERIFIED] https://developers.make.com/custom-apps-documentation/component-blocks/api/handling-responses/error.md |
| Make webhook ingress behaviour: 200 "Accepted", 400 "Queue is full", 429 "Too many requests"; queue per webhook; 410 for webhooks unconnected for over 5 days; 300 requests/10 s; logs 3 days | relay delivery target behaviour | n/a | [VERIFIED] https://help.make.com/webhooks ; payload max 5 MB: https://apps.make.com/gateway.md |
| Make webhook hostnames (`hook.<zone>.make.com`) | allowlist entries | n/a | partly [VERIFIED] (Make docs show `hook.make.com`), per-zone forms from community posts; complete list [ASSUMPTION], spike S-M1 |
| Make zones and egress IPs | zone list; optional network review | n/a | [VERIFIED] https://help.make.com/allow-connections-to-and-from-make-ip-addresses |
| Make API, SDK Apps: create/get/delete app, sections for base, connections, webhooks (`api`, `parameters`, `attach`, `detach`, `update`, `scope`), modules, RPCs, functions; `review`; app visibility | deploy script | Make API key with `sdk-apps:read` and `sdk-apps:write`, zone host | [VERIFIED] https://developers.make.com/api-documentation/api-reference/sdk-apps.md ; `/sdk-apps/webhooks.md` ; key creation https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/generation-of-your-api-key.md |
| Make API rate limits per plan | deploy throttle | n/a | [VERIFIED] https://developers.make.com/api-documentation/getting-started/rate-limiting.md |
| `@makehq/sdk` (TypeScript management SDK) | upload and readback | Make API key | [VERIFIED] https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/ai-coding-agent/build-and-upload-your-app.md ; usage contract https://github.com/integromat/make-apps-skill/blob/main/skills/make-custom-apps/references/tooling-and-release.md |
| App visibility (private/public/approved), irreversibility of publishing | decision 5 | n/a | [VERIFIED] https://developers.make.com/custom-apps-documentation/create-your-first-app/app-visibility.md |
| App review prerequisites and process | public-review checklist | n/a | [VERIFIED] https://developers.make.com/custom-apps-documentation/app-review/prerequisites.md ; https://developers.make.com/custom-apps-documentation/app-review/request-app-review.md |
| Editor schemas and validator | K2 | none | [VERIFIED] https://github.com/integromat/make-apps-skill/tree/main/skills/make-custom-apps/references/editor-schemas |

**Auth flows.**
1. *Issue credential:* admin signs in to EW, uses the console (IMS-authenticated, #7) to issue a credential with scopes; value shown once.
2. *Create connection in Make:* user pastes the credential; Make runs the connection validation request (`GET /v1/me`); success stores the secret in the connection and the `org/site` label.
3. *Add a trigger:* user picks a trigger, creates a webhook (connection selected, optional prefix); Make generates the URL and calls attach (`POST /v1/hooks`, bearer); relay validates the URL's host against the allowlist and stores the subscription; Make stores the returned id.
4. *Event:* relay tick detects an event, POSTs the envelope to the Make URL (no credentials forwarded); Make answers `200 Accepted` and starts the scenario with one bundle.
5. *Action:* module sends the documented body to a relay route with the bearer; relay resolves org/site from the credential and calls the Admin API with the stored key.
6. *Remove:* user deletes the webhook (or scenario/module); Make calls detach (`DELETE /v1/hooks/{id}`); relay answers `204`. If Make never calls detach, the relay's `410` handling or retry exhaustion eventually ends the subscription.
7. *Deploy (maintainer):* `MAKE_API_KEY` and `MAKE_ZONE` from the environment; script creates/updates the private app and reads back each section; no secret enters the repo or CI.

## 4. Data contracts

**Make app to relay (request shapes; field names are the contract).**

| Make component | Relay request | Notes |
|---|---|---|
| Connection validation | `GET /v1/me`, bearer | success body: `org`, `site`, `label`, `scopes`, `capabilities`; label stored as metadata `org/site` |
| Trigger attach (×3) | `POST /v1/hooks` with `event` = `page.published` / `page.previewed` / `page.updated`, `targetUrl` = the Make webhook URL, `pathPrefix` only when set | `201 {id}`; errors `400 bad_target_url`, `403 credential_scope`, `409 subscription_limit`, `401` |
| Trigger detach (×3) | `DELETE /v1/hooks/{id}` | `204`, idempotent |
| Create Page from Template | `POST /v1/pages` with `templatePath`, `path`, `collision` only when "unique" chosen | `201 {path, urls}`; `409 conflict`; `501 unsupported_for_site`; `404` template missing |
| Preview Page | `POST /v1/pages/preview` with `path` | `200 {path, urls, status}` |
| Publish Page | `POST /v1/pages/publish` with `path`, `previewFirst` (explicit boolean) | `200 {path, urls, status}` |

**Relay to Make (delivery).** `POST` of the event envelope as JSON to the stored URL; no `Authorization`; redirects not followed. Make's behaviour: `200 Accepted` (success), `400 Queue is full`, `429`, `410`. The envelope fields and types are #7 section 4 (`id`, `type`, `occurredAt`, `detectedAt`, `org`, `site`, `ref`, `path`, `user`, `change`, `urls{preview, live, edit}`, `source`).

**Trigger interface (Make types).** `id` text; `type` text; `occurredAt`, `detectedAt` date; `org`, `site`, `ref`, `path`, `user`, `change`, `source` text; `urls` collection of three URL texts. A test asserts the interface keys equal the envelope's keys (no drift in either direction) and samples equal the golden envelope.

**Relay configuration touched:** `SUBSCRIBER_HOSTS` gains the Make hosts (non-secret var). No secret, no D1 migration, no cron change.

**Make environment variables for deploy (maintainer machine only):** `MAKE_API_KEY` (secret), `MAKE_ZONE` (bare hostname such as `eu1.make.com`); optional script arguments: target app name, relay base URL for a dev variant. No secret is accepted as an argument.

## 5. Folder layout (proposed; fits #1, #2 and #7)

```
apps/automation-connectors/
├─ README.md                         (existing, #7) gains: a "Make" link/section pointer + description mention; registration row notes the provider
├─ worker/                           (existing, #7) change: SUBSCRIBER_HOSTS in the wrangler config (and the matching documented table); NO other source change
└─ providers/make/
   ├─ SPEC.md                        this file
   ├─ README.md                      vendor setup: credential + scopes, zones/hosts, step-by-step (connection, triggers, actions), dedupe recipe, errors table, security and data notes, deploy, public-review checklist
   ├─ package.json                   private; pinned @makehq/sdk and ajv (dev); own `npm ci` like providers/zapier
   ├─ app/                           the Make app definitions as committed files:
   │   ├─ base, connection, webhooks (3), modules (3 triggers + 3 actions), samples/interfaces, app metadata
   ├─ schemas/                       vendored Make editor schemas + LICENSE + provenance note (commit hash)
   ├─ scripts/                       deploy script (SDK; dry-run default), schema validation runner
   └─ test/                          simulator, K1/K2/K3 tests, fixtures (golden envelope read from ../../worker/contract/ by relative path), README doc-test
```

Rules: `.hlxignore` already hides `**/providers/`, `**/worker/`, `**/test/` (#7 section 5); S3 treats `providers/<vendor>/` as sub-structure (#1). Contract fixtures stay in `worker/contract/` and are read, never copied (same deliberate same-extension dependency as #7's Zapier tests). Definition file naming follows Make's component names so uploads map 1:1; exact layout is the implementer's call so long as the deploy script and tests agree. [OPEN, small: vendored schemas vs fetched at a pinned commit.]

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **#7 is unbuilt and its spec is the contract.** Any drift in route names, scope names, envelope or error codes breaks the Make app silently (Make does not compile against the relay). | High | Golden fixtures and the route/scope table are read by K1 tests (R-M3); contract change = both sides change in one PR; start build only after #7's connector API is merged. |
| R2 | **Make's webhook behaviour is under-documented:** hostnames per zone, when attach and detach are called, response codes for inactive or deleted scenarios, whether an `update` procedure is needed. | High for AC1 and the allowlist | Spikes S-M1, S-M2, S-M4 first; host list and lifecycle notes recorded in the README and in test fixtures; relay's 410 and retry policy bounds the damage meanwhile. |
| R3 | **Orphan subscriptions.** If Make does not call detach in some user actions (scenario deleted, scenario copied, app removed), subscriptions linger until retries fail or Make returns 410 (5 days unconnected). Each consumes one of the site's 50 subscription slots. | Medium | Spike S-M2 maps actions to detach calls; README documents the cleanup (console list + revoke); relay failure policy (#7 DL3/DL4); request to #7: surface per-subscription failure state clearly (already planned). |
| R4 | **Webhook URL secrecy (decision 8).** The relay stores Make URLs and the console lists subscriptions. | Medium | R-M1 (mask token in admin responses and logs); test that a canary URL token never appears in logs or admin responses (reuses CR8). |
| R5 | **Irreversible publication.** Publishing a Make app cannot be undone and components cannot be deleted [VERIFIED app-visibility]. A premature publish locks in names, labels and modules. | High if it happens | The script never publishes (K3 test); public path is an explicit owner decision (OQ 2); labels reviewed before any publish. |
| R6 | **At-least-once and no Make dedupe** can double-post to downstream apps. | Medium | Stable `id` first in the output; README recipe; test that duplicates produce identical ids; live check L8. |
| R7 | **Restricted evaluator fidelity (K1).** The simulator may disagree with real Make on empty-value handling, date parsing, collection output or header merging. | Medium | Narrow subset with fail-on-unknown; spike S-M5/S-M8 compare against real runs; live L5/L6 are the authority; any mismatch becomes a golden case. |
| R8 | **Make plan, zone and feature access** (custom apps and instant triggers on the test org's plan; API rate limits for upload; Core is 60 requests/minute). | Medium | Spike S-M6 on the actual org before building; upload script throttles and resumes. |
| R9 | **Relay reachability for `ref=local`.** Make cannot call `localhost`; a tunnel adds a moving part and a second app variant. | Medium | Dev app variant + tunnel documented; if S-M7 shows `baseUrl` can use app common data, variant handling collapses to one value; or deploy a staging relay instead (OQ 9). |
| R10 | **Public-review blockers:** relay domain on a shared platform domain, trademarks ("Adobe", "Experience Workspace"), service must not already exist in Make, universal module and test scenarios required. | High for public listing, none for private | README checklist; owner decision (OQ 2, 3, 4); not built here. |
| R11 | **Personal data flows into Make logs** (acting user email; Make keeps webhook logs 3 days, 30 on Enterprise, and execution data). | Medium | README states it; carry #7 OQ13 (keep, hash or omit user by default). |
| R12 | **Tooling churn:** Make's VS Code route is deprecated; SDK versions move (baseline 1.8.1 vs npm 1.17.0 today); doc pages are GitBook and change. | Low-Med | Pin SDK exactly; dry-run mocks in CI; recheck sources at build time. |
| R13 | **Make queue-full and inactive-scenario behaviour** (`400 Queue is full`) makes the relay fail deliveries for stopped scenarios, wasting retries. | Low-Med | Retry schedule is bounded (#7); relay marks failed and shows it; consider relay auto-pause after repeated 4xx (OQ 16, a #7 feature). |
| R14 | **Make hook-host allowlist too broad or wrong.** A wildcard or the wrong host either lets the relay POST to unrelated Make hosts or blocks real webhooks. | High | Exact hostnames; RG2 look-alike matrix; spike S-M1 for the real list; API hosts excluded by test. |
| R15 | **Credential reuse across connectors.** The same relay credential could be pasted into Zapier and Make, widening its blast radius. | Low | README recommends one credential per connection with minimal scopes; console shows label and last used (#7). |
| R16 | **Adobe outside-activity/IP policy** for a personally hosted relay and a Make app that automates an Adobe product. | High for publication | Carried from #1 R1 and #7 R1; README note; OQ 1. |
| R17 | **Make org plan costs:** each trigger run is a Make operation; heavy sites consume the owner's operations. | Low | README note on operations and webhook processing schedule. |

**Relay requests derived from this ticket (inputs to #7; none redesigns the shell):**
- **R-M1** mask the secret path of subscriber URLs in admin subscription lists, delivery lists and logs.
- **R-M2** treat an empty string for optional hook and page fields as absent (defensive).
- **R-M3** keep a machine-readable list of connector routes and scopes in `worker/contract/` for connector tests.
- **R-M4** document in the console/README that each Make webhook uses one subscription slot of the site's cap.

**Spikes (build-plan step 1; results recorded in the README and fixtures; throwaway scripts not committed).**
- **S-M1** Webhook hosts: create a webhook for the app in each reachable zone (and a custom webhook) and record the URL host, path form, token length, port, redirects.
- **S-M2** Lifecycle: record when Make calls attach and detach (adding a webhook, saving, deactivating, deleting the module, the webhook, the scenario, cloning a scenario, installing a new app version) and what happens when attach fails; learn whether the webhook `update` section is needed.
- **S-M3** What Make's server requests look like to the relay: `Origin` absence, `User-Agent`, source addresses versus the published egress table.
- **S-M4** Responses from Make's ingress to the relay for: active scenario, inactive scenario, deleted webhook, full queue; confirm 200/400/410/429 and body text.
- **S-M5** Empty-value semantics for optional mappable fields and for `false` and `0` under the app's manifest version.
- **S-M6** The test org: plan can create private custom apps with instant triggers; API key creation; API rate limit during a full upload; zone.
- **S-M7** Whether `baseUrl` in the base may be an expression over common data (decides the dev/prod variant method).
- **S-M8** Webhook intake of the envelope: nested `urls` as a collection bundle; ISO 8601 with offset parsed into the date type; large integers not involved.
- **S-M9** (optional) Behaviour of "Re-determine data structure" and sample handling for instant triggers.

## 7. Ordered build plan (sized to #8's acceptance criteria)

0. **Prerequisites (owner):** #1, #2 and #7 merged with the relay deployed and the console working (#7 M0 to M9 passed); a Make test organisation (zone and plan checked, S-M6); Make API key (`sdk-apps:read`, `sdk-apps:write`); an EW test site connected on the relay with a credential issued; a tunnel tool for the dev app; Open Questions 1 to 9 answered. Gate: if #7's connector API is not merged, #8 does not start.
1. **Spikes S-M1 to S-M9** against the real Make org with throwaway scripts; record the real hook hosts, lifecycle, response codes. Gate: if S-M1 or S-M2 contradict decisions 3 or 7, update this spec before building definitions.
2. **Relay registration (AC4):** add the Make hosts to the relay's subscriber-host setting and its documented table; tests RG1 to RG3 (red first, then green); confirm no other relay file changes (SC4).
3. **Test harness first:** restricted IML evaluator and fake Make ingress over #7's W1/R1 fakes; schema validator runner; the golden-fixture loader. Self-tests: evaluator rejects unsupported constructs; fake ingress returns Make's documented codes.
4. **Connection and base (AC7):** schema tests (K2, SD series) then K1 connection tests (CX1 to CX5); definitions made green.
5. **Triggers (AC1):** three webhooks and three instant triggers, test-first (TR1 to TR12), including the full chain relay → fake Make ingress → bundle.
6. **Actions (AC2):** three modules, test-first (MA1 to MA9), including error mapping and the explicit boolean.
7. **Deploy script (K3, AC3 prerequisite):** dry-run default, order, readback, throttling, safety rules (DP1 to DP8).
8. **README and extension README link (AC5), repo checks (AC4, AC7, AC8):** README doc-tests, provider-isolation and secrets-hygiene checks, CI job `make-app`.
9. **Live verification (AC3, AC6):** deploy to the dev app (tunnel, `ref=local`), run L1 to L10; deploy the production-variant private app, run the branch-ref flow; record observed values (real hosts, lifecycle, latencies) in the README and fixtures.
10. **Public-review checklist** in the README (no review request); hand-off note for #9 (what was learned about the allowlist, URL masking, dedupe) .

---

# Testing Requirements

## 1. Conventions

- **Runner:** Node built-in `node:test` (Node >= 22.12, per #2/#7), because the tests drive the relay worker (`Request`/`Response`, `crypto.subtle`) and Node-only tooling. No browser runner is involved; no browser code exists in this provider.
- **Fixtures/mocks:** #2 test kit (fake IMS, env factory, injected `fetch`/clock/random/sleep, canary secrets); #7 fakes (fake Admin API with scripted log entries, in-memory store, `worker.scheduled` driver); new here: **fake Make ingress** (a `fetch` handler registered for Make hook hosts that records the relay's delivery request and answers `200 Accepted`, `400 Queue is full`, `429`, `410`, or a redirect or timeout as scripted) and the **Make simulator** (restricted IML evaluator over the committed definitions). The golden envelope, `me` body and relay error bodies come from `worker/contract/` by relative path.
- **Canaries:** a relay credential canary, a Make API key canary, a webhook-token canary; log capture on both relay and simulator.
- Every test enters through the Make simulator (which calls `worker.fetch` / `worker.scheduled`), or through the deploy script's entry with a fake SDK client.

## 2. Static definition tests (seam K2)

| ID | Behaviour asserted |
|---|---|
| SD1 | Every component file validates against Make's editor schema for its kind with no warnings, except sections without a schema (webhook receiver and update), which are listed as "not validated" and asserted by TR tests instead |
| SD2 | Every reference resolves: each trigger links to an existing webhook and the connection; each module/webhook references the one connection; no orphan components |
| SD3 | No absolute URL appears in any definition except the relay origin (in the base and the connection validation request); all other requests are relative to the base |
| SD4 | The relay origin literal is identical wherever it appears (so the dev-variant replacement is safe) and is HTTPS |
| SD5 | The connection has exactly one parameter of type `password`; no URL, site, org or Admin-key parameter exists |
| SD6 | Both base and connection sanitize the authorization header |
| SD7 | No definition contains a secret-looking literal (relay credential prefix, long hex/base64 token) |
| SD8 | Triggers are exactly: published, previewed, updated (no fourth trigger); actions exactly: create, preview, publish; no universal, search or RPC component in v1 |
| SD9 | Module and webhook labels and descriptions are present and in English (Make review item, cheap to keep) |

## 3. Connection tests (seam K1)

| ID | Behaviour asserted |
|---|---|
| CX1 | Validation sends `GET` to the relay's "who am I" route with `Authorization: Bearer <credential>` from the connection field; a success body yields metadata `org/site` and stores no extra secret |
| CX2 | `401` (revoked or wrong credential) produces a readable "credential invalid or revoked" message; no retry; the relay received exactly one request |
| CX3 | A simulated log of the validation and of every module request shows the credential canary redacted (sanitize paths work); an unsanitized path (negative control) leaks it, proving the test can fail |
| CX4 | A credential without any scope can still pass validation (relay `me` is "any scope") and later fails at the module with the scope message |
| CX5 | Connection to a different relay origin is impossible: no input can change the origin (SD4/SD5 behaviourally: the simulator sends all requests to the constant origin even when a parameter named like a URL is injected) |

## 4. Trigger tests (seam K1; each runs for published, previewed and updated)

| ID | Behaviour asserted |
|---|---|
| TR1 | Attach sends `POST /v1/hooks` with the right event, the Make-style URL as `targetUrl`, bearer, JSON; `pathPrefix` present only when set; absent otherwise (not empty string) |
| TR2 | The relay's `201 {id}` is persisted as the webhook's remote id; a later detach sends `DELETE /v1/hooks/{id}` with the persisted id (not Make's internal id) |
| TR3 | Detach is harmless when repeated, when the id is unknown, and when the credential has been revoked (relay `204`/`401` both produce no scenario-breaking error beyond the documented message) |
| TR4 | Re-attach with the same URL returns the same id (relay SB2) and creates no second subscription |
| TR5 | Full chain: attach, fake Admin API emits a matching log entry, run a tick, the relay POSTs one envelope to the fake Make ingress host, the simulator applies the webhook receiver definition and produces one bundle whose fields equal the golden mapping; the ingress answered `200 Accepted` |
| TR6 | A delivery whose `type` differs from the trigger's event produces no bundle but is acknowledged `200` (so the relay does not retry) |
| TR7 | `pathPrefix` set at attach: only events under the prefix are delivered (relay DL1), through the Make-shaped subscription |
| TR8 | Interface keys equal the envelope's keys both ways; samples equal the golden envelope; `occurredAt`/`detectedAt` parse as dates with offset |
| TR9 | Delivery repeated with the same envelope (ambiguous retry) yields two bundles with the same `id`; the first output field is `id` |
| TR10 | Attach errors: `400 bad_target_url`, `401`, `403 credential_scope`, `409 subscription_limit` each yield a distinct readable message including the relay code and request id; a non-relay-shaped error body falls back to a status-only message |
| TR11 | Make-flavoured failures against the relay's outbox (fake ingress): `400 Queue is full` and `429` follow the retry schedule and end `failed` after the cap (relay DL3), `410` deletes the subscription and stops attempts (relay DL4), a `302` is a failure with no second request (relay DL7), and other subscribers in the same tick are unaffected (DL5) |
| TR12 | Two webhooks (two scenarios) on the same credential and event get two subscriptions and each receives each event once; deleting one leaves the other receiving |

## 5. Action tests (seam K1)

| ID | Behaviour asserted |
|---|---|
| MA1 | Create Page: body has template path and new path; `collision` only when "unique" chosen, absent otherwise; `201` yields output `{path, urls}`; real relay with fake Admin API creates the source copy (relay AX1) |
| MA2 | Create Page errors: `409 conflict`, `404` template missing, `501 unsupported_for_site`, `403 credential_scope`, `401` each produce the matching readable message |
| MA3 | Preview Page: body is the path verbatim; output `{path, urls, status}`; `404`/`403` mapped |
| MA4 | Publish Page: with "preview first" on the relay previews then publishes in that order (observed at the fake Admin API); with it off only publishes; the off value is sent as `false`, never omitted |
| MA5 | Path pass-through: a hostile matrix (missing leading slash, `..`, encoded traversal, double slash, encoded slash, over-long, control characters) is passed unchanged and the relay answers `400` with no Admin API call (relay AX4); the module shows the readable message |
| MA6 | Scope matrix: a credential with only `events:read` gets `403 credential_scope` from each action and the message names the missing scope |
| MA7 | `429` and `5xx` from the relay are not swallowed: the module reports an error of Make's rate-limit or connection kind as the definition declares; no client-side retry loop exists in the definition |
| MA8 | The module never sets an absolute URL or an `Origin`-like header, and sends only `Authorization`, `Content-Type`, `Accept` (header hygiene) |
| MA9 | Cross-tenant: with two sites and two credentials, an action using credential A never affects site B even when the input path or template refers to B's names (relay CR3 exercised through the module) |

## 6. Relay registration and neutrality tests (seams W1, R1, S3)

| ID | Behaviour asserted |
|---|---|
| RG1 | The relay's default subscriber-host setting equals the documented list: the Zapier host plus exactly the Make hook hosts recorded by S-M1; the README table and the config are parsed and compared |
| RG2 | Subscription URL matrix for Make: accepted: `https://<each allowed host>/<token>`; rejected with `400 bad_target_url` and no outbound request: `http://`, credentials in URL, IP literal, port other than 443, `localhost`, look-alikes (`hook.eu1.make.com.evil.example`, `evil-hook.eu1.make.com`, `hook.eu1.make.com@evil.example`, `hook-eu1.make.com`, punycode, trailing dot), and Make's API and website hosts (for example `eu1.make.com`, `www.make.com`) |
| RG3 | Delivery to a Make host: `Content-Type: application/json`, no `Authorization`, no relay credential, no Admin API key, no inbound headers, redirects not followed; body size far below 5 MB; per-subscription per-tick cap holds when a burst of 500 events is queued (documented against Make's 300 requests per 10 seconds) |
| SC1 | Every route used by the Make definitions is in the relay's connector route table with a scope that matches the module (derived list; R-M3); the README scope table matches the relay's scope constants |
| SC2 | Unauthenticated calls: for every route the definitions use, a request with no, malformed, unknown or revoked credential gets `401` before any handler or outbound call (derived from definitions, so a new module cannot dodge it) |
| SC3 | Secrets hygiene: the relay's wrangler config gains no `secrets.required` entry, no `vars` key looking like a secret, and `.dev.vars.example` is unchanged; no tracked `.env*`; the provider folder contains no Make API key, relay credential or webhook token (pattern scan) |
| SC4 | Provider isolation: relay source contains no vendor-specific logic for Make (no references to Make hostnames or "integromat" outside config, tests, README and fixtures); the provider folder imports nothing from the console or other extensions; a PR-scope check lists any changed file outside the provider folder, the relay host setting, the extension README link and CI config |
| SC5 | The canary property (relay CR8 pattern): across success and every error path, the credential, webhook-token and Make API key canaries never appear in any response, any outbound request to a non-relay/non-Make host, or any log line |

## 7. Deploy script tests (seam K3)

| ID | Behaviour asserted |
|---|---|
| DP1 | Default run is a dry run: it prints the plan and makes zero SDK/network calls; `--live` without `MAKE_API_KEY` or `MAKE_ZONE` fails before any call |
| DP2 | `MAKE_ZONE` is accepted only as a bare hostname from the known zone list; a scheme, path, port or unknown host is refused; secrets are never accepted as arguments |
| DP3 | Order and gating: create private app, confirm it is private (a fake returning public aborts before any section write), then connection, webhooks, modules; every section write is followed by a read-back and an exact comparison; mismatch aborts and reports which section |
| DP4 | Automatic retries are off: an empty or 5xx create response stops with "outcome uncertain: look the app up" and makes no second create |
| DP5 | Throttling: with the fake clock, the call rate stays at or below the configured limit (default under the Core plan's 60 per minute) and a `429` pauses and resumes without duplicating a write |
| DP6 | Never publishes, requests review, creates connections, runs scenarios or calls the provider: the fake client records no such method calls across all modes |
| DP7 | Variant safety: `--relay-base-url` replaces exactly the origin literal, only for an app name marked dev, only for HTTPS; replacing the origin of the production-named app is refused; the report never prints definition contents or the key |
| DP8 | Update path: an existing app is updated section by section without creating a duplicate; unchanged sections are skipped (idempotent re-run) |

## 8. README and repo checks (seam S3)

| ID | Behaviour asserted |
|---|---|
| RD1 | The provider README exists and has the required sections: credentials and scopes (with the module-to-scope table), supported zones and hosts, step-by-step setup, dedupe recipe, errors table, security and data notes, deploy instructions, public-review checklist, statement that no EW site config is read |
| RD2 | The errors table covers every relay error code the definitions can surface; the zone/host table equals the relay config; the scope table equals the relay's scope constants (parsed doc test) |
| RD3 | The extension README links to the provider README and names the extensions-table row as updated; the extensions table row for `automation-connectors` mentions Make; every table row still resolves to a folder and entry page (#7 UR4) |
| RD4 | `.hlxignore` still hides `**/providers/**`, `**/worker/**`, `**/test/**` (no Make files are served from the code bus) |

## 9. CI additions (no Make account, no Cloudflare or EW login)

| Job | Steps | Notes |
|---|---|---|
| `make-app` | checkout, Node >= 22.12, `npm ci` in `providers/make/`, run K2, K1, K3 and RD tests | every push and PR; deploys nothing; the Make API key never exists in CI |
| `relay-unit` (existing, #7) | adds RG1 to RG3 and SC1 to SC5 (they need the relay worker) | same job or a `make-registration` step; implementer's call |
| `lint` (existing) | lints the deploy script and test code with the helix config; JSON definition files are covered by K2, not ESLint | |
| `unit` / `e2e` (existing) | unchanged | no browser code added |

## 10. Live verification inside real Make and EW (manual; needs EW login, Cloudflare, a Make test org)

**Accounts and credentials needed:** everything in #7 section 6 (GitHub admin, Adobe IMS identity with config access, hlx6 test site, Admin API key `publish` with short expiry, Cloudflare account and plan, deployed relay with D1 and `KEY_ENCRYPTION_KEY`); a **Make organisation** (zone and plan checked for custom apps and instant triggers) and a user able to create apps; a **Make API key** with `sdk-apps:read` and `sdk-apps:write` (profile settings, API access) kept only in a local `.env.local`; a tunnel tool for `ref=local`; for the parity scenario, a Slack workspace and test channel; for the dependency-free sink, a Make Data store. Chrome for EW. Never paste a token, Admin key or relay credential into a ticket, PR or chat.

| Step | What to do | Expected | Proves |
|---|---|---|---|
| **L0 (prereq)** | Relay deployed (#7 M0); console issues a credential with all four scopes; Make API key created; `npm ci` in the provider; deploy script dry-run prints the plan | dry-run makes no call | AC3 setup |
| **L1 (spikes S-M1 to S-M9)** | Run and record: real hook hosts per zone, attach/detach lifecycle, Origin and egress view at the relay, ingress codes, empty-value semantics, plan limits, `baseUrl` expression support, envelope intake | notes in the PR; README, fixtures and allowlist updated | AC1, AC4 inputs |
| **L2 (upload dev app)** | Create a tunnel to the local relay (`wrangler dev`, local D1, real Admin API); run the deploy script `--live` for the dev app with `--relay-base-url` = the tunnel origin; read back reports success | app visible as *Private* in the test org; every section read back equal | AC3 |
| **L3 (`ref=local`, end to end)** | Console `?ref=local` (page `localhost:3000`, relay `localhost:8787`): issue credential; in Make create a scenario with the dev app: connection (paste credential; label shows `org/site`), trigger Watch Page Published → Data store add record (id, path, user); save and activate; in EW preview then publish a page on the test site; trigger the local relay's tick (scheduled test hook) | one Data store record within the documented latency; relay console shows the subscription and a delivered outcome; repeat tick sends nothing new | AC1, AC3, AC6 |
| **L4 (branch ref, end to end)** | Push branch `make-provider`; open the console at `?ref=make-provider` against the deployed relay; upload the production-variant private app (`--live`, production origin); build the same scenario, plus a Slack message module for parity; publish a page | Slack message (and record) within about two minutes; page `Origin` seen by the relay recorded | AC3, AC6 |
| **L5 (triggers)** | Repeat L4 for Page Previewed and Page Updated (edit and save in DA, wait the scan interval); set a path prefix and publish pages inside and outside it | each trigger runs for its event only; prefix filters | AC1 |
| **L6 (actions)** | Scenario: Create Page from Template → Preview Page → Publish Page for a template path and a new path; open the new page in EW and on the live URL; rerun to see the conflict message; switch to "create unique name"; run with a credential lacking `pages:publish` | page created, previewed and published as normal EW events; conflict and scope messages are readable and include the request id | AC2 |
| **L7 (lifecycle)** | Delete the webhook in Make, then a scenario, then deactivate another; check the relay console's subscription list after each; clone a scenario | record which actions call detach; subscriptions removed where Make detaches; anything orphaned is documented in the README; deliveries to a removed webhook end by `410` or failure, not by flooding | AC1, R3 |
| **L8 (duplicates and burst)** | Publish the same page three times quickly; observe records; force an ambiguous delivery (fake slow ingress locally) | three distinct events, no duplicates under normal operation; a resent event carries the same `id` and the README recipe drops it | AC1 |
| **L9 (secrets and rejection)** | Search the Make connection UI, scenario execution logs and relay logs for the credential and for a webhook token; `curl` every relay route the app uses without a credential, with a revoked one, and with a browser `Origin` | credential masked in Make UI and logs; unauthenticated calls `401`; `Origin` calls `403`; webhook URL token masked in the console | AC7 |
| **L10 (errors)** | Revoke the credential in the console while a scenario is active; stop the relay; let the Admin key expire in a test site | connection test and modules fail with readable messages; no scenario is stuck in an infinite retry; relay status shows the cause | AC2, AC7 |
| **L11 (review dry run)** | Walk the README's public-review checklist against https://developers.make.com/custom-apps-documentation/app-review/prerequisites.md; list the blockers (domain, trademarks, universal module, test scenarios) without requesting review | checklist recorded; no review requested | README (AC5) |

## 11. Acceptance-criteria traceability (ticket #8)

| # | Acceptance criterion (#8) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Make instant triggers (published, previewed, updated) are fed by the relay's subscription API | SD2, SD8, TR1 to TR12 (attach/detach through `POST/DELETE /v1/hooks`, full chain relay → Make ingress → bundle, filters, duplicates, failure policy), RG1 to RG3 (Make hosts accepted and delivered to), relay SB/DL suites run with Make-shaped URLs | **L3**, **L4**, **L5** (live triggers), **L7** (lifecycle), **L8** (dedupe), spikes S-M1, S-M2, S-M4 |
| AC2 | Make modules: create page from template, preview page, publish page | SD8, MA1 to MA9 (bodies, collision and boolean handling, outputs, error mapping, scope and tenancy), SC1 | **L6** (live actions), **L10** (error cases) |
| AC3 | A live scenario works end to end in a test Make org | TR5 and DP1 to DP8 prove the same chain and the upload with fakes only | **L0 to L4** (the live scenario itself: dev app upload, connection, trigger → Data store/Slack, EW publish) |
| AC4 | Added inside the existing `automation-connectors` extension folder as a new provider; no changes needed in the extension shell beyond registering the provider | SC4 (isolation and PR-scope check), RG1 (the registration is the host setting), RD3 (links), RD4 (nothing served) | Review: the PR diff touches only the provider folder, the relay host setting, the README link/description and CI; walk the provider README on a clean clone |
| AC5 | Extension README documents this vendor's setup (credentials, site config keys) | RD1, RD2 (required sections; scope, host and error tables equal code constants; "no EW site config read" statement) | **L11**; walk the README once on a clean clone with a fresh Make org (setup steps reproduce L3/L4) |
| AC6 | Works in EW with `ref=local` and with a branch ref | CX5 (origin constant), DP7 (dev variant safety), reuse of #7 UI7 and E2E1 for the console paths | **L3** (`ref=local`: local relay + tunnel + dev app), **L4** (branch ref: deployed relay + production-variant app); record the page `Origin` the relay sees |
| AC7 | Vendor credentials live only in this extension's worker (built from the shared worker template); the browser never receives them; unauthenticated calls to the worker are rejected | SD5, SD6, SD7, CX1 to CX3, SC2 (every route used by the app rejects unauthenticated calls), SC3 (no new secret in the worker; hygiene), SC5 (canaries), DP2 and DP6/DP7 (deploy key never in args, reports or repo) | **L9** (secret search in Make UI/logs and relay logs; live rejection matrix); review: no Make secret in the worker config |
| AC8 | Core logic covered by unit tests; lint and CI green | all tiers above (SD, CX, TR, MA, RG, SC, DP, RD); CI jobs `make-app`, `relay-unit`, `lint` | Review: CI green on the PR; mutation check on a scratch branch (add a wildcard host, drop `previewFirst:false`, add an absolute URL to a module) and see RG2, MA4, SD3 fail |

Every acceptance criterion on #8 maps to at least one automated test or a numbered manual verification step above.

## 12. Self-check against #46's acceptance criteria

- `apps/automation-connectors/providers/make/` exists and contains `SPEC.md`: yes.
- Follows the to-spec template (Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes) and adds Build Analysis and Testing Requirements: yes.
- Every #8 acceptance criterion mapped to a test or verification step: section 11.
- External API claims cite primary-source URLs; unverified items marked [ASSUMPTION] or [OPEN]: yes (community-post hostnames are flagged as non-primary).
- No implementation code written: this file only.

## 13. Open questions for the owner

1. **Make account and ownership.** Which Make organisation, zone and plan hosts the test, and who owns the Make account under which the private app is created (personal vs an Adobe-provided one)? Does the plan allow custom apps and instant triggers (S-M6)? Is the Adobe outside-activity/IP policy answer (#1 R1, #7 OQ3) in place before anything is shared?
2. **Private only, or publish by invite link / public review?** Publishing is irreversible and freezes components [VERIFIED]. This spec stays private. Do you want a published invite-link app, or a public listing, and if so when?
3. **Relay hostname.** `workers.dev` or a custom domain? Make's review prerequisites reject service domains on generic platform hosts [VERIFIED rule; whether `workers.dev` counts is ASSUMPTION], and the connection's relay origin is a constant in the app.
4. **App and module names.** Working name "EW Automation"; "Adobe" and "Experience Workspace" are Adobe marks and Make review requires trademark compliance [VERIFIED: https://developers.make.com/custom-apps-documentation/app-review/request-app-review.md]. Final name and module labels (they cannot be removed once public, only renamed/hidden)?
5. **Trigger set.** Ship exactly the three triggers in #8, or add *Page Unpublished* now (relay already emits it; same as #7 OQ11)?
6. **Universal module and review items now?** Add the relative-path "Make an API Call" module and limit/pagination conventions in v1 so a later review is smaller, or defer to when a review is requested?
7. **Test strategy.** Accept the restricted IML simulator (seam K1) as the unit-test seam for a declarative app, with live scenarios as the authority on Make's own behaviour, or prefer structure-only assertions plus live checks?
8. **Deploy tooling.** SDK script as specified (pin `@makehq/sdk`: the skill's tested baseline `1.8.1`, or npm's current `1.17.0`)? Vendor the Make editor schemas or fetch at a pinned commit? Is a repo-owned definition set uploaded by script acceptable versus editing in Make's web editor?
9. **`ref=local` mechanism.** Tunnel plus a dev app variant (this spec), or deploy a separate staging relay and a staging app version? Which tunnel tool?
10. **Credential granularity.** One credential per Make connection with the scopes the scenarios need (this spec), or a console preset "Make (all scopes)"? One connection per EW site?
11. **Requests on #7 (R-M1 to R-M4).** Accept masking of subscriber URL tokens in the console and logs, a machine-readable route/scope table in the contract folder, empty-string-as-absent, and the per-slot documentation as changes to the #7 build (so the shell change stays "registration only")?
12. **Live scenario sink.** Slack for parity with #7's live Zap, Data store as the dependency-free sink, or both? Which accounts exist?
13. **Personal data in Make.** Events carry the acting user's email when the log has it, and Make keeps webhook logs for 3 days (30 on Enterprise). Keep, hash or omit by default (same as #7 OQ13)?
14. **Which Make zones to support.** All of `eu1`, `eu2`, `us1`, `us2` (and Celonis zones), or only the owner's zone for the private phase? The allowlist is exact hostnames, so each zone is an explicit entry after S-M1.
15. **At-least-once.** Accept that Make scenarios must de-duplicate on `id` for ambiguous retries (same as #7 OQ6), documented with a Data store recipe, rather than a stricter guarantee the relay cannot give?
16. **Stopped or full scenarios.** If a scenario is inactive or its queue is full, Make answers `400 Queue is full` and the relay retries to exhaustion. Want a relay-level auto-pause after repeated 4xx (a #7 feature), or is the bounded retry enough?
17. **Make already has an AEM app?** If Make lists an Adobe Experience Manager or EW app, a public review ("service not already available in Make") changes shape; I could not confirm either way.
18. **Operations cost.** Each trigger run and action consumes Make operations on the owner's org; is a dedicated test org with a spend cap preferred?
