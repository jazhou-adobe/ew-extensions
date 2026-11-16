# Spec: Marketing Automation Sync: Iterable (provider `iterable`)

Ticket: jazhou-adobe/ew-extensions#32 (this spec: #70). #32 is blocked by #27 (extension shell, vendor interface, first provider Marketo; spec in `apps/marketing-automation-sync/SPEC.md`), which is itself blocked by #1 (repo scaffold, spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template, spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as #1, #2, #27, #28): **[VERIFIED]** = read in a primary source (URL given) on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision, a live-project check, or an answer from Iterable.

Vocabulary follows #1, #2 and #27: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *source page*, *field*, *target*, *slot*, *binding*, *mapping*, *sync*, *re-sync*, *descriptor*, *V1 contract suite* are as defined in #27. Iterable vocabulary used here: *project* = the unit that owns an API key, snippets, templates and a data center; *snippet* = an Iterable reusable content block (HTML, inline CSS, Handlebars, or plain text) that templates embed with a snippet expression and that Iterable inserts at send time; *snippet expression* = the Handlebars call that embeds a snippet, e.g. `{{{ snippet "name" }}}`; *data feed* = an Iterable-side connection that *pulls* structured data from an external URL at send time (not a push target, see Decision 2); *USDC / EDC* = Iterable's US and EU data centers, each with its own API host.

This spec stays consistent with #27's provider interface (descriptor, `connect`, `listTargets`, `describeTarget`, `push`, normalised error taxonomy, V1 contract suite, fake vendor) and does **not** redesign the shell. Everything #27 fixed (mapping document, field addressing, extraction, formats, storage, sync engine, status, lease, pacing, authorisation, routes, folder layout, tooling, template amendments R-T1..R-T5) is reused by reference. Only Iterable-specific decisions are made here. Where Iterable does not fit the interface cleanly (Iterable has no draft state, so every write is live), the spec says so (Decision 3, Build Analysis section 4) and proposes the smallest additive amendment together with an in-module or README fallback. The sibling provider spec `providers/ajo/SPEC.md` (#28) is referenced where the two vendors share a pattern; this spec does not depend on #28 landing first.

Primary sources read (2026-11-16): [Iterable OpenAPI definition, API version 1.8 (source of the rendered API Explorer)](https://api.iterable.com/api-docs) and the rendered [API Explorer (US)](https://api.iterable.com/api/docs) / [API Explorer (EU)](https://api.eu.iterable.com/api/docs); [Iterable API Endpoints and Sample Payloads, Snippets section](https://support.iterable.com/hc/en-us/articles/204780579-Iterable-API-Endpoints-and-Sample-Payloads); [Getting Started with Iterable's API](https://support.iterable.com/hc/en-us/articles/41044692130196-Getting-Started-with-Iterable-s-API); [API Keys](https://support.iterable.com/hc/en-us/articles/360043464871-API-Keys); [API Response Codes](https://support.iterable.com/hc/en-us/articles/39629320560148-API-Response-Codes); [Snippets Overview](https://support.iterable.com/hc/en-us/articles/4414807441556-Snippets-Overview); [Creating and Managing Snippets](https://support.iterable.com/hc/en-us/articles/46135873895956-Creating-and-Managing-Snippets); [Adding a Snippet to a Template](https://support.iterable.com/hc/en-us/articles/4415894606356-Adding-a-Snippet-to-a-Template); Data Feeds: [Overview](https://support.iterable.com/hc/en-us/articles/204795659-Data-Feeds-Overview), [Managing Data Feeds](https://support.iterable.com/hc/en-us/articles/39205474652948-Managing-Data-Feeds), [Creating a Data Feed Web Service](https://support.iterable.com/hc/en-us/articles/45728211053332-Creating-a-Data-Feed-Web-Service); Contentful's Iterable app: [help page](https://www.contentful.com/help/apps/iterable), [changelog](https://www.contentful.com/developers/changelog/iterable-marketing-automation-app-is-now-live/), [Iterable-side integration page](https://support.iterable.com/hc/en-us/articles/41071094449300-Contentful-Iterable-Integration); the Snippets API announcement on the [Iterable community](https://community.iterable.com/product-updates/build-once-personalize-everywhere-introducing-the-snippets-api-1364) (seen only as a search-result excerpt dated 2025-09-17: "Snippets APIs are now available for all customers"). The ticket's own reference, the [Contentful marketplace blog](https://www.contentful.com/blog/new-apps-integrations-marketplace/), returned a bot-check page to my fetch and was **not** re-read; the Iterable claim in it is cross-checked against the Contentful help page above. Upstream `adobe-rnd/ew-extensions` has no Iterable code (GitHub code search for `iterable` in that repo returned no hits on 2026-11-16 [VERIFIED by command]).

---

## Problem Statement

A team that runs its campaign copy in Experience Workspace (EW) and sends it through **Iterable** writes the same headline, body copy, call-to-action and image URL twice: once as an EW page or fragment, once as an Iterable **snippet** that email, in-app, push and SMS templates embed. Every copy fix is repeated by hand and the two copies drift. #27 gives EW a vendor-neutral mapping shell plus Marketo; Iterable is not available in it. The ticket's scoring note ("Contentful just shipped four of these") points at Contentful's Iterable app, which exists and is a **data-feed link generator**, not a content pusher: Contentful gives the marketer a URL for an entry, the marketer pastes it into an Iterable data feed, and Iterable pulls the entry from Contentful's delivery API at send time [VERIFIED: Contentful help page and changelog above]. #32 asks for something different and stronger: acceptance criteria that say content *pushes* on demand and is *re-synced by a poller* with per-item status.

Six things make Iterable different from Marketo and AJO, the vendors the shell was built and reviewed around:

1. **"Data feeds / snippets" names two different mechanisms, and only one is a push target.** Data feeds are pulled by Iterable from a URL at send time; they are created and edited in the Iterable UI (permission *Manage Integrations*) and the OpenAPI definition contains no data-feed path at all [VERIFIED: Managing Data Feeds page; `jq` over the 159 operations of the definition found no path containing `feed`]. Snippets have a documented create/read/update/delete API [VERIFIED: endpoints article, OpenAPI]. Only snippets can satisfy "content pushes on demand and the worker re-syncs".
2. **There is no draft state: a write is live.** "When you edit a snippet, any changes you make immediately affect every template that references it, even while campaigns are running" [VERIFIED: Creating and Managing Snippets]. Marketo has draft/approve for snippets and AJO has draft/publish for fragments; Iterable has neither. A polled sync therefore changes live customer messages without any human looking, the first time the EW page is published.
3. **There is no optimistic concurrency.** The update endpoint is `PUT /api/snippets/{identifier}` with `content`, optional `description` and `variables`; no etag, no `If-Match`, no version field [VERIFIED: OpenAPI `UpdateSnippetRequest`]. Last write wins between EW and a person editing in the Iterable UI, and what `PUT` does to `description` and `variables` when they are omitted is not documented [OPEN, spike IS1].
4. **Content that looks like code is code.** Snippet content is Handlebars; "Handlebars must be valid" or the API rejects it, and `[[field]]` addresses data-feed fields [VERIFIED: OpenAPI `content` description; Managing Data Feeds, merge contexts]. A sync that copies `{{profile.email}}` or a stray `{{#if` from a public, author-edited EW page into a live snippet hands the page author expression evaluation against customer profile data, or breaks every template that embeds the snippet.
5. **The credential is project-wide.** Writing snippets needs a **server-side** API key; there is no snippet-scoped key, and a server-side key "can access all of Iterable's API endpoints" except a short list of client-only ones (users, events, campaigns, lists, exports, templates, and more) [VERIFIED: API Keys, "Server-side" section and per-endpoint `x-iterable-api-key-types`]. A key is bound to one project and one data center [VERIFIED]. The key must never reach the browser, which is why #2's worker is mandatory, and the blast radius of a leak is the whole project.
6. **The listing endpoint is unpaged and heavy.** `GET /api/snippets` takes no parameters and returns every snippet with its full content [VERIFIED: OpenAPI `getSnippets` has an empty `parameters` list; sample response includes `content`]. Search, paging and kind filtering are the module's job, and the endpoint's rate limit is not documented (the endpoint description carries none, unlike others that say "Rate limit: 100 requests/second, per project") [VERIFIED absence in the definition; OPEN, spike IS4].

The maintainer needs Iterable added **as one provider module**, inside the existing `marketing-automation-sync` folder, without changing the shell, so campaign copy is authored once in EW and reaches Iterable snippets, with the missing draft step made visible and controllable.

## Solution

Add the Iterable provider to `marketing-automation-sync`: one worker module under `providers/iterable/`, registered in the shell's vendor registry, plus its README, fake, tests and a descriptor. No shell logic changes (two small additive descriptor extensions are *proposed* in Build Analysis 4, each with a no-shell-change fallback).

What the admin sees, unchanged from #27: in the existing app they choose vendor **Iterable**, choose a **target** from a searchable list of the project's snippets (two kinds, *HTML snippet* and *Text snippet*, see Decision 6), map one EW field or block to the snippet's body, preview exactly what would be written, save the mapping for the site, press **Sync now**, and watch the status view show last sync time and per-item errors. After an author edits and publishes the EW page, the worker's poll notices the changed published version and re-syncs the snippet within the polling interval.

What is specific to Iterable:

- **Targets are existing snippets**, identified by Iterable's numeric snippet id. The module never creates, deletes or renames snippets (the interface has no such operation, and the id-only update path cannot create one).
- **One slot per target, its body.** HTML snippets take `html` (and escaped `text`/`url`/`image`); text snippets take `text`, `url`, `image` verbatim.
- **Every write is live, and the product says so.** The descriptor marks the vendor as live-on-write; the UI (if the owner accepts proposal IP1) warns and, by default, holds *polled* re-syncs until the admin has pressed Sync now once; the README says in its first section that editing a snippet changes running campaigns. Without IP1 the fallback is the README warning plus the preview and the per-binding disable switch.
- **Personalization syntax is refused, not passed through.** A value containing `{{` or `[[` is rejected per slot with a plain message, so page content cannot become executable personalization.
- **Existing snippet properties are preserved.** The write sends back the description and variables exactly as read; the name is immutable and never sent.
- **Auth and secrets stay in the worker.** One server-side API key per deployment, held only as a Cloudflare secret and injected as the `Api-Key` header by the template's proxy helper; the data center (US or EU) is a non-secret enum variable that selects one of two fixed hosts; every route is authenticated exactly as #27 specifies.
- **Data feeds are documented, not built**: README explains that a data feed pointing at an EW-hosted JSON URL needs no sync at all, and why a worker-served feed is out of scope (Decision 2, Out of Scope).

## User Stories

Admin (site or campaign admin who sets up the mapping):

1. As an admin, I want to choose Iterable as the vendor for a binding, so that I can keep Iterable snippets in sync with EW pages.
2. As an admin, I want to search my Iterable project's snippets by name from the app, so that I never copy snippet ids around.
3. As an admin, I want to choose whether a snippet is treated as an HTML snippet or a text snippet, so that the same field can feed an email body block and an SMS line without markup leaking.
4. As an admin, I want to map one EW block as HTML to an HTML snippet, so that a reusable section (banner, footer, CTA) stays in sync.
5. As an admin, I want to map one EW field to a text snippet as text, link URL or image URL, so that a headline, offer line or link can be reused by name in templates.
6. As an admin, I want each snippet in the list to show its description and last-updated time and who updated it, so that I know what I am about to overwrite.
7. As an admin, I want to see the snippet's current content next to the new value in the preview, so that I can judge the change before the first write.
8. As an admin, I want a preview that shows the exact value and the Iterable operations that would run (read, write), without changing anything, so that I can trust the first sync.
9. As an admin, I want a clear statement in the app that Iterable writes go live immediately to every template and running campaign that uses the snippet, so that I choose targets knowingly.
10. As an admin, I want polled re-syncs for an Iterable binding to stay on hold until I have run the first Sync now myself (if the owner accepts this), so that nothing changes live content before I have seen one successful controlled write.
11. As an admin, I want values containing personalization syntax (`{{`, `[[`) rejected with a message naming the field, so that page content cannot inject expressions into customer messages.
12. As an admin, I want an oversize value reported before any write, so that I find out in preview rather than in Iterable (email clients clip messages over about 100 KB).
13. As an admin, I want to check the Iterable connection from the app and see "connected" or a plain reason (key rejected, wrong data center, key lacks permission), so that I can fix setup without reading logs.
14. As an admin, I want the README to tell me exactly which API key type to create, in which project, and how to find the data center, so that setup needs no guesswork.
15. As an admin, I want the README to recommend a dedicated, EW-owned snippet per binding, tested with a copy first, so that I do not overwrite hand-built Handlebars logic by accident.
16. As an admin, I want the same mapping rules as for Marketo (per site, versioned, conflict on stale save, export/import, disable binding), so that Iterable bindings behave like any other.
17. As an admin, I want Marketo, AJO and Iterable bindings in the same site mapping, so that I can run several platforms from one place.
18. As an admin, I want a snippet that was deleted in Iterable to show "target not found" with a prompt to pick another, so that I understand why a binding stopped.

Campaign author:

19. As an author, I want my published EW edits to reach the Iterable snippet automatically (after the admin has enabled it), so that I do not repeat the copy in Iterable.
20. As an author, I want to see when the snippet was last synced and whether it succeeded, so that I know Iterable has my latest copy.
21. As an author, I want a Sync now button, so that I can push right after publishing.
22. As an author, I want an unpublished or deleted source page to show "source unavailable" and leave the snippet untouched, so that a mistake never blanks a live message component.
23. As an author, I want a missing or empty field reported per slot with the field named, so that I know which edit broke the mapping.
24. As an author, I want to be told if the snippet was changed in Iterable since EW last wrote it (if the owner wants drift warnings), so that I know an EW sync will overwrite someone else's edit.

Maintainer / operator:

25. As the maintainer, I want the Iterable API key only in the worker's secret store, so that no page, response, log or database row can leak it.
26. As the maintainer, I want the key sent only in the `Api-Key` header, never in a URL or body, so that no log line and no stricter legacy rate limit applies (Iterable limits query-string and body keys more strictly since 2025-11-10).
27. As the maintainer, I want the data center chosen from a two-value variable, not a URL, so that no one can aim the worker's key at another host.
28. As the maintainer, I want `429` honoured with backoff and `Retry-After`, so that this integration cannot hammer a shared project's API.
29. As the maintainer, I want one failed snippet not to block the others, so that a single deleted snippet does not stop a campaign.
30. As the maintainer, I want the module never to delete, rename or create snippets, templates, catalogs, data feeds or any other Iterable object, so that automation cannot destroy campaign assets, even though the key could.
31. As the maintainer, I want a repeated sync with unchanged content to make no Iterable writes, so that polling costs almost nothing and `updatedAt` in Iterable does not churn.
32. As the maintainer, I want the update to carry the snippet's existing description and variables back unchanged, so that a sync cannot silently clear them.
33. As the maintainer, I want Iterable's error text, key identifier and caller IP never forwarded to the browser, so that error bodies cannot leak anything (Iterable's 401 body includes the caller IP and the first characters of the key id).
34. As the maintainer, I want the module to need no change in the shell beyond registering it, so that vendor #3 is as cheap as the contract promised.
35. As the maintainer, I want a CI check that a provider change touches only the allowed paths, so that "no shell changes" is enforced, not hoped for.
36. As the maintainer, I want the README (extension and provider) to document Iterable setup, secrets, variables and the "reads no site configuration" fact, so that a new person can enable it alone.
37. As the maintainer, I want edits made through the API attributed to a recognisable user in Iterable's audit fields (if Iterable allows it), so that "who changed my snippet?" has an answer.
38. As the maintainer, I want a clear statement of what the key can and cannot do, so that I can decide whether to run this worker for a project that holds more than snippets.

