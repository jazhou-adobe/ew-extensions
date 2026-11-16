# Spec: Slack / Teams Approvals: Slack (relay + first chat tool)

Ticket: jazhou-adobe/ew-extensions#20 (this spec: #58). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). Blocks #21 (Microsoft Teams; its spec task #59 reads this file and must stay consistent with the **provider interface** defined below).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe / Slack / Cloudflare.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/` (type decided by its EW config-sheet row); *worker* = the per-extension backend in `apps/<name>/worker/`, built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. Additions for this ticket: *Request Publish* = Adobe's approval workflow (plugin + Publish Requests Inbox app + Adobe-managed backend worker); *relay* = this extension's worker acting as the Request Publish **email-provider API**; *chat provider* = a vendor module (Slack now, Teams in #21) that delivers a normalized notification into a chat tool; *notification event* = the vendor-neutral record the relay derives from one inbound email payload.

---

## Problem Statement

Approvers in the Request Publish workflow only learn about a pending request from an **email**. Request Publish's own docs say so: "The designated approvers receive an email notification with a link to review the content" ([Request Publish](https://www.aem.live/docs/ew/administering/request-publish)). Many teams live in Slack. A publish request that sits in an inbox unseen blocks the author, and the approver has to context-switch (email, open Experience Workspace, find the Publish Requests Inbox) just to see what the change is. Contentful's marketplace features Slack and Teams approval apps, so this is a visible gap ([marketplace reference from the ticket](https://www.contentful.com/marketplace/apps/); not fetched, ticket reference only).

Request Publish is not extensible from the outside in the obvious ways. Its backend worker (`publish-requests-worker`, repo `cloudadoption/publish-requests-worker`) is **not publicly readable** (GitHub API returned 404 on 2026-11-16), is "managed by Adobe and provisioned per customer" (docs), and the plugin and inbox are thin clients of it ([plugin README](https://github.com/adobe-rnd/aem-apps/blob/main/tools/plugins/request-for-publish/README.md), [inbox README](https://github.com/adobe-rnd/aem-apps/blob/main/tools/apps/publish-requests-inbox/README.md)). The one documented extension point is the customer-supplied **email provider API** (`apiUrl` + `x-auth-api-key` header, SendGrid-style JSON payload).

Approving is also not a simple API call. In the inbox, **Approve & Publish** (1) publishes the page client-side with the approver's own IMS session through the AEM Admin API, then (2) calls `POST /api/requests/approve` on Adobe's worker with the approver's IMS token, which records the approval and emails the author. A Slack button click carries no Adobe identity, so a Slack-side "Approve" cannot do either step as the approver (details in Build Analysis section 3).

## Solution

Ship one self-contained extension, `chat-approvals`, with three user-visible parts:

1. **A relay worker that is the Request Publish email-provider endpoint.** The customer points the Request Publish `apiUrl` at the relay. For every notification Adobe's worker would have sent as email, the relay (a) **forwards the email unchanged** to the customer's real email provider if one is configured (so email keeps working), and (b) parses the payload into a vendor-neutral notification event and **fans it out to chat providers**.
2. **A Slack provider (first chat tool).** A "publish requested" event becomes a Slack message (to a mapped channel, to each approver by DM, or both) showing the page, author, note, and **Preview**, **Diff** and **Inbox review** links, with **Approve** and **Reject** buttons. Because a Slack identity cannot be safely bound to an Adobe approver (decision 6), both buttons **deep-link into the Publish Requests Inbox** review page, where the approver acts as themselves. When the workflow's outcome email (approved / rejected) reaches the relay, the relay **posts the outcome into the same Slack thread** and updates the original message so the buttons stop inviting action.
3. **A small admin app in Experience Workspace** (a fullscreen app, registered as an `apps` sheet row) where a site admin connects the Slack workspace (OAuth install handled by the worker), maps approvers/paths to channels, and sends a test message. The app is provider-agnostic and renders whatever providers the worker reports, so Teams (#21) only adds a provider.

Slack request signatures are verified, the Slack bot install (OAuth v2) is completed by the worker, all vendor credentials (Slack signing secret, client secret, bot tokens, relay API key, upstream email key) live only in the worker, and every route is closed to unauthenticated callers using the authenticator that suits the caller (IMS token for the browser, shared key for Adobe's worker, Slack signature for Slack).

## User Stories

Site admin (the person who sets this up for an EW org/site):

1. As a site admin, I want an app in my Experience Workspace Apps menu for chat approvals, so that I can set it up without leaving EW.
2. As a site admin, I want a "Connect Slack" button that walks me through Slack's install consent, so that I do not copy tokens by hand.
3. As a site admin, I want to see whether Slack is connected, which workspace it is, and when it last failed, so that I know the integration is healthy.
4. As a site admin, I want to map content path patterns to Slack channels, so that the right team sees the right requests.
5. As a site admin, I want to choose between channel delivery, per-approver DMs, or both, so that I can balance visibility against noise.
6. As a site admin, I want approvers matched to Slack users automatically by email, so that I do not maintain a second directory.
7. As a site admin, I want to override the email-to-Slack-user match for specific people, so that edge cases (different Slack email, shared mailbox) work.
8. As a site admin, I want to send a test message from the app, so that I can verify channel permissions before real requests arrive.
9. As a site admin, I want the app to tell me exactly which URL and key to give my Adobe contact for the Request Publish email provider, so that onboarding is copy-paste.
10. As a site admin, I want to disconnect Slack (revoke and delete the stored token), so that I can offboard cleanly.
11. As a site admin, I want only people with write access to the site config to change these settings, so that an ordinary author cannot redirect approvals.
12. As a site admin, I want email to keep working while chat is added, so that I can adopt chat gradually.
13. As a site admin, I want chat-only mode (no upstream email provider), so that a sandbox needs no email account.
14. As a site admin, I want clear, short setup docs in the extension README (setup, the config-sheet row, the Request Publish values), so that I can do this alone.

Approver (in Slack):

15. As an approver, I want a Slack message when a request needs me, so that I see it without checking email.
16. As an approver, I want to see the page path, who asked, and their note in the message, so that I can triage at a glance.
17. As an approver, I want Preview, Diff and Review links in the message, so that I can judge the change before approving.
18. As an approver, I want an Approve button that takes me straight to the request's review screen, so that I can publish as myself in two clicks.
19. As an approver, I want a Reject button that takes me to the same review screen, so that I can reject with a reason as myself.
20. As an approver, I want to be @-mentioned only if I am actually an approver, so that I am not pinged for others' requests.
21. As an approver, I want a reminder in the same thread when the author resends, so that my channel does not fill with duplicates.
22. As an approver, I want the thread to show the outcome (approved/published with the live link, or rejected with the reason), so that everyone in the channel knows it is done.
23. As an approver, I want the original message's buttons to disappear once the request is closed, so that I do not click a dead request.
24. As an approver who is not in Slack, I want to still get the normal email, so that I am not left out.
25. As an approver, I want a stale request link to land on the inbox's "No Pending Request" page rather than anything destructive, so that old messages are harmless.

Author:

26. As an author, I want my submission to reach approvers in the chat they actually read, so that approval is faster.
27. As an author, I want my note shown to approvers exactly as text (never as Slack formatting or mentions), so that my note cannot ping the whole channel by accident.
28. As an author, I want to still receive the normal approved/rejected email, so that the existing workflow is unchanged.

Maintainer / operator:

29. As the maintainer, I want Slack request signatures verified before anything else happens, so that nobody can forge approvals traffic.
30. As the maintainer, I want the email endpoint to require a shared key and reject everything else, so that the internet cannot post into my customers' channels.
31. As the maintainer, I want Slack tokens encrypted at rest and never returned by any route, so that a storage leak is not a credential leak.
32. As the maintainer, I want all secrets only in the worker's secret store, so that the browser, the repo and logs never contain them.
33. As the maintainer, I want chat delivery failures to never fail or delay the email, so that a Slack outage does not block publishing workflow mail.
34. As the maintainer, I want unrecognised email payloads forwarded as email only and logged without their bodies, so that a format change degrades to "email only" instead of garbage in Slack.
35. As the maintainer, I want Slack rate limits and `Retry-After` honoured, so that the app is not throttled or disabled.
36. As the maintainer, I want a revoked or uninstalled Slack app to be detected (events and API errors) and surfaced as "reconnect needed", so that failures are not silent.
37. As the maintainer, I want one structured log line per inbound request with no tokens, secrets, email bodies or Slack payload secrets (`response_url`, `trigger_id`), so that debugging does not create a leak.
38. As the maintainer, I want the free Cloudflare plan to suffice for a small team, so that cost is zero until real usage.
39. As the maintainer, I want the Slack app definition kept in the repo as a manifest, so that dev and prod Slack apps are reproducible.
40. As the maintainer, I want the Slack scopes in the manifest, code and README to be checked equal in CI, so that they cannot drift.

Extension author (Teams ticket #21 and later providers):

41. As the author of the Teams provider, I want a documented provider interface (recipients, deliver, update, reply, install, routes, descriptor), so that I add one folder and register it.
42. As the author of the Teams provider, I want core code with no provider names in it (machine-checked), so that adding Teams cannot require editing the relay.
43. As the author of the Teams provider, I want a provider conformance test suite and a fake provider, so that I can prove my provider before touching a real tenant.
44. As the author of the Teams provider, I want provider-private storage namespaces, so that conversation references and tokens of two providers never collide.
45. As the author of the Teams provider, I want recipient resolution to be the provider's job (Teams cannot address users by email), so that the core never assumes email addressing.
46. As the author of the Teams provider, I want the admin app to be descriptor-driven, so that no browser change is needed beyond registering my provider.

Security reviewer:

47. As a security reviewer, I want proof that a forged Slack request (wrong secret, tampered body, old timestamp) is rejected before any handler or Slack call, so that "signatures are verified" is tested.
48. As a security reviewer, I want proof that an unauthenticated call to every route is rejected with no side effects, so that the worker is not an open relay.
49. As a security reviewer, I want proof that author-controlled text (note, path, emails) cannot inject Slack mentions or links, so that the relay is not a phishing amplifier.
50. As a security reviewer, I want proof that only allow-listed link hosts appear on buttons, so that an attacker with a stolen relay key cannot plant arbitrary links.
51. As a security reviewer, I want proof that a canary of every secret never appears in any response or log, so that "never echoed" is tested rather than promised.

## Implementation Decisions

(No file paths or code, except where noted. Paths and layout are in the Build Analysis.)

1. **Integration path: the relay is the Request Publish email-provider endpoint.** This is the candidate approach in the ticket and the only documented extension point of Request Publish [VERIFIED: https://www.aem.live/docs/ew/administering/request-publish, Step 1: customer supplies `apiUrl`, `apiKey` (sent as `x-auth-api-key`), `fromEmail`, `fromName`; "your custom API should support the following payload format" with `personalizations[].to/cc/subject`, `from`, `content[].type/value`]. The relay is onboarded the same way any email provider is: the Adobe engineering contact registers the site with the relay's URL and key. Alternatives considered and rejected: (a) polling the requests sheet `/.da/publish-workflow-requests.json` (needs a user token or a service identity; neither exists for a background job); (b) forking or extending Adobe's worker (private, Adobe-managed); (c) the Assistant/MCP path (`aem-agentic-plugins`) which serves chat inside EW, not Slack; (d) browser-side hooks in the plugin (plugin is Adobe's code, not ours).
2. **The relay must keep email working.** Because the relay replaces the email provider, it **forwards every inbound payload unchanged** to a configured upstream provider when one is set (config: upstream URL; secrets: upstream key; header name and scheme configurable because "SendGrid-style" providers use `Authorization: Bearer` while the Adobe doc's example uses `x-auth-api-key`) [ASSUMPTION: upstream providers accept the same payload; Twilio SendGrid's `mail/send` is the reference shape: https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send, not fetched]. With no upstream configured the relay runs in **chat-only mode** and answers `202` after validating the call (decision 5). Email forwarding uses the template's proxy helper: secret injected by name, host on the route allow-list, POST retried on `429` only by default (avoids duplicate email on 5xx; this matches #2 decision 8).
3. **Email is the system of record for the event; chat is best-effort.** The email response status depends only on the upstream result (or `202` in chat-only mode). Chat fan-out runs after the email is handled, as background work with the platform's post-response extension (`ctx.waitUntil`, capped at 30 s after the response per https://developers.cloudflare.com/workers/runtime-apis/context/ [VERIFIED]); a Slack failure is logged and surfaced in admin status, never returned to Adobe's worker.
4. **Authentication is per route, always fail-closed.** The template (#2) allows only IMS bearer tokens and has no unauthenticated routes. This extension needs three more caller types, each of which is also authenticated: the email endpoint (shared key in `x-auth-api-key`, constant-time compare, key is a worker secret); Slack routes (HMAC-SHA256 signature over `v0:{timestamp}:{raw body}` with the signing secret, 5-minute timestamp window [VERIFIED: https://docs.slack.dev/authentication/verifying-requests-from-slack]); and the OAuth redirect callback (a signed, expiring `state` created by an authenticated admin call). Browser-facing admin routes keep the template's IMS validation + CORS + optional `authorize` hook. A request to any route with no valid credential for *that route's* authenticator gets `401` before any handler, store access or outbound call. This needs a small, backwards-compatible template extension (named authenticators per route); see Build Analysis section 7 and Open Question 1.
5. **Event derivation from the email payload (the highest-risk part).** The email payload has no structured fields for org, site, path, or event kind: only recipients, a subject, and HTML. The parser therefore derives a notification event from (a) `personalizations[].to/cc`, (b) links in the HTML body (Inbox review link with `org`, `site`, `path` query parameters; preview, diff and live links), (c) subject/body markers for the event kind (`requested`, `reminder` for resend, `approved` possibly consolidated across several pages, `rejected` with reason, `withdrawn`). Evidence for the link shape: the inbox accepts `org`, `site`, `path` (and, in v1, `author`, `preview`, `comment`) as URL parameters and is opened "from an approval-email link with a path" [VERIFIED: inbox README]; v2 ignores `author`/`preview`/`comment` and builds links from site and path [VERIFIED: https://github.com/adobe-rnd/aem-apps/blob/main/tools/apps/publish-requests-inbox-v2/README.md]. That the emails actually carry these links, and the subject/body markers, are **[ASSUMPTION] until real payloads are captured** (build plan step 13, manual check MV4). Design consequences: the parser is a pure, table-driven module with **fixtures captured from the real worker**; an unrecognised payload is classified `unknown`, forwarded as email only, and logged without its body; no chat message is ever built from guessed fields.
6. **Approve / Reject are deep links, not in-Slack actions. Identity cannot be bound safely.** Evidence: in the inbox, approving = client-side `POST https://admin.hlx.page/live/{org}/{site}/main/{path}` under the approver's IMS session, then `POST /api/requests/approve` to Adobe's worker with the approver's IMS bearer token; rejecting = `POST /api/requests/reject` the same way; the worker "derives identity from the token" and the plugin/inbox never send an approver email [VERIFIED: inbox `api.js` and README, https://github.com/adobe-rnd/aem-apps/blob/main/tools/apps/publish-requests-inbox/api.js]. A Slack click proves a Slack user id only. Linking Slack to an Adobe identity would at best bind a Slack id to an email; it still would not yield an IMS token, and storing users' IMS tokens in a relay is an unacceptable credential store. Using a Helix Admin API key with the `publish` role ([VERIFIED: https://www.aem.live/docs/admin-apikeys]) would let the relay publish, but as a service identity that bypasses Adobe's per-approver checks and still could not call the approve endpoint (it requires an approver IMS token). So both buttons are Slack **link buttons** (`url`) to the inbox review view (labels make that explicit: "Approve in Inbox", "Reject in Inbox"). This is the fallback the ticket's acceptance criterion names; it is the shipped behaviour, not a placeholder. Slack still sends an interaction payload for link buttons and requires an acknowledgement within 3 seconds [VERIFIED: https://docs.slack.dev/reference/block-kit/block-elements/button-element, https://docs.slack.dev/interactivity/handling-user-interaction], so the relay implements the interactivity endpoint as signature-verify + empty `200`. Reconsideration conditions (not built): Adobe offers a delegated-approval / token-exchange API, or the EW team confirms a supported service identity.
7. **Outcome is posted back by observing the outcome email.** Since approval happens in the inbox, Slack cannot know the result from a click. After approving/rejecting, Adobe's worker emails the author (and, on reject, others) through the same `apiUrl` [VERIFIED: inbox README use cases 3 and 6: worker emails the author on approve; rejection reason emailed to author and DigiOps]. The relay classifies those emails, correlates them to the earlier request by key (provider, org, site, normalized path), and for each open thread posts a reply (approved: live link; rejected: reason) and rewrites the original message without the action buttons. Approval emails can be **consolidated per author across several pages** [VERIFIED: inbox README use case 3], so one email can close several threads. No match, no thread: nothing is posted (logged). A request closed by withdrawal or reject-by-others with no email leaves buttons until the record's TTL; they are harmless because the inbox shows "No Pending Request".
8. **One thread per (org, site, page).** Request Publish allows one pending request per page ("You can only have one pending request per page") [VERIFIED: docs]. The thread record maps that key to one or more Slack message references (one per delivery target: channel and/or each DM). A resend produces a **reminder reply** in the existing thread, not a new top-level message. Identical payloads within a short window (Adobe retries) are de-duplicated by a payload hash.
9. **Recipients.** Approvers (`to`) are resolved to Slack users **by the provider** (Slack: `users.lookupByEmail`, scope `users:read.email`, Tier 3 limit 50+/min; returns `users_not_found` for unknown or deactivated users) [VERIFIED: https://docs.slack.dev/reference/methods/users.lookupByEmail]. Resolution results are cached; an admin override table (email to Slack user id) wins. Unresolved approvers are shown as plain text without a mention. CC recipients are listed as text and are not DM'd (a per-site switch may enable it). Delivery modes per site: `channel` (post to the channel mapped for the page path, mentioning resolved approvers), `dm` (one DM per resolved approver), `both`. Default: `channel` when a path rule matches, otherwise `dm`. A hard cap on DM fan-out (default 15) protects the 50-subrequest Free-plan limit (Free plan allows 50 subrequests per invocation, per #2 R7 and https://developers.cloudflare.com/workers/platform/limits/) and Slack's one-message-per-second-per-channel guidance [VERIFIED: https://docs.slack.dev/apis/web-api/rate-limits].
10. **Slack app model: single-workspace app per deployment, not a distributed Marketplace app.** Each deployment (dev, prod) has one Slack app (created from a manifest kept in the repo) with its own signing secret and client credentials as worker secrets. OAuth v2 install yields a bot token (`oauth.v2.access`); Slack bot tokens do not expire unless token rotation is enabled [VERIFIED: https://docs.slack.dev/authentication/installing-with-oauth, "OAuth tokens do not expire"]. Distribution (Marketplace review, multi-tenant secrets) is out of scope. Scopes (required): `chat:write` (post/update), `users:read.email` and `users:read` (match approvers). Optional: `channels:read`/`groups:read` for a channel picker, `chat:write.public` to post into public channels without being invited [ASSUMPTION: scope semantics beyond the cited method docs not read; confirm in https://docs.slack.dev/reference/scopes]. Without `chat:write.public` the bot must be invited to the channel (`not_in_channel`) [OPEN].
11. **OAuth install flow runs through the worker.** The admin app calls an authenticated worker route; the worker checks the caller may configure the site (decision 15) and returns a Slack authorize URL carrying a signed, expiring `state` (bound to org, site and the caller's user id) and the worker's HTTPS `redirect_uri` (must be HTTPS and registered in the Slack app [VERIFIED: installing-with-oauth]). The app opens it in a new tab. Slack redirects to the worker's callback; the worker verifies `state`, exchanges the temporary `code` (10-minute lifetime, single use) via `oauth.v2.access` with the client secret injected by the proxy helper, checks the granted scopes, stores the bot token **encrypted at rest** (AES-GCM with a worker-secret key) keyed by Slack team id, and binds the team to org/site. The callback returns a small HTML page (workspace name, "you can close this tab"), never a token. `access_denied`, bad `state` and Slack errors produce a generic message and store nothing. Re-install replaces the token; "Disconnect" calls `auth.revoke` and deletes the record. `app_uninstalled` / `tokens_revoked` events delete the record [ASSUMPTION: event names per Slack's events catalogue, https://docs.slack.dev/reference/events, not read; to confirm].
12. **Provider interface (contract for #21).** The relay core knows only a `ChatProvider` contract; it contains no provider names. A provider module supplies: an id and display name; a **descriptor** for the admin app (connection status, how to connect, settings fields); its own **routes** (e.g. `/slack/*`) each naming an authenticator the provider also supplies; `beginInstall`; **recipient resolution** (the provider decides how to turn an approver email into an addressable recipient: Slack by `users.lookupByEmail`; Teams cannot address users by email or UPN and needs the Entra object id from Graph or a stored conversation reference [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages]); `deliver(event, plan)` returning opaque message references; `update(reference, event, status)` and `reply(reference, text)`; `disconnect`. Providers classify their own failures into three kinds the core understands: `retryable`, `permanent`, `install_revoked`. Providers treat every string in an event as untrusted and escape for their own markup. Storage is namespaced per provider. Adding Teams = a new provider folder + one registration line in the worker entry; no browser change (the admin app renders descriptors). Full table in Build Analysis section 5.
13. **Storage: Workers KV, with an encrypted-at-rest rule for tokens.** Stored: Slack installation records (encrypted token, team id, org/site binding, scopes), per-site mapping config, thread records (key to message references plus the minimal event needed to re-render; TTL 30 days), approver-to-Slack-id cache (TTL 24 h), dedupe hashes (TTL minutes), OAuth state nonces are stateless (signed). KV is eventually consistent (changes can take 60 s+ to be visible in other locations) and Free allows 1,000 writes/day [VERIFIED: https://developers.cloudflare.com/kv/concepts/how-kv-works/, https://developers.cloudflare.com/kv/platform/limits/]. This is acceptable because thread lookups happen minutes after the thread is written; strongly consistent needs (single-use `state`) are met statelessly. Roughly 2 to 4 writes per request keeps a small team inside the Free tier [ASSUMPTION: usage]. D1 or a Durable Object is the documented fallback if consistency bites [OPEN: Question 5]. #2 lists KV as out of scope *for the template*; this extension needs the binding exposed to handlers (Question 1).
14. **Mapping configuration lives in the worker, edited through the admin app.** The email callback has no user token, so the relay cannot read the DA site config (`admin.da.live/config/...` needs a caller token). Therefore channel mapping and delivery mode are stored in worker KV and edited via authenticated admin routes. The extension reads **no EW site config** itself; it depends on the Request Publish tabs (`publish-workflow-config`, etc.) only indirectly, through the approvers Adobe's worker puts in the email. The README states this (AC5 "site config it reads").
15. **Who may configure.** An admin route is allowed only if the caller has write permission on the site's DA config. The worker asks DA: `GET https://admin.da.live/config/{org}/{site}/` with the caller's token; DA answers `403` without config read permission [VERIFIED: https://github.com/adobe/da-admin/blob/main/src/routes/config.js, `hasConfigPermission`], and exposes an `X-da-actions` header on responses [VERIFIED: da-admin `daResp.js` exposes it in CORS]. Using that header to prove `write` on the config route is **[ASSUMPTION]**; fallback is read access plus an allowlist of IMS user ids as a worker variable. This forwards the caller's token to `admin.da.live` only (the service that accepts it), an explicit, single-host exception to #2's "token never forwarded" rule [OPEN: Question 7].
16. **Message content and safety.** Fields shown: page path, org/site, author, note (truncated, text only), approvers/CC (mentions only from resolved ids), and links. Every untrusted string is escaped for Slack (`&`, `<`, `>` as HTML entities, per https://docs.slack.dev/messaging/formatting-message-text [VERIFIED]) so a note containing `<!channel>`, `<@U…>` or `<https://evil|text>` renders as literal text. Link buttons and inline links are emitted only if the host is on an allow-list derived from the event's own org/site (`da.live`, `{ref}--{site}--{org}.aem.live/.aem.page`, `*.preview.da.live`, `tools.aem.live`); anything else is dropped and logged. The inbox link comes from the email; a configured inbox base is the fallback [ASSUMPTION: URL form from the docs' `apps` row `/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox/publish-requests-inbox` plus the README's `org`/`site`/`path` parameters]. Messages always carry a plain-text `text` fallback for notifications and screen readers (Slack's own guidance, https://docs.slack.dev/reference/methods/chat.postMessage). Block text and button-label length limits are respected (button text max 75, url max 3000 [VERIFIED: button-element doc]).
17. **Admin app (browser).** A fullscreen app registered as an `apps` row. It awaits the SDK, sends `Authorization: Bearer <SDK token>` to a **constant** worker origin (never from the URL; #2 decision 13), shows provider cards from the worker's descriptors (status, connect/disconnect, settings), the mapping editor, the test-message button, and the values to give the Adobe contact (relay URL; the key is never shown). Standalone (no SDK) state as in #1. All values rendered as text. No library plugin is delivered (the Request Publish plugin remains Adobe's).
18. **Teams-readiness is verified, not asserted.** A fake second provider is registered in tests and the conformance suite runs for both providers; a repo check fails if provider names appear in core code or the admin app (Testing section, PV and UR groups).
19. **Tooling and conventions follow #1 and #2** (decided by owner): ESLint 8 + helix config, Stylelint 16, `@web/test-runner` for browser code, `node:test` for worker code, Playwright, Node 22 (>=22.12 for wrangler 4), husky. Tests live inside the extension folder. Worker built from `shared/worker-template/`, extended per Build Analysis section 7. Vendor code under `providers/slack/`, with server code in `providers/slack/worker/` (per #2 decision 3, which is itself [OPEN] there).
20. **Deploy is manual in this ticket** (#2 decision 15). Separate `dev` and `prod` worker environments, each with its own Slack app, secrets and KV namespace.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only. For the worker: given a `Request` (headers, body) and a fake outside world (fake IMS, fake Slack Web API, fake upstream email provider, fake DA admin, in-memory KV), assert the `Response`, the outbound calls (host, path, headers, body, count, order, timing), the persisted records (as seen through later requests), and the logs. Never assert on internal function names, module structure or call counts of internals. For the admin page: assert DOM text and which worker calls the page makes. Two negative properties are tested across **every** path: "every secret canary never appears in any response, header or log" and "no handler, store access or outbound call runs before the route's authenticator succeeds".

**Proposed seams** (recorded here instead of asked, per #58). Existing seams from #1 and #2 are reused; one new seam is added because AC4 needs it.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | The worker's HTTP boundary: `worker.fetch(request, env, ctx)`; all three inbound surfaces (email endpoint, Slack routes, admin routes) go through it | reused from #2, extended | Node unit tests | Constructed `Request`s; `makeEnv`; in-memory KV; injected `fetch` routing to `fakeIms`, **new `fakeSlack`**, `fakeUpstream`, **new `fakeDaAdmin`**; injected `sleep`/`random`/`now` |
| PV (new, minimal) | The `ChatProvider` interface (the contract between core and a vendor module) | **new** | Provider conformance suite run against Slack and a **fake provider** | The fake provider records calls; the Slack provider runs against `fakeSlack`. Justified because AC4 ("Teams only adds a provider") is otherwise unverifiable and #21 reuses it |
| W2 | The same worker in workerd over real HTTP | reused from #2 | Smoke | `wrangler dev` local, local fake IMS/Slack/upstream servers, local KV |
| S1 | Entry HTML page + SDK module boundary | reused from #1/#2 | Playwright e2e of the admin app | #1 SDK stub with a test-signed token; real local worker (W2 style) |
| S2 | Render/logic module + SDK result | reused | WTR tests of the admin page | Injected `fetch`; hand-built SDK result |
| S3 | Repo convention check | reused, extended | CI lint job | Temp-dir fixtures |

Why not fewer: the email-to-Slack pipeline (parse, dedupe, fan-out, thread store, outcome) is one behaviour reachable entirely through W1, so it needs no extra seam; PV exists only to test the provider boundary independent of Slack. The real EW boundary, real Adobe email payloads, real Slack, and the real Request Publish round trip are covered only by manual verification (MV matrix).

**Modules tested:** email ingest (auth, validation, classification, link extraction, sanitising), relay pipeline (passthrough, fan-out, dedupe, thread store, outcome), Slack signature verifier and routes, Slack OAuth install, Slack renderer and API client (escaping, link policy, error taxonomy, pacing, recipients), admin routes and authorization, provider registry and conformance, secret hygiene and unauthenticated matrix, admin page, convention checks.

**Prior art:**
- #2 test kit and matrix patterns (fake IMS, canary, `makeEnv`, `fakeUpstream`, UA/UC/UP/US groups) in `shared/worker-template/SPEC.md`; #1 SDK stub, S1/S2 patterns in `apps/hello-world/SPEC.md`.
- Upstream `adobe-rnd/ew-extensions` has no worker or Slack code (checked by #2); Adobe's `adobe-rnd/aem-apps` shows the Request Publish client contract and has its own fake-client test style (`test/tools/plugins/request-for-publish-v2/fixture-client.js`) [VERIFIED: file list via GitHub API 2026-11-16].
- Slack's own documentation provides the signature algorithm and an example (secret, timestamp, basestring) but not a complete vector for the example body (truncated in the doc); tests recompute the HMAC independently with `node:crypto` instead of copying a vector.

## Out of Scope

- **Approving or rejecting from inside Slack** as the approver (decision 6). No Slack-to-IMS identity binding, no storing of users' IMS tokens, no relay-held Helix `publish` API key.
- **Microsoft Teams** (ticket #21 / spec #59). Only the provider contract it needs.
- Slack Marketplace distribution, multi-tenant public app, enterprise-grid org-wide installs (the OAuth `team` and org-install nuances in https://docs.slack.dev/authentication/installing-with-oauth are noted, not handled).
- Slack slash commands, App Home, modals, `/request-publish` initiating requests from Slack, "approve everything" bulk actions.
- Changing Adobe's Request Publish plugin, inbox, or worker; any Request Publish v2 multi-step approval semantics beyond treating each notification as an event.
- A CI deploy workflow and Cloudflare credentials in GitHub (#2 decision 15).
- Persistent audit history of who acted (the relay stores only open threads; Request Publish itself deletes completed requests).
- Digest/summary messages, reminders on a schedule, SLAs, escalation.
- Localisation, theming, and visual design beyond basic semantics.
- Reading or writing the DA site config from the relay (decision 14).
- Per-user opt-out of chat notifications (documented as a follow-up; Slack's own mute applies).
- The Adobe outside-activity / IP policy decision and the customer-data-handling review (carried from #1 R1; flagged in Build Analysis R1).

## Further Notes

- **Docs say little about the email contract.** The only authoritative description of the email provider payload is the sample in the Request Publish doc. Subject text, HTML, which events send mail, and recipients for outcome mail are not documented; this spec derives them from READMEs of the open-source clients and flags everything the relay parses as [ASSUMPTION] until captured (MV4). Treat "capture real payloads" as the first technical task after onboarding.
- **Adobe's worker is private and per-customer.** `cloudadoption/publish-requests-worker` returned 404; the plugin README names it as the single source of truth for approver resolution, sheet I/O and email. Whether it retries failed provider calls, treats non-2xx as failure (v2 README: `emailErrors` in a successful mutation are warnings: "the sheet was saved but email delivery failed"), or has a timeout is unknown [OPEN]. The relay therefore answers fast (target under 1 s), returns `2xx` only when the upstream email (if configured) succeeded, and never blocks on Slack.
- **Onboarding is a human step with Adobe.** The docs require "your AEM Engineering contact" to configure org, site, allowed email domains, and the provider (`apiUrl`, `apiKey`, `fromEmail`, `fromName`). Whether a personally hosted relay (a Cloudflare account under a personal name handling customer approver emails) is acceptable to Adobe is a policy question (R1) that this spec cannot answer.
- **Existing Request Publish plugin and inbox are deployed from `adobe-rnd/aem-apps`** and referenced from customer config sheets by `https://main--aem-apps--adobe-rnd.aem.live/...` paths [VERIFIED: docs]. This extension never modifies them.
- **Why both buttons point at the same page.** The inbox single-review view contains both Approve & Publish and an expandable Reject section [VERIFIED: docs "Reviewing a Request in Detail"]; there is no parameter that pre-opens Reject [ASSUMPTION: none found in the README's URL parameter table]. The two buttons exist because the ticket asks for Approve/Reject actions and because they set the approver's expectation (primary vs danger styling, different labels).
- **Slack link-button clicks still hit the relay** (acknowledgement required within 3 seconds), so the interactivity route must exist and be fast even though it does nothing.
- **Free-plan fit.** A typical request costs one email call, a few Slack calls (lookups cached), and 2 to 4 KV writes; the limits in https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/kv/platform/limits/ are comfortable for a small team [ASSUMPTION: measured in smoke SM4].

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)                                   Slack workspace (sandbox / customer)
 ├─ Request Publish plugin (Adobe) ──submit──► Adobe publish-requests-worker (private, per customer)
 │                                                    │ approver email / author email  (SendGrid-style JSON, x-auth-api-key)
 │                                                    ▼
 │                                  ┌──────────────────────────────────────────────┐
 │                                  │  chat-approvals relay worker (this ticket)   │
 │                                  │  POST /v1/email   (shared-key auth)          │
 │                                  │   1 forward email unchanged → upstream email provider (optional)
 │                                  │   2 parse → NotificationEvent                │
 │                                  │   3 fan out → ChatProvider(s) (background)   │
 │                                  │  /slack/*         (Slack signature auth) ◄── Slack interactivity, events, OAuth redirect
 │                                  │  /admin/*         (IMS token + DA config authz) ◄── admin app
 │                                  └───────────┬──────────────────────────────────┘
 │                                              │ chat.postMessage / chat.update / users.lookupByEmail / oauth.v2.access
 │                                              ▼                                    ▼
 ├─ Chat Approvals admin app (this ticket; `apps` row) ──fetch + Bearer IMS──► /admin/*     Slack message
 │                                                                                         [Preview] [Diff] [Approve in Inbox] [Reject in Inbox]
 └─ Publish Requests Inbox (Adobe) ◄── approver clicks the Slack link button ── approves as self (Helix publish + POST /api/requests/approve)
                                                    │ outcome email to author → /v1/email → thread reply + message update in Slack
```

| Concern | Browser extension (static, public) | Relay worker (private, holds secrets) |
|---|---|---|
| Vendor credentials (Slack signing/client secrets, bot tokens, relay key, upstream key, encryption key) | never | only place (Cloudflare secret store; tokens encrypted in KV) |
| Identity of the admin | obtains IMS token from the SDK, sends it | validates it; authorizes against DA config |
| Email endpoint | none | shared-key auth, parse, forward, fan out |
| Slack OAuth, signatures, API calls | none (opens the install URL the worker returns) | all of it |
| Mapping, delivery mode, overrides | edits via admin routes | stores, applies |
| Approving/rejecting | none | none (deep link only) |
| UI, SDK actions | all | none |

## 2. EW integration points

- **Extension type: app.** The admin surface is a **fullscreen app** registered in the `apps` sheet of `https://da.live/config#/{org}/{site}/` (columns `title`, `description`, `image`, `path`, `ref`), appearing in `https://da.live/apps#/{org}/{site}` [VERIFIED via the #1 spec section 2.5 from https://www.aem.live/docs/ew/developing/apps-plugins]. Proposed row: title `Chat Approvals`, description `Send publish requests to Slack`, path = the app URL `https://da.live/app/jazhou-adobe/ew-extensions/apps/chat-approvals/chat-approvals` (the Request Publish doc writes inbox paths in the relative form `/app/{org}/{repo}/...`; both forms appear in docs, #1 documents the full-URL form; the README documents the form that works in M2) [OPEN, low stakes]. **No library plugin and no `library`/`prepare` row** (the plugin that creates requests remains Adobe's `Request Publish` row, configured per the Request Publish doc).
- **SDK actions used:** none. The app uses only `token` and `context` from the SDK result (#1/#2). It does not call `actions.daFetch`.
- **Requirements on the site (not owned by this extension):** the Request Publish workflow itself must be onboarded and configured: `publish-workflow-config` (approver rules), optional `publish-workflow-groups-to-email`, `publish-workflow-settings`, the author-writable `/.da/publish-workflow-requests.json`, and per-user EDS roles `basic_author` / `basic_publish` [VERIFIED: https://www.aem.live/docs/ew/administering/request-publish Steps 1 to 3]. The README of this extension lists these as prerequisites and states that **this extension reads no site config** (decision 14).
- **Host-platform reachability (AC6):** the Apps card at `https://da.live/apps#/{org}/{site}` and the direct URL `https://da.live/app/{org}/{site}/apps/chat-approvals/chat-approvals`. Trust prompt and `ref` handling as in #1 section 2.4.
- **`ref=local` loop:** page at `http://localhost:3000` calls the local worker at `http://localhost:8787` (#2). Slack and Adobe's worker **cannot reach localhost**, so the Slack callback, interactivity and email routes are exercised in `ref=local` only through test drivers (curl/fixtures) and a local fake Slack; real Slack is verified against a deployed dev worker with a branch ref (MV matrix). A tunnel is not part of the supported loop.
- **Branch ref:** pages on `*.aem.live` / `*.preview.da.live` call the deployed dev worker; the worker's CORS allow-list from #2 decision 5 applies unchanged to `/admin/*`.

## 3. Findings about Request Publish that drive the design (all read 2026-11-16)

| Fact | Source | Consequence |
|---|---|---|
| Notifications are sent by an Adobe-managed backend worker via the customer's email provider API: `apiUrl`, `apiKey` sent as `x-auth-api-key`, `fromEmail`, `fromName`; payload has `personalizations[].to`, `cc`, `subject`, `from`, `content[].type/value` (HTML) | https://www.aem.live/docs/ew/administering/request-publish | Relay = email provider. Payload has no structured org/site/path/kind. |
| Onboarding is done by the Adobe engineering contact; allowed email domains are enforced for approvers, CC, authors | same | Owner must engage Adobe to point `apiUrl` at the relay; test emails must use allowed domains. |
| Plugin and inbox are thin REST clients of `publish-requests-worker`; identity = IMS token; worker does approver resolution, sheet I/O, email | https://github.com/adobe-rnd/aem-apps/blob/main/tools/plugins/request-for-publish/README.md and inbox README | No place to hook Slack inside the workflow except email. |
| Approve = client-side Helix publish under the approver's session, then `POST /api/requests/approve` (IMS bearer); reject = `POST /api/requests/reject`; the client never sends an approver email | https://github.com/adobe-rnd/aem-apps/blob/main/tools/apps/publish-requests-inbox/api.js | Slack cannot approve as the approver (decision 6). |
| Worker repo `cloudadoption/publish-requests-worker` is not publicly readable (HTTP 404) | `gh api repos/cloudadoption/publish-requests-worker` | Email contract cannot be read from source; must be captured. |
| Inbox URL parameters `org`, `site`, `path` (+ legacy `author`, `preview`, `comment`); v2 ignores the legacy ones and builds links from site and path | inbox README; https://github.com/adobe-rnd/aem-apps/blob/main/tools/apps/publish-requests-inbox-v2/README.md | Parser can derive the key from the review link; relay can rebuild a review link from org/site/path. |
| Approval emails can consolidate several pages for one author; reject emails go to the author and DigiOps | inbox README use cases 3 and 6 | Outcome handler must close N threads per email and ignore non-author recipients. |
| One pending request per page | request-publish doc | Thread key = (org, site, path). |
| Worker-side `emailErrors` on successful mutation are warnings | v2 plugin README | Email failure is visible to users but non-fatal: relay should not return 5xx for chat problems. |
| v2 plugin/inbox exist beside v1 and are opt-in per site (multi-step workflows, `/api/v2/*`) | v2 READMEs | Event kinds may include "step advanced, next approvers notified"; treat as `requested` to the new approvers; confirm via capture [OPEN]. |
| MCP path (`aem-agentic-plugins`) exposes `request_publish`, `approve_request`, etc. acting as the signed-in user | request-publish doc, Agentic mode | Confirms per-user identity is the model; not a Slack path. |

## 4. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Request Publish email-provider contract (inbound, from Adobe's worker) | receive notifications | `x-auth-api-key` shared secret (we choose it; Adobe stores it) | https://www.aem.live/docs/ew/administering/request-publish |
| Upstream email provider (outbound, optional) | forward email unchanged | configurable header + secret via proxy helper | customer-specific; SendGrid reference https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send [not fetched] |
| Slack OAuth v2: `https://slack.com/oauth/v2/authorize`, `POST https://slack.com/api/oauth.v2.access` | install, bot token | client id/secret; `state`; HTTPS redirect_uri; code lifetime 10 min | https://docs.slack.dev/authentication/installing-with-oauth |
| Slack `chat.postMessage` (special rate limit, about 1 msg/s/channel; `blocks` + fallback `text`; `thread_ts`; DM by user id as `channel`) | deliver | bot token `chat:write` | https://docs.slack.dev/reference/methods/chat.postMessage |
| Slack `chat.update` (Tier 3, `channel` + `ts`; bot may update its own messages; omitting `blocks` while giving `text` removes blocks) | rewrite message after outcome | bot token | https://docs.slack.dev/reference/methods/chat.update |
| Slack `users.lookupByEmail` (Tier 3, `users:read.email`; `users_not_found` for deactivated) | approver email → user id | bot token | https://docs.slack.dev/reference/methods/users.lookupByEmail |
| Slack interactivity (block_actions to Request URL, form-encoded `payload`, ack `200` within 3 s; link buttons still post) | click acknowledgement | signature | https://docs.slack.dev/interactivity/handling-user-interaction, https://docs.slack.dev/reference/interaction-payloads/block_actions-payload |
| Slack request verification (`X-Slack-Signature`, `X-Slack-Request-Timestamp`, `v0:ts:body`, HMAC-SHA256, 5-minute window; raw body) | authenticate Slack | signing secret | https://docs.slack.dev/authentication/verifying-requests-from-slack |
| Slack Events API URL verification (`url_verification` challenge, respond with `challenge`) | register events URL | signature + challenge | https://docs.slack.dev/apis/events-api/using-http-request-urls |
| Slack rate limits (`429` + `Retry-After`; per method per workspace) | pacing | n/a | https://docs.slack.dev/apis/web-api/rate-limits |
| DA Admin config `GET https://admin.da.live/config/{org}/{site}/` | authorize admin callers | caller's IMS token (forwarded to this host only) | https://github.com/adobe/da-admin/blob/main/src/routes/config.js [VERIFIED source] |
| Adobe IMS key set | verify admin callers (from #2) | none | #2 spec |
| Cloudflare Workers KV, `ctx.waitUntil` | storage, background work | bindings | https://developers.cloudflare.com/kv/platform/limits/, https://developers.cloudflare.com/workers/runtime-apis/context/ |
| Slack Developer Program sandbox | test workspace | developer account | https://docs.slack.dev/tools/developer-sandboxes |

**Auth flows.**
- *Adobe's worker → relay:* header `x-auth-api-key` compared in constant time with `EMAIL_RELAY_API_KEY`.
- *Slack → relay:* signature check on the raw body before parsing; reject if timestamp skew > 5 minutes; handlers see only verified payloads. Note: Slack's `token` field in payloads is deprecated and ignored.
- *Admin app → relay:* template IMS verification (#2) + `authorize` hook calling DA config with the caller's token.
- *Slack install:* admin app (authenticated) → worker returns authorize URL with signed `state` → Slack consent → Slack redirects browser to worker callback → `state` verified → `oauth.v2.access` → encrypted token stored.
- *Relay → Slack:* `Authorization: Bearer <bot token>` injected by the provider's client; token decrypted just-in-time; never logged. [ASSUMPTION: the template's proxy helper takes a *secret name*; a per-install token is not a worker secret. Proxy helper needs a "dynamic credential" option, section 7 item E6.]

## 5. Data contracts

All contracts are behaviour contracts, not code.

### 5.1 Inbound email contract (from Adobe's worker)

Method `POST`, header `x-auth-api-key`, JSON body shaped as in the Request Publish doc. Relay response: `202` (chat-only, or upstream accepted), `401` bad key, `400` malformed, `413` too large, `502` upstream email failed after retries. No body detail beyond the template's error JSON. [ASSUMPTION: Adobe's worker treats any `2xx` as success.]

### 5.2 NotificationEvent (vendor-neutral, produced by the parser)

| Field | Meaning |
|---|---|
| `kind` | `requested`, `reminder`, `approved`, `rejected`, `withdrawn`, `unknown` |
| `key` | `{ org, site, path }`; `path` normalized (leading slash, no `.html`) |
| `requester` | author email (from the review link `author` or body) |
| `approvers`, `cc` | emails from `personalizations[].to/cc` (for outcome events: the recipients, ignored for routing) |
| `note` | author note as plain text, truncated |
| `reason` | rejection reason as plain text |
| `links` | `{ preview, diff, review, live }`, each already validated against the host allow-list or absent |
| `paths` | for consolidated approvals, the list of keys closed by one email |
| `source` | payload hash used for de-duplication |

### 5.3 ChatProvider contract (the interface #21/#59 must implement)

| Member | Behaviour |
|---|---|
| `id`, `displayName` | stable machine id (route prefix, KV namespace) and label |
| `descriptor(siteCtx)` | JSON for the admin app: `status` (`not_connected`, `connected`, `needs_reconnect`, `error`), workspace/tenant label, connect kind (`oauth` / `manual`), settings fields (type, label, validation), last error (code only) |
| `routes()` | list of `{ method, path, authenticator, handler }`; paths live under `/{id}/` |
| `authenticators()` | named verifiers this provider needs (Slack: `slack-signature`; Teams: Bot Framework JWT) |
| `beginInstall(ctx)` | returns `{ url }` for the browser to open, or manual instructions |
| `resolveRecipients(ctx, emails)` | returns `{ resolved: [{ email, ref }], unresolved: [email] }`; the only place addressing rules live |
| `deliver(ctx, event, plan)` | sends per the plan (channel/dm targets), returns receipts `{ target, messageRef }`; `messageRef` is opaque to the core |
| `update(ctx, receipt, event, status)` | rewrite an earlier message (status: `approved`, `rejected`, `closed`) |
| `reply(ctx, receipt, text)` | thread/reply message |
| `disconnect(ctx)` | revoke and delete provider state |
| Error taxonomy | provider maps every failure to `retryable`, `permanent` or `install_revoked`; core reacts (retry within budget, record and surface, mark reconnect-needed) |
| Guarantees from core | normalized event; per-provider namespaced store; template `proxy`/`secret`/`log`; no provider names in core; each provider isolated (one failing never stops another or email) |

### 5.4 Stored records (KV; provider records are namespaced by provider id)

| Record | Key (conceptual) | Content | Lifetime |
|---|---|---|---|
| Install | `slack:install:{teamId}` | encrypted bot token, bot user id, scopes, team name, org/site bindings, installed-by user id | until disconnect/revoke |
| Binding | `site:{org}/{site}` | provider ids connected, delivery mode, path-pattern to channel rules, override map (email to Slack user id), cc switch | until changed |
| Thread | `thread:{provider}:{org}:{site}:{path}` | receipts (channel/DM + `ts`), minimal event to re-render, status | 30 days |
| Approver cache | `slack:user:{teamId}:{email-hash}` | Slack user id or not-found marker | 24 h |
| Dedupe | `dedupe:{payload hash}` | marker | minutes |

No records contain the relay key, signing secret or IMS tokens.

### 5.5 Worker routes and authenticators

| Route | Authenticator | CORS | Purpose |
|---|---|---|---|
| `POST /v1/email` | `relay-key` | none (server to server) | email-provider endpoint |
| `POST /slack/interactivity` | `slack-signature` | none | ack link-button clicks (and any future actions) |
| `POST /slack/events` | `slack-signature` (+ `url_verification`) | none | `app_uninstalled`, `tokens_revoked` |
| `GET /slack/oauth/callback` | signed `state` | none (browser navigation) | complete install, returns HTML |
| `POST /admin/providers/{id}/install-url` | IMS + `authorize` | allow-list from #2 | begin install |
| `GET /admin/providers` | IMS + `authorize` | allow-list | descriptors |
| `GET/PUT /admin/sites/{org}/{site}/config` | IMS + `authorize` | allow-list | mapping, mode, overrides |
| `POST /admin/sites/{org}/{site}/test-message` | IMS + `authorize` | allow-list | send test |
| `DELETE /admin/providers/{id}/install` | IMS + `authorize` | allow-list | disconnect |
| `OPTIONS /admin/*` | none (preflight) | as #2 | preflight |

### 5.6 Worker configuration

| Name | Kind | Meaning |
|---|---|---|
| `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` | vars (#2) | CORS and IMS verification |
| `SLACK_API_ORIGIN` | var | `https://slack.com` in production; overridden only in local/test environments to point at a fake (never set in prod config; checked by UR) |
| `UPSTREAM_EMAIL_URL`, `UPSTREAM_EMAIL_AUTH_HEADER`, `UPSTREAM_EMAIL_AUTH_SCHEME` | vars | optional email forwarding target and auth placement |
| `MAX_DM_RECIPIENTS`, `NOTE_MAX_CHARS`, `INBOX_APP_URL`, `LINK_HOST_ALLOWLIST_EXTRA` | vars | limits and fallback inbox base |
| `DA_ADMIN_ORIGIN` | var | `https://admin.da.live` (overridden in tests) |
| `EMAIL_RELAY_API_KEY` | secret | key Adobe's worker sends |
| `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID` (var), `SLACK_CLIENT_SECRET` | secrets | Slack app credentials |
| `TOKEN_ENCRYPTION_KEY`, `STATE_SIGNING_KEY` | secrets | at-rest encryption and OAuth `state` |
| `UPSTREAM_EMAIL_API_KEY` | secret (optional) | real email provider key |
| `CHAT_KV` | binding | Workers KV namespace |

## 6. Folder layout (fits the #1 convention and #2 decision 3)

```
apps/chat-approvals/
├─ SPEC.md                    this file
├─ README.md                  setup, config-sheet row, Request Publish prerequisites, relay values for the Adobe contact, local dev, deploy, security notes
├─ chat-approvals.html        entry page (SDK module tag + script); registered in the `apps` sheet
├─ chat-approvals.js          bootstrap (awaits SDK, wires render)
├─ chat-approvals-render.js   side-effect-free render/logic (testable)
├─ chat-approvals.css
├─ test/unit/  test/e2e/      admin page tests (S1, S2)
├─ worker/                    relay core: entry (registers providers), email ingest + parser, pipeline, store, registry, authenticators, wrangler config, .dev.vars.example, README, test/
└─ providers/
   └─ slack/
      ├─ README.md            Slack setup: create app from manifest, scopes, URLs, secrets, channel invite
      ├─ slack-app-manifest   Slack app definition (scopes, request URLs, event subscriptions, redirect URL)
      └─ worker/              Slack provider: signature verifier, OAuth, API client, renderer, recipients, routes, test/
shared/worker-template/       (#2) core library; extended per section 7
```

Teams (#21) adds `apps/chat-approvals/providers/teams/` (+ `worker/`) and one registration in the worker entry; the browser shell is unchanged.

## 7. Dependencies on the worker template (#2) and proposed resolutions

The #2 spec decisions 4 ("no unauthenticated routes other than OPTIONS") and its out-of-scope list (no KV, no non-IMS auth, JSON responses only) do not accommodate this extension. Needed, each backwards-compatible with the hello-world proof:

| # | Need | Proposed template change |
|---|---|---|
| E1 | Per-route named authenticators: `ims` (default), plus extension-supplied (`relay-key`, `slack-signature`, `signed-state`) | Route declaration takes an `auth` field. Pipeline stays fixed: origin gate (browser routes only), authenticator, routing, handler. Missing/invalid credential for that route's authenticator = `401` before handler. Unknown routes still `401` first so route discovery stays impossible. |
| E2 | Handlers need the **raw request body** for HMAC verification | Authenticator receives the buffered raw body (size-capped as in #2 UP12); the handler gets the same bytes |
| E3 | KV binding access in handler context | Expose declared bindings (not secrets) on the context; document in the wrangler scaffold |
| E4 | HTML response from the OAuth callback | Allow handlers to return a `Response` with `text/html` and a strict CSP; error responses remain JSON |
| E5 | Routes with no browser CORS (server-to-server, Slack) | Per-route `cors: 'none'`: no ACAO headers, preflight not answered; `Origin` header present on such a request is refused (a browser must not drive them) |
| E6 | Outbound credential that is not a worker secret (decrypted per-install bot token) | `proxy` option for an explicit one-call credential value, still redacted from logs/responses and never forwarded elsewhere |
| E7 | `waitUntil` budget awareness | Context exposes `ctx.waitUntil`; extension enforces its own deadline below 30 s |

If #2 rejects these, this extension cannot satisfy "unauthenticated calls rejected" for machine callers with the shared pipeline, and would need to be built on a fork; flagged as Open Question 1.

## 8. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Customer data and policy.** The relay receives approver/author emails and notes for a customer's org and forwards them to Slack; hosted on a personal Cloudflare account, relayed through Adobe's onboarding, built under a personal GitHub name. Carries #1 R1 / #2 R1. | High, blocks real onboarding | [OPEN] owner decides account and gets Adobe policy/security sign-off before any non-synthetic traffic. Spec delivers works with synthetic payloads first. |
| R2 | **Email payload format is undocumented** (kind, org/site/path extraction, outcome recipients, consolidation, v2 multi-step). | High | Capture-first plan (step 13/MV4); tolerant table-driven parser; unknown means email-only; fixtures updated from real payloads. |
| R3 | **Adobe must register the relay as `apiUrl`.** No onboarding means no real end-to-end. | High (schedule) | [OPEN] owner contacts AEM Engineering; fallback verification with synthetic payloads against the deployed dev worker and a real Slack sandbox; real-EW part limited to deep-link and admin app. |
| R4 | **Slack identity cannot be bound to Adobe approver** | Resolved by design | Deep-link buttons (decision 6). Documented reconsideration conditions. |
| R5 | **Outcome detection depends on outcome emails passing through `apiUrl`.** If approve/reject mail uses a different path or no mail, threads never close. | Medium | MV6/MV7 verify; fallback: buttons remain; TTL expiry; inbox shows "No Pending Request" for stale links. |
| R6 | **Template mismatch (E1 to E7).** | High until agreed | Question 1; fork fallback. |
| R7 | **Slack mrkdwn/mention injection and link planting** via author note, path, or stolen relay key. | High if unmitigated | Escape all untrusted text; mentions only from resolved ids; link host allow-list; tests SL2, SL3, IN5. |
| R8 | **Relay key leak** lets anyone post into mapped channels. | Medium | Key rotation (one `wrangler secret put`), only allow-listed link hosts, content limited to events matching a connected org/site, constant-time compare, optional IP allow-list [ASSUMPTION: Adobe egress IPs unknown]. |
| R9 | **Slack token at rest** (KV leak or backup exposure). | Medium | AES-GCM with worker-secret key; no token in logs/responses; revoke on disconnect/uninstall; tests OA4. |
| R10 | **KV eventual consistency** (writes visible elsewhere after 60 s+). | Low-Med | Thread lookup tolerance; retry once after short delay for outcome events [ASSUMPTION]; D1/DO fallback. |
| R11 | **Free-plan limits** (KV 1,000 writes/day; 50 subrequests; 10 ms CPU; `waitUntil` 30 s). | Low-Med | Caps and caches; SM4 measures; paid plan owner decision. |
| R12 | **Slack rate limits / burst behaviour** (about 1 msg/s per channel; app may be quieted for sustained bursts). | Low-Med | Pace posting; honour `Retry-After`; DM cap. |
| R13 | **Bot not in channel / missing scopes** (`not_in_channel`, `missing_scope`). | Medium | Admin test-message surfaces the exact fix; manifest + scope check at install; `chat:write.public` option [OPEN]. |
| R14 | **Slack OAuth only works against an HTTPS public URL** (local dev cannot receive Slack). | Medium | Documented: install and interactivity are verified on the deployed dev worker; local loop uses fakes. |
| R15 | **IMS/DA authorization of admin callers** (`X-da-actions` on config GET unverified; token forwarding exception). | Medium | Spike in step 9; fallback allowlist; Question 7. |
| R16 | **Event subscription names and some scopes unverified** (`app_uninstalled`, `tokens_revoked`, `chat:write.public`, channel-list scopes). | Low | Read https://docs.slack.dev/reference/events and /reference/scopes during step 8; update tests. |
| R17 | **Request Publish v2 / multi-step workflows** change which emails are sent. | Medium | Parser kinds tolerant; capture both v1 and v2 payloads if the site uses v2 [OPEN]. |
| R18 | **Adobe worker's retry/timeouts toward `apiUrl`** unknown; slow relay may cause duplicates or `emailErrors`. | Medium | Fast response, dedupe by payload hash (RL8). |
| R19 | **Slack free-plan and sandbox constraints** (basic sandbox: 2 workspaces, 8 users, 1-month inactivity archive; fixed identity emails). | Low | Sandbox users' emails must equal approvers in the site's `publish-workflow-config`; extend/recreate sandbox as needed. |

## 9. Ordered build plan (sized to #20's acceptance criteria)

0. **Owner prerequisites:** #1 and #2 merged (tooling, CI, worker template); Cloudflare account/login; Slack Developer Program sandbox + Slack dev app from the manifest; an EW org/site onboarded to Request Publish by the AEM Engineering contact (Question 2) with the dev worker URL and key; decide Open Questions 1 to 7 before step 1.
1. **Template alignment (E1 to E7)** agreed and landed in `shared/worker-template/` (separate PR against #2). No code in this ticket until agreed.
2. **Test kit additions:** `fakeSlack` (records and scripts Web API calls incl. `ok:false`, `429` + `Retry-After`), Slack request signer, in-memory KV, `fakeDaAdmin`, email payload fixtures (doc sample plus assumed shapes tagged `assumed`). Self-check tests (UK-style).
3. **Email ingest and parser**, test-first (IN groups) using only fixtures. AC1 (parse), AC8 (key auth).
4. **Provider interface, registry, store, pipeline with fake provider**, test-first (PV, RL groups). AC4.
5. **Slack signature verification and routes** (ack-only interactivity, events with `url_verification`), test-first (SG). AC3.
6. **Slack renderer, recipients, delivery, thread store**, test-first (SL, RL). AC1.
7. **Outcome handling** (reply + update, consolidated, resend reminder, dedupe), test-first (RL, SL). AC2.
8. **OAuth install, token encryption, disconnect, revoke handling**, test-first (OA). AC3.
9. **Admin routes + authorization** (AD) and **admin app** (WB, descriptor-driven); decide Question 7 after the `X-da-actions` spike. AC5, AC6, AC7, AC8.
10. **Passthrough and resilience** (RL1 to RL3, RL8, RL9): upstream forward, chat-only mode, failure isolation, background budget. AC1, AC8.
11. **Slack manifest, READMEs, repo README table row, config-sheet row**; manifest/scope consistency check. AC5, AC6.
12. **Smoke, Playwright e2e, CI jobs** (extend #1/#2 workflow; no secrets in CI). AC9.
13. **Deploy the dev worker, capture real payloads (MV4), correct parser and fixtures, run MV matrix** in a real Slack sandbox and onboarded EW site. AC1, AC2, AC7.
14. **Hand-off note for #21:** provider contract, conformance suite entry point, fake provider usage, registration step.

---

# Testing Requirements

## 1. Worker unit tests (seam W1; Node built-in runner; test kit from #2 plus additions)

Fixtures/mocks: `makeEnv` (production-like, `ALLOW_LOCALHOST` false) with canaries for every secret: `EMAIL_RELAY_API_KEY`, `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `STATE_SIGNING_KEY`, `UPSTREAM_EMAIL_API_KEY`, and a canary Slack bot token (`xoxb-canary-…`); `fakeIms`; **`fakeSlack`** (scripted responses for `oauth.v2.access`, `chat.postMessage`, `chat.update`, `users.lookupByEmail`, `auth.revoke`; records headers/bodies); **`signSlack(body, secret, ts)`**; **in-memory KV** (get/put/delete with TTL, injected `now`); **`fakeDaAdmin`** (200 with `X-da-actions`, 403); `fakeUpstream` (#2). `sleep`, `random`, `now` injected. Email fixtures live under `test/fixtures/email/` and are tagged `doc` (verbatim shape from the Request Publish doc), `assumed` (inferred HTML) or `captured` (from MV4, replaced after step 13).

### 1.1 Email ingest and parsing (AC1, AC8)

| ID | Behaviour asserted |
|---|---|
| IN1 | The doc's sample payload with the right key, for a connected org/site: `202`; event kind `requested`; approvers and cc from `to`/`cc`; key and links extracted from the review link in the HTML |
| IN2 | Missing, wrong, empty, or differently-cased-header key: `401`; no store access, no upstream call, no Slack call; key compare is constant time (length-mismatch handled); the key does not appear in response or logs |
| IN3 | Non-JSON, missing `personalizations`/`content`, empty recipients, over-size body: `400`/`413`; no side effects |
| IN4 | Classification matrix over fixtures: requested, reminder (resend), approved (single page, consolidated multiple pages), rejected (with reason), withdrawn, unknown; each yields the expected kind and key(s) |
| IN5 | Link policy: only allow-listed hosts for the event's org/site survive; `javascript:`, `data:`, look-alike hosts (`da.live.evil.com`, other org/site `aem.live`), userinfo URLs are dropped; dropped links are logged by host only |
| IN6 | HTML to text: tags stripped, entities decoded, scripts/styles ignored, note truncated at the cap; no HTML is ever passed to a provider |
| IN7 | Payload for an org/site with no connected provider: email forwarded only; zero Slack calls; `202` |
| IN8 | Unrecognised payload: email forwarded; no chat; log line has kind `unknown` and no body |
| IN9 | Path normalization: `/a/b`, `/a/b.html`, `a/b` produce the same thread key |

### 1.2 Relay pipeline (AC1, AC2, AC8)

| ID | Behaviour asserted |
|---|---|
| RL1 | Upstream configured: body forwarded semantically identical with the upstream key injected once in the configured header; inbound `x-auth-api-key` not forwarded; upstream `429` retried honouring `Retry-After`; upstream `503` on this POST not retried (template default) and answered `502`; Slack delivery still attempted in the same request |
| RL2 | Chat-only mode (no upstream): `202` after parse; response time independent of Slack latency (Slack scripted slow) |
| RL3 | Slack/provider failure (any error kind) never changes the email response status |
| RL4 | Fan-out plan: channel rule match posts to the mapped channel with mentions for resolved approvers; `dm` mode posts one DM per resolved approver; `both`; unresolved approvers rendered as plain text; cc not DM'd by default; recipients beyond `MAX_DM_RECIPIENTS` fall back to channel only |
| RL5 | `reminder` event with an existing thread: reply in that thread, no new top-level message |
| RL6 | `approved`: thread reply with live link and original message re-rendered without action buttons; consolidated approval closes each named thread once |
| RL7 | `rejected`: reply contains the reason as inert text; message updated; no thread record = no-op with a log line |
| RL8 | Same payload delivered twice within the dedupe window: one Slack message |
| RL9 | Delivery completes within the background budget with scripted `429` + `Retry-After`; work beyond the budget is dropped and logged, not left half-applied |
| RL10 | Thread record TTL and update: a thread is findable for outcome handling after a delay shorter than the TTL, absent after |
| RL11 | KV read of a just-written thread missing (consistency): outcome handler retries once then no-ops without throwing |

### 1.3 Slack provider (AC1, AC2, AC3)

| ID | Behaviour asserted |
|---|---|
| SL1 | `requested` message: `blocks` contain path, org/site, author, note, approvers, and Preview, Diff and review links; includes plain `text` fallback; within Slack length limits |
| SL2 | Escaping: `&`, `<`, `>` escaped in path, note, emails; note containing `<!channel>`, `<@U123>`, `<https://evil.example|x>`, backticks, and newlines renders inert; mentions appear only for resolved ids |
| SL3 | **Approve in Inbox** and **Reject in Inbox** are link buttons (`url` set, no state-changing `value`), point to the inbox review URL for the event key, and are absent when no valid review link can be formed |
| SL4 | Recipient resolution: found, `users_not_found`, `ratelimited` with `Retry-After` retried, cache hit avoids the call, admin override wins over lookup |
| SL5 | API error mapping: `channel_not_found`, `not_in_channel` = `permanent` (recorded in status); `invalid_auth`, `token_revoked`, `account_inactive` = `install_revoked` (status `needs_reconnect`); `ratelimited` = `retryable`; `missing_scope` = `permanent` with the scope named; HTTP `200` with `ok:false` is treated as failure |
| SL6 | `chat.postMessage` is not blindly retried on `5xx` (no duplicate messages), retried on `429` |
| SL7 | Pacing: successive posts to one channel are spaced about one second apart (injected `sleep`) |
| SL8 | `update`/`reply` use the stored channel and `ts`; `message_not_found`/`cant_update_message` falls back to reply only |
| SL9 | DM delivery uses the Slack user id as the channel; failure of one DM does not stop the others |
| SL10 | The bot token reaches Slack only in the `Authorization` header of Slack-API calls; never in logs, KV values (plain), responses |

### 1.4 Slack signature, interactivity, events (AC3)

| ID | Behaviour asserted |
|---|---|
| SG1 | Correctly signed request (signature recomputed in the test with `node:crypto` over `v0:{ts}:{raw body}`) is accepted |
| SG2 | Tampered body, wrong secret, missing/empty `X-Slack-Signature` or timestamp, wrong version prefix, non-hex or wrong-length signature: `401`; no handler/Slack/KV access |
| SG3 | Timestamp older or newer than 5 minutes: `401`; just inside the window: accepted (injected `now`) |
| SG4 | Verification runs on the raw bytes (form-encoded body with reordered/duplicated params fails when altered; parsing happens only after success) |
| SG5 | `url_verification` challenge answered only for a validly signed request, echoing `challenge` |
| SG6 | Interactivity `block_actions` from a link-button click: `200` with empty body well within 3 s; no Slack call before the ack; no state change; `response_url` and `trigger_id` not logged |
| SG7 | `app_uninstalled` / `tokens_revoked` (event names to confirm, R16) delete the install record; status becomes not connected |
| SG8 | Unknown event or payload `type` with a valid signature: `200`, ignored (avoids Slack retry storms) |
| SG9 | Slack's deprecated `token` field present or wrong: ignored (decision relies on signature only) |

### 1.5 Slack OAuth install (AC3)

| ID | Behaviour asserted |
|---|---|
| OA1 | `install-url`: no/invalid IMS token `401`; no DA config permission `403`; success returns a Slack authorize URL with client id, scopes, HTTPS redirect URI and a signed `state`; the URL contains no secret |
| OA2 | Callback with missing, tampered, expired, or wrong-site `state`: generic HTML error; no `oauth.v2.access` call |
| OA3 | Valid callback: `oauth.v2.access` called with the client secret injected by the proxy helper (not in the URL/log), granted scopes checked, install stored, success HTML shows workspace name and no token |
| OA4 | Stored value is ciphertext: the raw KV value never contains the token; decrypt round trip; a wrong key fails closed (status error, no Slack call) |
| OA5 | Slack returns `ok:false` (`invalid_code`, `bad_redirect_uri`) or user denies (`error=access_denied`): friendly HTML; nothing stored |
| OA6 | `state` replay: a second callback with the same state and a (now used) code fails at Slack and changes nothing |
| OA7 | Re-install for the same team replaces the token; the org/site binding is only the one in `state` |
| OA8 | Insufficient granted scopes: status `needs_reconnect` naming the missing scope; no partial enablement |
| OA9 | Disconnect: `auth.revoke` called, record deleted; if Slack says already revoked, record still deleted |

### 1.6 Admin routes and authorization (AC5, AC7, AC8)

| ID | Behaviour asserted |
|---|---|
| AD1 | Every `/admin/*` route: no token `401`; invalid token `401`; disallowed origin `403`; allowed origin gets CORS headers on all responses (inherits #2 UA/UC) |
| AD2 | Authorization: a caller whose DA config call is `403` is refused (`403`); a caller with access is allowed; the caller's token is sent only to `DA_ADMIN_ORIGIN` and never logged or forwarded elsewhere |
| AD3 | Config PUT validation: channel id format, pattern syntax (`/a/*`, `/*`, exact), size limits, unknown fields rejected; GET never returns tokens or secrets |
| AD4 | `GET /admin/providers` returns descriptors for registered providers with status; no secrets |
| AD5 | Test message posts to the mapped channel; errors from SL5 are returned as plain, actionable codes (`not_in_channel`, `needs_reconnect`) |
| AD6 | A user with access to site A cannot read or change site B's config or install |
| AD7 | Delivery mode and mapping changes take effect on the next email event (read-after-write within one test) |

### 1.7 Provider contract and Teams-readiness (AC4)

| ID | Behaviour asserted |
|---|---|
| PV1 | Registering a **fake provider** adds its routes, authenticators and descriptor to a worker built from the unmodified core; an email event reaches both Slack and the fake |
| PV2 | The conformance suite (recipients, deliver receipts, update, reply, error taxonomy, descriptor shape, disconnect) passes for Slack and the fake provider; #21 reuses this suite |
| PV3 | Per-provider namespace: neither provider can read the other's records |
| PV4 | A provider that throws or times out does not stop the other provider and does not change the email response |
| PV5 | The fake resolves recipients by a non-email identifier; the core passes the opaque references through untouched |
| PV6 | The fake provider's routes use its own authenticator; with no credential they are `401` (extends SC2) |

### 1.8 Secret hygiene and unauthenticated matrix (AC3, AC8)

| ID | Behaviour asserted |
|---|---|
| SC1 | Canary matrix (as #2 US1) over success and every error path of every route: no secret canary, no bot token, no IMS token, no Slack `response_url`/`trigger_id` in any response body, header or log line |
| SC2 | For every registered route (including a fake provider's) and for unknown paths: no credential and wrong credential yield `401`/`403`; zero KV reads/writes, zero outbound calls |
| SC3 | Machine routes (`/v1/email`, `/slack/*`) have no CORS headers and refuse a request carrying `Origin`; `/admin/*` follows #2 UC |
| SC4 | The Slack bot token is not present in any KV value in plaintext (scan all values written during a full scenario) |
| SC5 | Logging: one structured line per request with route pattern, status, outcome code, duration, request id; no tokens, bodies, emails or notes |

### 1.9 Test-kit self-check

UK1: `signSlack` output verifies with an independent HMAC implementation. UK2: `fakeSlack` replays scripts in order and records requests. UK3: in-memory KV TTL/expiry behaves with injected `now`. UK4: email fixtures tagged `assumed` are listed in a manifest so MV4 knows what to replace.

## 2. Admin page tests (seam S2, WTR; SDK stub from #1; injected `fetch`)

| ID | Behaviour asserted |
|---|---|
| WB1 | Provider cards render from descriptors; every value is shown as text; HTML/script in values creates no elements |
| WB2 | "Connect Slack" calls the install-url route with `Authorization: Bearer <SDK token>` to the constant worker origin and opens the returned URL in a new context with `noopener`; a returned non-Slack URL is refused |
| WB3 | Standalone (no SDK) state shows the "not inside Experience Workspace" message; controls disabled |
| WB4 | Mapping editor validates inputs and sends the exact PUT; `403` shows a plain message (no stack); `401` prompts re-open |
| WB5 | Test-message button shows the worker's result code as readable text |
| WB6 | The IMS token never appears in DOM or console; `?worker=` in the URL is ignored; on `localhost` the loopback worker, elsewhere the fixed deployed origin (#2 HP5) |
| WB7 | A descriptor for a provider the page has never seen renders a working connect panel (descriptor-driven; AC4 browser side) |
| WB8 | The page shows the relay URL to give the Adobe contact and never shows the relay key |

## 3. Browser to real worker (seam S1 extended, Playwright, Chromium, hermetic, no credentials)

Playwright starts the #1 static server on `:3000`, the real worker via wrangler on `:8787` (local env; `IMS_ORIGIN`, `SLACK_API_ORIGIN`, `DA_ADMIN_ORIGIN` pointing at throwaway local Node servers started in global setup; secrets from a temp env file; local KV). The #1 SDK stub supplies a token signed by the test key. A test driver plays Adobe's worker (POSTs fixture emails with the key) and Slack (signed callbacks).

| ID | Behaviour asserted |
|---|---|
| E2E1 | Open the app; Connect Slack returns an authorize URL (fake Slack); driver completes the callback with a valid `state` and fake code; the page then shows connected |
| E2E2 | Driver POSTs a `requested` email: fake Slack received one `chat.postMessage` with the expected blocks and link buttons; the real cross-origin admin calls (preflight included) succeeded |
| E2E3 | Driver POSTs an `approved` email: fake Slack received a thread reply and a `chat.update` removing the buttons |
| E2E4 | Forged Slack interactivity (bad signature) and key-less email: `401`; fake Slack saw nothing |
| E2E5 | Page HTML, DOM, console and all network responses contain neither the IMS token nor any secret canary; only expected hosts contacted |

## 4. Runtime smoke tier (seam W2; Node test driving `wrangler dev` locally, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SM1 | Worker bundles (shared core + provider + `jose`) and starts; bare requests to every route return `401` |
| SM2 | Signature verification with the runtime's Web Crypto (HMAC SHA-256, constant-time compare available [ASSUMPTION: `crypto.subtle.timingSafeEqual` in workerd; else a manual constant-time loop]) accepts a driver-signed request and rejects a tampered one |
| SM3 | Full email-to-Slack flow over real HTTP with local KV persistence between requests; AES-GCM encrypt/decrypt in workerd |
| SM4 | Records CPU/wall time, KV operation count and subrequest count for one request with 5 approvers (informational against R11; no hard threshold until a baseline exists) |
| SM5 | Canary secrets absent from all responses (SC1 over real HTTP) |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR1 | Convention check from #1/#2 passes for `apps/chat-approvals/` (entry page, README, tests, `worker/`, `providers/slack/`); `providers/<vendor>/` is not treated as an extension |
| UR2 | README extensions table has a `chat-approvals` row (folder `apps/chat-approvals/`, entry `chat-approvals.html`, type `app`) and a README for the extension documents the `apps` registration row |
| UR3 | No provider name literal (`slack`, `teams`) appears in core worker code or in the admin page; only under `providers/*` and the registration site |
| UR4 | The Slack manifest scopes, the code's required-scope constant, and the README scope list are identical |
| UR5 | Production wrangler config sets neither `SLACK_API_ORIGIN`, `DA_ADMIN_ORIGIN`, nor `ALLOW_LOCALHOST`; the #2 UR rules (no tracked `.dev.vars`, no secret-like `vars`, secrets declared) pass for this worker |
| UR6 | No file outside `worker/` and `providers/*/worker/` contains a secret-shaped string (`xoxb-`, `xoxp-`, `xapp-`, `xoxe-`) and the browser-served files import nothing from `worker/` |

## 6. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login, a Slack sandbox, a Cloudflare account, and Request Publish onboarding)

Accounts and credentials needed (see section 7). Never paste real IMS or Slack tokens into chat, issues or logs. Use a throwaway relay key.

- **MV0 (prereq):** #1 Code Sync done (`curl -I https://main--ew-extensions--jazhou-adobe.aem.live/apps/chat-approvals/chat-approvals.html` is 200); dev worker deployed with all secrets set; Slack dev app created from the manifest with the dev worker's URLs; a Slack sandbox workspace with an approver user whose email equals a `publish-workflow-config` approver. Proves the environment.
- **MV1 (app, `ref=local`):** `npm start` (port 3000) and the local worker (port 8787, fake Slack/DA admin where needed); open `https://da.live/app/jazhou-adobe/ew-extensions/apps/chat-approvals/chat-approvals?ref=local`; accept the trust prompt; the provider card loads; mapping save works; unauthenticated `curl` to the local worker gives `401`. DevTools: preflight `204`, `Access-Control-Allow-Origin: http://localhost:3000`. Proves AC7 (local), AC8 (real IMS token accepted, none rejected), AC5.
- **MV2 (inspect real token, same as #2 W2):** decode only the claims locally and confirm the IMS verification and `ALLOWED_IMS_CLIENT_IDS` decision. Prerequisite for MV3.
- **MV3 (branch ref, deployed dev worker, real Slack OAuth):** push branch `chat-approvals-slack` (simple name), wait for code sync; open the same URL with `?ref=chat-approvals-slack`; click Connect Slack; complete consent in the sandbox; the card shows connected with the workspace name; set a channel mapping; invite the bot to the channel (or grant `chat:write.public`); click Test message and see it in Slack. Record the real page `Origin`. Proves AC3 (OAuth by the worker), AC7 (branch ref), AC8 (no credential visible in DevTools).
- **MV4 (capture the real email contract):** with the dev worker's `apiUrl` registered by the Adobe contact and a temporary dev-only capture log of payload *shapes* (subject, link patterns, recipients redacted; never enabled in prod), submit a request as author, resend it, approve it as approver, reject another, withdraw one. Save redacted payloads as `captured` fixtures; update the parser and the `assumed` manifest. Proves R2 is closed or documents the gap.
- **MV5 (AC1 end to end):** as author (IMS identity A, `basic_author`) request publish for a page via the Request Publish plugin; the Slack channel and/or the approver's DM show the message with path, author, note, approver mention, working **Preview**, **Diff** and **Inbox** links; the normal email (if an upstream is configured) also arrives.
- **MV6 (AC2, approve):** as approver (identity B, `basic_publish`), click **Approve in Inbox**; the Publish Requests Inbox review page opens for that request; Approve & Publish; the Slack thread receives the approved reply with the live link and the original message loses its buttons; the page is live. Also: click the Slack buttons and confirm Slack shows no error marker (ack works).
- **MV7 (AC2, reject):** another request; **Reject in Inbox**, supply a reason; the thread shows the rejection reason as plain text.
- **MV8 (negatives):** `curl` the deployed `/v1/email` without key (`401`), with wrong key (`401`); `curl` `/slack/interactivity` unsigned (`401`) and signed with an old timestamp (`401`); `curl` `/admin/providers` without token (`401`) and with an `Origin: https://evil.example` plus a valid token (`403`). Proves AC8, AC3.
- **MV9 (resend and stale):** resend a pending request from the Publish Requests Inbox: a reminder appears in the existing thread (no new top-level message); open the buttons of a closed request: inbox shows "No Pending Request" and nothing happens.
- **MV10 (uninstall):** remove the app from the Slack workspace; the card shows reconnect-needed; subsequent request emails still deliver email only; no errors returned to Adobe's worker.
- **MV11 (rotation):** `wrangler secret put EMAIL_RELAY_API_KEY` with a new value; update the Adobe-side key via the contact; the old key is rejected, the new one works; no code redeploy.
- **MV12 (privacy check):** search Slack message JSON and Cloudflare logs for the IMS token, relay key, and bot token (none).

## 7. Sandbox accounts and credentials needed

| Need | Why | Notes |
|---|---|---|
| GitHub admin on `jazhou-adobe/ew-extensions` | Code Sync (from #1) | owner |
| Adobe IMS identities A (author, `basic_author`) and B (approver, `basic_publish`) with DA access to the org/site; config-write permission for the admin | MV1 to MV7 | the approver B email must be a Slack sandbox user email |
| EW org/site onboarded to Request Publish with `apiUrl` = dev worker and an allowed test email domain | MV4 to MV9 | requires the AEM Engineering contact (Question 2); if unavailable, MV4 to MV9 degrade to synthetic payload replay with `curl` and fixtures |
| Cloudflare account with `wrangler login`; a KV namespace per environment | deploy | owner decision (Question 13) |
| Slack Developer Program account and a basic sandbox (https://docs.slack.dev/tools/developer-sandboxes) with an approver user and a channel | Slack testing | sandbox users have a fixed email identity; basic sandbox: 2 workspaces, 1-month inactivity archive |
| Slack app (dev) from the manifest: signing secret, client id/secret | OAuth and signatures | prod gets a separate app |
| Throwaway relay key and encryption/state keys | secrets | generated per environment, set with `wrangler secret put` |
| Optional upstream email provider key (e.g. a SendGrid sandbox) | RL1 manual proof | skip for chat-only |
| Chrome | `ref=local` loop | as #1 |

Hermetic automated tiers (sections 1 to 5) need none of the above.

## 8. CI additions (no credentials, no Cloudflare login)

Extends the #1/#2 workflow (same triggers: `push` and `pull_request`, Node 22 with wrangler's floor, `npm ci`):

| Job | Steps |
|---|---|
| `lint` (existing) | ESLint + Stylelint over the extension; S3 checks UR1 to UR6 |
| `unit` (existing) | WTR admin page tests WB1 to WB8 |
| `worker-unit` (from #2) | `npm run test:worker` includes this extension's IN, RL, SL, SG, OA, AD, PV, SC, UK groups |
| `worker-smoke` (from #2) | SM1 to SM5 with local fakes; advisory if flaky, per #2 |
| `e2e` (existing) | adds E2E1 to E2E5 (worker + fake Slack/DA/IMS servers) |

No Slack, Cloudflare or Adobe secrets in CI.

## 9. Acceptance-criteria traceability (ticket #20)

| # | Acceptance criterion (#20) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | A Request Publish submission produces a Slack message to the mapped approvers/channel with preview and diff links | IN1, IN4, IN5, IN7, RL1 to RL5, RL8, SL1, SL4, SL9; E2E2; SM3 | **MV5** (real submission to Slack with working links), **MV4** (real payload capture closes the parser assumption), MV9 (reminder) |
| AC2 | Approve / Reject act as the approver (or deep-link into the inbox if identity cannot be bound) and the outcome is posted back into the thread | SL3 (link buttons only, correct inbox URL), SG6 (ack), RL6, RL7, SL8 (outcome reply + message update), IN4 (outcome classification); E2E3 | **MV6** (approve as self through the inbox, outcome in thread), **MV7** (reject reason), MV9 (stale links harmless). Review: Implementation Decision 6 documents why identity cannot be bound and the reconsideration conditions |
| AC3 | Slack request signatures are verified; Slack bot install (OAuth) is handled by the worker | SG1 to SG9 (signature matrix, replay window, raw body, challenge), OA1 to OA9 (state, code exchange, encrypted token, errors, disconnect), SL10, SC1, SC4; E2E1, E2E4; SM2, SM3 | **MV3** (real Slack OAuth consent through the worker), **MV8** (unsigned/old-timestamp requests rejected on the deployed worker), MV10 (uninstall handling) |
| AC4 | Relay is structured so Teams only adds a provider | PV1 to PV6 (fake provider registered with no core change; conformance suite; namespaces; isolation; non-email addressing), WB7 (descriptor-driven UI), UR3 (no provider names in core) | Review: provider contract table in Build Analysis 5.3 matches what #59 needs; #59 spec consistency check; hand-off note (build step 14) |
| AC5 | Self-contained `chat-approvals` folder with README covering setup, the EW config-sheet row, and any site config it reads | UR1, UR2, UR6 (structure, README table, no imports out of folder) | **README review checklist:** setup steps, the `apps` row, Request Publish prerequisites and the Adobe `apiUrl`/key values, the statement that no site config is read, Slack setup under `providers/slack/README.md`; walk-through by a reviewer on a clean clone; **MV1**, **MV3** |
| AC6 | Listed in the repo README extensions table and reachable from its host platform | UR2 (table row and folder/entry consistency) | **MV1/MV3** (opens via the direct URL), Apps card check after adding the `apps` row at `https://da.live/apps#/{org}/{site}` |
| AC7 | Works in EW with `ref=local` and with a branch ref | WB6 (origin constant per host), E2E1 to E2E5 (local loop with real worker and fakes) | **MV1** (`ref=local`), **MV3** (branch ref against the deployed dev worker; records real `Origin`), MV2 |
| AC8 | Vendor credentials only in the worker (from the template); browser never receives them; unauthenticated calls rejected | SC1 to SC5 (canaries, matrix, no CORS on machine routes, no plaintext token in KV), IN2, SG2, OA1, AD1, AD2, PV6, UR5, UR6, WB6, WB8; E2E4, E2E5; SM1, SM5 | **MV8** (unauthenticated calls to the deployed worker), MV11 (rotation), MV12 (no secrets in Slack/logs), DevTools check in MV1/MV3 |
| AC9 | Core logic covered by unit tests; lint and CI green | Sections 1 to 5 run in `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` on every push and PR | Review: CI green on the PR; deliberately weaken a rule on a scratch branch (loosen the signature window; add `slack` into core) and see SG3/UR3 fail |

Every acceptance criterion on #20 maps to at least one automated test and at least one numbered manual or review step above.

## 10. Open questions for the owner

1. **Template extension (E1 to E7).** #2 allows only IMS-authenticated routes, JSON responses, no KV, no per-install credentials. Do you accept extending the template (named per-route authenticators, raw body to authenticators, KV binding on the handler context, HTML responses, no-CORS machine routes, dynamic outbound credential) as a prerequisite PR against #2? If not, this extension cannot meet AC8 for machine callers on the shared pipeline.
2. **Adobe onboarding and policy.** Will the AEM Engineering contact register a personally hosted relay as `apiUrl` for a test org/site (customer approver emails and notes flow through it)? Who contacts them, and does the Adobe outside-activity / data-handling policy (R1) permit it? Without this, MV4 to MV9 fall back to synthetic payloads.
3. **Direct approve from Slack.** Confirm the deep-link-only decision (identity cannot be bound; no stored IMS tokens; no service `publish` key). Is there any Adobe-supported delegated approval or token exchange you can ask the EW team about?
4. **Real email payloads.** I could not read Adobe's private worker, so subject text, HTML, which events send mail, and outcome recipients are assumptions until captured. Is capturing them through the dev worker (MV4, redacted, dev-only logging) acceptable? Does your site use Request Publish **v1** or **v2** (multi-step)?
5. **Storage.** Accept Workers KV (eventual consistency, 1,000 writes/day Free) with encrypted tokens, or choose D1/Durable Objects now?
6. **Mapping home.** Channel mapping and delivery mode are stored in the worker and edited in the admin app (the relay cannot read DA config without a user token). Accept, or do you prefer a DA config tab (needs a service credential that does not exist)?
7. **Who may configure.** Accept "caller has DA config write permission, checked by forwarding the caller's token to `admin.da.live` only" (unverified `X-da-actions` behaviour), with a user-id allowlist fallback? This is an exception to #2's "never forward the token".
8. **Slack distribution model.** Single-workspace private app per deployment (this spec) vs a distributed multi-tenant app later (Marketplace review, secrets management).
9. **Privacy defaults.** Is it acceptable to post author email and the author's note (truncated, escaped) into Slack channels by default? Should the note be opt-in?
10. **Default delivery.** Channel when mapped else DM; cc not notified. Agree?
11. **Bot channel access.** Require inviting the bot to channels (default), or add `chat:write.public` (broader permission)?
12. **Upstream email.** Should the sandbox run chat-only, or do you have an email provider key to prove email passthrough (RL1, MV5)?
13. **Cloudflare account and environments.** Which account, Free vs Paid, and the `dev`/`prod` naming; separate Slack apps per environment (assumed).
14. **`apps` row path form.** Full `https://da.live/app/...` URL (as #1 documents) or the relative `/app/...` form shown in the Request Publish doc?
15. **Reject button.** Both buttons open the same inbox page (there is no pre-opened Reject). Keep two labelled buttons, or a single "Review in Inbox" button to avoid implying two different destinations?
