# Spec: Workfront / Jira Link: Jira Cloud (provider)

Ticket: jazhou-adobe/ew-extensions#17 (this spec: #55). Blocked by #16 (Workfront plugin shell + first tool; spec in `apps/work-management-link/SPEC.md`), which itself is blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). #17 blocks nothing.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #16 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Atlassian/Adobe/Cloudflare.

Vocabulary follows #1, #2 and #16: *extension* = one folder `apps/<name>/` (this one is the **library plugin** `work-management-link`); *worker* = the per-extension backend (`apps/work-management-link/worker/`, built from `shared/worker-template/`); *template* = `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *shell*, *provider*, *work item*, *link*, *publish event* as defined in #16. Added here:

- **Atlassian site** = the customer's Jira Cloud site (`https://<name>.atlassian.net`); **cloudId** = the site's UUID, which Atlassian's API gateway requires in every request path.
- **3LO app** = the OAuth 2.0 (3LO) integration created in the Atlassian developer console; it owns the client id and client secret.
- **Connection** = the one stored, encrypted Atlassian grant (access token, rotating refresh token, cloudId, granted scopes) that the worker uses for every Jira call. **Connected account** = the Atlassian user who consented; every comment and transition the worker makes is attributed to that account.
- **Connection admin** = an Adobe IMS user the operator has allow-listed to connect, reconnect or disconnect the Jira connection.
- **Issue** = a Jira record. Atlassian's current UI and docs say "work item" (for example in the JQL field reference); the REST API and its paths still say `issue` [VERIFIED: https://support.atlassian.com/jira-software-cloud/docs/jql-fields/ and the REST paths in https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json]. This spec uses "issue" for API-level statements and the shell's "work item" wording only in author-facing copy [OPEN Q19].

---

**Interface assumptions about #16.** `apps/work-management-link/` contains only #16's SPEC.md today (directory listing, 2026-11-16; no code exists, and `providers/jira/` is created by this task). This spec therefore implements against the provider contract **as specified in #16** (Implementation Decisions 2 to 5, 14 to 16, 19 to 23, 31 to 35; Testing Decisions seams W1/P1/S2/S1/W2/S3; Build Analysis sections 4 to 7) and states every point where it relies on something #16 leaves implicit. This spec does not redesign the shell.

#16's contract is *closed*: `describe`, `parseReference`, `search`, `get`, `create`, `lookup`, `postPublishUpdate`, a seven-code error taxonomy, a normalised item, a `describe` field "whether it needs user-level connection (`service` only in this ticket)", a reserved descriptor `connection` field, and "an optional per-provider browser hook" reserved for "a Jira OAuth connect button". Workfront needs none of the machinery below because it authenticates with a client-credentials grant that needs no human and no durable state. **Jira's OAuth 2.0 (3LO) is an authorization-code grant with rotating refresh tokens**, so it needs eight small, additive, optional extension points that #16 names only in passing (X1 to X8 in the table below). Each is defaulted so that Workfront and #16's test-only provider are unaffected. Whether #16's implementation carries them is the single biggest risk to AC4 ("no changes needed in the shell beyond registering the provider"); see R1, build-plan step 0 and Open Question 1.

| # | Extension point Jira needs | What #16 already says | Proposed shape (additive and optional) |
|---|---|---|---|
| X1 | Provider-declared descriptor fields: `connection` = `{ mode: 'service', setup: 'oauth' }` (Workfront: `{ mode: 'service', setup: 'none' }`), the provider's setting keys with validators, the names of its secrets **and** non-secret vars | `describe` carries id, label, item types, create fields, lookups, id pattern, connection kind, secret names; "descriptor `connection` field reserved" | Same `describe`, three more optional fields (`settings`, `vars`, and the `setup` value) |
| X2 | A server-side connection API: `connectionStatus`, `startConnect`, `completeConnect`, `disconnect`, mounted by the shell under provider-scoped routes, with the shell enforcing authentication and the admin gate | Not in the closed operation list. #16 puts "Jira's OAuth connect flow and token refresh" out of scope for itself | Optional operations; the shell mounts `GET .../connection`, `POST .../connection/start`, `DELETE .../connection` (IMS-authenticated) and one public `GET .../oauth/callback` (authenticated by the single-use `state`) |
| X3 | A provider-scoped durable store with compare-and-set, TTL and consume-once semantics, backed by D1 and an in-memory fake, behind the same store port as links | #16's store port covers links, settings, events and leases only | `ctx.state` with `get`, `putIfVersion`, `putIfAbsent`, `consume`, `delete`, namespaced by provider id; one generic table, reserved in the shell's first migration |
| X4 | Provider context with proxy, secrets accessor, logger, injected clock, `sleep`, `random` | Implied: the Workfront provider uses `proxy` and the secrets accessor; tests inject clock and `sleep` | `ctx` as in #2's handler context plus the three injected primitives |
| X5 | Public OAuth callback route with a non-IMS authenticator, an HTML response and no CORS | #2 decision 4: "no unauthenticated routes other than OPTIONS"; the sibling spec `apps/chat-approvals/SPEC.md` section 7 already asks #2 for exactly this (E1 per-route authenticators, E4 HTML response, E5 no-CORS routes) | Reuse those requests verbatim; this spec adds a fallback if #2 refuses (decision 12) |
| X6 | Browser hook slot for the connect panel | "Optional per-provider browser hook ... reserved for ... a Jira OAuth connect button" | `mountConnection(container, api)` registered in the plugin's browser-side registry (a third registration line) |
| X7 | Provider-scoped operator allow-list for status targets and provider-prefixed per-site settings keys | #16 decision 21: "ALLOWED_PUBLISH_STATUSES (default empty)", per-provider-and-type target keys such as `workfront.task.on-publish-status` | Allow-list entries are `<provider>.<type>:<value>`; provider keys are validated by the descriptor's `settings` schema (X1) |
| X8 | A scheduled maintenance hook so the worker keeps the connection alive when nothing is published for months | #16: the scheduled handler only polls and delivers | Optional provider operation `maintain`, called at most once per tick with the injected clock; a no-op for Workfront |

If #16 is built without these, build-plan step 0 adds them as the first, smallest commit **in the shell**, driven by this spec and exercised by #16's test-only provider extended to declare `setup: 'oauth'`; the sentence in #17's AC4 is then read as "no change to the behaviour of existing providers, and none beyond registering the provider for any later one". This is flagged for the owner (Open Question 1) rather than assumed settled.

---

## Problem Statement

A content author in Experience Workspace (EW) whose team tracks content work in **Jira Cloud** has the same problem #16 solves for Workfront: the page and its ticket live in two tools with nothing connecting them. The author copies the page URL into the issue by hand, keeps a second tab open to see whether the issue is still open, who has it and when it is due, and has to remember to go back after publishing to say the work is live. Project leads cannot tell from the issue whether the page went out.

Contentful's Jira Cloud app (https://www.contentful.com/help/apps/jira-app/) shows that editors want this inside the editor: it authenticates with Jira once, lets the admin pick one Jira site and one project, shows linked tickets in the sidebar and allows unlimited issues per entry [VERIFIED: that page]. It is one-way, needs a Jira admin to install a Connect app so that Jira can store link metadata, and is Jira-only. #16 builds the provider-agnostic shell with Workfront as the first tool; #17 must add Jira as **a module in the same plugin**, not a second plugin.

Jira makes this harder than Workfront in four ways, each of which shapes this spec:

1. **Authorization needs a human, once.** Atlassian's OAuth 2.0 (3LO) is an authorization-code grant: someone must consent in a browser. There is no client-credentials grant for a normal 3LO app, and the implicit flow is not supported [VERIFIED: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/, "Implicit grant flow not supported"]. The browser extension cannot hold a client secret, so the consent round trip has to end at the worker.
2. **Refresh tokens rotate.** Every refresh returns a new refresh token and disables the old one; a refresh token expires after 90 days of inactivity; failing to persist the new one locks the integration out [VERIFIED: same page, "Use a refresh token to get another access token and refresh token pair"]. The worker must therefore store tokens durably, encrypted, and refresh them safely even when a user request and the cron-driven poller race.
3. **No human is present when the page is published.** The poller posts the comment and transition with no author on the line, so the grant it uses must be one that outlives any browser session. 
4. **Jira's vocabulary differs.** A Jira status is a named step in a per-project workflow; you do not "set" a status, you perform a *transition* that the workflow offers from the current status. Issue keys can change when an issue moves projects. Comments are Atlassian Document Format (ADF), not text. The API enforces a points-based hourly quota in addition to per-second and per-issue-write limits [VERIFIED: https://developer.atlassian.com/cloud/jira/platform/rate-limiting/].

The work cannot be a browser-only extension for the same reasons as #16: publishing is an event that happens whether or not EW is open, and the Jira credentials must never reach the browser.

## Solution

**Jira Cloud appears in the Work Item plugin as a second provider.** For the author it behaves like Workfront: search Jira by words or paste an issue link or key, or create an issue, and link it to the page; the card shows the issue's key and summary, status, assignee and due date, with an "open in Jira" button and the state of the last publish update; when the page is published the worker comments on the linked issue and/or transitions it, as configured per site, with nobody having to have EW open.

What is new for the operator is a one-time **Connect Jira** step. An allow-listed connection admin opens the plugin, presses Connect, signs in to Atlassian in a new tab, consents (the consent screen names the app and the scopes), and is redirected to the worker, which exchanges the one-time code for tokens, stores them **encrypted at rest**, and from then on refreshes them on demand. Everything the worker does in Jira is done as that connected account (recommended: a dedicated Atlassian user for the integration, not a person), so the author sees and can link whatever that account can see, and notes carry the page and publisher in their text. The plugin shows the connection state (`not_connected`, `connected`, `needs_reconnect`, `error`) to everyone and offers Connect, Reconnect and Disconnect to connection admins.

Under the hood Jira is one module that implements #16's closed provider contract unchanged for the seven operations, plus the additive extension points X1 to X8 above. The shell, the poller, the ledger, the link store, the routes and the plugin UI stay as #16 specified. The Jira module owns: JQL construction (with escaping), the issue-to-item normalisation, ADF construction, transition resolution, the comment-marker idempotency check, and the token manager (encrypt, refresh with a compare-and-set lease, persist before use). Jira credentials live only in this extension's worker: the client secret and the token-encryption key are worker secrets, the tokens are encrypted before they reach D1, and the browser only ever sees normalised, allow-listed fields and a connection status.

## User Stories

Content author (EW editor):