Security reviewer:

39. As a security reviewer, I want proof that a canary API key never appears in any response, header, log line or stored row for Iterable paths, so that "never reaches the browser" is tested.
40. As a security reviewer, I want proof that every route still returns 401 without a token after Iterable is registered, so that adding a vendor cannot add an unauthenticated path.
41. As a security reviewer, I want proof that the snippet id, data-center value, paths and query strings cannot steer the worker to another host or another API path, so that user input cannot cause server-side request forgery or path injection.
42. As a security reviewer, I want proof that content containing personalization syntax, script, iframe or style cannot reach an Iterable snippet, so that page authors cannot execute expressions or inject script into messages.
43. As a security reviewer, I want the user's IMS token proven never to be sent to Iterable, so that token handling stays auditable.
44. As a security reviewer, I want proof that the module only calls the snippet read and update-by-id operations (plus the connection-test read), so that the wide key cannot be used for anything else through this worker.

Vendor developer (the owner or an agent working the remaining follow-ups):

45. As a vendor developer, I want Iterable to pass the same V1 contract suite as Marketo and the fake vendor, so that the suite is shown to be vendor-independent a third time.
46. As a vendor developer, I want the interface-fit findings from Iterable (no draft state, no concurrency token, unpaged listing, key-in-header auth, a pull-based sibling mechanism) recorded with proposed amendments, so that Braze, Klaviyo and HubSpot specs can reuse them.

## Implementation Decisions