1. As a content author, I want Jira to appear alongside Workfront in the Work Item plugin, so that I do not need a second plugin for the tool my team uses.
2. As a content author, I want to search Jira by words from an issue's summary, so that I can find the ticket without knowing its key.
3. As a content author, I want to paste a Jira issue link (including a board or backlog link that carries a selected issue) or just a key such as `WEB-123`, so that I can link the ticket I already have open.
4. As a content author, I want results to show the key, summary, status and assignee, so that I pick the right issue and not a look-alike.
5. As a content author, I want a link from a different Jira site to be refused with a clear message, so that I cannot link something the integration cannot reach.
6. As a content author, I want to link the chosen issue to the current page with one click, so that the connection takes seconds.
7. As a content author, I want the link to be saved with the page and visible to every author on every browser, so that my colleagues see the same ticket (the #16 meaning of "stored with the page").
8. As a content author, I want to create a new Jira issue from the plugin with a summary and optional description, so that I can start tracking the page without switching tools.
9. As a content author, I want the created issue to carry links to the page's edit URL and live URL, so that people who start in Jira can reach the page.
10. As a content author, I want a created issue to be linked to the page automatically, and a "Link now" retry if linking fails after creation, so that a hiccup never creates a duplicate issue.
11. As a content author, I want the card to show the issue's status, assignee and due date, so that I know whether the work is on track without opening Jira.
12. As a content author, I want "Unassigned" and "No due date" shown plainly when those are empty, so that an empty value is not mistaken for a loading error.
13. As a content author, I want a button that opens the issue in Jira in a new tab, so that I can read the full ticket and discussion.
14. As a content author, I want to unlink or replace the linked issue (with a confirmation), so that I can fix a wrong link or follow a re-scoped ticket.
15. As a content author, I want the card to refresh when I reopen the plugin and to have a Refresh action, so that I see status changes made in Jira.
16. As a content author, I want to see whether the last publish update reached Jira (waiting for first publish, sent with time, failed with a reason, skipped by configuration), so that I know the ticket is up to date.
17. As a content author, I want a Retry button when the update failed, so that I can recover without asking an admin.
18. As a content author, I want a plain message when Jira is not connected or the connection has expired ("ask a Jira connection admin to reconnect"), with no jargon and no vendor error text, so that I know whom to ask.
19. As a content author, I want search and create to be disabled with an explanation while Jira is not connected, so that I do not see confusing errors.
20. As a content author, I want a Jira issue I cannot be allowed to see to look the same as a missing issue ("not found or no access"), so that the plugin does not reveal what exists.
21. As a content author, I want the plugin to keep working with the keyboard and with status shown as text, so that it is usable by everyone.
22. As a content author, I want the plugin never to change my document, so that linking cannot interfere with my editing session.

Connection admin (operator or delegate):

23. As a connection admin, I want a Connect Jira button that sends me to Atlassian's own consent screen, so that I never type Atlassian credentials into the plugin.
24. As a connection admin, I want the consent screen to show exactly which permissions are requested (read and write Jira work, offline access), so that I can judge the grant before approving.
25. As a connection admin, I want to see "Connected to <site name>" with the time it was connected, so that I know it worked and which site it is.
26. As a connection admin, I want connecting to fail with a clear message if the account has no access to the configured Jira site or the grant lacks a needed permission, so that a half-working connection is never stored.
27. As a connection admin, I want to Reconnect when the connection has expired or been revoked, so that updates resume without redeploying anything.
28. As a connection admin, I want to Disconnect, so that I can remove the stored tokens (and I understand that revoking the app in the Atlassian account's connected-app settings is the Atlassian-side step).
29. As a connection admin, I want non-admins to be unable to connect or replace the connection, so that no one can re-point the integration at their own Atlassian account.
30. As a connection admin, I want my own IMS user id shown (to me only) when I am not on the allow-list, so that I can ask the operator to add it.

Site administrator:

31. As a site administrator, I want to enable Jira by adding `jira` to the `providers` setting in the existing config tab, so that rollout stays copy-paste.
32. As a site administrator, I want to choose per site whether publishing posts a comment, transitions the issue, both or nothing, using the same `on-publish` key as Workfront, so that one policy covers both tools.
33. As a site administrator, I want to name the Jira status that issues move to on publish (for example `Done` or `Ready for QA`), so that "published" maps to my own workflow.
34. As a site administrator, I want a transition to be skipped when the issue is already in that status or already done, so that publishing never rewinds finished work.
35. As a site administrator, I want a clear failure reason when my workflow does not allow that transition or the transition needs extra fields, so that I can fix the workflow or choose another status.
36. As a site administrator, I want a default Jira project key and issue type for issues created from EW, so that authors are not asked what they cannot know.
37. As a site administrator, I want to restrict search to specific Jira projects, so that authors only see relevant issues.
38. As a site administrator, I want invalid Jira settings reported with safe defaults used, so that a typo never causes a surprising transition.
39. As a site administrator, I want the comment text to use #16's placeholders, so that Jira and Workfront notes read the same way.

Jira administrator:

40. As a Jira administrator, I want the integration to act as one named Atlassian account I can see, scope and revoke, so that its access is auditable.
41. As a Jira administrator, I want the integration to be limited to the Jira projects that account can access, so that linking cannot expose the rest of the site.
42. As a Jira administrator, I want the app to request the narrowest classic scopes that cover the features, so that the consent is not broader than needed.
43. As a Jira administrator, I want automatic comments to say they come from the EW integration and which page was published, so that they are recognisable in the issue.
44. As a Jira administrator, I want one publish never to post the same comment twice and never to flood an issue, so that watchers are not spammed.

Project lead (reads Jira):

45. As a project lead, I want a comment on the issue when its page is published, with the live URL, so that I know the work is live without asking.
46. As a project lead, I want the issue to move to the agreed status automatically when configured, so that the board reflects reality.
47. As a project lead, I want an issue created from EW to point back to the page, so that I can open the page from the issue.

Maintainer (this repo):

48. As the maintainer, I want Jira to be one module passing the shared conformance suite with no change to the existing providers' behaviour, so that "Jira only adds a module" is a tested property.
49. As the maintainer, I want the Atlassian client secret and the token-encryption key only in the worker's secret store, never in the browser, git, logs, responses or D1, so that a public repo and a public site cannot leak them.
50. As the maintainer, I want refresh tokens encrypted at rest and every credential write compare-and-set, so that a D1 dump leaks nothing usable and two workers cannot overwrite each other's rotated token.
51. As the maintainer, I want a refresh failure to be classified (revoked or expired grant versus transient outage), so that a short Atlassian outage never forces a reconnect and a revoked grant never causes a refresh storm.
52. As the maintainer, I want the connection kept alive when nothing is published for weeks, so that the 90-day inactivity expiry never silently disables the integration.
53. As the maintainer, I want the Atlassian rate limits (hourly points, per-endpoint burst, per-issue write) handled by the template's retry and the shell's bounded concurrency, so that a bulk publish degrades gracefully.
54. As the maintainer, I want every Atlassian API claim in the README backed by a primary-source URL or tagged as unverified, and a sandbox spike scheduled before the build, so that unknowns are retired early.
55. As the maintainer, I want a recorded-fixture contract test, so that the in-memory fake Jira cannot drift from the real API.
56. As the maintainer, I want the extension README to cover the Atlassian app setup, callback URL, secrets, vars, site config keys, connect procedure and local development, so that someone else can deploy it.

Security reviewer:

57. As a security reviewer, I want proof that the OAuth `state` is random, single-use, short-lived and bound to the connection admin who started the flow, so that the callback cannot be driven by another user or replayed.
58. As a security reviewer, I want proof that the callback route never reflects request data, sets no CORS headers, refuses a request carrying an `Origin` header and responds with a locked-down static page, so that it is not an XSS or CSRF vector.
59. As a security reviewer, I want proof that user text (search words, keys, summaries, project keys, comment templates) cannot change which host, path or JQL structure the worker uses, so that the worker is not an SSRF or JQL-injection vector.
60. As a security reviewer, I want proof that Atlassian response fields are reduced to an allow-list before reaching the browser (no emails, account ids, avatar URLs, descriptions, comments, custom fields), so that Jira data is not leaked beyond what the card needs.
61. As a security reviewer, I want proof that only `auth.atlassian.com` and `api.atlassian.com` are ever contacted, so that the worker cannot be pointed elsewhere.
62. As a security reviewer, I want unauthenticated and wrongly-originated calls to every Jira-related route rejected before any vendor or store access, so that the worker cannot be used as an open Jira proxy.

## Implementation Decisions

(No file paths or code, except type shapes that encode a decision. Paths and layout are in the Build Analysis. Decisions here extend #16's numbered decisions; they do not repeat the shell's behaviour.)

**Identity and connection model**

1. **One site-level connection, 3LO, as a named account.** The worker holds exactly one Jira connection per deployment, created through OAuth 2.0 (3LO) by a connection admin consenting as a dedicated Atlassian account. All Jira reads and writes, including the unattended publish updates, use that connection. Reasons: the poller runs with no user and needs a grant that outlives sessions (a per-author grant would make an author's departure break publish updates for their pages); #16's contract says `connection` is `service` in this ticket; Workfront already uses one technical account (#16 decision 26), so authors get the same model for both tools; Contentful's app likewise authenticates once for the whole space and picks one site [VERIFIED: https://www.contentful.com/help/apps/jira-app/]. Consequence (documented, as for Workfront): the connected account's visibility, not the author's, defines what authors can find and link; attribution of automatic notes is in note text. The storage keys carry a `connection id` (`site` today) so that per-user connections (`user:<ims id>`) can be added later without a migration. Per-author Jira identity is out of scope [OPEN Q3].
2. **The ticket says 3LO; 2LO service-account credentials are noted, not built.** Atlassian also offers OAuth 2.0 credentials for **service accounts** (client-credentials grant, `grant_type=client_credentials` at `https://auth.atlassian.com/oauth/token`, 60-minute tokens, scopes chosen on the credential, requires the centralised user-management experience and an organisation admin) [VERIFIED: https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts]. That is the Jira twin of Workfront's Server-to-Server credential: no consent screen, no refresh tokens, no callback. #17 states "using Atlassian OAuth 2.0 (3LO)", so 3LO is the specified path. The token manager is isolated behind one internal seam (get a valid access token for the connection) so that a 2LO source could replace the stored-refresh-token source without touching the Jira operations. Whether the service-account route works with the cloudId discovery and the scopes this spec needs is [OPEN] and is the owner's call (Q3).
3. **One Atlassian app per deployment, owned by the operator; policy note.** The operator creates one 3LO app in the Atlassian developer console, adds the Jira platform REST API with the classic scopes below, sets the callback URL, and enables sharing if the connected account is not the app owner (a private app can only be installed by its owner; sharing yields an authorization URL to distribute) [VERIFIED: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/, "Distributing your OAuth 2.0 (3LO) apps"]. Users consenting to an unreviewed shared app see a warning that Atlassian has not reviewed it; review is optional [VERIFIED: same section]. Atlassian's guidance prohibits third-party apps that store customers' API tokens or ask each customer to create its own 3LO app; the supported pattern is one centralised distributable app [VERIFIED: https://www.atlassian.com/blog/development/building-secure-and-scalable-integrations-our-guidance-for-third-party-apps]. A deployment that serves only the operator's own Jira site with the operator's own app is outside the pattern that guidance targets [ASSUMPTION; not stated]. Anyone who deploys this extension for other organisations would need to revisit this (R10, Q5).
4. **Scopes, least privilege, classic.** The worker requests `read:jira-work`, `write:jira-work` and `offline_access` (needed to receive a refresh token [VERIFIED: 3LO page]) and nothing else. The REST reference lists `read:jira-work` for search, get issue, get transitions, get comments, project search and create metadata, and `write:jira-work` for create issue, add comment and transition [VERIFIED per operation: https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json, `x-atlassian-oauth2-scopes`]. `read:jira-user` is requested only if spike J1 shows the assignee's display name is not returned without it [ASSUMPTION: it is]. Granular scopes are listed as "Beta" in the same reference and are not used. The connected account's project permissions also constrain every call regardless of scopes [VERIFIED: 3LO page]: Browse projects (search, read, comments), Create issues (create), Add comments (comment), Transition issues (transition) [VERIFIED: permission lines in the same reference].
5. **The Jira site is pinned by configuration.** A worker var `JIRA_SITE_URL` (for example `https://acme.atlassian.net`) names the site. At connect time the worker selects the `accessible-resources` entry whose `url` equals it and stores that entry's cloudId; if there is none, connecting fails (`site_not_accessible`) and nothing is stored. Authors never choose a site, and the worker never builds a request to a site hostname: all calls go to `https://api.atlassian.com/ex/jira/{cloudId}/...` [VERIFIED: 3LO page, section 3.2], with `{cloudId}` validated as a UUID before it is placed in a path. The "open in Jira" URL is built from `JIRA_SITE_URL` and the issue key.

**Connect flow**

6. **Who may connect.** Connect, Reconnect and Disconnect require an IMS user id in the worker var `JIRA_CONNECTION_ADMIN_USER_IDS`; the default is empty, which disables connecting (closed by default). Everyone with a valid token may read the connection status (state, site name, connected time, `canManage`); the status never contains tokens, the connected account's identity or the admin list. A non-admin sees their own IMS user id in the plugin so that they can ask the operator to add it. Rationale: whoever connects chooses which Atlassian account every Jira action runs as, so the gate is stricter than #16's optional caller allow-list.
7. **Flow (browser, worker, Atlassian).** (a) The connection admin presses Connect; the plugin calls the authenticated `start` route. (b) The worker checks the admin gate, creates a random `state` of at least 128 bits, stores `{ userId, createdAt }` under its hash with a 10-minute TTL via the state port (decision 11), limits pending states per user (oldest evicted), and returns the authorize URL: `https://auth.atlassian.com/authorize` with `audience=api.atlassian.com`, `client_id`, `scope`, `redirect_uri`, `state`, `response_type=code`, `prompt=consent` [VERIFIED: 3LO page, section 1]. (c) The plugin opens that URL in a new tab (only if its host is `auth.atlassian.com` over https) or, if popups are blocked, shows it as a link with a copy button. (d) After consent Atlassian redirects the browser to the worker's callback `redirect_uri` with `code` and `state`. (e) The callback atomically consumes the `state` (single use, within TTL), exchanges the code at `https://auth.atlassian.com/oauth/token` (JSON body: `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`) [VERIFIED: 3LO page, section 2], calls `accessible-resources` with the new access token, selects the pinned site (decision 5), checks the granted `scope` covers the required ones, encrypts and stores the connection, and returns a static HTML page ("Jira is connected. You can close this tab."). (f) The plugin, which polls `GET .../connection` every 2 seconds for at most 5 minutes while a connect is pending, shows `connected`. **No `window.opener`/`postMessage` dependency**: Atlassian's pages may sever the opener, and the extension iframe's sandbox attributes are not documented [OPEN: confirmed in J1/M-J2]; polling works regardless. PKCE is not part of Atlassian's documented 3LO flow, and the `state` binding is what the page documents for CSRF protection, so none is used [VERIFIED: the page documents no PKCE parameters; the `state` rationale is in its FAQ].
8. **Callback hygiene.** The callback route: accepts only `code`, `state` and the `error`/`error_description` pair Atlassian sends on denial; never reflects any request value into the response; has no CORS headers and refuses any request that carries an `Origin` header (a top-level browser navigation does not send one for GET [ASSUMPTION; verified in M-J2], so legitimate use is unaffected); returns a static page with `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; consumes the `state` before it calls Atlassian; never retries the code exchange (an authorization code is single-use); logs error codes only, never the query string. A denied or failed consent shows a friendly, static, generic message.
9. **Disconnect and reconnect.** Disconnect deletes the stored connection. The 3LO documentation describes no token-revocation endpoint, so the README tells the admin to remove the app from the Atlassian account's connected apps as the provider-side step [ASSUMPTION: location of that setting; no primary page read; J7 verifies]. Reconnect replaces the record atomically (new version), after which the old refresh token is unreachable by the worker. A disconnected state makes Jira calls fail with `auth_failed` (reason `not_connected`); pending events then fail with that reason and can be re-queued with Retry after reconnecting.
10. **Client id is a worker var; the secret is a secret.** `JIRA_CLIENT_ID` appears in the authorize URL the browser must follow, by Atlassian's design [VERIFIED: authorize URL in the 3LO page], so it is not a secret and lives in `vars`; `JIRA_CLIENT_SECRET` and `JIRA_TOKEN_ENCRYPTION_KEY` are Cloudflare secrets in `secrets.required`. (This differs from #16's treatment of the Workfront client id; the difference follows from the flows. The repo check from #16/#2 that rejects secret-looking `vars` names is unaffected because `JIRA_CLIENT_ID` does not match its patterns.) The redirect URI is the var `JIRA_OAUTH_REDIRECT_URI` (full URL, must be https in production, must equal the callback URL registered in the Atlassian app, and must end with the shell's callback path).
11. **Durable state through the shell's state port (X3).** Jira stores two kinds of records through the provider-scoped state port: the encrypted connection record and pending OAuth `state` entries (TTL, consume-once). It does not touch D1 directly. In tests the port is in-memory; in production it is the D1 table the shell's first migration reserves; one contract suite runs against both (extending #16's SC1) so the fake cannot drift. If #16 did not reserve this table, adding it is the one migration this ticket contributes (X3 in step 0).
12. **Fallback if the template refuses the public callback (X5).** If #2 cannot support a non-IMS authenticated route, the callback becomes a **static page in this extension** (served from the EDS code bus) registered as the Atlassian callback URL; it shows the `code` and `state` (never calling the worker), the connection admin copies them into the plugin's connect panel, and the plugin posts them to an IMS-authenticated `complete` route on the worker, which performs the same `state` check and exchange. This is slower and clumsier but needs no template change. It is also tied to a single registered callback host (the production `main` code origin), so branch-ref and local testing then use a dev Atlassian app whose callback is the local page. Recorded as the fallback only; the primary design is the worker callback (Q2).

**Token store and refresh**

13. **Encrypted at rest.** The connection record stores the access token, refresh token and metadata (cloudId, site name, granted scopes, expiry, version, status, connected-by IMS user id, timestamps). Access and refresh tokens are encrypted with AES-256-GCM (Web Crypto, available in Workers) using a 256-bit key from the secret `JIRA_TOKEN_ENCRYPTION_KEY`, a fresh random 96-bit IV per write, and additional authenticated data binding the ciphertext to provider, connection id and field name so a ciphertext cannot be moved between records. A database dump or a D1 export therefore contains no usable token. Rotating the encryption key invalidates stored tokens and requires a reconnect (documented); a wrong key yields status `error` (operator problem) rather than `needs_reconnect` (grant problem). This introduces credentials into D1, which #16's data-minimisation decision 8 did not cover (it concerns item data); the README states it.
14. **Refresh on demand, with margin.** A valid access token is used while it has more than 2 minutes of life left (the lifetime comes from the token response's `expires_in`; this spec does not assume a value, as the 3LO page does not state one [VERIFIED: it documents only the field]); otherwise the token manager refreshes. A Jira call that returns 401 triggers exactly one forced refresh and one retry; a second 401 marks the connection `needs_reconnect`.
15. **Safe rotation: lease, persist-before-use, compare-and-set.** Refresh is single-flight inside an isolate and cross-isolate through a short lease and a version check in the state port: the winner takes the lease (a conditional write on the record's version), calls the token endpoint with the current refresh token, and writes the new pair with version+1 **before** the new access token is used; losers wait briefly and re-read instead of refreshing. The documented reuse interval of 10 minutes (breach detection does not apply when a refresh token is exchanged more than once within it, "to avoid network concurrency issues") [VERIFIED: 3LO page] is the safety net: if the write of a freshly rotated pair fails, the previous refresh token still works for ten minutes, so the writer retries and the next call recovers; the failure is logged by name only. [ASSUMPTION: what Atlassian returns for a second exchange of the same refresh token within the window (a second valid pair, or the same one); J7 observes it.]
16. **Failure classification.** On refresh: `403` with `invalid_grant` ("Unknown or invalid refresh token": expired refresh token, changed Atlassian password, or a refresh token that was not replaced) [VERIFIED: 3LO page] marks the connection `needs_reconnect` and stops all further refresh attempts until a reconnect (no refresh storms); `429`, `5xx` and network errors leave it `active` and surface as `rate_limited`/`unavailable`, retried by the template's `proxy` (the refresh POST is declared safe to retry because of the reuse interval in decision 15) and by later ticks; a response whose granted scopes no longer cover the required ones marks `needs_reconnect` with reason `scope_missing`. Authors see only the generic messages; operators get the reason code in logs and in the status route's `reason` field.
17. **Keep-alive.** A rotating refresh token expires after 90 days of inactivity, and each use issues a new one that restarts the 90 days [VERIFIED: 3LO page]. Because publishes can be months apart, the scheduled handler calls `maintain` (X8): if the last successful refresh is older than 30 days (injected clock), the token manager refreshes once. At most one maintenance call per tick; a failure is classified as in decision 16.
18. **The 90-day and password caveats are documented, not hidden.** If the Atlassian account's password changes, the refresh token stops working until reconnect [VERIFIED: 3LO page]; the README tells the operator to use a dedicated account with a stable credential and to monitor the `needs_reconnect` state (alerting is a follow-up, Q16).

**Provider module behaviour**

19. **Item type.** One item type, `issue` (label "Jira issue" [OPEN Q19: "work item"]). Descriptor create fields: `summary` (text, required, at most 255 characters [ASSUMPTION: Jira's limit; J4]), `description` (long text, optional, capped), `project` (lookup `project`, optional when a default project is configured). The issue type is a site setting, not a form field (Jira's issue types and their create fields are per project and dependent on it, which #16's flat lookup cannot express; this keeps the descriptor language unchanged).
20. **Identifier model.** The canonical item `id` is the issue's **numeric id** (stable when an issue moves projects or is renamed), validated by the descriptor's id pattern. A pasted key resolves through `get`, which accepts a key or an id [VERIFIED: https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json, `GET /rest/api/3/issue/{issueIdOrKey}`: "If the identifier doesn't match an issue, a case-insensitive search and check for moved issues is performed"], and returns the numeric id; the shell links what `get` or `search` returned. The `title` is `KEY: summary` (plain text), so authors see the current key without a normalised-item change; the `url` is `JIRA_SITE_URL` + `/browse/` + the issue key [ASSUMPTION: URL form; J2].
21. **`parseReference`.** Accepts: an issue key (`[A-Z][A-Z0-9_]*-<digits>`, case-insensitive on input [ASSUMPTION: Jira key rule; J3]); a bare numeric id; an https URL on exactly the `JIRA_SITE_URL` host whose path is `/browse/<KEY>` (query and hash ignored), or a software-board/backlog URL carrying a `selectedIssue` key [ASSUMPTION: URL shape; J2]. Rejects, with no vendor call: any other host (including look-alikes such as `<site>.atlassian.net.evil.example` and userinfo tricks such as `https://<site>.atlassian.net@evil.example/...`), `http://`, ports, and paths that are not an issue. This is the provider's half of #16's WS2.
22. **`search`.** Search is a JQL query through `GET /rest/api/3/search/jql`, the enhanced search that replaces `GET /rest/api/3/search`, which the reference marks "Currently being removed" [VERIFIED: swagger-v3 summaries]. It returns only the ids by default and therefore always sends an explicit `fields` list limited to the allow-listed fields (summary, status, assignee, due date, issue type) [VERIFIED: `fields` parameter description]. The JQL is built by the provider from escaped parts only: a text clause on the author's words (`text ~ "<escaped words>"`, the documented contains operator for the `text` field [VERIFIED: https://support.atlassian.com/jira-software-cloud/docs/jql-fields/]), an optional `project in (<validated keys>)` from the site setting, and `ORDER BY updated DESC`. The API requires a **bounded** query (a search restriction) and rejects, for example, a bare `order by` [VERIFIED: `jql` parameter description]; whether the text clause counts as bounded, whether prefix matching is available and how special characters behave are [OPEN] and settled in J3, which fixes the final JQL form. A query that looks like an issue key becomes a key lookup. Quotes, backslashes, JQL reserved characters and control characters in user text are escaped or rejected so they can never add clauses (tested as JQL-injection cases). The first page only is returned (`maxResults` at most the requested limit, hard cap 50); `nextPageToken` is never followed [VERIFIED: pagination is token-based; the token "will expire in 7 days"]. Recent writes may not appear immediately (documented eventual consistency) [VERIFIED: same page]; the shell never relies on search to find an issue it just created (decision 26).
23. **`get`.** `GET /rest/api/3/issue/{id}` with `fields` limited to summary, status, assignee, due date and issue type [VERIFIED: `fields` parameter]. A `404` is mapped to `not_found` and deliberately also covers "no permission", because the API returns `404` for both ("the issue is not found or the user does not have permission to view it") [VERIFIED: response descriptions], so the plugin cannot reveal which issues exist (story 20).
24. **Normalisation.** `status.code` = the status id, `label` = the status name, `phase` from the status category key (`new` to `open`, `indeterminate` to `in-progress`, `done` to `done`, anything else to `other`) [ASSUMPTION: the three key values; the schema documents a `key` field without listing them; J6]. `assignees` = the single assignee's display name only, or empty when unassigned (never account ids, emails or avatar URLs); an assignee without a usable display name becomes `Unknown user`. `dueDate` = the issue's due date (a date without time) as an ISO date, or null [ASSUMPTION: `duedate` is a `YYYY-MM-DD` string; J4]. Everything else is dropped at the provider boundary (#16 decision 4). `fetchedAt` comes from the injected clock.
25. **`lookup` (project).** `GET /rest/api/3/project/search` with `query` (matched against key or name), `maxResults` bounded (the API caps it at 100 [VERIFIED]; this provider uses at most 25) and `action=create` so that only projects where the connected account has *Create issues* are offered [VERIFIED: `action` enum `view`, `browse`, `edit`, `create` and its definition]. Options are `{ value: project key, label: "KEY: name" }`.
26. **`create`.** One `POST /rest/api/3/issue` with `fields`: project (by key), issue type (by name from the site setting; default `Task` [ASSUMPTION: exists in the project]), `summary`, and a `description` built as ADF containing the author's text and the page's edit and live URLs as plain text. Multi-line text fields take ADF, not strings [VERIFIED: create-issue description]. The POST response carries only id, key and self [VERIFIED: `CreatedIssue` schema], so the provider then reads the issue with `get` (the read is idempotent and uses the template's retries) and returns the normalised item; if that read still fails it returns an item built from the POST data with status `Unknown` (phase `other`) so that the shell can link and the card refreshes later. **The create POST is never retried on 5xx or timeout** (#16 decision 29): a flaky response must not produce duplicate issues. A `400` for missing or invalid fields becomes `invalid_input` with a generic code (`required_field_missing`, `project_or_type_invalid`), never the vendor's `errors` text; projects whose create screen has required custom fields are therefore not creatable from EW and the author is told to create in Jira and link [OPEN Q9].
27. **ADF construction.** Descriptions and comments are built by the provider from plain text: each line becomes a paragraph of `text` nodes inside a `doc` (version 1); `https://` URLs found in the text get a `link` mark; nothing from users or templates is ever parsed as ADF, markdown or HTML; control characters are stripped and the length capped [VERIFIED: ADF root structure `{version:1,type:doc,content:[paragraph...]}`: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/].
28. **`postPublishUpdate`, `comment`.** The shell passes the already-rendered plain text (#16 decision 22). The provider posts `POST /rest/api/3/issue/{id}/comment` with an ADF body made of that text plus a final paragraph carrying the event marker (`EW publish event <event id>`). Before any re-attempt of an event whose previous attempt ended ambiguously (timeout or 5xx after the POST may have landed), the provider lists the issue's most recent comments (newest first, at most 3 pages of 100, bounded) and searches the ADF text for the exact marker token; if found, it returns `sent` (reason `already_present`) and posts nothing (#16 decision 15). The comment is visible to everyone who can browse the project; role/group visibility restrictions are not applied in v1 [OPEN Q11]. Comments notify watchers by Jira's normal rules; the shell's one-event-per-observed-change and bounded concurrency are the flood control (R16).
29. **`postPublishUpdate`, `status`.** The target is the site setting `jira.issue.on-publish-status` (a status **name**) and must be in the operator allow-list (X7). The provider reads the issue (status name and category); if the issue is already in the target (case-insensitive name) it returns `skipped(already)`, and if its category is `done` it returns `skipped(already_done)`; otherwise it reads `GET .../transitions` (only transitions the user can perform from the current status are listed [VERIFIED: endpoint description]), selects the available transition whose `to` status name equals the target (lowest transition id when several lead to a same-named status), and performs `POST .../transitions` with that transition id (`204` on success) [VERIFIED: response codes]. No matching transition is a final failure `transition_unavailable` (a workflow that does not permit the move from here). A `400` caused by a transition screen that requires fields (for example Resolution) is a final failure `transition_requires_fields`; v1 does not set transition fields [OPEN Q8]. A `409` ("conflicting update") triggers a re-read: at the target means `skipped(already)`, otherwise a retryable `unavailable` [VERIFIED: 409 meaning]. A `413` (per-issue comment limit) is a final failure `comment_limit_reached`.
30. **Error mapping into #16's closed taxonomy.** `404` to `not_found`; `403` to `forbidden`; `401` after one forced refresh to `auth_failed` (and connection `needs_reconnect`); `400` to `invalid_input` or `provider_error` with a generic reason code; `429` to `rate_limited` carrying the `Retry-After` seconds [VERIFIED: 429 responses carry `Retry-After`; some transient `5xx` can too]; `5xx`, timeouts and network errors to `unavailable`; anything else to `provider_error`. Vendor `errorMessages` and `errors` text is never passed through. `provider_not_connected` is not a new code: the not-connected and needs-reconnect conditions use `auth_failed` with a reason, and the descriptor status tells the UI which message to show.
31. **Rate limits.** Jira Cloud enforces three independent limits on 3LO apps: a points-based hourly quota (Global Pool default of 65,000 points per hour shared across all tenants of the app; resets at the top of each UTC hour), per-endpoint per-second burst limits (about 10 requests per second per GET endpoint is the documented steady-state example), and per-issue write limits; enforcement of the points quota began 2026-03-02; exceeding any returns `429` with `Retry-After` [VERIFIED: https://developer.atlassian.com/cloud/jira/platform/rate-limiting/]. This integration's volume (a few calls per publish, a few per search) is far below the quota for one site; the shell's bounded delivery concurrency (default 2) and the template's `429` backoff are the controls. A `429` ends in the shell's retry schedule, never in a tight loop.
32. **Operator allow-list and settings for Jira (X1, X7).** Descriptor `settings` declares: `jira.issue.on-publish-status` (status name, up to 60 characters, printable, no control characters), `jira.default-project-key` (project key pattern), `jira.default-issue-type` (name, default `Task`), `jira.search-projects` (comma-separated project keys, each matching the key pattern, at most 20). `providers` in the shared setting must include `jira` to enable it per site. Worker vars: `JIRA_SITE_URL`, `JIRA_CLIENT_ID`, `JIRA_OAUTH_REDIRECT_URI`, `JIRA_CONNECTION_ADMIN_USER_IDS`; the operator allow-list entries for Jira are `jira.issue:<status name>`, default empty (no transitions). Secrets: `JIRA_CLIENT_SECRET`, `JIRA_TOKEN_ENCRYPTION_KEY`. Settings can never name a host, a URL or a cloudId.

**Quality gates**

33. **Conformance plus isolation.** The Jira module passes #16's table-driven conformance suite unchanged; a mixed-registry test (Workfront, Jira, the test-only provider) proves that provider failures are isolated (a not-connected Jira does not affect Workfront search or delivery) and that the shell code paths are untouched (decision 36).
34. **Browser rules (reuse #1, #2, #16 decision 32).** Vanilla DOM; side-effect-free render modules and thin bootstrap; the SDK imported and awaited; every vendor string rendered as text; links opened only if `https`; the IMS token sent only to the worker and to `admin.da.live`. Jira-specific additions: the connect panel (a browser hook, X6) calls only the worker; it opens an authorize URL only if its host is exactly `auth.atlassian.com` over https, with `noopener noreferrer`; it never reads, logs or displays the `state`; polling is bounded and stops on unmount; vendor strings never become HTML.
35. **Worker rules (reuse #2, #16 decision 33).** Everything pipeline-level is the template's. Jira adds: outbound hosts `auth.atlassian.com` and `api.atlassian.com` only; the Atlassian tokens are one-call credentials injected by the proxy helper (template request E6 from the chat-approvals spec for a non-secret-store credential) and are redacted from logs and responses like secrets; the state port and the callback route as above.
36. **Registration, precisely.** Adding Jira touches: the new provider module under `providers/jira/worker/`; one line in the worker provider registry; one line in the browser hook registry (the connect panel); the `secrets.required` list and `vars` in the worker's wrangler config; `.dev.vars.example`; the generic state-table migration if #16 did not reserve it; the README section. No shell, poller, ledger, store, route, renderer or conformance-suite file changes behaviour. A repo check lists the permitted diff scope. The shell-extension commit of step 0 (X1 to X8) is separate and is the only shell change, if needed.
37. **README is the contract (AC5).** The extension README's Jira section covers: creating the Atlassian 3LO app (developer console, add the Jira platform REST API, the three scopes, callback URL, enable sharing); secrets and vars with their meanings; setting `JIRA_SITE_URL`; allow-listing connection admins; connecting from the plugin; the `jira.*` site config keys and `providers` with the example config tab rows; local development with a **separate dev Atlassian app** whose callback is the local worker; branch-ref testing; the permissions the connected account needs; rotation (client secret, encryption key), Disconnect and revoke; the 90-day and password caveats; limits; privacy (what is stored where); the Atlassian policy note.

## Testing Decisions

**What makes a good test here.** Assert external behaviour: given requests, a controllable clock and fake outside services (fake Atlassian authorization server and API, fake AEM Admin, fake DA config), assert the responses, the observable state of the fakes (which comments and transitions exist on which issue, which tokens the fake considers valid), what the store contains **including that no token is stored in plaintext**, and what was logged. Never assert on helper names, module structure or internal call counts. Properties tested as *negative* properties across every path: **no secret, token, code or state ever leaves the worker** (canary); **nothing happens before authentication or `state` validation succeeds**; **a publish produces at most one comment per event and at most one transition**; **no refresh token is ever lost to a race or a failed write**; **user text never changes the host, path or JQL structure**.

**Proposed seams** (recorded here instead of asked). All seams are reused from #16; **no new seam is added**. The only new test artefacts are fakes and fixtures, plus the state-port contract suite (a second instance of #16's store-contract pattern).

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary, highest) | The worker boundary: `worker.fetch(request, env, ctx)` and `worker.scheduled(controller, env, ctx)` | reused from #16 | Node unit tests (`node:test`) for every server-side AC, including the connect flow and token lifecycle | Constructed `Request`s; #2's test kit; **`fakeAtlassian`** (stateful, in-memory: authorization server with `authorization_code` and rotating `refresh_token` grants, reuse interval, `invalid_grant`, scope reporting; `accessible-resources`; the Jira REST subset used; request log; scripted failures); scripted fake AEM Admin; in-memory state port; injected clock, `sleep`, `random` |
| P1 | The provider contract (registry entries) | reused from #16 | The shared conformance suite, now also run for `jira`; the mixed-registry isolation test | Shared conformance table; Jira via `fakeAtlassian` |
| S2 | Render/logic module + SDK result + injected `fetch` | reused from #1/#16 | WTR tests for the connect panel and the Jira-flavoured item card | Hand-built SDK result; injected `fetch` returning contract fixtures |
| S1 | Entry HTML + SDK stub + real local worker | reused from #1/#16 | Playwright e2e (hermetic), including the connect round trip | #1 SDK stub (token signed by the test key); worker via `wrangler dev` with local D1; **fake Atlassian as a local HTTP server** for both `auth.atlassian.com` and `api.atlassian.com` (hosts overridden through worker vars used only by the local environment); browser GET to the callback performed by the test driver |
| W2 | The same worker in workerd over real HTTP (D1, scheduled handler, callback) | reused from #16 | Smoke tier | `wrangler dev` local mode; fake servers |
| S3 | Repo convention check | reused from #1/#16 | CI lint job | Temp-dir filesystem fixtures |

Why no new seam: the high-risk Jira behaviours (state binding, rotation, refresh races, encryption at rest, JQL escaping, marker idempotency, transition resolution) are all observable at W1 as HTTP responses, fake-Atlassian state and store contents, and the conformance obligations at P1. The real boundary (a real consent screen, real token lifetimes, real workflows, real rate limits) is covered only by the manual spike and verification (Testing Requirements section 7).

**Modules tested:** connection admin gate, connect routes (start, callback, status, disconnect), token manager (encryption, expiry margin, lease/CAS refresh, failure classification, keep-alive), Jira client (host and path building, ADF builder, JQL builder, error mapping), normaliser, `parseReference`, search/get/lookup/create, `postPublishUpdate` (comment with marker, status with transition resolution), provider descriptor and settings schema, state-port contract (memory and D1), connect-panel render/logic, Jira item card, repo checks.

**Prior art.**
- `apps/work-management-link/SPEC.md` (#16): provider conformance suite (WV*), mixed providers, settings and delivery tables (WK*, WU*), poller tests (WP*); this spec re-uses their ids as "re-checks" for Jira.
- `shared/worker-template/SPEC.md` (#2): test kit, canary property tests, `proxy` retry matrix, smoke tier.
- `apps/chat-approvals/SPEC.md`: OAuth install through the worker, state tampering tests (OA*), encrypted token at rest, template extension requests E1 to E7, "can't receive callbacks on localhost" analysis (not applicable here: a 3LO callback is a *browser* redirect, so a local worker can receive it, see Build Analysis 2).
- `apps/video-picker/providers/brightcove/SPEC.md`: vendor-follow-up structure, "diff-scope" review checklist for "only a registry line" claims, token-exchange caching tests.
- Upstream `adobe-rnd/ew-extensions` has no worker code (confirmed in the #2 spec); the pattern, not code, is the prior art.

## Out of Scope

- Workfront and any provider other than Jira Cloud and the test-only provider. Jira **Data Center / Server** and Jira Service Management requests (their REST APIs and auth differ).
- **Per-author Atlassian identity** (each author connecting their own account), Atlassian service-account 2LO credentials, Forge or Connect apps, a Marketplace listing and Atlassian app review. Revisit when per-user permissions or distribution matter (R10, Q3, Q5).
- Webhooks or any Jira-to-EW push (Jira dynamic webhooks exist for OAuth apps, but #16 declares two-way push out of scope); showing Jira comments; attachments; worklogs; sprints; boards; epics and sub-task hierarchy; custom fields, including transition screens that require fields (Q8) and create screens that require custom fields (Q9).
- Setting a Jira **remote link** or issue property back to the page for issues linked from EW (Contentful stores a `contentfulLink` property for reverse lookup [VERIFIED: Contentful page]); the issue description of a *created* issue carries the page URLs, that is all (Q13).
- Comment visibility restrictions, @mentions, comment edits or deletes, reacting to Jira changes made after the comment.
- Multiple Jira sites per deployment; per-site cloudId selection by authors.
- Multiple links per page (#16 limit), content refs other than `main`, unpublish events (all #16 scope).
- Automated alerting when the connection needs reconnecting (Q16), automated Atlassian-side revocation, automated deploy, secret-scanning setup.
- TypeScript, bundlers beyond wrangler, frameworks.

## Further Notes

- **Docs gaps.** The EW developer page cited by #17 (https://www.aem.live/docs/ew/developing/apps-plugins) says nothing about backends, OAuth popups or iframe sandbox attributes. Whether the library iframe permits `allow-popups` is not documented; this spec's design needs neither popups from the iframe nor `window.opener` (decision 7). Atlassian's 3LO page documents the access-token response only as `expires_in` and does not state the lifetime; the service-account page states 60 minutes for 2LO tokens, which is not assumed to apply [VERIFIED: both pages].
- **`/rest/api/3/search` is being removed.** The reference marks it "Currently being removed" and describes `GET/POST /rest/api/3/search/jql` as the replacement, with token-based pagination (`nextPageToken`, no `total`, tokens expire in 7 days) and a requirement that the query be bounded [VERIFIED: swagger-v3 and https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/]. The provider uses only the new endpoint.
- **Where the Atlassian API facts come from.** Endpoint paths, parameters, response codes, scopes and permission requirements are read from Atlassian's published OpenAPI document for the Jira Cloud platform REST API v3 (https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json, read 2026-11-16, version string `1001.0.0-SNAPSHOT-...`) and the REST reference pages under https://developer.atlassian.com/cloud/jira/platform/rest/v3/. Behaviour that a document cannot show (status category key values, `duedate` format, JQL `text` boundedness, same-named statuses, token reuse behaviour, real lifetimes) is tagged and scheduled for spikes J1 to J8.
- **Contentful comparison.** Contentful's app requires a Jira admin to install a Connect app so that link metadata can be stored in Jira and queried by JQL [VERIFIED: Contentful page]. This provider keeps link metadata in the worker (#16 decision 6), so no Jira-side app install is needed beyond consenting to the 3LO app, at the cost of Jira not knowing which pages an issue is linked to (Out of Scope, Q13).
- **Why not per-user tokens for the publish update?** The update runs when a page is published, possibly days after the link was made, by a poller with no user. A per-author grant would tie delivery to one person's 90-day inactivity window, password changes and employment. A site-level connection with a keep-alive survives all three.
- **Naming.** The plugin remains "Work Item" (#16 Q15); Jira shows up inside it. Author-facing copy says "Jira issue" until the owner decides (Q19).

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
  └─ editor library ──iframe──> Work Item plugin (https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
        │   SDK handshake: { token (IMS), context { org, site, path, ref } }        (unchanged from #16)
        ├─ GET https://admin.da.live/config/{org}/{site}  -> config tab `work-management-link`  (providers, jira.* keys)
        └─ fetch(worker /v1/*, Authorization: Bearer <IMS token>)
              ├─ shell routes (#16): config, settings, items/search, lookups, items, links, retry
              └─ connection routes (X2): GET/POST/DELETE /v1/providers/jira/connection[/start]
                                   ▼
Cloudflare Worker (apps/work-management-link/worker; core imported from shared/worker-template)
  fetch:      origin gate -> IMS token check -> route -> shell services -> provider registry -> jira module
              PUBLIC (state-authenticated, no CORS): GET /v1/providers/jira/oauth/callback
  scheduled:  every minute -> poller -> AEM Admin status -> events ledger -> delivery -> jira.postPublishUpdate
              + jira.maintain (keep-alive, at most once per tick)
  state:      D1 (links, settings, events, provider_state: encrypted connection + pending OAuth states)
  secrets:    JIRA_CLIENT_SECRET, JIRA_TOKEN_ENCRYPTION_KEY   (+ #16's AEM_ADMIN_API_KEY, WORKFRONT_*)
        ├─ https://auth.atlassian.com/authorize          (browser is sent here, never fetched by the worker)
        ├─ https://auth.atlassian.com/oauth/token        (code exchange, refresh)
        ├─ https://api.atlassian.com/oauth/token/accessible-resources   (find cloudId for JIRA_SITE_URL)
        └─ https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...    (search/jql, issue, comment, transitions, project/search)
```

| Concern | Browser plugin (static, public) | Worker (private, holds secrets and state) |
|---|---|---|
| Atlassian client secret, tokens, encryption key | never | only place; tokens encrypted at rest; plaintext only in memory for one call |
| OAuth consent | opens the authorize URL, polls status | creates `state`, receives the callback, exchanges the code, stores the connection |
| Who may connect | shows Connect only when `canManage` | enforces the admin allow-list on start and disconnect |
| JQL, ADF, transitions, key/id handling | none | all of it (Jira module) |
| Item search, get, create, lookup | calls the shell routes, renders normalised items and descriptors | calls Jira through the module, allow-lists fields |
| Link persistence, publish detection, delivery, retries | none | #16 (shell) |
| Token refresh and keep-alive | none | token manager, `maintain` |
| Per-site Jira settings | reads the config tab, pushes rows (#16 decision 21) | validates against the descriptor schema and the operator allow-list |

## 2. EW integration points

- **Library plugin vs app:** unchanged: library plugin, the existing `library` row from #16 (`Work Item`, `inline`). Jira adds **no** new `apps` or `library` row; enabling Jira for a site is the `providers` key in the existing `work-management-link` config tab (#16 decision 19). The connect panel is part of the plugin, not a separate app.
- **Config tab rows added by Jira** (names are [ASSUMPTION], owner may rename; the `on-publish`, `comment-template`, `poll-minutes` and `stale-days` keys are #16's and apply to Jira unchanged):

  | key | value (example) |
  |---|---|
  | providers | `workfront,jira` |
  | jira.issue.on-publish-status | `Done` |
  | jira.default-project-key | `WEB` |
  | jira.default-issue-type | `Task` |
  | jira.search-projects | `WEB,CONTENT` |

- **SDK actions used:** none (as #16): only `context` (org, site, path) and `token`.
- **`ref=local`:** the plugin at `http://localhost:3000` calls the local worker at `http://localhost:8787` (`ALLOW_LOCALHOST=true`, local D1). **Unlike the Slack install in `apps/chat-approvals/SPEC.md` (whose callback is called by Slack's servers), the Atlassian consent callback is a browser redirect**, so a local worker *can* receive it if Atlassian accepts an `http://localhost` callback URL [OPEN: J1]; Atlassian's server never calls the worker. The callback URL registered in the Atlassian app is exact-match [VERIFIED: the `redirect_uri` "must match" the callback URL configured in the console, 3LO page; whether several callbacks can be registered is not stated], so local development uses a **second, dev-only Atlassian app** whose callback is `http://localhost:8787/v1/providers/jira/oauth/callback` and whose client secret goes in `.dev.vars`; the deployed worker uses the production app. Whether one app may register several callback URLs is [OPEN: J1] and would remove the need for the second app.
- **Branch ref / main:** pages on `*.aem.live` (or `*.preview.da.live`) call the deployed worker; the callback URL is the deployed worker's, independent of which branch hosts the plugin, so a branch ref can drive the whole connect flow against the production app and worker. The origin the plugin sends is covered by #2's CORS allow-list; the callback needs no CORS.
- **Config read permission:** same as #16 (authors need read access to the config; 403/404 means defaults with a notice).

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Atlassian authorize `GET https://auth.atlassian.com/authorize` | consent screen the browser is sent to | `client_id`, `scope`, `redirect_uri`, `state`, `audience=api.atlassian.com`, `response_type=code`, `prompt=consent` | https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ [VERIFIED] |
| Token `POST https://auth.atlassian.com/oauth/token` | code exchange (`grant_type=authorization_code`), refresh (`grant_type=refresh_token`); JSON body; returns `access_token`, `expires_in`, `scope`, and `refresh_token` with `offline_access` | client id + secret in the body (the secret injected by the proxy) | same page [VERIFIED]; the refresh request for rotating tokens and the `403 invalid_grant` causes [VERIFIED] |
| Accessible resources `GET https://api.atlassian.com/oauth/token/accessible-resources` | find the cloudId and site `url` for `JIRA_SITE_URL`; check granted scopes | access token (Bearer) | same page [VERIFIED]; the response does not describe user permissions, and ids are not unique across container types, so entries are selected by `url` and scopes [VERIFIED] |
| Jira REST `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` | `GET search/jql`, `GET issue/{idOrKey}`, `POST issue`, `GET/POST issue/{id}/comment`, `GET/POST issue/{id}/transitions`, `GET project/search`, optional `GET issue/createmeta/{project}/issuetypes` | access token (Bearer); classic scopes `read:jira-work`, `write:jira-work`; project permissions of the connected account | https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json [VERIFIED, per-operation scopes, parameters, response codes]; URL structure and gateway host: 3LO page section 3.2 [VERIFIED] |
| Atlassian Document Format | comment and description bodies | n/a | https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/ [VERIFIED root structure: version 1, `doc`, paragraphs, text nodes, marks] |
| JQL `text` field | free-text search | n/a | https://support.atlassian.com/jira-software-cloud/docs/jql-fields/ [VERIFIED: `text ~ "Fred"`, only the `~` operator] |
| Rate limits | hourly points quota, burst, per-issue write; `Retry-After`; `RateLimit-Reason` values (`jira-burst-based`, `jira-per-issue-on-write`, quota names) | n/a | https://developer.atlassian.com/cloud/jira/platform/rate-limiting/ [VERIFIED] |
| Service-account OAuth (alternative, not built) | 2LO client-credentials, 60-minute tokens | credential id/secret for a service account | https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts [VERIFIED] |
| Policy | one centralised app; no stored personal API tokens; no per-customer 3LO apps | n/a | https://www.atlassian.com/blog/development/building-secure-and-scalable-integrations-our-guidance-for-third-party-apps [VERIFIED] |
| Free developer Jira site | test instance (the signup page offers "free development sites of Atlassian cloud products", standard editions) | Atlassian account | https://www.atlassian.com/try/cloud/signup?product=confluence.ondemand,jira-software.ondemand,jira-servicedesk.ondemand,jira-core.ondemand&developer=true [VERIFIED from the search snippet; terms and limits [OPEN]] |
| DA config, IMS keys, AEM Admin status, Cloudflare Cron/D1 | as #16 | as #16 | `apps/work-management-link/SPEC.md` Build Analysis section 3 |

**Auth flows.**
- *Browser to worker:* IMS token as Bearer, verified by the template before routing; connection routes add the admin gate for start and disconnect; the callback is the only route not using IMS (authenticated by the single-use `state`).
- *Connect:* admin (IMS) -> `start` -> authorize URL -> Atlassian consent -> browser redirect to worker callback -> `state` consumed -> code exchange -> `accessible-resources` -> encrypted connection stored -> status `connected`.
- *Worker to Jira (request time and scheduled):* token manager supplies a valid access token (decrypt; refresh with lease and compare-and-set when near expiry or on 401) -> `api.atlassian.com/ex/jira/{cloudId}`. The caller's IMS token is never forwarded.
- *Keep-alive:* scheduled tick -> `maintain` -> refresh if last refresh is older than 30 days.

**Unverified [OPEN]** (each has a spike in section 7 step 1): callback URL rules (one or many, `http://localhost`) and whether the library iframe allows popups (J1); site `url` form and the browse URL shape, board URL `selectedIssue` form (J2); JQL `text ~` boundedness, prefix matching, special characters, key lookup, read-after-create timing (J3); summary length, `duedate` format, required fields on create, ADF description acceptance, default `Task` type (J4); comment ordering parameter for newest-first, marker round trip, notification behaviour (J5); status category key values, transition shape, same-named statuses, transition screens (J6); token lifetime, what a second exchange of a refresh token inside the reuse window returns, revocation and password-change behaviour, whether `read:jira-user` is required for assignee names, where the user revokes the app (J1, J7); real rate-limit headers and per-issue write limit behaviour (J8).

## 4. Data contracts

All contracts are behaviour contracts, not code.

**Descriptor (`describe`) for Jira** (the shape #16 defines plus X1):

| Field | Value |
|---|---|
| `id` / `label` | `jira` / `Jira` |
| `connection` | `{ mode: 'service', setup: 'oauth' }` (Workfront: `{ mode: 'service', setup: 'none' }`) |
| `itemTypes` | one: `issue` ("Jira issue"), create fields `summary` (required text, max 255), `description` (optional long text, capped), `project` (lookup `project`, required unless the site configured a default) |
| `idPattern` | numeric issue id (digits, no leading zero, bounded length) |
| `settings` | `jira.issue.on-publish-status`, `jira.default-project-key`, `jira.default-issue-type`, `jira.search-projects` with their validators (decision 32) |
| `secrets` | `JIRA_CLIENT_SECRET`, `JIRA_TOKEN_ENCRYPTION_KEY` |
| `vars` | `JIRA_SITE_URL`, `JIRA_CLIENT_ID`, `JIRA_OAUTH_REDIRECT_URI`, `JIRA_CONNECTION_ADMIN_USER_IDS` |

**Provider operations** (unchanged from #16 decision 3; Jira specifics):

| Operation | Jira behaviour (summary) |
|---|---|
| `parseReference(text)` | key, numeric id, `JIRA_SITE_URL` browse/`selectedIssue` URL; everything else "not mine"; no vendor call |
| `search({ query, type, limit })` | one `search/jql` call, explicit `fields`, `maxResults` at most `limit`, first page only |
| `get({ type, id })` | one issue read; `404` -> `not_found` (also "no permission") |
| `create({ type, fields })` | one issue POST (never retried on 5xx) + one read |
| `lookup({ name: 'project', query })` | `project/search` with `action=create`, at most 25 |
| `postPublishUpdate({ item, event, settings, action })` | `comment`: marker check only after an ambiguous prior attempt, then one comment POST; `status`: read, transitions read, one transition POST |
| `connectionStatus()` / `startConnect({ userId })` / `completeConnect({ code, state })` / `disconnect()` (X2) | as decisions 6 to 9 |
| `maintain({ now })` (X8) | refresh if last refresh older than 30 days |

**Jira issue mapping to the normalised item:**

| Normalised field | Source | Rule |
|---|---|---|
| `provider` / `type` | constants | `jira` / `issue` |
| `id` | `id` | numeric string |
| `title` | `key` + `fields.summary` | `KEY: summary`, plain text |
| `url` | `JIRA_SITE_URL` + `/browse/` + `key` | https only [ASSUMPTION: J2] |
| `status.code` / `label` | `fields.status.id` / `name` | |
| `status.phase` | `fields.status.statusCategory.key` | `new`, `indeterminate`, `done` -> `open`, `in-progress`, `done`; else `other` [ASSUMPTION: values; J6] |
| `assignees` | `fields.assignee.displayName` | empty when null; `Unknown user` when no name |
| `dueDate` | `fields.duedate` | ISO date or null [ASSUMPTION: format; J4] |
| `fetchedAt` | injected clock | |

**Connection status route** (`GET /v1/providers/jira/connection`, any authenticated user): `{ state, siteName?, connectedAt?, canManage, reason? }` with `state` in `not_connected`, `connected`, `needs_reconnect`, `error`; `reason` a code (`reconnect_required`, `scope_missing`, `encryption_key_invalid`, `site_not_accessible`); never tokens, never the connected account's identity, never the admin list. `POST .../connection/start` (admin only) returns `{ authorizeUrl }`; `DELETE .../connection` (admin only) is idempotent. The callback is public, returns static HTML only.

**Extension-defined error codes for Jira** (same envelope as #16): `connect_disabled` (403, admin list empty), `not_connection_admin` (403), `invalid_state` (callback, generic HTML), `site_not_accessible`, `scope_missing`, plus #16's codes. Reason codes carried by outcomes and the sync summary: `sent`, `already_present`, `skipped_already`, `skipped_already_done`, `transition_unavailable`, `transition_requires_fields`, `comment_limit_reached`, `reconnect_required`, `not_connected`, `not_found`, `forbidden`, `rate_limited`, `unavailable`.

**Provider state records** (through the state port; conceptual):

| Key (`jira/...`) | Value | Notes |
|---|---|---|
| `connection/site` | `{ status, cloudId, siteName, scopes, accessEnc, refreshEnc, accessExpiresAt, lastRefreshAt, refreshLeaseUntil, connectedBy (IMS user id), connectedAt, reason? }`, `version` | `accessEnc`/`refreshEnc` are AES-GCM ciphertext (IV + data), AAD = provider, connection id, field |
| `oauth-state/<sha256(state)>` | `{ userId, createdAt }` | TTL 10 minutes; consumed once; at most 5 pending per user |

State-table shape (generic, shell-owned; X3): provider, key, value (JSON), version, expires_at (nullable), updated_at; primary key (provider, key). Retention: expired `oauth-state` rows purged by the scheduled handler; the connection row persists until disconnect.

**Worker configuration.** Vars (non-secret): `JIRA_SITE_URL`, `JIRA_CLIENT_ID`, `JIRA_OAUTH_REDIRECT_URI`, `JIRA_CONNECTION_ADMIN_USER_IDS`; local-only overrides for the two Atlassian base URLs used by tests, set only in the local environment and ignored when `ALLOW_LOCALHOST` is false. Secrets (`secrets.required`, in addition to #16's): `JIRA_CLIENT_SECRET`, `JIRA_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64). Operator allow-list entries: `jira.issue:<status name>`.

**Atlassian developer-console configuration (documented in the README):** app type OAuth 2.0 (3LO); API: Jira platform REST API with the scopes `read:jira-work`, `write:jira-work` (and `read:jira-user` only if J1 requires it); `offline_access` is requested in the authorize URL; callback URL = `JIRA_OAUTH_REDIRECT_URI`; Distribution: sharing enabled when the connected account is not the app owner.

## 5. Folder layout (proposed; fits #1, #2 and #16)

```
apps/work-management-link/
├─ (shell as in #16)
└─ providers/jira/
   ├─ SPEC.md                    this file
   ├─ README.md                  vendor section source for the extension README (credentials, vars, config keys, connect, local dev)
   ├─ browser/                   connect panel hook (mountConnection) and its render module
   ├─ worker/                    jira provider module: descriptor, client (hosts, paths, error mapping),
   │                             token manager (encrypt, refresh, lease/CAS, keep-alive), connect (start, callback, status, disconnect),
   │                             jql builder, adf builder, normaliser, parseReference, transitions
   ├─ fixtures/                  sanitised recordings from the sandbox spike (token responses, issues, transitions, comments, rate-limit headers)
   └─ test/                      unit (node:test, WTR), contract, fixtures-vs-fake checks, e2e specs for the connect flow
```

Imports follow #2 and #16: the worker imports the shared template core by relative path; Jira server code lives in `providers/jira/worker/` and is registered by the extension worker's registry (#2 Open Question 3, #16 Q14). The fake Atlassian lives in the extension's `test/support/` next to the fake Workfront.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **#16's contract does not yet carry what Jira needs** (X1 to X8: connection API, state port, public callback route, browser hook slot, provider settings, keep-alive). AC4 is only true if they exist or are added as a minimal shell change. | High | Build-plan step 0 reconciles against the implemented #16 before any code; the additions are additive/optional and proven by the test-only provider; Q1 asks the owner to amend #16 now |
| R2 | **Template cannot host a public, non-IMS route (X5)** | High | Reuse chat-approvals' E1/E4/E5 requests; fallback static-callback + authenticated `complete` (decision 12); Q2 |
| R3 | **Refresh-token rotation races or a lost write locks the integration out** | High | Lease + version compare-and-set, persist before use, documented 10-minute reuse window, JT4/JT8; J7 observes real behaviour |
| R4 | **Refresh token expires (90 days of inactivity), password change, or revocation** silently disables publish updates | High | Keep-alive refresh (30 days); `needs_reconnect` state visible to all; failed events retry after reconnect; alerting follow-up (Q16); dedicated account guidance |
| R5 | **Privilege model:** all actions run as one Atlassian account; any authenticated Adobe user can reach the routes; the connection admin chooses the account | High | Closed-by-default admin allow-list; least-privilege Jira permissions for the account; client-id and optional user-id allow-lists; documented (Q3, Q4) |
| R6 | **Atlassian facts partly unverified** (status category keys, `duedate`, `text ~` boundedness, token reuse behaviour, callback rules, popup/opener behaviour) | High | Spike J1 to J8 is build step 1 and gates steps 5 to 9; sanitised recordings become fixtures; every tag resolved in the README |
| R7 | **Duplicate or lost comments** (ambiguous POST, restart mid-tick, overlapping ticks) | Medium | #16's event uniqueness, per-action state and leases + the marker check (decision 28); JU2, JU14 |
| R8 | **JQL injection or SSRF through user text** | Medium | JQL built from escaped parts only; outbound hosts fixed; cloudId validated; JA6 matrix |
| R9 | **Secrets and tokens in D1/logs** | High if it happens | AES-GCM with AAD; canary tests over responses, logs, D1 dump (JA4, JT1); redaction (template) |
| R10 | **Atlassian policy:** guidance against per-customer 3LO apps and stored credentials; unreviewed shared apps show a warning; private app only installable by owner | Medium | One operator-owned app per deployment; README policy note; do not offer the extension as a multi-tenant service without a Marketplace-listed distributable app; Q5 |
| R11 | **Rate limits:** hourly points quota (global pool 65,000 points shared across all tenants of the app), burst, per-issue write; enforcement since 2026-03-02 | Low-Med | Few calls per action; bounded concurrency; `429` honoured; J8 measures; shared pool matters only if the extension is ever distributed to many sites |
| R12 | **Workflows differ per project:** transitions not available, required transition fields, same-named statuses | Medium | Explicit final failure reasons; deterministic pick; Q8; J6 |
| R13 | **Issue keys change when issues move; the link stores the numeric id** | Low-Med | Canonical numeric id (decision 20); title shows the current key; stored `item_url` may use the old key, Jira redirects moved keys [ASSUMPTION; J2] |
| R14 | **Eventual consistency of JQL search** | Low | Never search for a just-created issue; link by returned id (decision 22, 26) |
| R15 | **Iframe/popup/opener limits** | Medium | Design uses neither (decision 7); fallback copyable link; J1/M-J2 observe real behaviour |
| R16 | **Comment notifications spam watchers** on bulk publish | Low-Med | One comment per publish event; bounded concurrency; documented; consider adding visibility/notification options later (Q11) |
| R17 | **Encryption key loss or rotation** invalidates all stored tokens | Medium | Documented: reconnect after rotation; wrong key surfaces `error` not `needs_reconnect`; back up the key in the operator's secret manager |
| R18 | **Cloudflare/D1 limits, personal-account data policy, backups** (carried from #16 R6, R9, R15) | Medium | Carried unchanged; Q17 |
| R19 | **Recorded fixtures contain real data** | Low-Med | Sanitise (ids, names, emails, tokens) before committing; a fixture-lint rule rejects token-looking strings and `@`-addresses |
| R20 | **Locale/vocabulary drift:** Atlassian renamed "issue" to "work item" in UI | Low | Copy decided by the owner (Q19); API unaffected |

## 7. Ordered build plan (sized to #17's acceptance criteria)

0. **Reconcile with the implemented #16 (and #2).** Compare the provider contract, descriptor, registry, state port, route table, scheduled path and browser registry with X1 to X8. Add whatever is missing as one separate, minimal, backward-compatible shell commit (state-port table and migration, optional `connection`/`maintain` operations and routes, public-callback route support via the #2 E1/E4/E5 changes or the decision 12 fallback, provider `settings` schema, browser hook slot), extend #16's test-only provider to declare `setup: 'oauth'` so that the shell side is tested without Jira, and record the outcome in the Jira README. **Owner prerequisites:** #1, #2, #16 landed; Atlassian developer account and a free developer Jira site; a dedicated Atlassian user for the integration; two 3LO apps (dev and prod) per Open Question 7; Cloudflare account and the #16 plan decision; EW org/site as in #1; AEM Admin key as #16.
1. **Sandbox spike J1 to J8, throwaway scripts only, nothing but fixtures committed:**
   - **J1** create the 3LO app; try one and several callback URLs, an `http://localhost` callback; run the consent in a real browser and inspect what the consent screen shows; record the token response (`expires_in`, `scope`, presence of `refresh_token`); check which scopes are required for assignee display names (try without `read:jira-user`); observe from inside the EW library iframe whether `window.open` and `window.opener` work (a tiny test page, no product code).
   - **J2** `accessible-resources` shape for the site; the `url` form; browse and board URL shapes carrying `selectedIssue`; whether an old key redirects/resolves after moving an issue.
   - **J3** search forms: is `text ~ "word"` bounded; prefix matching; reserved characters; key lookup; pagination with `nextPageToken`; delay before a new issue is searchable.
   - **J4** create: minimal fields; summary length limit; `duedate` format; required-field failure shape; ADF description with links; default issue type; project `action=create` lookup.
   - **J5** comments: post ADF with marker; list comments newest first (parameter spelling); read the marker back; notification behaviour for watchers.
   - **J6** transitions: list shape (`to`, `isAvailable`), perform by id, status category key values, a workflow lacking a path, a transition with a required screen field, same-named statuses across projects.
   - **J7** token lifecycle: observed `expires_in`; refresh rotation; exchange the same refresh token twice inside 10 minutes and record what returns; `invalid_grant` after removing the app from the account's connected apps and after a password change; where that setting lives.
   - **J8** rate limits: observe headers on normal responses and a deliberate per-issue write burst on the sandbox.
   Output: sanitised fixtures and an updated list of decisions moved from [OPEN] to [VERIFIED]. Gates steps 5 to 9.
2. **Tooling additions:** wrangler vars and secret names for Jira, `.dev.vars.example` entries, repo-check additions (section 5 of Testing Requirements). Lint stays green.
3. **Test support (it is the seam):** stateful `fakeAtlassian` (authorization server with rotating refresh and reuse interval, `invalid_grant`, scopes, accessible-resources, the Jira REST subset, throttling and failure injection, request log, per-issue write limit), recorded-fixture guard (JF), extension of the state-port contract suite. Self-test: fake response shapes equal the recorded fixtures' keys and types.
4. **Connection admin gate, state, connect routes and callback**, test-first (JO*, JA1 to JA3). AC3, AC7.
5. **Token manager** (encryption, margin, lease/CAS refresh, classification, keep-alive), test-first (JT*). AC3.
6. **Jira client and operations:** host/path building, JQL builder, ADF builder, normaliser, `parseReference`, `search`, `get`, `lookup`, `create`, test-first (JS*, JN*, JA5, JA6, JA8). AC1.
7. **`postPublishUpdate` (comment with marker, status with transition resolution)**, test-first (JU*), then the end-to-end publish through the poller (JU14). AC2.
8. **Descriptor, settings schema, registry lines, conformance and mixed-registry tests** (JW*), diff-scope check. AC4.
9. **Connect panel and Jira item card UI**, test-first (JB*). AC1, AC3, AC4 (browser half), AC7.
10. **README Jira section and example config tab rows.** AC5.
11. **Hermetic e2e (E2E-J1 to E2E-J7) and smoke tier (SM-J1 to SM-J5)** against the real local worker with fakes. AC1 to AC3, AC6, AC7.
12. **CI:** extend `worker-unit`, `worker-smoke`, `lint`, `unit`, `e2e`; no credentials. AC8.
13. **Deploy and manual verification (M-J0 to M-J15)** with a real Jira sandbox, `ref=local` and a branch ref; record the observed values in the README. AC1 to AC7.
14. **Hand-off note** in the README: what was added to the shell (if anything), the connection contract, and recommendations for a follow-up per-user connection and alerting.

---

# Testing Requirements

## 1. Worker tests (seam W1, `node:test`) and provider conformance (seam P1)

Fixtures and mocks (from `test/support/`, built on #2's test kit and #16's fakes): `makeEnv()` production-like (`ALLOW_LOCALHOST` false) with canary values for `JIRA_CLIENT_SECRET` and `JIRA_TOKEN_ENCRYPTION_KEY`, `JIRA_SITE_URL` (an `acme.atlassian.net` stand-in), `JIRA_CLIENT_ID`, `JIRA_OAUTH_REDIRECT_URI`, `JIRA_CONNECTION_ADMIN_USER_IDS`; `fakeIms` and `signToken` (admin and non-admin users); **`fakeAtlassian`**: authorization server (single-use authorization codes bound to `redirect_uri`, `authorization_code` and rotating `refresh_token` grants returning `access_token`, `expires_in`, `scope`, `refresh_token`, a 10-minute reuse interval, `403 invalid_grant` for unknown/expired/revoked tokens, scopes granted configurable), `accessible-resources` (one or several sites, scopes per grant), and a stateful subset of Jira REST (issues with key and numeric id, statuses with categories, workflows and transitions with `isAvailable`, comments with ADF, projects with create permission, search over summaries with `nextPageToken`, per-issue write limit, `404` for invisible issues), with scripted failures (401 to force refresh, 403, 404, 409, 413, 429 with `Retry-After`, 5xx, ambiguous success-then-timeout) and a full request log; a **canary access token and refresh token** per scenario; scripted fake AEM Admin and in-memory state port; injected clock, `sleep`, `random`. Every test calls `worker.fetch` or `worker.scheduled` (or the registry entry for P1) and nothing else.

### 1.1 Access and hygiene (AC7)

| ID | Behaviour asserted |
|---|---|
| JA1 | Table-driven over every Jira-related route (status, start, disconnect, items/search/links with provider `jira`): no `Authorization` -> `401`, error envelope; provider, store and fakes untouched; preflight from an allowed origin needs no token. The callback with no/invalid `state` -> generic static HTML error, no Atlassian call |
| JA2 | Disallowed origin with a valid token -> `403` on connection routes; the callback **with an `Origin` header** is refused and never reaches the store; the callback response has no CORS headers |
| JA3 | Admin gate: valid non-admin token on `start` and `disconnect` -> `403 not_connection_admin`; empty `JIRA_CONNECTION_ADMIN_USER_IDS` -> `403 connect_disabled` for everyone; the status route works for any valid caller and returns `canManage` correctly |
| JA4 | **Canary matrix:** across success, every error code, a vendor error body that echoes the secret, a failing token exchange, a failing refresh, the scheduled path and the callback HTML, the client-secret canary, encryption-key canary, access token, refresh token, authorization code and `state` appear in no response body or header and no log line |
| JA5 | **Field allow-list:** the fake returns extra fields (reporter and assignee emails and account ids, avatar URLs, `self` links with the site host, description ADF, comments, changelog, custom fields); none reach any response; only the normalised shape does |
| JA6 | **Outbound host and path safety:** only `auth.atlassian.com` and `api.atlassian.com` are ever contacted (asserted over the full request log of every scenario); the cloudId is validated as a UUID before use and a tampered stored value is rejected before any fetch; crafted keys, ids, `q`, project keys, summaries and templates (containing `/`, `..`, `?`, `&`, `#`, newlines, `@`) cannot change host, path or query structure |
| JA7 | **JQL injection matrix:** user text containing `"`, `\`, `)`, `OR`, `ORDER BY`, `project =`, `~`, `*`, newlines and very long strings produces the exact documented escaped JQL (or `400`), never an extra clause; settings values for `jira.search-projects` can only contribute validated project keys |
| JA8 | A pasted URL on another Jira site or a look-alike host -> `invalid_reference`, no vendor call |
| JA9 | `org`/`site` in query, body or headers are ignored (re-check of WA7 for Jira routes); no Jira route reads them |

### 1.2 Connect flow (AC3, AC7)

| ID | Behaviour asserted |
|---|---|
| JO1 | `start` by an admin returns an authorize URL on `auth.atlassian.com` with `audience=api.atlassian.com`, the configured `client_id`, exactly `read:jira-work write:jira-work offline_access` (no extras), `redirect_uri` equal to the var, `response_type=code`, `prompt=consent`, a `state` of at least 128 bits of entropy; the URL contains no secret; a pending `state` record exists bound to the admin's user id with a 10-minute TTL |
| JO2 | Two `start` calls yield two distinct states; at most 5 pending per user (oldest evicted); expired states are purged by the scheduled handler |
| JO3 | Valid callback: the exchange request has the documented JSON body (`grant_type`, `client_id`, `client_secret` injected by the proxy and absent from URL and logs, `code`, `redirect_uri`); `accessible-resources` is called with the new token; the site whose `url` equals `JIRA_SITE_URL` is selected; granted scopes are checked; the connection is stored encrypted with status `active`; the page says "connected" with the site name and no token |
| JO4 | Callback with missing, unknown, expired, replayed or tampered `state` -> generic static error, **no token call**; a replay of a used state cannot cause a second exchange |
| JO5 | `error=access_denied` (user denied) -> friendly static page; the `state` is consumed; nothing stored; `error_description` is not reflected |
| JO6 | Token endpoint answers `400`/`403`/`5xx`/timeout -> generic error page; the code exchange is not retried; nothing stored; log has the error code only |
| JO7 | No site with the pinned URL, or the grant lacks a required scope -> `site_not_accessible` / `scope_missing` page, nothing stored |
| JO8 | Reconnect while connected replaces the record atomically (version bump); the previous tokens are no longer read by any code path; status shows the new `connectedAt` |
| JO9 | Disconnect deletes the record; Jira calls then fail with `auth_failed` (reason `not_connected`) and pending events fail with that reason; Retry after reconnect delivers exactly one comment |
| JO10 | Status route states: `not_connected`, `connected` (site name, time), `needs_reconnect` (after `invalid_grant`), `error` (wrong encryption key); never tokens, account identity or admin list |
| JO11 | Callback response headers: `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; the body is static: `state`, `code` and `error_description` payloads containing markup do not appear in it |
| JO12 | A state started by admin A cannot be used to bind a connection that is then attributed to admin B (`connectedBy` is the user who started) |

### 1.3 Token store and refresh (AC3)

| ID | Behaviour asserted |
|---|---|
| JT1 | **At rest:** a dump of the state port (memory and D1 in smoke) contains neither the access nor the refresh token in plaintext; each write uses a fresh IV (two writes of the same token give different ciphertext); moving a ciphertext to another record or field fails to decrypt (AAD binding) |
| JT2 | A token with more than the margin of life left is used without any token-endpoint call |
| JT3 | Near expiry -> exactly one refresh; the new pair is persisted **before** the Jira call proceeds; the rotated refresh token replaces the old one; after the fake's reuse interval the old one is rejected and the next refresh uses the new one |
| JT4 | **Concurrency:** 10 simultaneous calls in one worker instance -> one refresh; two worker instances over the same store racing -> the stored pair is always valid and never reverts to an older version; no call is ever made with a refresh token that the store no longer holds (lease and version assertions with injected interleavings) |
| JT5 | `403 invalid_grant` on refresh -> connection `needs_reconnect`; **no further token calls** until reconnect (counted); Jira calls fail with `auth_failed`; author-facing text is generic |
| JT6 | Refresh `5xx`/`429`/timeout -> connection stays `active`; the call fails as `unavailable`/`rate_limited`; the template retries the refresh POST (declared safe to retry) per its schedule; a later call succeeds |
| JT7 | Jira API `401` with a token believed valid -> one forced refresh and one retry -> success; a second `401` -> `needs_reconnect` |
| JT8 | Persist failure after a successful refresh -> the write is retried; if it keeps failing the old refresh token is still usable inside the fake's 10-minute window and the next call recovers; the log carries `credential_persist_failed` (a name, no values) |
| JT9 | Keep-alive: with the injected clock past 30 days since the last refresh the scheduled tick refreshes once (even with no links); not before; at most one token call per tick |
| JT10 | Inactivity expiry (fake: refresh token expired after 90 days unused) -> `needs_reconnect`; the sync summary shows `failed` with `reconnect_required`; after reconnect, Retry delivers one comment |
| JT11 | Wrong encryption key (operator error) -> status `error` with `encryption_key_invalid`, not `needs_reconnect`; no token call made with undecryptable data |
| JT12 | A refresh response whose scopes no longer cover the required ones -> `needs_reconnect` (`scope_missing`) |
| JT13 | The worker's clock a day ahead or behind: no token-call loop (a rejected token triggers exactly one forced refresh per call, JT7) |

### 1.4 Search, resolve, lookup and create (AC1)

| ID | Behaviour asserted |
|---|---|
| JS1 | Search sends a bounded JQL (restriction present), an explicit `fields` list, `maxResults` at most the limit (hard cap 50) and `ORDER BY updated DESC`; results are normalised; empty or over-long `q` -> `400` |
| JS2 | Query that looks like a key (any case) resolves through a key lookup and returns zero or one item |
| JS3 | `jira.search-projects` restricts the JQL to the validated keys; invalid keys in the setting are rejected by settings validation (WK2 re-check) |
| JS4 | `nextPageToken` present in the fake's page -> only the first page is returned; no unbounded loop; `isLast` handled |
| JS5 | `parseReference` accepts key, numeric id, `/browse/KEY` URL (query/hash/trailing slash ignored), board URL with `selectedIssue`; rejects other hosts, look-alikes, `http://`, ports, userinfo URLs, non-issue paths; no vendor call for rejections |
| JS6 | `get` by key and by numeric id return the same normalised item (numeric `id`); a moved issue's old key resolves; `404` -> `item_not_found` (same for a permission-hidden issue); nothing stored on failed link attempts (WL4 re-check) |
| JS7 | Project lookup calls `project/search` with `action=create`, `query` and `maxResults` at most 25; returns `{ value, label }`; the vendor request has no unvalidated user text outside the `query` parameter |
| JS8 | Create validation: missing/over-long summary, control characters, bad project key, unknown type -> `400 invalid_input` with field codes and **no vendor call** |
| JS9 | Create sends exactly one issue POST with project, issue type from settings, summary, and an ADF description containing the page's edit and live URLs; the following read returns the normalised item; if the read fails the shell receives an item with status `Unknown` and can still link |
| JS10 | Create `5xx`/timeout is not retried; the fake contains at most one new issue; `429` on the create POST is retried per the template rule |
| JS11 | Create `400` (required custom field missing, invalid field, type not in project) -> `invalid_input` with generic code, no vendor text; `403` -> `forbidden` |
| JS12 | Defaults from settings (`jira.default-project-key`, `jira.default-issue-type`) apply when the form leaves them empty; none configured and none supplied -> `invalid_input`, no vendor call |
| JS13 | ADF safety: markup/markdown/ADF-looking input stays literal text; `https://` URLs become link marks, other schemes (`javascript:`, `data:`) do not; control characters stripped; length caps enforced |

### 1.5 Normalisation and status display (AC1)

| ID | Behaviour asserted |
|---|---|
| JN1 | Status mapping: category key `new`/`indeterminate`/`done` -> `open`/`in-progress`/`done`; unknown key -> `other`; `label` is the status name; `code` the status id |
| JN2 | Assignee: null -> `[]`; display name only (no account id, email, avatar); no usable name -> `Unknown user` |
| JN3 | Due date: `YYYY-MM-DD` -> ISO date; null -> null; malformed -> null (defensive) |
| JN4 | `title` is `KEY: summary` as plain text (HTML in the summary stays text); `url` is `JIRA_SITE_URL` + `/browse/` + key over https; a key failing the pattern -> `provider_error`, not a malformed URL |
| JN5 | Deleted/hidden issue -> `200` with the link and `itemError: item_not_found`; Jira outage -> `200` with `itemError: provider_unavailable`; not connected -> `200` with `itemError: provider_auth_failed` (generic) (re-checks of WG4/WG5 for Jira) |
| JN6 | TTL behaviour as WG6: two reads within the TTL make one Jira call; `refresh=1` always calls |

### 1.6 Publish update (AC2)

| ID | Behaviour asserted |
|---|---|
| JU1 | `on-publish=comment` -> exactly one comment on the right issue; ADF is paragraphs from the rendered text plus a final marker paragraph; the issue's status is unchanged |
| JU2 | **Marker idempotency:** an attempt whose POST landed but whose response was lost (or returned `5xx`) is followed by a retry that lists recent comments, finds the marker and posts nothing (`sent`, `already_present`); with no marker the retry posts once; the marker search is bounded (at most 3 pages) |
| JU3 | A comment that merely contains text similar to the marker (different event id, partial token) does not match |
| JU4 | `on-publish=status` -> issue read, transitions read, one transition POST by the id whose `to` status name equals the configured target; the fake issue now has that status |
| JU5 | Already in the target (any case) -> `skipped(already)`; category `done` -> `skipped(already_done)`; no POST |
| JU6 | No available transition leads to the target -> final `transition_unavailable`, no POST; two transitions to same-named statuses -> the lowest transition id is used (documented) |
| JU7 | Transition with a required screen field (`400`) -> final `transition_requires_fields`; `400` because the account may not transition -> `forbidden` final |
| JU8 | `409` conflicting update -> re-read: at target -> `skipped(already)`; otherwise retryable `unavailable` |
| JU9 | `413` per-issue comment limit -> final `comment_limit_reached`; `404` -> final `not_found`; `403` -> final `forbidden` |
| JU10 | `429` (including per-issue write limit `RateLimit-Reason`) -> `rate_limited` carrying `Retry-After`; the shell's retry schedule applies (+1/+5/+15/+60/+240 min with the injected clock); `5xx` on the comment POST is not retried in-call |
| JU11 | A status target not in the operator allow-list (`jira.issue:<name>`) is refused by the shell before the provider is called (WU5 re-check with the Jira entry format); empty allow-list -> no transitions |
| JU12 | Not connected / needs reconnect: events fail with `reconnect_required` or `not_connected`, never loop; after reconnect, Retry delivers exactly one comment |
| JU13 | Bulk: 30 linked pages published in one window -> 30 comments across issues, delivery concurrency at most `MAX_DELIVERY_CONCURRENCY`, at most one token refresh, `429` handled, no duplicates |
| JU14 | **End to end through the poller:** link a Jira issue; advance the fake Admin `lastModified`; trigger `scheduled` -> exactly one comment (and the transition when configured); a second trigger adds none; the canary secrets are absent everywhere |
| JU15 | Comment text built from the template with placeholder-like text in values is not re-expanded; control characters stripped; length capped; no markup interpreted (WU9 re-check through ADF) |

### 1.7 Conformance, isolation, settings (AC4)

| ID | Behaviour asserted |
|---|---|
| JW1 | `jira` passes #16's conformance table unchanged: descriptor shape (including `connection`), `parseReference` accept/reject, search/get/create/lookup/`postPublishUpdate` shapes, closed error taxonomy, allow-listed fields (WV1) |
| JW2 | **Mixed registry:** Workfront, Jira and the test-only provider registered together: `GET /v1/config` lists all with their connection states; routes dispatch by provider; with Jira `not_connected`, Workfront search, link and delivery work unchanged; with Workfront failing, Jira works |
| JW3 | Zero-shell-change proof for the module: with the shell code untouched, registering `jira` (module + registry lines + config + migration + README) is the only difference between "Jira absent" and "Jira present" (the repo check JR3 enforces the diff scope) |
| JW4 | Every vendor failure maps into the closed taxonomy; vendor `errorMessages`/`errors` text (carrying a canary) never appears in any response (WV4 re-check) |
| JW5 | Jira settings: valid values stored; invalid status name (control characters, over 60 characters), project key patterns, `search-projects` over 20 entries -> rejected individually with warnings, previous or default value stays; unknown keys ignored; no key can name a host, URL or cloudId (WK2 to WK4 re-checks) |
| JW6 | Provider-declared secrets and vars equal the worker config (`secrets.required` includes exactly the two Jira secrets; the four vars are present) |

### 1.8 Fixtures contract (AC8)

| ID | Behaviour asserted |
|---|---|
| JF1 | The fake's response shapes (keys and types) equal the sandbox-recorded fixtures for token responses, `accessible-resources`, issue, search page, create response, transitions, comments and a `429` |
| JF2 | The fixture lint rejects tokens, emails, account ids and real hostnames in committed recordings |

### 1.9 State-port contract (AC3)

JC1: one suite (get, put-if-absent, put-if-version conflicts, TTL expiry with the injected clock, consume-once atomicity under concurrent calls, delete) run against the in-memory port in W1 and against local D1 in the smoke tier (SM-J2). Guards against the fake drifting from D1.

## 2. Browser unit tests (seam S2, `@web/test-runner`, injected `fetch`, hand-built SDK result)

| ID | Behaviour asserted |
|---|---|
| JB1 | Connection panel renders each state from the status route as text (not colour alone): not connected, connected (site name, time), needs reconnect, error with reason text |
| JB2 | Non-admin (`canManage` false): no Connect/Disconnect; message "ask a Jira connection admin"; the user's own IMS user id shown; the panel makes no `start` call |
| JB3 | Admin Connect: calls `start` once (double-click safe); opens the returned URL only if its host is exactly `auth.atlassian.com` over https (otherwise shows an error), with `noopener noreferrer`; when `window.open` is blocked shows the link with a copy button; polls the status route at the documented interval for at most 5 minutes and stops on `connected`, on timeout and on unmount |
| JB4 | Disconnect asks for confirmation and sends one request; the panel then shows not connected |
| JB5 | Jira item card: title (`KEY: summary`), status label as text, assignee names, "Unassigned", due date, "No due date"; "Open in Jira" appears only for `https` URLs and uses `rel="noopener noreferrer"` |
| JB6 | All vendor strings (title, status, assignee) are rendered as text: `<img src=x onerror=...>` creates no element (UL8 re-check with Jira shapes) |
| JB7 | Search and paste: a pasted Jira URL or key resolves to one result; a foreign URL shows a helpful message; results show type, key, status, assignee |
| JB8 | Descriptor-driven create form for Jira (summary, description, project lookup with the default applied) renders with no Jira-specific rendering code beyond the registered connect panel (UL11 re-check) |
| JB9 | Not connected (descriptor/status): search and create are disabled with an explanatory message and make no item calls; `needs_reconnect` for an existing link shows "Jira connection needs reconnecting (ask an admin)" with the open-in-Jira link still available |
| JB10 | The IMS token and the `state` never appear in the DOM or console; the authorize URL is used as returned and never logged; the worker origin is constant (UL9 re-check) |
| JB11 | Keyboard operation and accessible names for Connect, Disconnect, Copy link and Retry; status conveyed as text |

## 3. Runtime smoke tier (seam W2, `wrangler dev` local, no Cloudflare login)

Starts the real worker in workerd with local D1 (migrations applied, including the state table), secrets from an env file, and the Atlassian hosts, Admin base and DA config pointed at local Node fakes.

| ID | Behaviour asserted |
|---|---|
| SM-J1 | The worker bundles (Jira module, Web Crypto AES-GCM, new routes, migration) and starts; a bare request -> `401`; the callback with no state -> generic HTML |
| SM-J2 | State-port contract suite (JC1) passes against local D1; consume-once is atomic under two concurrent callbacks |
| SM-J3 | Connect flow over real HTTP: `start` -> follow the authorize URL against the fake -> browser-style GET (no `Origin`) to the callback -> status `connected`; a GET with an `Origin` header is refused; canary secrets absent from all responses |
| SM-J4 | Link, advance fake Admin `lastModified`, trigger scheduled: the fake Jira has exactly one comment; a second trigger adds none; with an expired access token the tick refreshes once and the persisted refresh token changes (ciphertext differs) |
| SM-J5 | Records CPU/wall time and subrequest count per tick (with and without a refresh) for 1, 20 and 100 links; informational against #16 R6, no hard threshold until a baseline exists |

## 4. End-to-end tests inside the extension (seam S1, Playwright, Chromium, hermetic)

Server: the #1 static server on `:3000`; the real worker via wrangler on `:8787` (local D1) with the fakes (including `fakeAtlassian`) as local servers; the #1 SDK stub with a token signed by the test key (an admin user and a non-admin user); `page.route` serves the stub SDK and the DA config tab; every other external request is aborted.

| ID | Behaviour asserted |
|---|---|
| E2E-J1 | **Connect round trip:** admin opens the plugin (Jira not connected), presses Connect; the test opens the returned authorize URL against the fake authorization server, which redirects the browser to the worker's local callback with `code` and `state`; the callback page shows success; the plugin (polling) shows Connected with the site name |
| E2E-J2 | Non-admin session: no Connect button, status text and own user id shown; direct `start` call from the page's origin with the non-admin token -> `403` |
| E2E-J3 | Search and link a Jira issue: card shows key and summary, status, assignee and due date from the fake; pasted URL and key work (real cross-origin requests, preflight included) |
| E2E-J4 | Create an issue (project lookup, default type): auto-linked; the fake contains one new issue whose description has the page URLs |
| E2E-J5 | Advance the fake Admin `lastModified`, trigger the scheduled event, reload the plugin: the fake issue has the comment (and the transition when configured per site); the plugin shows "sent" |
| E2E-J6 | Token lifecycle inside the flow: the fake expires the access token; search and link still work without any UI event; no response, DOM or network log contains an Atlassian token, the client secret, the encryption key, the `code` or the `state` |
| E2E-J7 | Negatives and hosts: request without token -> `401` shown plainly; token signed by another key -> `401`; only the page, SDK stub, worker, stubbed `admin.da.live` and the fake Atlassian host(s) were contacted |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| JR1 | `providers/jira/` contains `SPEC.md`, `README.md`, tests; the extension README contains the Jira section headings (Atlassian app, secrets and vars, connection admins, connecting, site config keys, local development, branch ref, permissions, rotation and disconnect, caveats, policy note) so they cannot be silently removed |
| JR2 | `secrets.required` contains `JIRA_CLIENT_SECRET` and `JIRA_TOKEN_ENCRYPTION_KEY`; no `vars` key matches a secret pattern; `.dev.vars.example` lists both secrets; the four Jira vars exist in the production and local environments; `JIRA_OAUTH_REDIRECT_URI` is https in production and ends with the callback path; local-only Atlassian base URL overrides are absent from the production environment (extends #2 UR3/UR5 and #16 UR-L3) |
| JR3 | **Diff scope for "Jira only adds a module":** files changed by the Jira PRs outside `providers/jira/**` are limited to the permitted list (worker provider registry line, browser hook registry line, wrangler config vars and secret names, `.dev.vars.example`, the generic state migration if added, README Jira section, test-support additions); shell, poller, ledger, store, route, renderer and conformance-suite files are untouched |
| JR4 | The registry enumeration includes `jira` in the conformance run (UR-L4 re-check) and every registered provider has a README section |
| JR5 | No import from another extension; no network access or `process.env` use in the Jira browser code; the fixture lint (JF2) runs |

## 6. CI additions (no credentials, no Cloudflare login, no Atlassian account)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint over the new code (worker globals override); JR1 to JR5 | |
| `unit` (existing) | WTR JB1 to JB11 | `--no-sandbox` Chromium args as in #1 |
| `worker-unit` (existing, extended) | `node:test` JA, JO, JT, JS, JN, JU, JW, JF, JC1 (memory) | runs on every push and PR |
| `worker-smoke` (existing, extended) | SM-J1 to SM-J5 | advisory until stable, per #2 Q11 |
| `e2e` (existing, extended) | E2E-J1 to E2E-J7 with the worker and fakes as web servers | Chromium only |

## 7. End-to-end checks inside real Experience Workspace and real Jira Cloud (manual; needs interactive Adobe and Atlassian logins)

**Accounts and credentials needed (none can be provided by an agent):**
- Everything #16 section 6 lists for EW and Cloudflare: GitHub admin (Code Sync, per #1), an Adobe IMS identity with DA org/site access and config-write permission, Chrome, a Cloudflare account (D1, plan per #16 Q2) with Wrangler login, an AEM Admin API key for the test site.
- An **Atlassian account** that can create apps in the developer console (https://developer.atlassian.com/console/myapps/), and **two OAuth 2.0 (3LO) apps**: a dev app (callback `http://localhost:8787/v1/providers/jira/oauth/callback`, if Atlassian accepts it, J1) and a production app (callback on the deployed worker), with the Jira platform REST API scopes above and sharing enabled when the connected account is not the app owner.
- A **Jira Cloud site for testing**: a free development site (https://www.atlassian.com/try/cloud/signup?product=confluence.ondemand,jira-software.ondemand,jira-servicedesk.ondemand,jira-core.ondemand&developer=true; terms [OPEN]) with a site admin; a **dedicated Atlassian user** for the integration who is licensed on the site; a test project where that user has Browse, Create issues, Add comments and Transition issues; at least five issues (assigned and unassigned, with and without a due date, one already `Done`); a second project where the integration user has **no** Browse permission; a workflow with a transition to `Done` and a status with no inbound path; optionally a project whose create screen requires a custom field.
- The operator's IMS user id (visible in the plugin for non-admins, or from a decoded token's claims) for `JIRA_CONNECTION_ADMIN_USER_IDS`.
- Never paste client secrets, the encryption key, an Atlassian token, an authorization code or an IMS token into chat, issues, PR descriptions or logs; they are live credentials until expiry or revocation. Read credentials from prompts or unset environment variables for `curl` checks.

Steps (M-J numbering avoids collision with #1 M, #2 W, #16 M-L):

- **M-J0 (prereq):** worker deployed as per #16 M-L0 plus Jira: `wrangler secret put JIRA_CLIENT_SECRET`, `wrangler secret put JIRA_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64, generated locally); vars set (`JIRA_SITE_URL`, `JIRA_CLIENT_ID`, `JIRA_OAUTH_REDIRECT_URI`, `JIRA_CONNECTION_ADMIN_USER_IDS`); `curl -i <worker>/v1/config` -> `401`; the existing `library` row and config tab (`providers` includes `jira`). Proves AC7 (bare `401`).
- **M-J1 (spike J1 to J8, before the build):** execute the build-plan step 1 checks with throwaway scripts; record outcomes and resolve every [OPEN] tag from section 3 of the Build Analysis. Includes opening a test page inside the real library iframe to see whether popups and `window.opener` work. Retires R6, R15.
- **M-J2 (`ref=local`, connect):** `npm start` (port 3000) and the worker dev script (port 8787) using the dev Atlassian app in `.dev.vars`; open an EW document with `?ref=local`; open the library; **Work Item**; the Jira connection panel shows "not connected" with Connect; press Connect, sign in as the dedicated Atlassian user, check the consent screen shows the app name and exactly the requested permissions, approve; the callback tab says connected; the plugin shows Connected with the site name within a few seconds. Inspect the local D1 file or `wrangler d1 execute` output: the connection row has ciphertext, no plaintext token. Record whether the callback request carried an `Origin` header. Proves AC3, AC6 (local), AC7.
- **M-J3 (search and link):** search a known issue by words, paste its URL, paste its key; link one; compare key, summary, status, assignee and due date with the Jira UI; try an unassigned issue and one with no due date; try an issue key from another site. Proves AC1.
- **M-J4 (create):** create an issue (default project and type from the config tab, then the project lookup); confirm it exists in Jira with the page URLs in the description and that it is linked; try a project with a required custom field and record the author-facing message. Proves AC1.
- **M-J5 (stored with the page):** reload; open the same page in another browser profile and as a second user: the link is there; unlink and relink. Proves AC1.
- **M-J6 (publish comment):** edit and publish the page; wait at most the poll interval plus one minute; the Jira issue shows exactly one comment with the live URL and the marker line; the plugin shows "sent"; publish twice quickly: one coalesced comment. Proves AC2.
- **M-J7 (publish transition):** set `jira.issue.on-publish-status=Done` and add `jira.issue:Done` to the operator allow-list; publish: the issue transitions; publish again: `skipped (already)`; point at an issue whose workflow has no path to the target: the plugin shows the failure reason; point at an issue with a required transition field if available: `transition_requires_fields`. Proves AC2.
- **M-J8 (per-site settings):** step the config tab through `none`, `comment`, `status`, `comment,status`, an invalid status name (warning shown, no transition), `search-projects` restriction, a custom template; reopen the plugin; observe each outcome on the next publish. Proves AC2 (as configured).
- **M-J9 (token refresh):** record the observed `expires_in`; wait longer than it, then search and publish: both work with no reconnect; the worker log shows one refresh; the stored ciphertext changed (rotation persisted). Proves AC3.
- **M-J10 (revocation and recovery):** remove the app from the dedicated user's connected apps in Atlassian (or change its password as per Atlassian's documented cause) [location of the setting from J7]; the next call shows "Jira connection needs reconnecting"; publish, watch the event fail with `reconnect_required`; reconnect from the plugin; press Retry; exactly one comment appears. Proves AC3 (failure handling), AC2 (retry).
- **M-J11 (branch ref):** push branch `wml-jira` (simple name), wait for code sync, open the editor with `?ref=wml-jira`; the plugin loads from `{branch}--ew-extensions--jazhou-adobe.aem.live` and works against the deployed worker; connect with the production app (the callback is the worker's), then repeat M-J3 and M-J6 once. Record the page's real `Origin` and whether the browser popup/opener behaved as the spike found. Proves AC6 (branch ref).
- **M-J12 (secret hygiene):** search the Network panel responses, page source and DevTools Application storage for the client secret, encryption key, access token, refresh token, authorization code and `state` (none; the `state` appears only in the authorize URL the browser navigates to); `wrangler secret list` shows names only; the callback page source contains no request data. Proves AC7.
- **M-J13 (negatives and access):** `curl` without token -> `401`; valid token with `Origin: https://evil.example` -> `403`; non-admin token on `start` -> `403`; callback with a random `state` -> generic page; with a used `state` -> generic page. Proves AC7.
- **M-J14 (permissions and limits):** link an issue in the project the integration user cannot browse -> generic "not found or no access"; remove the Add comments permission and publish -> failed `forbidden` visible; optional: publish ten linked pages at once and observe `Retry-After`/rate-limit headers (J8). Proves AC2, AC7.
- **M-J15 (docs walk-through and listing):** a reviewer follows the extension README's Jira section from a clean clone to a connected local instance using only the README; confirm the repo README extensions table still lists the extension (no new row) and the diff-scope check (JR3) passes on the PR. Proves AC4, AC5.

## 8. Acceptance-criteria traceability (ticket #17)

| # | Acceptance criterion (#17) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can search or create a Jira issue and link it to the page; status, assignee and due date are shown | JS1 to JS13, JN1 to JN6, JA5 to JA8 (search, resolve, create, projection), WL/WG re-checks via the shared shell suite with `jira`; JB5 to JB9, E2E-J3, E2E-J4 (browser to real local worker), SM-J4 | **M-J3**, **M-J4**, **M-J5** (compare with the Jira UI; persistence across profiles and users); spike J2, J3, J4, J6 |
| AC2 | Publishing the page comments on / transitions the linked Jira issue as configured | JU1 to JU15 (comment with marker, transition resolution, skips, failures, retries, bulk, end-to-end via the poller), JW5 (settings), WK/WU re-checks; E2E-J5, SM-J4 | **M-J6**, **M-J7**, **M-J8**, **M-J10** (retry), **M-J14**; spike J5, J6, J8 |
| AC3 | Jira OAuth tokens are stored and refreshed by the worker | JO1 to JO12 (connect, state, callback hygiene), JT1 to JT13 (encryption at rest, margin, rotation, races, classification, keep-alive, persist failure), JC1 (state port), E2E-J1, E2E-J6, SM-J2 to SM-J4 | **M-J2** (real consent, ciphertext in D1), **M-J9** (real refresh and rotation), **M-J10** (revocation), spike J7 |
| AC4 | Added inside the existing `work-management-link` folder as a new provider; no changes needed in the shell beyond registering the provider | JW1 to JW3, JW6 (conformance unchanged, mixed-registry isolation, declared names equal config), JB8 (descriptor-driven UI unchanged), JR3 (diff scope), JR4 | Build-plan step 0 outcome recorded in the README (which, if any, shell extension points had to be added, and why); **M-J15** (reviewer confirms the diff against the permitted list); Open Question 1 |
| AC5 | Extension README documents this vendor's setup (credentials, site config keys) | JR1 (required Jira README headings), JR2 (documented secrets/vars equal the config) | **M-J15** (walk-through from a clean clone using only the README); review against decision 37's topic list |
| AC6 | Works in EW with `ref=local` and with a branch ref | JB3, JB10 (origin handling, authorize-URL host rule), E2E-J1 to E2E-J7 (page on `localhost:3000`, real local worker, cross-origin), WA2 (origins) | **M-J2** (`ref=local`, incl. connect with the dev app), **M-J11** (branch ref against the deployed worker and production app) |
| AC7 | Vendor credentials live only in this extension's worker (built from the shared template); the browser never receives them; unauthenticated calls are rejected | JA1 to JA9 (auth before anything, origin gate, admin gate, canary matrix, allow-list, host/path/JQL safety), JO2 to JO12, JT1, JT11, JR2 (no secret in vars/git), JB10, E2E-J2, E2E-J6, E2E-J7, SM-J1, SM-J3 | **M-J0** (bare `curl` -> `401`), **M-J12**, **M-J13**, **M-J14**; `wrangler secret list` |
| AC8 | Core logic covered by unit tests; lint and CI green | All tables above; `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` jobs (section 6); JF1, JF2 | CI shows all jobs green on the PR; deliberately loosen the field allow-list (JA5) or concatenate user text into JQL (JA7) on a scratch branch and see the suite go red |

Every acceptance criterion on #17 maps to at least one automated test or a numbered manual step. Criteria on #55 itself: `apps/work-management-link/providers/jira/` exists and contains this `SPEC.md`; it follows the to-spec template (Problem Statement through Further Notes) and adds Build Analysis and Testing Requirements; the table above covers every #17 criterion; external API claims carry primary-source URLs and unverified claims are tagged [ASSUMPTION] or [OPEN]; no implementation code is written.

## 9. Open questions for the owner

1. **Contract additions (R1, X1 to X8).** #16's closed provider contract has no connection API, state port, public callback route, browser hook slot, provider settings schema or keep-alive hook. Do you want #16's spec amended now to reserve them (preferred: Jira then truly "only adds a module"), or is a one-off minimal shell commit by #17 (build-plan step 0) acceptable, with AC4 read as "no behaviour change to existing providers"?
2. **Public OAuth callback (X5).** Will #2 add per-route authenticators, HTML responses and no-CORS routes (the same E1/E4/E5 that `apps/chat-approvals/SPEC.md` already requests)? If not, accept the decision-12 fallback (static callback page plus authenticated `complete`)? This is a shared decision with chat-approvals.
3. **Identity model and account (decisions 1, 2).** Accept one site-level connection acting as a dedicated Atlassian account (authors see what it sees), deferring per-author identity? Is a dedicated licensed Jira user available? Would you rather use an Atlassian **service-account OAuth 2.0 credential** (client credentials, no consent, no refresh tokens; needs an organisation admin and the centralised user-management experience) instead of 3LO, given the ticket text says 3LO?
4. **Who may connect (decision 6).** Is a worker var listing IMS user ids acceptable as the "connection admin" gate (default closed)? Is there a better signal for "config admin" than a hand-maintained list?
5. **Atlassian app ownership and policy (decision 3, R10).** Who owns the Atlassian developer-console app and its client secret? Is a private/shared single-operator app acceptable under Atlassian's integration guidance and Adobe's outside-activity/IP policy (carried from #1 R1)? Would a Marketplace-listed distributable app (or Forge) be needed before anyone else deploys this?
6. **Jira site.** Which Jira Cloud site (`JIRA_SITE_URL`) and which free/sandbox site for testing? One site per deployment as in decision 5, or do you foresee several?
7. **Atlassian apps per environment.** Atlassian's console takes an exact callback URL; is it acceptable to keep **two** apps (dev with a localhost callback, production with the deployed worker), with the production app also used for branch-ref testing? (J1 checks whether one app can register several callbacks.)
8. **Transitions.** Target by status **name** in the config tab (this spec) or also by id? Is failing with a clear reason acceptable when the workflow offers no path or the transition screen requires fields (for example Resolution), or do you want an optional `jira.issue.on-publish-fields` (for example a resolution name) in a follow-up?
9. **Creating issues.** Default project key and issue type come from the config tab; projects whose create screen has required custom fields are not creatable from EW (the author is told to create in Jira and link). Acceptable? Should the form ask for the issue type when no default is set?
10. **Search scope.** Search all projects the integration account can browse (default) or only `jira.search-projects`? Is `text ~` free-text relevance acceptable, or do you want summary-only matching?
11. **Comment content and visibility.** The comment is visible to everyone who can browse the project and notifies watchers per Jira rules. Acceptable, or do you want a role/group visibility restriction or a no-notification option? May `{published_by}` (an email from the Admin API) appear in Jira comments (carries #16 Q11)?
12. **Marker.** A visible `EW publish event <id>` line is added to every automatic comment so a retry can detect it. Acceptable, or should the marker be less prominent (for example a comment property that cannot be searched, with a heavier fallback scan)?
13. **Back-link in Jira.** Should linking an existing issue also write a Jira remote link or issue property pointing at the page (Contentful stores `contentfulLink` for reverse lookup)? v1 only puts the URLs in the description of an issue created from EW.
14. **Scopes.** Accept classic scopes `read:jira-work`, `write:jira-work`, `offline_access` (adding `read:jira-user` only if J1 requires it), rather than the Beta granular scopes? Do you want the connected account's name shown to admins (needs `read:jira-user` and `GET /myself`)?
15. **Secrets and key rotation.** Accept that rotating `JIRA_TOKEN_ENCRYPTION_KEY` requires a reconnect, and that the operator keeps a copy of the key in their own secret manager? Do you want a documented D1 export/backup step (carries #16 Q13)?
16. **Keep-alive and alerting.** 30-day keep-alive refresh and a visible `needs_reconnect` state: enough, or do you want a notification (for example a message to a chat channel via the chat-approvals worker, or a status line in an admin view) when the connection needs reconnecting?
17. **Platform and data policy.** Cloudflare plan, personal-account handling of an Atlassian credential and customer Jira data, retention and backups: carried from #16 Q2, Q10, Q13; confirm they apply unchanged.
18. **Rate-limit tier.** The default Global Pool quota (65,000 points per hour shared across all tenants of the app) is ample for one operator; confirm no distribution to many sites is planned (R11).
19. **Naming.** Author-facing copy: "Jira issue" or "Jira work item" (Atlassian's current UI term)? Item-type label and the plugin's library title (carries #16 Q15).
20. **Follow-ups.** Do you want tickets for: per-author Jira connection, Jira webhook-driven status refresh, alerting for expired connections, comment visibility options, a "linked pages" overview?