(No file paths or code. Layout and shapes are in the Build Analysis. Everything not stated here is as in #27.)

**Product shape and scope**

1. **One provider module, registered, nothing else in the shell.** The Iterable module lives with its vendor folder (`providers/iterable/`, worker code under `providers/iterable/worker/` per #2 Decision 3). Registration = one entry in the shell's vendor registry, the Iterable secret name in the worker config, the non-secret variables, `.dev.vars.example`, and one row in the extension README's vendor list. No change to mapping, extraction, storage, sync engine, status, UI or routes. Enforced by a footprint check (Testing, UR-I1; the same rule as #28's UR-A1, built by whichever ticket lands first).
2. **Scope of #32 = Iterable snippets, pushed.** "Data feeds / snippets" in the ticket is resolved as follows [decision for owner confirmation, Open Question 1]:
   - **Snippets (in scope).** The only Iterable content object that has a documented write API for free-form HTML or text and that fits the interface with a `single` slot [VERIFIED: OpenAPI]. They satisfy every acceptance criterion as written.
   - **Data feeds (out of scope as a push target).** Iterable pulls them from a URL at send time (JSON, XML, RSS or Atom, response within 10 seconds, static `Authorization` header token only, 1-hour optional cache), and data feeds are created and edited in the Iterable UI only [VERIFIED: the three Data Feeds pages]. There is nothing to push to and no API to register a feed. The Contentful app takes this route (it generates a link) [VERIFIED]. EW can offer the equivalent without this ticket: an EW-hosted JSON URL (for example a spreadsheet published as JSON; EDS serving behaviour [ASSUMPTION, not checked here]) pasted into an Iterable data feed needs no worker and no credential. A *worker-served* feed would need a public route authenticated by Iterable's static `Authorization` token, which conflicts with #2 Decision 4 (no unauthenticated routes beyond `OPTIONS`; IMS bearer on everything) and with this ticket's AC6, so it is not designed here (Open Question 2).
   - **Other Iterable objects** (email and other templates via `POST /api/templates/*/upsert`, catalog items) were considered and left out: templates are whole messages with subject, preheader, HTML and settings (a multi-slot model and a bigger blast radius), and catalog is an add-on that is enabled per account through customer success [VERIFIED excerpt: Using Catalog, search result]. Either could be a later provider or kind (Open Question 3).
3. **Interface fit (verdict).** Iterable fits #27's interface with **no breaking change**: `single` slot model, one rule per binding, descriptor-driven UI, per-slot results, error taxonomy, `supportsApproval` false (so the shell shows no approval option). Three gaps are handled in the module or the README, each with an optional additive amendment the owner may accept (Build Analysis 4, proposals IP1-IP3): (IP1) a descriptor flag `writesAreLive` so the UI can warn and the shell can hold polled re-syncs until a first manual sync; (IP2) `describeTarget` may return a truncated, text-only `currentValue` for the slot, so preview can show current versus new; (IP3) `listTargets` items may carry a short `note` (shared with #28's P3). Fallbacks need no shell change.
4. **Tenancy.** Single-tenant per worker deployment, like Marketo and AJO (#27 Decision 18, OQ 2): one Iterable project, one API key, one data center. A deployment that needs a staging and a production project runs one worker per project [OPEN, Open Question 4].
5. **Never destructive.** The module never calls `DELETE`, never calls `POST /api/snippets` (create), never calls the update endpoint by *name* (which would create a snippet if the name did not exist [VERIFIED: update description]), and never calls any endpoint other than the three listed in Decision 17.

**Targets, kinds, slots**

6. **Two target kinds over one Iterable object.** Iterable snippets have no type attribute; whether one is "HTML" or "text" is decided by where templates embed it (`{{{ snippet "x" }}}` renders HTML, `{{ snippet "x" }}` renders markup as text [VERIFIED: Adding a Snippet to a Template]) and by the channel (SMS cannot render HTML [VERIFIED: Creating and Managing Snippets]). The descriptor therefore offers two kinds the admin chooses between, both listing every snippet in the project:
   - `html-snippet`: slot model `single`, formats `html`, `text`, `url`, `image`.
   - `text-snippet`: slot model `single`, formats `text`, `url`, `image`.
   The single slot's name is the constant #27 uses for a single-slot target (its body) [ASSUMPTION: confirm the constant against the #27 implementation].
7. **Format conversion at push (module-enforced).**
   - `html-snippet`: `html` is written as the shell produced it (already sanitised, Decision 12 of the shell); `text`, `url` and `image` values are HTML-escaped (`&`, `<`, `>`, `"`, `'`) so they render literally inside markup.
   - `text-snippet`: `text`, `url`, `image` are written verbatim; `html` is not offered by the descriptor and a push with it is `invalid_value`.
   Why not one kind: escaping text for an HTML snippet would show `&amp;` literally in an SMS or in a `{{ snippet }}` plain-text embed; the admin knows which they mean, the module cannot [Open Question 5].
8. **Listing, search, paging (module-local; Iterable has none).** `GET /api/snippets` returns all snippets with content and cannot be filtered or paged [VERIFIED]. The module reads the list, sorts by name (case-insensitive, stable), filters by the query as a **literal, case-insensitive substring** of name or description (never a regex), slices with an opaque cursor that encodes the offset plus the list's newest `updatedAt` (a cursor from a stale list is rejected so pages never overlap), and returns `{ id, name, kind, updatedAt, note: description }` per item. The content bodies are dropped before anything leaves the module. A per-isolate cache holds the list for a short time (default 30 s [ASSUMPTION]) so paging through a search costs one upstream call, and the cache is bypassed by `connect`'s test and by `push` (which reads the single snippet). Payload size for large projects is [OPEN, spike IS4].
9. **Identity = numeric id, not name.** The target id stored in the mapping is Iterable's numeric snippet id. Names are immutable after creation [VERIFIED] but a name made only of digits is treated as an id by the API and cannot be used as an identifier [VERIFIED: Identifying snippets]; names can contain spaces that need URL-encoding. Using the id sidesteps both and means the update path can only update an existing snippet (an unknown id returns 404 [VERIFIED: OpenAPI `updateSnippet` 404]). The module validates the id as digits only before building a path. A snippet that is deleted and re-created gets a new id: the binding reports `target_not_found` and the admin re-picks.

**Value rules**

10. **Write semantics (read, compare, replace).** `push` is: read the snippet by id (`target_not_found` on 404); apply the guards; if the stored `content` already equals the value to write, report `written` with no update (no `updatedAt` churn); otherwise `PUT` the full set the module understands (content, plus the description and variables exactly as read, plus the optional actor id, Decision 14); report `written` with `vendorState: live`. No read-after-write by default (the response carries only the snippet id) [VERIFIED: `UpdateSnippetResponse`]; whether Iterable normalises content so a later read differs from what was written is [OPEN, spike IS2] and decides whether a verifying read is added.
11. **Preserve what the module does not own.** The name is never sent (immutable, and the update request model has no name field [VERIFIED]). Description and variables are sent back as read; if the read has no `variables`, the key is omitted. What an omitted field does on `PUT` (cleared or kept) is not documented [OPEN, spike IS1]; sending the read values makes the behaviour irrelevant for existing snippets. `createdAt`, `createdBy`, `projectId` are read-only and not sent.
12. **Personalization-syntax guard.** A value containing `{{` or `[[` is rejected before any Iterable call with `invalid_value` and the fixed message "content contains personalization syntax", for every format and both kinds. Rationale: Problem 4; `{{` also covers `{{{` and `{{!`; `[[` is the data-feed field syntax [VERIFIED: Managing Data Feeds, merge contexts; whether Iterable evaluates a stray `[[` inside snippet content is [ASSUMPTION], spike IS5, so the guard is conservative]. Lone single braces and brackets pass. The shell's HTML sanitiser (#27 Decision 9) runs first; this guard is the module's second line. Whether to offer a deliberate pass-through, or an escaped-literal mode (`\{{` is Handlebars' documented literal escape [ASSUMPTION: Iterable's engine honours it; not read, spike IS5]), is Open Question 6.
13. **Content restrictions mirrored from Iterable.** Iterable disallows script tags with JavaScript or non-JSON content, inline event handlers, `javascript:` in `href`/`src`, `<iframe>` and `<style>` tags [VERIFIED: OpenAPI `content`; Creating and Managing Snippets]. The shell sanitiser already strips these from `html` values. The module adds a defence-in-depth check on the final content (case-insensitive `<script`, `<iframe`, `<style`, ` on...=` handler attributes, `javascript:`), failing with `invalid_value` "content not allowed in snippets". A server-side `400` maps to `invalid_value` as well.
14. **Size.** Iterable states no snippet-content limit, only that the whole request must stay under 4 MB, and warns that bodies over 100 KB can cause email clipping [VERIFIED: Snippets API section; Creating and Managing Snippets]. The shell's `VALUE_MAX_BYTES` default of 100 KB therefore matches the clipping guidance; the module additionally refuses values that would make the request exceed 4 MB (UTF-8 bytes of the serialised body, including the preserved description and variables).
15. **Actor attribution.** Iterable attributes API writes to the project creator unless `createdByUserId` ("User ID (email) of the updater") is supplied [VERIFIED: API Keys, "User associated with API key operations"; OpenAPI]. An optional non-secret variable `ITERABLE_ACTOR_USER_ID` is sent as that field when set. Whether the id must belong to an existing project user, and what Iterable then shows in `updatedBy`, is [OPEN, spike IS6, Open Question 8]. EW end-user identities are not passed (cron syncs have none, and the field's validation is unknown).

**Auth, transport, errors**

16. **Auth: static server-side API key in the `Api-Key` header.** Iterable has no OAuth for its REST API; a project-scoped key is sent as `Api-Key` (or `Api_Key`) [VERIFIED: Getting Started; API Keys]. The key goes in the header only: Iterable's own docs say it "must be provided as an HTTP request header" and that calls providing it in the query string or body get stricter rate limits from 2025-11-10 [VERIFIED]. The module has no token endpoint, no session expiry, no re-authentication; `connect` validates configuration and returns a session object holding only the resolved host. The key is injected by the template's proxy helper from the secret *name* (#2 Decision 8, `auth: { secret, header }`), so route and module code never hold the value. **Template amendment R-T2 (dynamic secret value, form-body secret) is not needed; R-T3 (response classifier) is not needed** (Iterable uses real HTTP statuses); R-T1 (D1, cron, `scheduled`) and R-T5 (extension error codes) are needed, as for #27. [ASSUMPTION: the proxy's header-injection path is what #2 specifies; verify against the #2 implementation.]
17. **Operations used (the complete allowlist).**
    - `GET /api/snippets` (list; used by `listTargets` and the connection test);
    - `GET /api/snippets/{id}` (read one; used by `describeTarget` and `push`);
    - `PUT /api/snippets/{id}` (update by id; used by `push`).
    All under the fixed host of Decision 18; JSON bodies; `Content-Type: application/json`; the module does not follow redirects (template `redirect: manual`). Required key type per operation from the definition: reads accept Server-side and Read-only keys; `PUT` accepts Server-side only [VERIFIED: `x-iterable-api-key-types`]. Consequence: a Read-only key passes the connection test and lists snippets but fails on write; the connection test says so only if spike IS3 shows a distinguishable signal; otherwise the first write reports it.
18. **Fixed hosts and validated inputs.** Variable `ITERABLE_DATA_CENTER` is an enum, `usdc` or `edc`, mapping to the constants `https://api.iterable.com` and `https://api.eu.iterable.com` [VERIFIED: Getting Started, Base URLs]; any other value fails the configuration check before any call. Snippet ids must be digits only (length-capped) before a path is built. Nothing from a caller (route parameters, mapping content, query) selects a host, path or header. A key created in one data center does not work in the other [VERIFIED via API Keys: "each associated with a specific data center"], so a wrong variable shows as `auth_failed`. The proxy's `allowedHosts` per route lists exactly the two hosts.
19. **Error classification (module-local; messages fixed; no upstream text to the browser).**

    | Iterable signal | Taxonomy code | Retry |
    |---|---|---|
    | `401` (`BadApiKey`: key missing, disabled, wrong data center, or insufficient privileges for the endpoint [VERIFIED: Response Codes, `BadApiKey` example "Disabled API key or insufficient privileges"]) | `auth_failed` | no |
    | `403` (`Forbidden`) | `permission_denied` | no |
    | `404` on a snippet id | `target_not_found` | no |
    | `400` (`BadParams`, `BadJsonBody`; invalid Handlebars; disallowed content) | `invalid_value` | no |
    | `429` (`RateLimitExceeded`) | `rate_limited`, honour `Retry-After` when present | yes |
    | `5xx` (`GenericError`, `DatabaseError`, `503`), network error, timeout | `vendor_unavailable` | yes |
    | `409` or anything else | `unknown` | no |

    Iterable's guidance for `429` is exponential backoff [VERIFIED: Getting Started, "Handling rate limit errors"]; #2's retry helper (`429` and `5xx`, `Retry-After`, jitter) covers it. `PUT` by id is idempotent (same body, same result), so it is retried on `5xx` without an explicit flag [per #2 Decision 8 idempotency rule]. The `401` response body contains the caller IP and a key identifier [VERIFIED: Response Codes example]; the module never forwards or logs bodies, and the key is also registered for redaction.
20. **Pacing.** Calls per sync are one read plus at most one update. The module obeys the shell's pacing (at most 2 concurrent, 5 per second, per-tick call budget, per-day counter). The snippet endpoints publish no rate limit [VERIFIED absence; OPEN, spike IS4, Open Question 9]; the shell's conservative pacing stands until measured. Steady state is hash-gated by the shell and costs nothing; the module's own compare-and-skip only matters for forced syncs.
21. **Concurrency.** There is no conditional write. The window between the module's read and its `PUT` is one round trip; a person saving the same snippet in that window loses their edit. The module does not try to merge. Drift (someone edited the snippet in Iterable after EW last wrote it) is **not** detected in #32: last EW write wins on the next changed sync, and the README says so (same stance as #27's overwrite policy, its Open Question 12). A warning would need the shell to store the `updatedAt` the vendor reported after each write and the module to compare it on the next read; that is a shell change and is not built (Open Question 7).

**Documentation and registration**

22. **README (AC4).** `providers/iterable/README.md` documents: what the provider does, that **writes are live** and affect running campaigns (first section), and that it never deletes, creates or renames; how to create a **server-side** API key in the target project (Iterable: *Integrations > API Keys*; exact menu path [ASSUMPTION], the key-type guidance is [VERIFIED: API Keys]), why a Read-only key is not enough, and that the key is project-wide so the project should be a dedicated one if the owner wants a narrower blast radius; how to tell US from EU (EDC) projects [VERIFIED: Getting Started]; the secret and variables with the exact `wrangler` commands; the statement that Iterable reads **no EW site configuration** (all settings are worker variables and secrets, #27 Decision 3); the recommendation to map to a dedicated EW-owned snippet and to test with a copy first (Iterable's own "copy and test" procedure [VERIFIED: Creating and Managing Snippets]); the guard and the content restrictions; the data-feed alternative (Decision 2); `ref=local` and branch-ref notes. The extension README's vendor list gets an Iterable row linking to it.

## Testing Decisions

**What makes a good test here.** As in #27: assert external behaviour only. Given an HTTP request or a cron tick and a fake outside world (fake Iterable, fake published site, fake DA admin, fake IMS, fake clock, in-memory store), assert the response, what the fake Iterable received (operations, order, count, headers, bodies), what the status routes say, and what was logged. Never assert internal helper names or the number of internal calls. Four properties are asserted as negatives across every Iterable path: (1) the canary API key never appears in any response, header, log line or stored row; (2) no Iterable call happens before authentication and authorisation succeed; (3) nothing is ever deleted, created or renamed in the fake Iterable (destructive-attempt counters stay zero) and no request uses a method or path outside Decision 17's allowlist; (4) the user's IMS token never reaches Iterable.

**Proposed seams (recorded instead of asked): no new seams.** The ideal number is one and #27 already provides the right ones; Iterable is the third consumer of the vendor contract suite and the first with static-key auth and no draft state.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| V1 (primary) | Vendor contract suite: takes a vendor module and a fake of that vendor's API | reused from #27 | Iterable module (VC1-VC8) plus Iterable-specific cases | Fake Iterable HTTP handler (stateful snippets, key types, data centers, scripted errors); the suite calls only the module's public interface |
| W1 | Worker HTTP boundary `worker.fetch` | reused from #2/#27 | Routes with `vendor=iterable`: targets, describe, test, preview, mapping, sync, status; security tests | Constructed `Request`; env factory with a canary Iterable key; fake IMS (user tokens), fake DA, fake site, fake Iterable as scripted fetch handlers |
| R1 | Worker tick `worker.scheduled` on a fake clock | reused from #27 | Polled re-sync of Iterable bindings, retries, held-until-first-manual-sync behaviour (if IP1), mixed-vendor sites | Same fakes plus a controllable clock |
| S1 / S2 / S3 / W2 / R2 | Entry page + SDK stub; render module; repo convention check; real workers runtime; store contract | reused from #1, #2, #27 | Playwright e2e with Iterable selected; WTR UI cases for descriptor-driven warnings; footprint check (UR-I1); smoke; no change | As #27 |

A *delta*, not a seam: the S3 convention check's **provider-footprint rule** (a change that adds a provider may touch only that provider's folder and the named registration points) is shared with #28; whichever ticket lands first builds it.

**Modules tested:** the Iterable module (configuration check, key injection and redaction, list/search/cursor, describe, read-compare-write push, preservation, guards for syntax, content, size and format, error classification, pacing integration), the Iterable fake itself (self-tests), the shell with Iterable registered (mixed-vendor mapping, vendor-agnostic engine, live-on-write handling if IP1), the footprint rule, README presence.

**Prior art:** #27's seams and tests (V1 suite, fake vendor, fake Marketo, SE canary property tests, SY engine tests); #28's AJO fake and AJ cases (guards, preservation, non-destructive counters) as the closest template; #2's test kit (canary secrets, fake IMS, env factory); the injected `fetchImpl`/`storage`/`now` pattern in upstream `tools/brand-visibility/session-auth.js` [VERIFIED by #2 and #27].

## Out of Scope

- **Iterable data feeds as a push target or as a worker-served feed** (Decision 2). No Iterable API exists to create or edit feeds; a worker-served feed conflicts with the template's authentication model. The README documents the no-worker alternative.
- Creating, deleting, renaming or copying snippets; editing snippet names; creating templates, campaigns, journeys, catalogs, lists, users, events or any other Iterable object; Iterable email, in-app, push and SMS **templates** and **catalog items** as targets (candidate follow-up providers or kinds).
- Snippet variables as slots (mapping several EW fields into one snippet's variable list, templating); a mapping that adds or removes variables. Variables are preserved as read.
- Personalization pass-through and literal-escape mode (Open Question 6); dynamic snippets.
- Drift detection when someone edits a snippet in Iterable (last EW write wins; README says so).
- A draft or staging step implemented inside Iterable (for example, auto-copying to a `-staging` snippet): the README recommends the manual "copy and test" practice instead.
- Multi-project or multi-data-center credentials in one deployment; per-site Iterable credentials entered in the app (#27 Decision 18 / OQ 2).
- Any change to the mapping UI, storage, sync engine, authorisation, extraction or the shell's other behaviour beyond the optional additive proposals IP1-IP3; template amendments beyond R-T1 and R-T5 (shared with #27).
- CI-driven worker deployment and Cloudflare credentials in CI (#2 Decision 15).
- The Adobe outside-activity/IP policy decision for running infrastructure that holds a customer-grade Iterable key on a personal Cloudflare account (flagged in #27 R1; owned by #1 R1).

## Further Notes

- **The Contentful comparison is about data feeds.** Contentful's Iterable app shows a sidebar link for an entry; the marketer pastes it into an Iterable data feed; Iterable fetches the entry from Contentful's Content Delivery API at send time, with the Contentful API key stored by the app config [VERIFIED: Contentful help page: "A sidebar app that generates a link"]. It does not write to Iterable. #32 is deliberately stronger (push, polled re-sync, status) and chooses snippets for that reason. If the owner's real intent is parity with Contentful, the deliverable is a README recipe and no code (Open Question 1).
- **The Snippets API is new.** The community announcement is dated 2025-09-17 (search-result excerpt only) and the endpoints article documents all five operations; the OpenAPI definition is `version 1.8` [VERIFIED]. Behaviour not pinned down by the docs is listed as spikes IS1-IS8.
- **API definition quirks worth knowing.** `SnippetResponse.id` is typed `object` while `snippetId` elsewhere is `int64`; the `PUT` request model's description says `createdByUserId` is "the updater" (the field is named for creation); the `PUT`, `POST` and `DELETE` operations require a Server-side key while the two `GET` operations also accept Read-only [VERIFIED by reading the definition]. Each is a reason for the live spikes.
- **Snippets are embedded by name, and names are immutable.** A snippet that must be renamed is copied and re-referenced by hand in Iterable [VERIFIED]; EW never does this. Because the mapping stores the numeric id, an admin's rename-by-copy shows up as `target_not_found` for the old id, which is the correct signal.
- **Snippets can reference data feeds and variables**, and templates must be configured to use data feeds for those snippets to render [VERIFIED]. Overwriting such a snippet with plain EW copy silently removes the feed reference; the README's "use a dedicated snippet" advice and preview-with-current-value (IP2) are the mitigations.
- **No Iterable project is available to the author.** Every Iterable behaviour in this spec is from documentation and the API definition; IS1-IS8 settle the unknowns against a real (ideally dedicated test) project before the module is finished, and the fake's fixtures are hand-written until then. Iterable's API Explorer states that explorer calls "affect project data", so a dedicated test project is the right target [VERIFIED].
- **This SPEC.md** is a planning artefact; keep or delete it when the provider is built, as decided for #1's spec [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

The architecture is #27's, unchanged. The Iterable module is one more vendor behind the registry.

```
EW app (browser, static)  ──IMS bearer──►  Worker (per #27)
                                             │ vendor registry: marketo | ajo | iterable | fake-vendor(test)
                                             │ fetch(): origin gate → IMS auth → site allowlist + DA permission → routes
                                             │ scheduled(): per site lease → due bindings → extract → hash → iterable.push (paced)
                                             ▼
        iterable module ──► https://api.iterable.com | https://api.eu.iterable.com   (host chosen by ITERABLE_DATA_CENTER enum)
                           GET /api/snippets · GET /api/snippets/{id} · PUT /api/snippets/{id}
                           header Api-Key injected by the template proxy from the secret ITERABLE_API_KEY
```

| Concern | App (browser) | Worker + Iterable module |
|---|---|---|
| Iterable API key | never | secrets store; injected by the proxy helper into the `Api-Key` header; never held by module or route code |
| Data center, actor user id | never sent or shown as credentials | non-secret variables |
| Choosing a snippet, mapping, preview | UI; descriptor-driven; shows current-versus-new if IP2 | list, search, describe, extract, validate |
| Value guards (syntax, content, size, kind/format) | shows the resulting per-slot errors | enforces; fixed messages |
| Live-write warning and hold (IP1) | renders the descriptor flag; first manual sync | engine honours the flag; module reports `vendorState: live` |
| Write | triggers Sync now, shows status | read, compare, `PUT` |
| Retries, rate limits, error mapping | none | template retry helper, backoff, pacing, classification table |

## 2. EW integration points

- **Type: unchanged.** The extension remains one app (`apps` sheet row, #27 section 2). The Iterable provider adds no row, no library plugin, no SDK action. The extensions table row stays; the extension README's vendor list gains an Iterable entry.
- **Site configuration read: none** (#27 Decision 3). Iterable settings are worker variables and a secret. AC4's "site config keys" is therefore satisfied by documenting the worker configuration keys and stating that no EW config-sheet or site-config key is read [OPEN, Open Question 11: confirm that reading of the criterion; same question as #28's].
- **SDK usage:** none beyond #27's (`token`, `context`, `actions.daFetch`).
- **`ref=local`:** page on `http://localhost:3000`, local worker on `http://localhost:8787` with the local env; Iterable either a real dedicated test project (real key in `.dev.vars`, never committed) or the local fake via a local-only host override gated by `ALLOW_LOCALHOST` (the same pattern as #27's content-origin override). **Branch ref:** page on `{branch}--{site}--{org}.aem.live` or `.preview.da.live` calling the deployed worker (#27 section 2; observed `Origin` recorded in manual step IM5). Iterable needs no browser-side change in either case.

## 3. External APIs and auth flows

| API | Use | Auth / headers | Source / status |
|---|---|---|---|
| Base URLs `https://api.iterable.com` (USDC) and `https://api.eu.iterable.com` (EDC) | host selection | key is bound to one project and data center | [VERIFIED] https://support.iterable.com/hc/en-us/articles/41044692130196-Getting-Started-with-Iterable-s-API ; https://support.iterable.com/hc/en-us/articles/360043464871-API-Keys |
| Authentication: `Api-Key` (or `Api_Key`) header; JWT-enabled keys are a client-side feature | every call | server-side key for writes; Read-only key for reads | [VERIFIED] same pages; OpenAPI `securityDefinitions: api_key in header name Api-Key`: https://api.iterable.com/api-docs |
| `GET /api/snippets` -> `{ snippets: [ { id, name, content, description, variables?, createdAt, updatedAt, createdBy, updatedBy, projectId } ] }`; no parameters | list targets; connection test | Server-side or Read-only | [VERIFIED] OpenAPI `getSnippets`; sample at https://support.iterable.com/hc/en-us/articles/204780579-Iterable-API-Endpoints-and-Sample-Payloads ; paging, size at scale, rate limit: [OPEN] IS4 |
| `GET /api/snippets/{identifier}` -> `{ snippet: {...} }`; numeric = id, string = name; `400` invalid identifier, `404` | read one | same | [VERIFIED] OpenAPI `getSnippet`; id-versus-name rule and URL-encoding of spaces: endpoints article |
| `PUT /api/snippets/{identifier}` body `{ content (required), description?, variables?, createdByUserId? }` -> `200` updated / `201` created, `{ snippetId }`; by id only updates, `404` if missing; by name creates if missing; name cannot change | write | **Server-side** only | [VERIFIED] OpenAPI `updateSnippet`, `UpdateSnippetRequest`; omitted-field behaviour: [OPEN] IS1 |
| `POST /api/snippets` (create), `DELETE /api/snippets/{identifier}` | **not used** | n/a | [VERIFIED] exist in the definition; excluded by Decision 5 |
| Snippet content rules: Handlebars must be valid; disallowed: script tags with JS or non-JSON content, inline event handlers, `javascript:` in `href`/`src`; no `<iframe>`, `<style>`, self-reference; no size limit but request < 4 MB | guards | n/a | [VERIFIED] OpenAPI `CreateSnippetRequest.content`; https://support.iterable.com/hc/en-us/articles/46135873895956-Creating-and-Managing-Snippets ; what a `400` body looks like: [OPEN] IS5 |
| Snippet name: unique per project, up to 100 characters (letters, digits, space, `-`, `_`), immutable; numeric-only name is treated as an id | why ids are used | n/a | [VERIFIED] endpoints article, "Identifying snippets" |
| Edits to a snippet "immediately affect every template that references it, even while campaigns are running"; copy-and-test is Iterable's own safe-edit procedure | live-on-write risk, README advice | n/a | [VERIFIED] https://support.iterable.com/hc/en-us/articles/46135873895956-Creating-and-Managing-Snippets ; https://support.iterable.com/hc/en-us/articles/4414807441556-Snippets-Overview |
| Snippet embedding: `{{{ snippet "name" }}}` (HTML) vs `{{ snippet "name" }}` (text); variables positional or named | kinds, format escaping | n/a | [VERIFIED] https://support.iterable.com/hc/en-us/articles/4415894606356-Adding-a-Snippet-to-a-Template |
| Response codes and bodies: `401 BadApiKey` ("Disabled API key or insufficient privileges"; body carries caller `ip` and `apiKeyIdentifier`), `403 Forbidden`, `404 NotFound`, `429 RateLimitExceeded`, `5xx`; bodies "subject to change without prior notice", fields may be added | error map; never forward bodies | n/a | [VERIFIED] https://support.iterable.com/hc/en-us/articles/39629320560148-API-Response-Codes |
| Rate limits: published per endpoint in the API Explorer, per project, per key or per organization; legacy key-in-query/body calls limited more strictly from 2025-11-10; the snippet endpoints state none | pacing | n/a | [VERIFIED] Getting Started; OpenAPI descriptions of snippet operations carry no limit; [OPEN] IS4 |
| Required Iterable permissions: *Create and Manage Snippets* (UI users); API-key permission is by key type | README | n/a | [VERIFIED for UI users] Creating and Managing Snippets; whether any user permission applies to API-key writes: [OPEN] IS3 |
| Data feeds: URL pull at send time; JSON/XML/RSS/Atom; 10 s response; static `Authorization` header token; 1-hour cache; managed in UI with *Manage Integrations*; no API paths | out of scope, README alternative | n/a | [VERIFIED] https://support.iterable.com/hc/en-us/articles/204795659-Data-Feeds-Overview ; https://support.iterable.com/hc/en-us/articles/39205474652948-Managing-Data-Feeds ; https://support.iterable.com/hc/en-us/articles/45728211053332-Creating-a-Data-Feed-Web-Service |
| Contentful's Iterable app: generates a data-feed link; Iterable pulls from Contentful's delivery API | prior art / comparison | n/a | [VERIFIED] https://www.contentful.com/help/apps/iterable ; https://www.contentful.com/developers/changelog/iterable-marketing-automation-app-is-now-live/ |
| Handlebars literal escape `\{{` | possible later escaping mode | n/a | [ASSUMPTION] Handlebars convention; Iterable's engine behaviour unread, IS5 |

**Auth flows (additions to #27 section 3).**
1. *Worker to Iterable (module `connect` and every call)*: no handshake. The secret name `ITERABLE_API_KEY` is passed to the proxy helper, which sets `Api-Key` on the outbound request to the allowlisted host; the value is registered for redaction (static, known at config time, so no dynamic-secret amendment). A `401` is `auth_failed` with no retry.
2. *App to worker*, *worker to DA admin*, *worker to published site*, *cron*: exactly as #27. The cron path uses only the stored mapping, the anonymous content fetch and the Iterable key.
3. *Connection test* (`POST /vendors/iterable/test`): one `GET /api/snippets` against the configured host; the response is `ok` or a fixed reason keyed to `auth_failed` (key rejected, wrong data center, or insufficient key type), `permission_denied`, `vendor_unavailable`, or `vendor_not_configured`; a Read-only key is flagged only if IS3 shows a distinguishable signal.

## 4. Data contracts

All routes, the mapping document, the status document and the stored state are #27's, unchanged. Iterable-specific values only:

**Descriptor** (`GET /vendors`, entry `iterable`): `configured` true when `ITERABLE_API_KEY` is set and `ITERABLE_DATA_CENTER` is valid; `supportsApproval` false on both kinds; kinds:

| kind | label | slotModel | valueFormats | supportsApproval | (proposed) writesAreLive |
|---|---|---|---|---|---|
| `html-snippet` | HTML snippet (renders markup) | `single` | `html`, `text`, `url`, `image` | false | true |
| `text-snippet` | Text snippet (plain text) | `single` | `text`, `url`, `image` | false | true |

Required secret names: `ITERABLE_API_KEY`. Non-secret variables: `ITERABLE_DATA_CENTER` (`usdc` | `edc`, required), `ITERABLE_ACTOR_USER_ID` (optional), `ITERABLE_LIST_CACHE_SECONDS` (default 30).

**Operations (module interface as #27 section 4):**

| Operation | Iterable behaviour |
|---|---|
| `descriptor` | as above |
| `connect(env)` | validate configuration (secret present, data-center enum valid, optional actor id shape); return a session holding only the resolved host; no network call. Failure -> `vendor_not_configured` (generic) |
| `listTargets(session, kind, query?, cursor?, limit?)` | `GET /api/snippets` (cached briefly), sort by name, literal case-insensitive filter on name and description, offset cursor tied to the list's newest `updatedAt`, items `{ id, name, kind, updatedAt, note }`, content dropped; unknown kind rejected; stale cursor rejected |
| `describeTarget(session, kind, id)` | validate id (digits); `GET /api/snippets/{id}`; `404` -> `target_not_found`; `slots: [{ name: <single-slot constant>, type: html \| text, currentValue?: <first 500 characters, text only> }]` (`currentValue` only if IP2 is accepted) |
| `push(session, {kind,id}, slots[1], {approve?})` | guards (kind/format, syntax, content, size) -> `GET /api/snippets/{id}` -> equal content: no write -> else `PUT` with content, preserved description and variables, optional actor id -> `{ results: [{slot, outcome, error?}], vendorState: "live" }`; `approve` ignored (descriptor says unsupported) |

`push` accepts exactly one slot (`single` kind) and returns exactly one result.

**Interface-fit proposals (all optional; each has a no-shell-change fallback).**

| # | Gap found with Iterable | Proposed amendment (to #27's contract) | Fallback used if declined |
|---|---|---|---|
| IP1 | A write is live immediately and affects running campaigns; the shell's only safety option, `approve`, does not exist for this vendor | Descriptor kinds gain an optional boolean `writesAreLive`. When true, the UI shows a "writes go live immediately" notice on the binding and the preview, and the engine runs **polled** re-syncs for that binding only after the binding has had one successful manual sync (state `never_synced` stays until then); manual Sync now is unaffected | README warning, preview, per-binding disable switch; polled re-sync pushes as for any vendor |
| IP2 | Preview cannot show what will be overwritten (no draft to compare against) | `describeTarget` slots gain an optional short, text-only `currentValue`; the preview route shows it beside the new value | Preview shows the new value only; README advises opening the snippet in Iterable first |
| IP3 | Admins need the description hint per snippet (many look alike) | `listTargets` items gain an optional short `note` (shared with #28's P3) | Names and last-updated time only |

No proposal changes engine behaviour for existing vendors. Cross-vendor lessons for the remaining follow-ups (OQ 13 of #27): (a) **vendors without a draft state** exist and need an explicit "live" signal in the contract, not an approval option; (b) **no concurrency token** means the module can only narrow, not close, the read-write window; (c) **unpaged listings** are the module's problem (cursor, cache, content stripped) and never leak to the shell; (d) **static-key header auth** removes the session, re-auth and dynamic-redaction machinery that Marketo and AJO needed, so the template's R-T2 and R-T3 amendments are not general requirements of every vendor.

**Configuration:** secret `ITERABLE_API_KEY`; variables `ITERABLE_DATA_CENTER`, `ITERABLE_ACTOR_USER_ID` (optional), `ITERABLE_LIST_CACHE_SECONDS` (default 30); local-only `ALLOW_LOCALHOST`-gated host override for the fake.

## 5. Folder layout (proposed; fits #1, #2, #27)

```
apps/marketing-automation-sync/
├─ (shell as #27, unchanged apart from the registration points below)
└─ providers/iterable/
   ├─ SPEC.md                 this file
   ├─ README.md               vendor setup (Decision 22)
   └─ worker/
      ├─ module              Iterable provider module (descriptor, connect, list/search/cursor, describe, push, guards, error map)
      ├─ fake/               fake Iterable (stateful snippets; key types; data centers; scripted errors; destructive-attempt counters)
      └─ test/               contract-suite run (V1), IT cases, fake self-tests, footprint fixture
```

**Registration points (the only shell-side edits allowed):** the worker entry's vendor registry (one line), the wrangler config's secret and variable declarations, `.dev.vars.example`, and the vendor list in the extension README. Nothing else outside `providers/iterable/`. If the owner accepts IP1-IP3, those are separate, reviewed shell changes made before or with this provider and are not part of the footprint exception.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **"Data feeds / snippets" ambiguity**: the ticket's scoring note describes Contentful's data-feed link generator, while its acceptance criteria describe push | High | Decision 2 resolves to snippets; owner confirms (OQ 1); README documents the feed recipe |
| R2 | **Every write is live**; polled sync changes running campaigns | High | IP1 hold-until-first-manual-sync; README first-section warning; preview; per-binding disable; recommend dedicated snippets and Iterable's copy-and-test practice (OQ 3) |
| R3 | **Project-wide server-side key**: no snippet-scoped key; a leak exposes users, events, campaigns, templates, exports | High | Secret only in the worker; module allowlists three operations (SEC11); dedicated project advised; redaction; rotation step IM8; OQ 10 |
| R4 | **Overwriting hand-built snippets** (Handlebars logic, variables, data-feed references) with plain EW copy | Medium-High | Dedicated-snippet advice; IP2 preview; variables/description preserved; guard rejects EW-side syntax but cannot stop EW text replacing existing logic: README states it |
| R5 | **Personalization injection or breakage** from page content | High | Decision 12 guard + tests IT15; shell sanitiser first; OQ 6 |
| R6 | **No concurrency token**: lost update if a person saves between read and write | Medium | Narrow window; no merge; documented; drift detection deferred (OQ 7) |
| R7 | **`PUT` may clear omitted `description`/`variables`** | Medium | Send read values back (Decision 11); spike IS1 confirms |
| R8 | **Iterable may normalise content** so read-back differs from written | Low-Medium | Skip-compare only affects forced syncs; shell hash gate unaffected; IS2 decides a verifying read |
| R9 | **Unpaged heavy listing** for large projects; rate limit unknown | Medium | Cache, strip content, cursor guard; IS4 measures payload and limits; pacing stands |
| R10 | **`401` is ambiguous** (bad key, wrong data center, insufficient key type) and key-type errors may only show on first write | Medium | One fixed message covering all three; README checklist; IS3 looks for a distinguishing signal |
| R11 | **Attribution**: writes appear as the project creator; `createdByUserId` semantics unclear | Low-Medium | Optional `ITERABLE_ACTOR_USER_ID`; IS6; OQ 8 |
| R12 | **Docs and definition quirks** (`id` typed `object`; response bodies "subject to change") | Low | Defensive parsing, additive-field tolerance test (IT20); fixtures from real responses (IS7) |
| R13 | **Secrets declaration for unused vendors** (`secrets.required` would require `ITERABLE_API_KEY` on a Marketo-only deployment) | Medium | Same recommendation as #28 OQ 8: a vendors-enabled variable decides the required list |
| R14 | **Template amendments** R-T1 and R-T5 still block #27 and so this provider; R-T2 and R-T3 are not needed here | Medium | As #27 R15 |
| R15 | **Adobe outside-activity/IP policy** and holding a customer-grade key on a personal Cloudflare account | High for publishing | Carried from #27 R1; owner decision |
| R16 | **Interface amendments IP1-IP3 touch the shell**; #27 says a contract change is reviewed across all vendors | Medium | Optional; fallbacks documented; reviewed with #28/#29/#30 specs (OQ 12) |
| R17 | **Snippet API recency** (announced 2025-09-17): behaviours may still change | Low-Medium | Contract tests pin the assumptions; live spikes rerun before release; tolerate added fields (Iterable promises additive changes only [VERIFIED: Getting Started, "API response schemas"]) |

**Spikes (build-plan step 1; results recorded in the README and the fake's fixtures; run against a dedicated Iterable test project):**
- **IS1** Update semantics: `PUT /api/snippets/{id}` with only `content` on a snippet that has a description and variables: are they kept or cleared? Same with `description: ""`/`variables: []`. Decides Decision 11's necessity.
- **IS2** Round trip: write HTML, plain text, text with `&`, `<`, non-ASCII, trailing whitespace; read back: byte-identical? Does opening the snippet in the WYSIWYG editor and saving change it (not via API; informational)? Decides a verifying read.
- **IS3** Auth matrix: Server-side key, Read-only key, disabled key, EU key against the US host and vice versa, no key, key in query: status and body for `GET` list, `GET` one and `PUT`; is the Read-only-write failure distinguishable (`401` versus `403`, `code`/`msg`)? Does any user-level permission apply to key writes?
- **IS4** Scale and limits: list latency and payload with 50, 500 and 2,000 snippets with realistic content; burst the three operations at 5, 20, 100 requests per second: `429`, `Retry-After`, any rate headers.
- **IS5** Content validation: which of `{{`, `{{{`, `{{!`, `[[`, unbalanced `{{#if`, `\{{`, `<style>`, `<iframe>`, `<script type="application/json">`, `javascript:`, event handlers, a 4 MB body, a self-referencing `{{{ snippet "x" }}}` returns `400` and with what body; what a stray `[[x]]` renders as in a proof.
- **IS6** Actor: `createdByUserId` with an existing user, an unknown email, and omitted: effect on `updatedBy`; validation errors.
- **IS7** Identifier and id typing: numeric-only names; names with spaces; `id` as number versus string in responses; ids above 2^53 (informational); `PUT` by an unknown id (`404` body) versus an unknown name (creates, `201`).
- **IS8** Pickup latency: after a `PUT`, how soon does a template preview and a proof show the new content; does any caching (template-level or global) delay it.

## 7. Ordered build plan (sized to #32's acceptance criteria)

0. **Prerequisites (owner):** #27 implemented (shell, interface, V1 suite, fake vendor, Marketo module, template amendments R-T1/R-T5); a **dedicated Iterable test project** with a server-side API key and its data center; decisions on OQ 1, 2, 3, 5, 6, 12, 13. (AC3, AC6)
1. **Spikes IS1-IS8** against the real test project; write results into the README and the fake's fixtures; settle Decisions 8, 10-15 branches. If no project is available, build against the fake only and mark unverified behaviours (OQ 14). (AC1, AC2, AC6)
2. **Iterable fake and self-tests** (stateful snippets, numeric ids, immutable unique names, `PUT` by id and by name semantics, key types and data centers, header-only key enforcement, scripted `400/401/403/404/429/5xx`, destructive-attempt counters that must stay zero). (AC7)
3. **Module, test-first against the V1 suite plus IT cases:** configuration check, host selection, key injection via the proxy and redaction, list/search/cursor/cache, describe, guards (kind/format, syntax, content, size), read-compare-write push with preservation, error map, pacing integration. (AC1, AC2, AC6, AC7)
4. **Registration and shell-with-Iterable tests:** registry line, config and secret declarations, `.dev.vars.example`, extension README vendor row; mixed-vendor mapping and engine tests; footprint check. If the owner accepts IP1-IP3, land those shell changes (with their own tests and a cross-vendor review) first. (AC3, AC7)
5. **Provider README** (setup, secret, variables, live-write warning, dedicated-snippet and copy-and-test advice, data-feed alternative, no-site-config statement, `ref=local` and branch-ref notes) and the extension README row. (AC4)
6. **Hermetic e2e (Playwright) and runtime smoke** with Iterable selected, real local worker and the fake. (AC1, AC2, AC5, AC6)
7. **CI additions** (no secrets in CI): the Iterable suite and footprint check run under the existing `worker-unit`, `worker-smoke`, `e2e`, `lint` jobs; no new job. (AC7)
8. **Deploy and manual verification in EW** IM0-IM9 plus the opt-in live-project script; record observed `Origin`, publish latency and spike results in the README. (AC1, AC2, AC5, AC6)
9. **Hand-off note** for the remaining follow-ups: the interface-fit lessons and proposals IP1-IP3.

---

# Testing Requirements

Runners as #27: Node built-in runner for worker code (`node:test`, #2 test kit), `@web/test-runner` for the app, Playwright (Chromium, hermetic) for e2e, a Node script for smoke and for the live-project check. A fetch guard fails any test that reaches a real external host. Fake clock, `sleep` and `random` in every timing test.

## 1. Fixtures and mocks

- **Fake Iterable** (`providers/iterable/worker/fake`): serves two hosts (US and EU) with separate key registries; requires an `Api-Key` header that matches a key of the right data center and type (`server-side`, `read-only`, disabled), and **fails the test** if a key arrives in a query string or body; implements `GET /api/snippets` (all snippets with content, no paging), `GET /api/snippets/{identifier}`, `PUT /api/snippets/{identifier}` (by numeric id: update or `404`; by name: create or update, recorded as a create), `POST /api/snippets` and `DELETE` (recorded as destructive attempts); numeric ids auto-increment; names unique and immutable; `updatedAt`/`updatedBy` maintained (`updatedBy` = `createdByUserId` or the project creator); optional content normalisation switch (models IS2); `400` for invalid Handlebars and disallowed content; `400` for malformed JSON; request body over 4 MB rejected; scripted `401` (body echoes a canary key identifier and a canary caller IP), `403`, `404`, `429` with and without `Retry-After`, `500`, `503`, connection reset, timeout. Records every request (method, path, headers, body).
- **Fake IMS/DA/site, env factory, fake clock, fake vendor, in-memory store:** from #27's test kit. Canary: `canary-iterable-key-<random>`.
- **Value fixtures:** plain text; text with `&`, `<`, `>`, quotes and non-ASCII; sanitised HTML from #27's golden pages; HTML containing `{{profile.email}}`, `{{{x}}}`, `{{!-- c --}}`, `{{#if a}}`, `[[feed.field]]`, `{ {`, a lone `{`, a lone `[`; hostile HTML bypassing the shell sanitiser (script, iframe, style, `onerror=`, `javascript:`) for module-direct tests; values at 100 KB minus/plus one byte and a value that makes the request exceed 4 MB (multi-byte at the boundary).
- **Snippets:** plain text snippet; HTML snippet with description and variables and Handlebars logic; snippet with a data-feed reference; snippet whose name is only digits; name with spaces; 600 snippets (varied names and content sizes) for list, search and cursor tests; ids malformed (`../1`, `abc`, `1.5`, empty, over-length, leading `+`).

## 2. Fake Iterable self-tests

IF1 key checks reject missing, wrong-type, disabled and wrong-data-center keys and any key in a query or body; IF2 `PUT` by id on an unknown id gives `404`, `PUT` by an unknown name creates and is counted as a create; IF3 names are unique and immutable, ids are stable; IF4 `updatedAt`/`updatedBy` move only on an actual `PUT`; IF5 listing returns all snippets with content and no paging; IF6 scripted errors and rate limits behave as modelled; IF7 any `DELETE`, `POST` create, unknown path or method is recorded as a destructive or disallowed attempt; IF8 the normalisation switch changes read-back content as modelled.

## 3. Contract suite V1 run for the Iterable module (seam V1)

The unmodified #27 suite, with the Iterable module and fake Iterable: **VC1-VC8** (descriptor complete and valid; `connect` outcomes; `listTargets` paging and filter; `describeTarget`; `push` writes exactly the slot given; per-slot failure isolation (asserted via a two-target scenario); no raw vendor text; no delete or create-target operation). A suite failure that is not an Iterable bug is a contract change and goes back to #27's owner.

## 4. Iterable module cases (seam V1 plus W1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| IT1 | Configuration check: missing `ITERABLE_API_KEY` or an invalid `ITERABLE_DATA_CENTER` gives `vendor_not_configured` (generic) and `configured:false` in the descriptor; no network call is made; no host, path or header component ever comes from a caller | A6 |
| IT2 | Host selection: `usdc` goes only to the US host, `edc` only to the EU host; the proxy's allowed hosts are exactly those two; a mapping or request carrying a URL, host or data-center value changes nothing | A6 |
| IT3 | Key transport: every call carries `Api-Key` from the secret; the key is never in the URL, a body, or any header other than `Api-Key`; the module and route code never see the value (injection happens in the proxy) | A6 |
| IT4 | `listTargets`: both kinds list all snippets; name and description search is a literal case-insensitive substring (regex metacharacters in the query match literally); sorted by name; `limit` honoured; opaque cursor walks 600 snippets without gaps or overlap; a cursor from before a list change is rejected; content bodies never appear in the result; unknown kind rejected | A1 |
| IT5 | List cache: two pages of one search cost one upstream list call within the cache window; `push` and the connection test bypass the cache | A2 |
| IT6 | `describeTarget`: slot type `html` or `text` per kind; unknown id -> `target_not_found`; malformed ids (non-digits, traversal, empty, over-length) rejected before any call; numeric-only-name snippet addressed by id works; `currentValue` present only when enabled and truncated and text-only | A1, A6 |
| IT7 | Push (HTML snippet, content differs): one read, one `PUT` by id; body has content, the description and variables exactly as read, and the actor id only if configured; no name field; `vendorState: live`; no other call | A2 |
| IT8 | Push with identical content: zero `PUT`s (one read only); `updatedAt` unchanged in the fake | A2 |
| IT9 | Preservation: description, variables, name, createdBy and createdAt unchanged after a content write (diff on the fake); a snippet without variables is written without a `variables` key | A2 |
| IT10 | Format versus kind: `html-snippet` accepts `html` verbatim and HTML-escapes `text`/`url`/`image`; `text-snippet` writes `text`/`url`/`image` verbatim and rejects `html` with `invalid_value`; a format outside the descriptor is rejected by the shell before the module | A1 |
| IT11 | Never destructive: across the whole Iterable suite the fake's destructive-attempt counter is zero, no request uses `DELETE`, `POST /api/snippets`, a name-based `PUT`, or any path other than the three allowed (property across the suite) | A2, A6 |
| IT12 | Target deleted in Iterable between list and push: `404` -> `target_not_found`; no `PUT`, nothing created; the same id never resurrects | A2 |
| IT13 | Source page 404 or empty field: shell reports `source_unavailable` / `empty_value`; zero Iterable calls | A2 |
| IT14 | Content guards (direct to the module, bypassing the sanitiser): `<script`, `<iframe`, `<style`, handler attributes, `javascript:` -> `invalid_value` "content not allowed in snippets" before any `PUT` | A2, A6 |
| IT15 | Personalization guard: every fixture containing `{{`, `{{{`, `{{!` or `[[` is rejected per slot before any Iterable call (zero fake requests, not even the read) with the fixed message, for each kind and format; lone `{`, `}`, `[`, `]` and `{ {` pass | A2, A6 |
| IT16 | Size: 100 KB exactly accepted at the shell cap; a value that makes the request exceed 4 MB (UTF-8 bytes, including preserved description and variables) rejected before any write; a server `400` maps to `invalid_value` | A2 |
| IT17 | Error map: `400`, `401` (body with canary key identifier and caller IP), `403`, `404`, `429` (with and without `Retry-After`), `500`, `503`, network error, timeout, malformed JSON body each map to Decision 19's table with `retryable` set correctly; raw bodies, `msg`, `params.ip` and key identifiers never reach any response or log line | A2, A6 |
| IT18 | Retry: `429`/`5xx` retried by the template helper with backoff and `Retry-After` under the fake clock, then reported; the `PUT` is retried on `5xx` and the replayed `PUT` leaves the fake in the same state (idempotent); `401`/`403`/`404`/`400` are never retried | A2 |
| IT19 | Pacing: 60 bindings against the fake: never more than 2 concurrent calls or 5 per second; the per-tick budget defers the remainder fairly | A2 |
| IT20 | Tolerance: an upstream response with extra, unknown fields and with `id` typed as a number or string parses identically; missing optional fields (`description`, `variables`) are handled | A2 |
| IT21 | Actor: with `ITERABLE_ACTOR_USER_ID` set, `createdByUserId` is sent on every `PUT` and `updatedBy` in the fake reflects it; unset, it is omitted; a malformed value fails the configuration check | A2 |
| IT22 | Connection test route: success `{ok:true}`; wrong key, wrong data center (key from the other DC), disabled key, read-only key (as far as the fake models a signal), unreachable each give a fixed reason; no key, key identifier, IP or upstream message echoed | A6 |
| IT23 | Read-only key: lists and describes succeed, `push` fails with `auth_failed`, and the status shows the fixed message | A2, A6 |

## 5. Shell integration with Iterable registered (seams W1, R1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| IN1 | A mapping with one Iterable binding, one Marketo and one AJO binding saves, reads back and validates (single kind has exactly one rule; slot uniqueness keyed by vendor, target, slot) | A1 |
| IN2 | Tick with a changed page: the Iterable binding is pushed through the engine with no Iterable knowledge in the engine; status shows `lastSyncedAt` and per-slot state | A2 |
| IN3 | **Polled re-sync**: edit the fake page, advance the clock, tick: only the changed field's snippet is written; unchanged pages cause zero Iterable calls (not even a read) | A2 |
| IN4 | Per-item errors in the status view: a deleted snippet shows `target_not_found` with the fixed message; another binding on the same site syncs | A2 |
| IN5 | A site with a bad Iterable key surfaces `auth_failed` for its Iterable bindings without disturbing Marketo/AJO bindings or other sites | A2, A6 |
| IN6 | Retryable failure (`429` then success): the retry schedule (5, 15, 60 minutes) runs under the fake clock; a repeated push writes once | A2 |
| IN7 | Engine run with only the fake vendor registered passes the #27 SY scenarios (unchanged), and again with Iterable registered | A3 |
| IN8 | Source page 404 -> `source_unavailable`; zero Iterable calls; snippet content untouched | A2 |
| IN9 | Sync now with more bindings than the inline budget returns `remaining` and the next tick finishes it | A2 |
| IN10 | `GET /vendors` lists `iterable` with `configured` true/false; the app's target picker, kind labels and formats render from the descriptor alone | A1, A3 |
| IN11 | **If IP1 is accepted:** a never-synced Iterable binding is not pushed by the tick (state `never_synced`, status text says "waiting for first manual sync"); Sync now pushes it; afterwards the tick re-syncs it on change. **If declined:** the tick pushes like any vendor (test pins the fallback) | A2 |

## 6. Security (seams W1, V1; A6)

| ID | Behaviour asserted |
|---|---|
| SEC1 | **Route enumeration with Iterable registered:** every route and method returns `401` without a token before any fake (site, DA, Iterable) receives a request (#27 AZ1 re-run; adding the vendor adds no unauthenticated path) |
| SEC2 | **Canary property test:** across success, every error in Decision 19, Iterable echoing the key identifier and caller IP in a `401` body, handler throw, missing-secret, connection test: the canary key never appears in any response body or header, log line, or stored row (store dump), including the D1 file in the smoke tier |
| SEC3 | The caller's IMS token reaches only the fake DA host; the fake Iterable never sees an `Authorization` derived from it, nor any header other than `Api-Key` carrying credentials |
| SEC4 | Inputs: malformed snippet ids, traversal, encoded separators, query smuggling, overlong strings, names instead of ids -> `400` and zero Iterable requests; the data-center value can be influenced by no request field |
| SEC5 | Redirects from Iterable are not followed; the fake sees no second request and the key is not re-sent to a redirect target |
| SEC6 | Disallowed `Origin` with a valid token -> `403` on Iterable routes (template behaviour on this worker) |
| SEC7 | Authorisation: DA write required for save, preview, sync, import; read-only callers can list and see status; site not on the allowlist -> zero outbound requests (#27 AZ3/AZ6 with `vendor=iterable`) |
| SEC8 | Injection via content: hostile HTML never reaches the fake Iterable (shell sanitiser) and personalization syntax never reaches it (IT15) |
| SEC9 | Iterable `401`/`403` bodies (`msg`, `code`, `params.ip`, `params.apiKeyIdentifier`) are absent from every response and log line |
| SEC10 | Key in header only: a test double that fails any request carrying the key in a URL or body proves the module and proxy never do it |
| SEC11 | Allowlist property: over the whole suite (every route, tick, error path), the fake records only `GET /api/snippets`, `GET /api/snippets/{digits}`, `PUT /api/snippets/{digits}`; any other method/path fails the test; the wide key cannot be used for anything else through this worker |

## 7. App unit tests (seam S2; `@web/test-runner`)

UA1 vendor picker lists Iterable from the descriptor; UA2 kind picker shows "HTML snippet" and "Text snippet" with their labels and formats; UA3 no approval option is shown for Iterable (descriptor `supportsApproval` false); UA4 target search sends the expected request (query, kind, cursor) and renders name, last-updated and note text; UA5 per-slot errors (`invalid_value` for syntax, content, size; `target_not_found`; `auth_failed`; `permission_denied`; `vendor_unavailable`) render as fixed plain messages exposed to assistive technology as text; UA6 last-sync time and state render in the status view; UA7 **if IP1:** the live-write notice renders on the binding and the preview, and the "waiting for first manual sync" state renders; **if declined:** the notice is absent and the test pins that; UA8 **if IP2:** preview shows current and new values side by side as text (a current value containing `<img onerror>` creates no element); UA9 the worker call helper sends `Authorization: Bearer <sdk token>` only to the configured worker origin; the page never receives or holds the Iterable key (no response the page can obtain contains it, asserted by SEC2 in the worker tier); UA10 `?worker=` and similar parameters are ignored (#2 Decision 13).

## 8. End-to-end (seam S1; Playwright, Chromium, hermetic: static server `:3000`, real worker via `wrangler dev` `:8787`, local D1, fake IMS/DA/site/Iterable as Node servers, #1 SDK stub)

| ID | Behaviour asserted | Proves |
|---|---|---|
| IE1 | Open app, choose vendor Iterable, search and pick an HTML snippet, map a block as HTML, preview, save, Sync now: the fake Iterable holds the new content; status shows last sync time | A1, A2, A5 |
| IE2 | Text snippet mapped from a heading as `text`: written verbatim | A1 |
| IE3 | Edit the fake page, advance the worker's test tick, reload status: snippet updated, other binding untouched | A2 |
| IE4 | Fake Iterable returns `404` for one snippet: status shows that item's plain error; the rest of the site synced | A2 |
| IE5 | Page contains `{{x}}` in the mapped field: preview and sync show the per-slot syntax error; fake Iterable untouched | A2, A6 |
| IE6 | Request without a token to every worker route -> `401` visible to the browser (CORS headers present) | A6 |
| IE7 | Page HTML, DOM text and all network responses contain neither the user token nor the canary Iterable key | A6 |
| IE8 | Only the static server, the worker, the SDK stub and (stubbed) `admin.da.live` are contacted from the browser | A6 |
| IE9 | **If IP1:** first tick does not write; Sync now writes; the following edit is re-synced by the tick | A2 |

## 9. Runtime smoke (seam W2)

SI1 the worker with the Iterable module bundles and starts under `wrangler dev`; a bare request -> `401`. SI2 the Iterable module against the fake over real HTTP including a `429` retry with real (tiny) timers and a read-compare-write cycle. SI3 canary absent from all responses and the local D1 file (SEC2 over HTTP). SI4 the scheduled hook runs a tick with an Iterable binding against the fakes. SI5 `Api-Key` header is present on the wire and the key is absent from the URL (verified at the fake over real HTTP).

## 10. Repo and docs checks (seam S3, extended)

| ID | Behaviour asserted | Proves |
|---|---|---|
| UR-I1 | **Provider footprint:** given a changed-file list for an "add Iterable" change, the rule accepts paths under `apps/marketing-automation-sync/providers/iterable/`, the named registration points (vendor registry, wrangler secret/variable declarations, `.dev.vars.example`, extension README vendor list), and fails any other path under `apps/marketing-automation-sync/` or `shared/`; temp-dir fixtures prove both directions; CI runs it on the real PR diff (shared with #28's UR-A1) | A3 |
| UR-I2 | `providers/iterable/` contains a worker module that passes the V1 suite (a provider that registers without a suite run fails, #27 UR5) | A3, A7 |
| UR-I3 | `providers/iterable/README.md` exists and mentions the secret and each variable name from the config, the live-write warning, the never-destructive behaviour, the dedicated-snippet advice, the data-feed alternative, and states that no EW site configuration is read; the extension README has an Iterable row linking to it | A4 |
| UR-I4 | #2 hygiene rules hold: no tracked `.dev.vars*`, `ITERABLE_API_KEY` only in `secrets` and `.dev.vars.example`, no secret-looking key in `vars` | A6 |
| UR-I5 | Lint (ESLint 8 helix, Stylelint 16) and all test tiers run in CI on every push and PR; no new CI job needed; no secrets in CI | A7 |

## 11. Live-project checks (opt-in Node script through the local worker against a real, dedicated Iterable test project; never in CI; budget: a handful of throwaway snippets, at most ~60 calls)

LS1 spikes IS1-IS8 outcomes recorded as fixtures; LS2 create (outside the module, by hand) an HTML and a text snippet, map, sync, and verify content in **Content > Snippets**; LS3 update a snippet that has a description and variables and confirm both survive; LS4 a `{{`/`[[` value is refused; LS5 a read-only key lists but fails to write with the documented fixed message; LS6 a rotated key recovers with no code change; LS7 a template using the snippet shows the new content in a preview or proof (pickup latency recorded, IS8). Findings update the fake and Decisions 8, 10-15.

## 12. Manual verification inside real Experience Workspace (needs interactive Adobe login; cannot be automated)

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, #1); an Adobe IMS identity with write access to the DA org/site and to edit its config; Chrome; a Cloudflare account with `wrangler login`; **an Iterable project dedicated to testing, with a server-side API key and (separately) a read-only key**, the project's data center, an email template that embeds a test snippet, and at least one HTML and one text snippet; a published test page with a key/value block and a grid block. Never paste the IMS token or the API key into chat, issue comments or logs. Iterable's API Explorer calls are real and affect project data, so use the test project only [VERIFIED].

- **IM0 (prereq):** deploy the worker with the key (`wrangler secret put ITERABLE_API_KEY`) and variables (`ITERABLE_DATA_CENTER`); `curl -i <worker>/v1/vendors` returns `401` (A6); with a valid token the vendor list shows Iterable `configured:true` and "Test connection" says connected (needs the test project).
- **IM1 (`ref=local`, full path):** `npm start` and the worker dev script; open `https://da.live/app/jazhou-adobe/ew-extensions/apps/marketing-automation-sync/marketing-automation-sync?ref=local`, accept the trust prompt (#1 2.4); choose Iterable; pick the HTML snippet; map the block as HTML; preview (current versus new if IP2); save; Sync now; in Iterable (Content > Snippets) the snippet shows the new content and "updated by" as configured; status shows last sync time (A1, A2, A5).
- **IM2 (text kind):** map a heading as text to a text snippet; sync; verify in Iterable; confirm a template embedding it with `{{ snippet "..." }}` renders the text and an HTML snippet embedded with `{{{ snippet "..." }}}` renders markup (A1).
- **IM3 (polled re-sync):** edit the heading in the EW editor and publish; without touching the app wait up to the polling interval (local scheduled trigger in `ref=local`); status shows a new last-synced time; Iterable holds the new text; unedited bindings unchanged; record publish-to-sync latency in the README. If IP1 is accepted, confirm the first binding waits for the manual sync (A2).
- **IM4 (per-item errors):** delete the snippet in Iterable, or put `{{profile.email}}` in the page, or swap to the read-only key; Sync now shows the plain per-item error for that binding only; restore and see recovery (A2).
- **IM5 (branch ref):** push a simple-named branch, wait for Code Sync, open the app URL with `?ref=<branch>` against the deployed worker; repeat IM1; record the page's actual `Origin` (`aem.live` or `preview.da.live`) in the README (A5; #2 R2).
- **IM6 (live effect, with care):** with a template embedding the snippet in a draft campaign or proof, sync and confirm the new content appears immediately (Iterable states edits apply at once [VERIFIED]); record the observation in the README's live-write section (A2).
- **IM7 (security):** with `curl`: no token -> `401`; valid token, user without write -> `403`; disallowed `Origin` -> `403`; site off the allowlist -> `403`; search page source, Network responses and DevTools storage for the API key (none) (A6).
- **IM8 (rotation):** create a second server-side key in the Iterable project, `wrangler secret put ITERABLE_API_KEY` with the new value, sync again with no code change, disable the old key in Iterable (A6).
- **IM9 (apps menu and documentation):** the card at `https://da.live/apps#/jazhou-adobe/ew-extensions` opens the app; a reviewer follows `providers/iterable/README.md` from a clean checkout to a working local sync (A4, A5).

## 13. Acceptance-criteria traceability (ticket #32)

Labels A1 to A7 are #32's seven acceptance criteria in the order the ticket lists them.

| # | Acceptance criterion (#32) | Automated proof | Manual / review verification |
|---|---|---|---|
| A1 | Admin maps EW page/fragment content (by block and field) to the vendor's content objects and saves the mapping per site | IT4, IT6, IT10 (targets, kinds, formats), IN1, IN10, UA1-UA4, IE1, IE2, plus #27's EX/MP/UI suites unchanged | **IM1**, **IM2**, LS2 |
| A2 | Content pushes on demand, and the worker re-syncs mapped pages whose published version changed (polled); the app shows last sync time and per-item errors | IT5, IT7-IT9, IT11-IT21, IT23 (push, compare-skip, preservation, non-destructive, guards, errors, retry, pacing), IN2-IN6, IN8, IN9, IN11 (engine, polled re-sync, per-item errors, recovery, live-write hold), UA5/UA6, IE1, IE3-IE5, IE9, SI2, SI4 | **IM1** (Sync now), **IM3** (publish then polled re-sync, latency recorded), **IM4** (per-item errors), **IM6** (live effect), LS3, LS4 |
| A3 | Added inside the existing `marketing-automation-sync` folder as a new provider; no changes needed in the extension shell beyond registering the provider | UR-I1 (footprint rule on the real diff), UR-I2, VC1-VC8 (V1 suite on Iterable), IN7 (engine vendor-agnostic with Iterable registered), IN10 | Review of the PR diff against the registration-point list in Build Analysis 5 (and, if IP1-IP3 are accepted, review that those are separate shell changes) |
| A4 | Extension README documents this vendor's setup (credentials, site config keys) | UR-I3 (provider README names the secret and each variable, states no site config is read; extension README row) | **IM9** (clean-checkout walk-through), review; Open Question 11 on the "site config keys" reading |
| A5 | Works in EW with `ref=local` and with a branch ref | IE1-IE9 (page at `localhost:3000` against a local worker), SI1-SI5, UA9/UA10; origin handling covered by the template's UC tests | **IM1** (`ref=local`), **IM5** (branch ref against the deployed worker; observed `Origin` recorded), **IM0**, **IM9** |
| A6 | Vendor credentials live only in this extension's worker (from the shared template); the browser never receives them; unauthenticated calls are rejected | IT1-IT3, IT11, IT14, IT15, IT17, IT22, IT23, SEC1-SEC11 (route enumeration, canary property test, key-in-header-only, three-operation allowlist, SSRF/path inputs, no user token to Iterable), UA9, IE6-IE8, SI1, SI3, SI5, UR-I4 | **IM0** (`curl` 401), **IM7** (security checks incl. page-source and storage search), **IM8** (rotation); review that the Iterable key appears only in worker config |
| A7 | Core logic covered by unit tests; lint and CI green | All worker and app unit tiers above (IF, IT, IN, SEC, UA), CI jobs `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` (UR-I5) | Review: CI green on a PR; deliberately break a guard on a scratch branch (drop the syntax guard, send the key in a query string, add a `DELETE` call, drop an auth check on one route) and see IT15 / SEC10 / SEC11 / SEC1 fail |

Every acceptance criterion on #32 maps to at least one automated test or a numbered manual verification step above.

## 14. Open questions for the owner

1. **"Data feeds / snippets" (R1).** This spec implements **snippets** (push) and documents data feeds as an Iterable-pull alternative. Contentful's Iterable app, the thing the ticket cites, only generates a data-feed link. Confirm snippets, or say that Contentful-style parity (an EW-hosted JSON URL pasted into an Iterable data feed, no worker) is what you actually want, in which case #32's acceptance criteria need rewording.
2. **Worker-served data feed.** If a feed served *by the worker* is wanted, it needs a route authenticated by Iterable's static `Authorization` token, which the template (#2 Decision 4) does not allow today and which contradicts AC6's "unauthenticated calls are rejected". Is that a separate template decision and ticket, or out for good?
3. **Live-write policy (R2).** Iterable has no draft. Accept IP1 (hold polled re-sync until the first manual Sync now, plus a visible "writes go live" notice) as a small additive shell change, or keep the README-only fallback? Should the default be "polled re-sync off until enabled per binding"?
4. **Project model.** One Iterable project and one data center per worker deployment (this spec), or several projects (for example test and production) selectable per binding? The latter needs a mapping field and so a shell change; "one deployment per project" is the fallback.
5. **Two snippet kinds.** Is the HTML-versus-text choice on the binding (this spec) the right way to decide escaping, or should the module always write EW text as plain text and never escape?
6. **Personalization syntax.** Reject `{{` and `[[` in synced content (this spec), or offer a deliberate pass-through (authors write Iterable Handlebars into EW pages) or an escaped-literal mode once IS5 shows what Iterable honours? Pass-through lets page authors execute expressions against profile data.
7. **Overwrite and drift.** One-way, last write wins, no drift detection when someone edits the snippet in Iterable and no concurrency token. Acceptable? Do you want a "changed in Iterable since EW last wrote it" warning (needs the shell to store the written `updatedAt`)?
8. **Attribution.** Edits appear as the project creator unless `createdByUserId` is sent. Which user id should EW syncs carry (a dedicated service user in the Iterable project), or is the default acceptable?
9. **Rate and budget.** The snippet endpoints publish no rate limit. Accept the shared conservative pacing (2 concurrent, 5 per second, per-tick and per-day budgets) until IS4 measures real behaviour?
10. **Key scope and blast radius (R3).** A server-side key is project-wide; there is no snippet-only key. Is a dedicated Iterable project for EW-managed snippets acceptable, or must this worker never hold a key for a project with real customer data? Related to the Adobe outside-activity/IP item (#27 R1).
11. **AC4 wording.** "Site config keys": this spec reads none (all settings are worker variables and a secret). Is documenting the worker keys and stating "no site configuration is read" the intended meaning, or should the provider read per-site settings (for example the target project) from the EW site config?
12. **Interface proposals IP1-IP3.** Accept as small additive amendments to #27's contract (`writesAreLive`, `currentValue`, list `note`; IP3 shared with #28's P3), or keep the fallbacks? These need review across #28, #29 and #30.
13. **Template amendments and secrets for unused vendors.** Iterable needs R-T1 and R-T5 only (not R-T2, not R-T3). Same decision as #27 Q5. Also, should the required-secrets list depend on a vendors-enabled variable so a Marketo-only deployment need not set `ITERABLE_API_KEY` (recommended; same as #28 OQ 8)?
14. **Iterable access.** Is there an Iterable project I can use (or that the owner will provision) as a dedicated test project with a server-side and a read-only key? Without one the module is built against the fake only, IM0-IM9 and LS1-LS7 are deferred, and Decisions 8, 10-15 stay unproven.
15. **Other objects.** Is there appetite for follow-up kinds, for example email templates (`/api/templates/email/upsert`) or catalog items, or is snippets-only the end state for Iterable?
16. **Polling interval and sizes.** Same 5-minute poll as #27 for Iterable? Use the shell's 100 KB default (Iterable's email-clipping guidance) as the cap?
17. **Policy item (carry-over).** Confirm the Adobe outside-activity/IP position before a worker holding an Iterable key (customer-grade, able to change live customer communications) runs under a personal Cloudflare account or is shared (#27 R1, #1 R1).
