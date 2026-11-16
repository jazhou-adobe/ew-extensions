# Spec: Marketing Automation Sync: Adobe Journey Optimizer (provider `ajo`)

Ticket: jazhou-adobe/ew-extensions#28 (this spec: #66). #28 is blocked by #27 (extension shell, vendor interface, first provider Marketo; spec in `apps/marketing-automation-sync/SPEC.md`), which is itself blocked by #1 (repo scaffold, spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template, spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as #1, #2, #27): **[VERIFIED]** = read in a primary source (URL given) on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision, a live-tenant check, or an answer from Adobe.

Vocabulary follows #1, #2 and #27: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *source page*, *field*, *target*, *slot*, *binding*, *mapping*, *sync*, *re-sync*, *descriptor*, *V1 contract suite* are as defined in #27. AJO vocabulary used here: *fragment* = a reusable content component in Adobe Journey Optimizer's Content Management (not an AEM Content Fragment and not a Journey Fragment, see Further Notes); *visual fragment* = fragment of API type `html` (email channel, built in the Email Designer); *expression fragment* = fragment of API type `expression` (HTML, text or JSON code, built in the personalization editor); *draft / live* = fragment status `DRAFT` / `PUBLISHED` in the API (`PUBLISHING` in between), shown as Draft / Live in the UI; *sandbox* = the Adobe Experience Platform sandbox every AJO call is scoped to; *API credential* = an Adobe Developer Console OAuth Server-to-Server credential attached to a product profile.

This spec stays consistent with #27's provider interface (descriptor, `connect`, `listTargets`, `describeTarget`, `push`, normalised error taxonomy, V1 contract suite, fake vendor) and does **not** redesign the shell. Everything #27 fixed (mapping document, field addressing, extraction, formats, storage, sync engine, status, lease, pacing, authorisation, routes, folder layout, tooling, template amendments R-T1..R-T5) is reused by reference. Only AJO-specific decisions are made here. Where AJO does not fit the interface cleanly, the spec says so (Decision 3, Build Analysis section 4) and proposes the smallest amendment together with an in-module fallback.

Primary sources read (2026-11-16): [AJO Content API definition (OpenAPI, source of the rendered reference)](https://raw.githubusercontent.com/AdobeDocs/journey-optimizer-apis/main/static/content.yaml) rendered at https://developer.adobe.com/journey-optimizer-apis/references/content ; [AJO API authentication page (source)](https://github.com/AdobeDocs/journey-optimizer-apis/blob/main/src/pages/references/authentication.md) (the rendered `/references/authentication` URL returned 404 when fetched with `curl`, so the repo source is cited); [AJO developer reference overview](https://developer.adobe.com/journey-optimizer-apis); [OAuth Server-to-Server implementation guide](https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation); AJO user docs: [Get started with fragments](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/content-management/fragments/fragments), [Create a fragment](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/content-management/fragments/create-fragments), [Manage fragments](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/content-management/fragments/manage-fragments), [Leverage expression fragments](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/content-management/personalization/use-expression-fragments), [Personalization syntax](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/content-management/personalization/personalization-syntax), [Guardrails and limitations](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/get-started/essentials/guardrails), [Get started for developers](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/get-started/by-role/developer). Upstream `adobe-rnd/ew-extensions` code search (2026-11-16) found no AJO, Marketo or "journey" prior art (the two `ajo` hits are incidental substrings in `package-lock.json` and an e2e README, not integrations) [VERIFIED by `gh api search/code`].

---

## Problem Statement

A team that runs its campaign copy in Experience Workspace (EW) and sends it through **Adobe Journey Optimizer (AJO)** writes the same headline, body copy, call-to-action and image URL twice: once as an EW page or fragment, once as an AJO **fragment** that emails in campaigns and journeys reference. Every copy fix is repeated by hand and the two copies drift. #27 gives EW a vendor-neutral mapping shell plus Marketo; AJO, the Adobe-fit vendor the scoring note points to, is not available in it.

Six things make AJO different from Marketo, the vendor the shell was built around:

1. **Different auth, with a header set Marketo does not have.** AJO calls need an access token from an Adobe Developer Console OAuth Server-to-Server credential (client id, client secret, scopes) plus three more headers: `x-api-key` (the client id), `x-gw-ims-org-id` and `x-sandbox-name` [VERIFIED: authentication.md and `content.yaml` parameters]. Adobe warns that generating too many access tokens gets an integration throttled, so tokens must be cached [VERIFIED: S2S implementation guide]. The credential must never reach the browser, which is why #2's worker is mandatory.
2. **A fragment has one body, and it is updated by whole-document replace.** There are no named slots as in Marketo program tokens. An update is a `PUT` of the full fragment guarded by `If-Match` with the etag from a prior `GET`; the `PATCH` endpoint can only change name, description and folder [VERIFIED: `content.yaml` `putFragment`, `patchFragment`]. Every sync is therefore read-modify-write with optimistic-concurrency conflicts (`409`).
3. **"Written" is not "live".** A new or edited fragment is a draft; a fragment must be *published* (an asynchronous API call) before journeys and campaigns can use it, and publishing a changed fragment automatically propagates to every live journey and campaign that references it [VERIFIED: Manage fragments, Use expression fragments, publishFragment description]. Auto-publishing from a polled sync would change live customer communications without a human looking.
4. **Content that looks like code is code.** AJO fragment content is rendered with a Handlebars-based personalization language where `{{...}}` and `{%...%}` are evaluated [VERIFIED: Personalization syntax page]. An EW page is public, author-edited content; a sync that copies `{{profile.person.name}}` or a stray `{%` from a page into a live fragment hands the page author a way to run personalization expressions against customer profiles, or to break every email that uses the fragment.
5. **Tight, partly contradictory size and permission limits.** Visual fragments are capped at 100 KB and expression fragments at 200 KB on the create page, while the guardrails page says 700 KB; creating, editing and publishing need the "Manage library items" and "Publish Fragment" permissions of the Content Library Manager product profile [VERIFIED: Create a fragment, Guardrails]. The API credential's product profile must carry them.
6. **The live system cannot be observed.** No AJO tenant is available to the author of this spec; the API reference leaves several behaviours unstated (what `PUT` does to a live fragment, whether `GET` returns the draft or live version, whether the expression fragment `subType` can be read back, rate limits). Those are explicit spikes, and the design branches on their outcome instead of guessing.

The maintainer needs AJO added **as one provider module**, inside the existing `marketing-automation-sync` folder, without changing the shell, so campaign content is authored once in EW and reaches AJO fragments with draft-first safety.

## Solution

Add the AJO provider to `marketing-automation-sync`: one worker module under `providers/ajo/` registered in the shell's vendor registry, plus its README, fake, tests and a descriptor. No shell logic changes.

What the admin sees, unchanged from #27: in the existing app they choose vendor **Adobe Journey Optimizer**, choose a **target** from a searchable list of AJO fragments (two kinds: *Visual fragment* and *Expression fragment*), map one EW field or block to the fragment's body, preview exactly what would be written, save the mapping for the site, press **Sync now**, and watch the status view show last sync time and per-item errors. After an author edits and publishes the EW page, the worker's poll notices the changed published version and re-syncs the fragment within the polling interval.

What is specific to AJO:

- **Targets are existing fragments**; the module never creates, deletes, archives or moves fragments (the interface has no such operation).
- **One slot per target, its body.** Visual fragments take `html`; expression fragments take `text`, `url`, `image` or `html` according to the fragment's own subtype (HTML or Text; JSON fragments are listed but not writable in #28).
- **Draft first.** A sync writes the fragment content. Publishing (which changes live campaigns and journeys) happens only when the binding's `approve` option is on; the UI calls it "publish" for this vendor. With it off, a person publishes in the AJO UI. The exact meaning of "write" on a currently-live fragment is decided by spike AS2 (Decision 9).
- **Personalization syntax is refused, not passed through.** Values containing `{{` or `{%` are rejected per slot with a plain message, so page content cannot become executable personalization.
- **Auth and secrets stay in the worker**: client id and secret are Cloudflare secrets, the access token lives in isolate memory, the sandbox and IMS org id are non-secret worker variables, and every route is authenticated exactly as #27 specifies.

## User Stories

Admin (site or campaign admin who sets up the mapping):

1. As an admin, I want to choose Adobe Journey Optimizer as the vendor for a binding, so that I can keep AJO fragments in sync with EW pages.
2. As an admin, I want to search my AJO sandbox's fragments by name from the app, so that I never copy fragment ids around.
3. As an admin, I want visual fragments and expression fragments listed as separate target kinds, so that I pick the right kind of reusable component.
4. As an admin, I want each fragment in the list to show its status (draft, publishing, live) and last-modified time, so that I know what I am about to overwrite.
5. As an admin, I want to map one EW block (as HTML) to a visual fragment, so that a reusable email section stays in sync.
6. As an admin, I want to map one EW field to an expression fragment as text, link URL, image URL or HTML, so that a headline, CTA link or banner URL can be reused by name in emails.
7. As an admin, I want the app to tell me which formats an expression fragment accepts (its subtype), so that I never map HTML into a text fragment by mistake.
8. As an admin, I want a clear "JSON fragments are not supported" message instead of a silent failure, so that I know why such a fragment cannot be selected.
9. As an admin, I want a preview that shows the exact value and the AJO operations that would run (read, write, optional publish), without changing anything, so that I can trust the first sync.
10. As an admin, I want a binding option "publish after writing" that is off by default, so that live emails and journeys never change without review.
11. As an admin, I want that option labelled in AJO's words and to see what it does (it updates every live campaign and journey that uses the fragment), so that I choose it knowingly.
12. As an admin, I want values containing personalization syntax (`{{`, `{%`) rejected with a message naming the field, so that page content cannot inject expressions into customer emails.
13. As an admin, I want an oversize value reported before any write, so that I find out in preview, not in AJO.
14. As an admin, I want to check the AJO connection from the app and see "connected" or a plain reason (credential rejected, sandbox or org id wrong, missing permission), so that I can fix setup without reading logs.
15. As an admin, I want the README to list exactly what to create in Adobe Developer Console and Admin Console (project, AJO API, OAuth Server-to-Server credential, product profile with Manage library items and Publish Fragment, sandbox access), so that setup needs no guesswork.
16. As an admin, I want the same mapping rules as for Marketo (per site, versioned, conflict on stale save, export/import, disable binding), so that AJO bindings behave like any other.
17. As an admin, I want Marketo and AJO bindings in the same site mapping, so that I can run both platforms from one place.

Campaign author:

18. As an author, I want my published EW edits to reach the AJO fragment automatically, so that I do not repeat the copy in AJO.
19. As an author, I want to see when the fragment was last synced and whether it succeeded, so that I know AJO has my latest copy.
20. As an author, I want a Sync now button, so that I can push right after publishing.
21. As an author, I want an unpublished or deleted source page to show "source unavailable" and leave the fragment untouched, so that a mistake never blanks an email component.
22. As an author, I want a missing or empty field reported per slot with the field named, so that I know which edit broke the mapping.
23. As an author, I want to know when a fragment was written but is waiting to be published in AJO, so that I do not assume the live email changed.
24. As an author, I want a fragment that someone edited in AJO in the meantime to be overwritten by the next EW sync only after a conflict-safe read-modify-write, so that I never silently produce a half-merged fragment.

Maintainer / operator:

25. As the maintainer, I want the AJO client id and secret only in the worker's secret store and the access token only in memory, so that no page, response, log or database row can leak them.
26. As the maintainer, I want the access token cached and minted only when there is work to do, so that Adobe does not throttle my integration for token churn.
27. As the maintainer, I want an expired or revoked token handled by one re-authentication and one retry, so that rotated credentials and 24-hour expiry recover by themselves.
28. As the maintainer, I want AJO calls paced under a conservative budget and `429` honoured with `Retry-After`, so that this integration cannot starve other consumers of the same AJO org.
29. As the maintainer, I want one failed fragment not to block the others, so that a single permission problem does not stop a campaign.
30. As the maintainer, I want the module never to delete, archive, unpublish or move AJO content, so that automation cannot destroy campaign assets.
31. As the maintainer, I want a repeated sync with unchanged content to make no AJO writes (and ideally one read at most), so that polling costs almost nothing.
32. As the maintainer, I want an `If-Match` conflict handled by one re-read and retry and then reported plainly, so that concurrent edits in AJO never corrupt a fragment.
33. As the maintainer, I want the module to preserve every fragment property it does not own (name, description, folder, source, editor context, labels), so that a sync cannot silently rename or move a fragment.
34. As the maintainer, I want AJO's error text and ids never forwarded to the browser (fixed messages per code), so that error bodies naming internal assets do not leak.
35. As the maintainer, I want each outbound AJO call to carry a fresh `x-request-id` that I can correlate with the worker's request id, so that Adobe support can trace a failed call.
36. As the maintainer, I want the AJO module to need no change in the shell beyond registering it, so that vendor #2 is as cheap as the contract promised.
37. As the maintainer, I want a CI check that a provider change touches only the allowed paths, so that "no shell changes" is enforced, not hoped for.
38. As the maintainer, I want the README (extension and provider) to document AJO setup, secrets, variables and the "reads no site configuration" fact, so that a new person can enable it alone.
39. As the maintainer, I want a clean statement of what the AJO API credential can and cannot do, so that I grant the narrowest product profile.

Security reviewer:

40. As a security reviewer, I want proof that a canary client secret and a canary access token never appear in any response, header, log line or stored row for AJO paths, so that "never reaches the browser" is tested.
41. As a security reviewer, I want proof that every route still returns 401 without a token after AJO is registered, so that adding a vendor cannot add an unauthenticated path.
42. As a security reviewer, I want proof that the fragment id, sandbox name, org id and paths cannot steer the worker to another host or another API path, so that user input cannot cause server-side request forgery or path injection.
43. As a security reviewer, I want proof that content containing personalization syntax or script cannot reach an AJO fragment, so that page authors cannot execute expressions or inject script into emails.
44. As a security reviewer, I want the user's IMS token proven never to be sent to Adobe's AJO or IMS token hosts, so that token handling stays auditable (the AJO call uses the worker's own service token).

Vendor developer (the owner or an agent working #29 to #32 after this):

45. As a vendor developer, I want AJO to pass the same V1 contract suite as Marketo and the fake vendor, so that the suite is shown to be vendor-independent.
46. As a vendor developer, I want the interface-fit findings from AJO (read-modify-write, async publish, single-slot targets, draft/live) recorded with proposed amendments, so that Braze, Klaviyo, HubSpot and Iterable specs can reuse them.

## Implementation Decisions

(No file paths or code. Layout and shapes are in the Build Analysis. Everything not stated here is as in #27.)

**Product shape and scope**

1. **One provider module, registered, nothing else in the shell.** The AJO module lives with its vendor folder (`providers/ajo/`, worker code under `providers/ajo/worker/` per #2 Decision 3). Registration = one entry in the shell's vendor registry, the AJO secret names in the worker config, the non-secret variables, `.dev.vars.example`, and one row in the extension README's vendor list. No change to mapping, extraction, storage, sync engine, status, UI or routes. This is enforced by a footprint check (Testing, UR-A1).
2. **Scope of #28 = AJO provider for existing fragments, both kinds, on-demand and polled sync through the shell, draft-first.** Out: creating fragments, templates, journeys, campaigns, folders; reading content back into EW.
3. **Interface fit (verdict).** AJO fits #27's interface with **no breaking change**: `single` slot model, one rule per binding, descriptor-driven UI, per-slot results, taxonomy. Four non-breaking gaps are handled inside the module, each with an optional amendment the owner may accept (Build Analysis 4, proposals P1-P4): (P1) a label for the approval option ("Publish"), (P2) a per-kind maximum value size in the descriptor, (P3) a free-text note on target list items, (P4) `vendorState` documented as an open vocabulary (`draft`, `publishing`, `published` for AJO; `draft`, `approved` for Marketo). Fallbacks need no shell change.
4. **Tenancy.** Single-tenant per worker deployment, like Marketo (#27 Decision 18, OQ 2): one AJO IMS org, one sandbox, one credential. A deployment that needs stage and production sandboxes runs one worker per sandbox [OPEN, Open Question 3].
5. **Never destructive.** The module never calls a delete, discard, archive or unpublish operation, and never uses `PATCH` (which can move a fragment to another folder). It also never creates a fragment.

**Targets, kinds, slots**

6. **Two target kinds.**
   - `visual-fragment`: API type `html`, channel `email`. Slot model `single`, formats `html`.
   - `expression-fragment`: API type `expression`, channel `shared`, with subtype `TEXT`, `HTML` or `JSON`. Slot model `single`, formats `text`, `html`, `url`, `image`.
   The slot's name is the same constant #27 uses for a single-slot target (its body) [ASSUMPTION: confirm the constant against the #27 implementation].
7. **Format versus subtype (module-enforced; the shell cannot know subtypes).** `describeTarget` reports the single slot's `type` as `html` (visual), or the expression subtype (`TEXT` or `HTML`; `JSON` reported as `JSON`). At push: visual accepts `html` only; expression `TEXT` accepts `text`, `url`, `image` (plain strings); expression `HTML` accepts `html`, and also `text`/`url`/`image`, which the module HTML-escapes; `JSON` is refused with `invalid_value` ("JSON fragments are not supported"). The UI uses the reported slot type to disable impossible format choices; the module still enforces it [expression `subType` read-back is [OPEN], spike AS1].
8. **Listing.** Server-side listing and filtering are available (unlike Marketo snippets): `GET /fragments` with `limit` (default 20, max 1000), `orderBy`, opaque `start` cursor and `property` filters including `name` (regex or contains) and `type` [VERIFIED: `content.yaml`]. The module maps `kind` to the `type` filter, `query` to a name filter (escaped so user text is a literal, not a regex), the response's next-page cursor to `nextCursor`, and each item to `{ id, name, kind, location (parent folder id), status, updatedAt }`. The exact name-filter operator syntax ("contains" is documented as supported but only the `~` regex form appears in the example) and whether archived fragments are returned are [OPEN], spike AS3.

**Value rules**

9. **Write semantics (the central safety decision, gated by spike AS2).** The module's push is: read the fragment (and its etag), validate kind and format, skip the write if the stored content already equals the value, otherwise replace the fragment's content with `If-Match`, then read again to learn the resulting status.
   - **Outcome A (expected from the UI behaviour and the API's separate "live fragment" read):** a write to a live fragment produces a draft and leaves the published version untouched until publish. Then draft-only is real, `approve` off means "draft written, live unchanged", and publishing is the opt-in step.
   - **Outcome B (writes change live content immediately):** then there is no draft-only mode for live fragments. The module refuses to write to a `PUBLISHED` fragment unless the binding has `approve` on (`invalid_value`, fixed message "this fragment is live; enable publishing for this binding"), and the README says so. Draft fragments stay safely writable.
   The build does not start before AS2 answers; the module's tests are written for A and have a switchable fake that models B.
10. **Publish step (opt-in, async).** With `approve` on, after a successful write the module requests publication and polls the fragment's last-publication status (`complete`, `inProgress`, `error`) honouring `Retry-After`, up to a bounded wait (default 20 s; "a few seconds" per the docs). Results: `complete` is `written` with `vendorState: published`; `error` is a per-slot `invalid_value` (non-retryable, publication errors need a content or permission fix); still `inProgress` at the deadline is a **retryable** per-slot failure (`vendor_unavailable`, "publication still running"), so the engine's backoff (5, 15, 60 minutes) re-pushes later; the repeated push finds identical content, makes no write, sees the fragment publishing or live, and finishes without re-publishing a live fragment. A fragment already `PUBLISHED` with identical content makes no calls beyond the read. Publishing needs the "Publish Fragment" permission; its absence surfaces as `permission_denied`.
11. **Personalization-syntax guard.** A value containing `{{` or `{%` (which also covers `{{{`) is rejected before any AJO call with `invalid_value` and the fixed message "content contains personalization syntax", for every format and kind. Rationale in Problem 4; AJO additionally forbids adding new personalization fields to a live fragment [VERIFIED: Manage fragments], so passing syntax through would also fail unpredictably at publish. Whether a deliberate pass-through option is wanted is Open Question 6. The shell's HTML sanitiser (#27 Decision 9) still runs first; this guard is the module's second line.
12. **Size.** The module rejects before writing: visual over 100 KB, expression over 200 KB (the documented create-page limits, the stricter of two contradictory documents [VERIFIED discrepancy: Create a fragment says 100 KB visual and 200 KB expression, Guardrails says 700 KB]; the larger number is not relied on). The shell's `VALUE_MAX_BYTES` default of 100 KB already equals the visual limit. A server-side rejection (`400`) maps to `invalid_value`. Byte counting is UTF-8 on the final serialised value.
13. **Preserve everything the module does not own.** The write sends the fragment back exactly as read, with only the content replaced: name, description, type, subtype, channels, source and its metadata, parent folder and editor context are carried through unchanged. The module never changes the name, so renaming in AJO is safe. Whether labels (object-level access control) survive a `PUT`, and whether the read and write representations of `channels` and `subType` are symmetric (the reference shows `channels` as a string on read and a one-item array on write; `subType` appears on write but not in the read schema) are [OPEN], spikes AS1 and AS4.
14. **Visual fragments and the Email Designer.** A visual fragment stores both content and an editor context. Writing content without the editor context the Email Designer expects might leave the designer showing stale structure, or the next designer save might overwrite the synced HTML [ASSUMPTION; [OPEN], spike AS5]. Default: carry the editor context through unchanged and document the caveat. If AS5 shows the designer renders from the editor context, then visual-fragment targets are restricted to fragments whose source origin is `external` (API-managed) and the README says UI-authored visual fragments cannot be targets; expression fragments are unaffected.

**Auth, transport, errors**

15. **Auth: OAuth Server-to-Server, client credentials, cached.** The module obtains an access token by POSTing a form-encoded body (client id, client secret, grant type `client_credentials`, scopes) to Adobe IMS's token endpoint, and caches it in isolate memory until a safety margin before `expires_in` (tokens "usually expire in 24 hours" [VERIFIED]; margin 5 minutes; if `expires_in` is absent assume 1 hour [ASSUMPTION]). Tokens are minted lazily, only when a call is about to be made, so a polling tick with no changed pages mints none (Adobe throttles excessive token generation [VERIFIED]). No token is persisted, in D1 or elsewhere. The token endpoint and API hosts are fixed constants (Decision 18).
16. **Required headers on every AJO call:** `Authorization: Bearer <token>`, `x-api-key` (the credential's client id), `x-gw-ims-org-id`, `x-sandbox-name`, a fresh `x-request-id` (the API requires it to be unique per request [VERIFIED]), and the vendor media types in `Accept` and `Content-Type` where the reference requires them [VERIFIED: parameters per endpoint in `content.yaml`]. The user's IMS token is never sent to Adobe's AJO or token hosts (#27 Decision 28: it goes only to the DA admin host).
17. **Configuration.** Secrets: `AJO_CLIENT_ID`, `AJO_CLIENT_SECRET`. The client id is not confidential by Adobe's definition (it is the API key), but it is declared as a secret so it is handled and redacted like one. Non-secret variables: `AJO_IMS_ORG_ID`, `AJO_SANDBOX_NAME`, `AJO_IMS_SCOPES` (the exact scope string copied from the credential's token command in Developer Console [VERIFIED mechanism: S2S guide shows `scope={SCOPES}`; the AJO scope values are not documented on the pages read, [OPEN]]), `AJO_PUBLISH_WAIT_MS`. Local-only overrides of the API and token hosts exist only under `ALLOW_LOCALHOST`, like #27's content-origin override. The browser sends and receives none of these; no route returns the org id or sandbox as a credential, and connection checks say only "ok" or a fixed reason. Whether vendors the deployment does not use must still have their secrets declared is Open Question 8.
18. **Fixed hosts and validated inputs.** Production hosts: `platform.adobe.io` (Content API base path `/ajo/content` [VERIFIED]) and `ims-na1.adobelogin.com` (token endpoint `/ims/token/v3` [VERIFIED]). Fragment ids must match the UUID form before they are placed in a path [format from examples in `content.yaml`, ASSUMPTION that all ids are UUIDs]. The sandbox name and org id come only from worker configuration, never from callers. Redirects are not followed. A stage host appears in the API definition (`platform-stage.adobe.io`); it is not used.
19. **Error classification (module-local; messages fixed; no upstream text to the browser).**

    | AJO signal | Taxonomy code | Retry |
    |---|---|---|
    | token endpoint rejects credentials | `auth_failed` | no |
    | `401` on an API call | re-authenticate once and retry once; second `401` is `auth_failed` | one re-auth |
    | `403` | `permission_denied` | no |
    | `404` on a fragment | `target_not_found` | no |
    | `400` on a write | `invalid_value` | no |
    | `409` on write (`If-Match` mismatch) | re-read and retry once; a second `409` is `vendor_unavailable` with message "fragment changed while syncing" | yes |
    | `429` | `rate_limited`, honour `Retry-After` | yes |
    | `5xx`, network error, timeout | `vendor_unavailable` | yes |
    | publication status `error` | `invalid_value` | no |
    | anything else | `unknown` | no |

    Unlike Marketo, AJO reports failures with real HTTP statuses, so #2's proxy retry helper (`429` and `5xx`, `Retry-After`) covers transport retries and **template amendment R-T3 (response classifier hook) is not needed for AJO** [ASSUMPTION: AJO gateway uses `429`; unverified, AS6]. R-T1, R-T2 (dynamic secret redaction for the access token, form-body injection of the client secret) and R-T5 are needed, as for Marketo. A `PUT` is idempotent; the publish `POST` is passed with the template's explicit "safe to retry" flag because repeating it re-publishes the same content [ASSUMPTION; verified in AS2].
20. **Pacing.** Calls per sync are small and bounded: read, optional write, read-after-write, and with publish one publish call plus at most a few status polls (so 1 to about 6). The module obeys the shell's pacing (at most 2 concurrent, 5 per second, per-tick call budget, per-day counter) and has no documented AJO daily quota to reflect [OPEN, Open Question 11; spike AS6 looks for rate-limit headers]. Steady state is hash-gated by the shell and costs nothing.

**Documentation and registration**

21. **README (AC4).** `providers/ajo/README.md` documents: what the provider does and its draft-first and no-delete behaviour; Developer Console steps (project, add the AJO API, add an OAuth Server-to-Server credential, choose product profile); Admin Console steps (product profile with Content Library Manager permissions, "Manage library items" and "Publish Fragment", sandbox access); how to find the IMS org id and sandbox name; the secrets and variables above with the exact `wrangler` commands; the statement that AJO reads **no EW site configuration** (all settings are worker variables and secrets, #27 Decision 3); `ref=local` and branch-ref notes; the caveats of Decisions 9, 11, 12 and 14. The extension README's vendor list gets an AJO row linking to it.

## Testing Decisions

**What makes a good test here.** As in #27: assert external behaviour only. Given an HTTP request or a cron tick and a fake outside world (fake AJO, fake IMS token endpoint, fake published site, fake DA admin, fake clock, in-memory store), assert the response, what the fake AJO received (operations, order, count, headers, bodies), what the status routes say, and what was logged. Never assert internal helper names or the number of internal calls. Four properties are asserted as negatives across every AJO path: (1) a canary client secret and canary access token never appear in any response, header, log line or stored row; (2) no AJO or IMS-token call happens before authentication and authorisation succeed; (3) nothing is ever deleted, unpublished, archived, moved or renamed in the fake AJO (its counters stay zero), and no fragment property other than content ever changes; (4) content with personalization syntax never reaches the fake AJO.

**Proposed seams (recorded instead of asked): no new seams.** The ideal number is one; #27 already provides the right ones and AJO is the first real test that they are vendor-independent.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| V1 (primary) | Vendor contract suite: takes a vendor module and a fake of that vendor's API | reused from #27 | AJO module (VC1-VC8) plus AJO-specific cases | Fake AJO HTTP handler (stateful fragments, etags, publication jobs, scripted errors) and fake IMS token endpoint; the suite calls only the module's public interface |
| W1 | Worker HTTP boundary `worker.fetch` | reused from #2/#27 | Routes with `vendor=ajo`: targets, describe, test, preview, mapping, sync, status; security tests | Constructed `Request`; env factory with canary AJO secrets; fake IMS (user tokens), fake DA, fake site, fake AJO and fake token endpoint as scripted fetch handlers |
| R1 | Worker tick `worker.scheduled` on a fake clock | reused from #27 | Polled re-sync of AJO bindings, retries, publication-pending recovery, mixed-vendor sites | Same fakes plus a controllable clock |
| S1 / S2 / S3 / W2 / R2 | Entry page + SDK stub; render module; repo convention check; real workers runtime; store contract | reused from #1, #2, #27 | Playwright e2e with AJO selected; WTR UI cases for descriptor-driven options; footprint check (UR-A1); smoke; no change | As #27 |

A *delta*, not a seam: the S3 convention check gains a **provider-footprint rule** (a change that adds a provider may touch only that provider's folder and the named registration points). It runs on a temp-dir fixture in unit tests and on the real diff in CI.

**Modules tested:** the AJO module (auth and token cache, request headers, list/describe mapping, read-modify-write push, publish and poll, value guards, error classification, pacing integration), the AJO fake itself (self-tests), the shell with AJO registered (mixed-vendor mapping, vendor-agnostic engine), the footprint rule, README presence.

**Prior art:** #27's seams and tests (V1 suite, fake vendor, fake Marketo, SE canary property tests, SY engine tests); #2's test kit (canary secrets, fake IMS, env factory); the injected `fetchImpl`/`storage`/`now` pattern in upstream `tools/brand-visibility/session-auth.js` [VERIFIED by #2 and #27].

## Out of Scope

- Creating, deleting, archiving, unarchiving, unpublishing, moving or renaming fragments; creating folders; editing tags, labels or access control. Content templates (the Content API has them; not mapped in #28).
- Journey Fragments (reusable journey nodes) and AEM Content Fragments synced into AJO (an existing AJO/AEM integration, different object and source).
- Campaigns, journeys, API-triggered messages, profile data, datasets, suppression lists, any other AJO API.
- Multi-sandbox or multi-org credentials in one deployment; per-site AJO credentials entered in the app (#27 Decision 18 / OQ 2).
- Dynamic fragments, personalization pass-through, mapping several EW fields into one fragment (templating); JSON-subtype expression fragments (listed, flagged, not writable).
- Drift detection when someone edits a fragment in AJO: last EW write wins on the next changed sync, apart from the conflict-safe write of Decision 19 (README says so).
- Any change to the mapping UI, storage, sync engine, authorisation, extraction or the shell's other behaviour; template amendments beyond R-T1, R-T2, R-T5 (shared with #27).
- CI-driven worker deployment and Cloudflare credentials in CI (#2 Decision 15).
- The Adobe outside-activity/IP policy decision for running infrastructure that holds an AJO credential on a personal Cloudflare account (flagged in #27 R1; owned by #1 R1).

## Further Notes

- **Two Adobe "fragment" features that are not this one.** AJO already integrates with AEM Content Fragments (AEM-authored content used in AJO emails) [VERIFIED: https://experienceleague.adobe.com/en/docs/journey-optimizer/using/content-management/combine/aem/aem-fragments] and has Journey Fragments (reusable journey nodes) [VERIFIED: same page and the Fragments page's note]. Neither takes EW page content. The relevant objects here are AJO *content* fragments, managed by the Content API.
- **Adobe itself names this use case.** The AJO developer guide lists "sync content templates from an external CMS" and "create and manage content templates and fragments from an external pipeline" as API use cases, all with OAuth Server-to-Server auth and no JWT [VERIFIED: https://experienceleague.adobe.com/en/docs/journey-optimizer/using/get-started/by-role/developer].
- **API definition quirks worth knowing.** The Content API definition is `version 0.0.1`; its fragment `GET` schema lists `status` but not `subType`; the `PUT` requires a one-element `channels` array while `GET` shows a string; the listing description allows only `html` as a type filter value although `expression` exists; the fragment `PATCH` response schema is declared as `204` for fragments but `200` for templates [VERIFIED by reading `content.yaml`]. Each is a reason for the live spikes rather than trusting the definition alone.
- **Docs contradict on size.** 100 KB / 200 KB (create page) versus 700 KB (guardrails). The module uses the smaller values until a live check says otherwise (AS7).
- **Draft fragments cannot be activated.** AJO blocks activation of a journey or campaign that uses a Draft fragment, so draft-only syncing deliberately requires a human publish step before the new copy goes out [VERIFIED: Leverage expression fragments].
- **Fragments created before June 2024 are shown as Draft even if live in use** [VERIFIED: Manage fragments caution]; the target list's status may therefore not mean what an admin expects for old fragments. The README mentions it.
- **No AJO sandbox is available to the author.** Every AJO behaviour in this spec is from documentation and the API definition; AS1-AS7 settle the unknowns against a real sandbox before the module is finished, and fixtures for the fake are hand-written until then.
- **This SPEC.md** is a planning artefact; keep or delete it when the provider is built, as decided for #1's spec [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

The architecture is #27's, unchanged. The AJO module is one more vendor behind the registry.

```
EW app (browser, static)  ──IMS bearer──►  Worker (per #27)
                                             │ vendor registry: marketo | ajo | fake-vendor(test)
                                             │ fetch(): origin gate → IMS auth → site allowlist + DA permission → routes
                                             │ scheduled(): per site lease → due bindings → extract → hash → ajo.push (paced)
                                             ▼
        ajo module ──(1) POST https://ims-na1.adobelogin.com/ims/token/v3  (client id + secret from secrets; token cached in memory)
                   ──(2) https://platform.adobe.io/ajo/content/fragments...  (Bearer, x-api-key, x-gw-ims-org-id, x-sandbox-name, x-request-id)
```

| Concern | App (browser) | Worker + AJO module |
|---|---|---|
| AJO client id/secret, access token | never | secrets store; token in isolate memory only |
| IMS org id, sandbox name | never sent or shown as credentials | non-secret variables |
| Choosing a fragment, mapping, preview | UI; descriptor-driven | list, describe, extract, validate |
| Value guards (syntax, size, subtype) | shows the resulting per-slot errors | enforces; fixed messages |
| Write, publish, poll | triggers Sync now, shows status | all of it |
| Conflicts, retries, rate limits | none | `If-Match` re-read, backoff, pacing |

## 2. EW integration points

- **Type: unchanged.** The extension remains one app (`apps` sheet row, #27 section 2). The AJO provider adds no row, no library plugin, no SDK action. The extensions table row stays; the extension README's vendor list gains an AJO entry.
- **Site configuration read: none** (#27 Decision 3). AJO settings are worker variables and secrets. AC4's "site config keys" is therefore satisfied by documenting worker configuration keys and stating that no EW config-sheet or site-config key is read [OPEN, Open Question 12: confirm that reading of the criterion].
- **SDK usage:** none beyond #27's (`token`, `context`, `actions.daFetch`).
- **`ref=local`:** page on `http://localhost:3000`, local worker on `http://localhost:8787` with the local env, AJO either the real sandbox (real secrets in `.dev.vars`, never committed) or the local fake via the local-only host overrides. **Branch ref:** page on `{branch}--{site}--{org}.aem.live` or `.preview.da.live` calling the deployed worker (#27 section 2; observed `Origin` recorded in manual step AM5). AJO needs no browser-side change in either case.

## 3. External APIs and auth flows

| API | Use | Auth / headers | Source / status |
|---|---|---|---|
| IMS token `POST https://ims-na1.adobelogin.com/ims/token/v3`, form body `client_id`, `client_secret`, `grant_type=client_credentials`, `scope` | obtain access token (usually 24 h) | OAuth Server-to-Server credential | [VERIFIED] https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation ; AJO scope string: [OPEN] (copy from the credential's token command) |
| AJO auth page: product profile, AEP role, headers `Authorization`, `x-api-key`, `x-gw-ims-org-id` | setup docs | n/a | [VERIFIED] https://github.com/AdobeDocs/journey-optimizer-apis/blob/main/src/pages/references/authentication.md (JWT credentials deprecated; new integrations must use OAuth S2S) |
| Content API base `https://platform.adobe.io/ajo/content` (stage host exists, unused) | all fragment calls | Bearer token, `x-api-key`, `x-gw-ims-org-id`, **`x-sandbox-name` (required)**, optional unique `x-request-id` | [VERIFIED] `content.yaml` servers and parameters |
| `GET /fragments` (`limit` 1-1000 default 20, `orderBy` default `-modifiedAt`, `start` cursor, `property` filters: `id`, `name` (regex, contains), `type` (`html`), `channels`, dates, `origin`) -> `_page`, `items[]`, `_links.next` | list targets | as above; `Accept: application/vnd.adobe.ajo.fragment-list.v1.0+json` | [VERIFIED] shape; `expression` as a `type` filter value, contains-operator syntax, archived fragments: [OPEN] AS3 |
| `GET /fragments/{id}` -> fragment with `etag` response header; `status` `DRAFT`/`PUBLISHING`/`PUBLISHED`; `type` `html`/`expression`; `channels`; `source{origin: ajo|external, metadata}`; `parentFolderId`; `labels`; audit fields; `fragment.content` (html) or `fragment.expression` (expression) | read before write; describe | `Accept: application/vnd.adobe.ajo.fragment.v1.0+json` | [VERIFIED] schema; whether GET returns draft or live content and whether `subType` is returned: [OPEN] AS1/AS2 |
| `PUT /fragments/{id}` with required `If-Match` etag, body = full fragment (`name`, `type`, `channels` one-item array, `fragment{content\|expression, editorContext?}`, `subType` for expression, `source`, `parentFolderId`) -> `204` + new `etag`; `400/401/403/404/409` | write content | `Content-Type: application/vnd.adobe.ajo.fragment.v1.0+json` | [VERIFIED] `putFragment`; effect on a live fragment: [OPEN] AS2 |
| `POST /fragments/publications` `{fragmentId}` -> `202` with `Location`, `Retry-After`; "publishing a content fragment will freeze the content... async... can take a few seconds" | publish (opt-in) | content type `application/vnd.adobe.ajo.fragment.publication.request.v1.0+json` | [VERIFIED] `publishFragment` |
| `GET /fragments/{id}/lastPublicationStatus` -> `status` `complete`/`inProgress`/`error`, `errors[]`; `GET /fragments/{id}/liveFragment` -> last successful publication's content | poll publish; optionally compare live vs draft | `application/vnd.adobe.ajo.fragment.publication.v1.0+json` | [VERIFIED] |
| `PATCH /fragments/{id}` (JSON Patch, only `/name`, `/description`, `/parentFolderId`) | **not used** | n/a | [VERIFIED] `patchFragment` |
| No `DELETE` operation for fragments in the definition | confirms non-destructive surface | n/a | [VERIFIED] absence in `content.yaml` (templates have one; fragments do not) |
| Error body `{path, request-id[], type: https://ns.adobe.com/aep/errors/CJMMAS-*, title, status, report{tenantInfo, additionalContext}, error-chain[]}` | classification (status code), never forwarded | n/a | [VERIFIED] `errorResponse`; `report.tenantInfo` carries sandbox and org id, a further reason not to forward |
| Limits: visual fragment 100 KB, expression 200 KB (create page); 700 KB (guardrails); permissions "Manage library items" and "Publish Fragment" (Content Library Manager profile) | guards, setup docs | n/a | [VERIFIED] https://experienceleague.adobe.com/en/docs/journey-optimizer/using/content-management/fragments/create-fragments and .../get-started/essentials/guardrails ; rate limits for the Content API: not found [OPEN] |
| Personalization syntax: Handlebars-based, `{{ }}`, `{{{ }}}`, `{%= %}` | guard design | n/a | [VERIFIED] https://experienceleague.adobe.com/en/docs/journey-optimizer/using/content-management/personalization/personalization-syntax ; literal-escape syntax for braces: not found [OPEN] AS8 |

**Auth flows (additions to #27 section 3).**
1. *Worker to AJO (module `connect`)*: secrets from `env` -> token endpoint POST (client secret in the form body; redaction registered for the secret and, once received, the access token, template R-T2) -> access token in isolate memory with expiry -> every API call carries the four AJO headers and a fresh request id. A `401` triggers one re-authentication and one retry. Token minting is lazy.
2. *App to worker*, *worker to DA admin*, *worker to published site*, *cron*: exactly as #27. The cron path uses only stored mapping, the anonymous content fetch and the AJO secrets.
3. *Connection test* (`POST /vendors/ajo/test`): mint a token and perform one cheap authenticated read (list fragments, `limit=1`) in the configured sandbox; the response is `ok` or a fixed reason keyed to `auth_failed`, `permission_denied` (profile or sandbox) or `vendor_unavailable`.

## 4. Data contracts

All routes, the mapping document, the status document and the stored state are #27's, unchanged. AJO-specific values only:

**Descriptor** (`GET /vendors`, entry `ajo`): `configured` true when both secrets and the three required variables are set; kinds:

| kind | label | slotModel | valueFormats | supportsApproval |
|---|---|---|---|---|
| `visual-fragment` | Visual fragment (email) | `single` | `html` | true |
| `expression-fragment` | Expression fragment | `single` | `text`, `html`, `url`, `image` | true |

Required secret names: `AJO_CLIENT_ID`, `AJO_CLIENT_SECRET`.

**Operations (module interface as #27 section 4):**

| Operation | AJO behaviour |
|---|---|
| `descriptor` | as above |
| `connect(env)` | validate configuration (required variables present, shapes valid, no URL from callers); mint or reuse token; failure -> `auth_failed` / `permission_denied` / `vendor_unavailable` |
| `listTargets(session, kind, query?, cursor?, limit?)` | `GET /fragments` with `type` from kind, escaped name filter, `limit`, `start`=cursor; items `{ id, name, kind, location: parentFolderId, status: draft\|publishing\|published, updatedAt }`; `nextCursor` from the response's next link |
| `describeTarget(session, kind, id)` | `GET /fragments/{id}`; kind check (a visual id asked as expression -> `target_not_found`); `slots: [{ name: <single-slot constant>, type: html \| TEXT \| HTML \| JSON }]` |
| `push(session, {kind,id}, slots[1], {approve?})` | Decisions 9-14, steps: guards (syntax, size, kind/format/subtype) -> read -> skip write if identical -> `PUT` with `If-Match`, preserving all other properties -> read for status -> if `approve` and not published: publish, poll -> `{ results: [{slot, outcome, error?}], vendorState: draft\|publishing\|published }` |

`push` accepts exactly one slot (`single` kind) and returns exactly one result.

**Interface-fit proposals (all optional; each has a no-shell-change fallback).**

| # | Gap found with AJO | Proposed amendment (to #27's contract) | Fallback used if declined |
|---|---|---|---|
| P1 | The approval option means "publish to live journeys and campaigns" | Descriptor gains an optional label for the approval option | UI shows the generic "approve" label; README explains it means publish |
| P2 | Value size limits differ per kind (100 KB / 200 KB) | Descriptor gains an optional `maxValueBytes` per kind, so preview can flag oversize | Push-time `invalid_value` (size guard in the module); shell default 100 KB already equals the visual limit |
| P3 | Admins need hints per target (live/draft is covered by `status`; origin `ajo` vs `external` and subtype are not) | `listTargets` items gain an optional short `note` | Status text only; subtype shown from `describeTarget` slot type after selection |
| P4 | `vendorState` vocabulary differs (`published` vs Marketo's `approved`) | Document `vendorState` as an open vocabulary the UI renders as text | UI renders the string; no behavioural coupling |

No proposal changes engine behaviour. Two cross-vendor lessons for #29-#32 (OQ 13 of #27): (a) update-by-replace with etags and a 409 loop is a vendor concern the module hides; (b) asynchronous publish is mapped onto the existing "retryable per-slot failure + idempotent repeat" semantics, so the engine needs no "poll later" step.

**Configuration:** secrets `AJO_CLIENT_ID`, `AJO_CLIENT_SECRET`; variables `AJO_IMS_ORG_ID`, `AJO_SANDBOX_NAME`, `AJO_IMS_SCOPES`, `AJO_PUBLISH_WAIT_MS` (default 20000); local-only `ALLOW_LOCALHOST`-gated host overrides.

## 5. Folder layout (proposed; fits #1, #2, #27)

```
apps/marketing-automation-sync/
├─ (shell as #27, unchanged apart from the registration points below)
└─ providers/ajo/
   ├─ SPEC.md                 this file
   ├─ README.md               vendor setup (Decision 21)
   └─ worker/
      ├─ module              AJO provider module (descriptor, connect, list, describe, push, error map, token cache)
      ├─ fake/               fake AJO + fake IMS token endpoint (stateful; scripted errors; outcome A/B switch)
      └─ test/               contract-suite run (V1), AJ cases, self-tests, footprint fixture
```

**Registration points (the only shell-side edits allowed):** the worker entry's vendor registry (one line), the wrangler config's secret and variable declarations, `.dev.vars.example`, and the vendor list in the extension README. Nothing else outside `providers/ajo/`.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No AJO sandbox/tenant** available to the author; every behaviour is from docs; the OpenAPI definition is `0.0.1` and inconsistent in places | High | Spikes AS1-AS8 first; hand-written fake until then; owner decision on access (OQ 1) |
| R2 | **A write to a live fragment may change live content** (Outcome B), defeating draft-first | High | AS2 gates the build; Decision 9 branch; default refuse-without-approve for live targets under B |
| R3 | **Auto-publish changes live campaigns and journeys.** Even opt-in it is high impact | High | Off by default; labelled; description of blast radius in UI and README; per-binding option; manual M steps |
| R4 | **Personalization injection / breakage** from page content | High | Decision 11 guard + tests AJ-G*; shell sanitiser first; owner decision on pass-through (OQ 6) |
| R5 | **Expression `subType` may not be readable**, so `PUT` cannot round-trip it | High for the expression kind | AS1; fallback: ship visual fragments first, expression kind behind the spike result, or infer subtype from content type |
| R6 | **Editor context / Email Designer mismatch** for visual fragments | Medium-High | AS5; restrict to `external`-origin visual fragments if needed (Decision 14) |
| R7 | **Read-modify-write races** with humans editing in AJO (`409`) | Medium | `If-Match`, one re-read and retry, then retryable failure; tests AJ-W5/W6; never merge |
| R8 | **Property loss on PUT** (labels, tags, folder, source metadata, editor context) | Medium | Send back what was read; AS4 diffs before/after on a real fragment |
| R9 | **Token throttling** if minted per tick | Medium | Lazy mint, in-memory cache, no persistence; documented; cron isolate churn measured in AS6 |
| R10 | **Permissions drift**: credential's product profile lacks "Manage library items" or "Publish Fragment"; sandbox not granted | Medium | `permission_denied` with fixed message; README checklist; connection test distinguishes read from publish only at first publish |
| R11 | **Rate limits / daily quota for the Content API are undocumented** | Medium | Conservative shared pacing; `429` handling; AS6 inspects headers; OQ 11 |
| R12 | **Docs contradict on size** (100/200 KB vs 700 KB) | Low-Medium | Use the smaller; AS7 |
| R13 | **Secrets declaration for unused vendors** (shell's `secrets.required` fails deploys when AJO secrets are missing on a Marketo-only deployment) | Medium | OQ 8; recommended: a vendor-enabled variable decides which secret names are required |
| R14 | **Template amendments** R-T1, R-T2, R-T5 still block #27 and so this provider; R-T3 not needed here | Medium | As #27 R15 |
| R15 | **Adobe outside-activity/IP policy** and holding a customer-grade credential on a personal Cloudflare account | High for publishing | Carried from #27 R1; owner decision |
| R16 | **Region/endpoint assumptions**: `ims-na1` and `platform.adobe.io` used for all tenants | Low-Medium | [ASSUMPTION] global endpoints per docs; AS6 confirms with the real org; config override in local env only |

**Spikes (build-plan step 1; results recorded in the README and the fake's fixtures):**
- **AS1** Read-back shape: `GET` of a visual fragment and of expression fragments with `TEXT`, `HTML`, `JSON` subtypes: is `subType` present, `channels` string vs array, what `fragment` holds, is `editorContext` present, `labels`, `source`. Decides Decisions 7 and 13.
- **AS2** Write semantics: `PUT` on a `DRAFT`, a `PUBLISHED` fragment (status after, `GET` content after, `liveFragment` content after); publish a changed and an unchanged fragment; repeat publish; what propagates. Decides Decision 9 (A or B) and the publish idempotence assumption.
- **AS3** Listing: name filter operator (`~` vs contains), regex anchoring and escaping, `type=expression`, archived items, cursor round trip, ordering stability.
- **AS4** Property preservation: before/after diff of a fragment with a folder, tags, labels and source metadata after a content-only `PUT`.
- **AS5** Designer behaviour: open a synced visual fragment in the Email Designer; does it render `content` or `editorContext`; does a designer save overwrite the synced HTML.
- **AS6** Platform behaviour: `429` presence and `Retry-After`/rate headers, token lifetime and `expires_in`, `401` vs `403` for a missing scope or product profile, error body for `409` and `400`, IMS scope string for the AJO API, `412` vs `409` on a stale `If-Match`.
- **AS7** Size limits: write 99 KB, 101 KB, 199 KB, 201 KB and 701 KB to visual and expression fragments.
- **AS8** Syntax escape: how to emit a literal `{{` in a fragment, and what AJO does with unbalanced `{%` on save and on publish (decides whether the guard could later offer an escaping mode).

## 7. Ordered build plan (sized to #28's acceptance criteria)

0. **Prerequisites (owner):** #27 implemented (shell, interface, V1 suite, fake vendor, Marketo module, template amendments R-T1/R-T2/R-T5); an AJO sandbox, a Developer Console project with the AJO API and an OAuth S2S credential bound to a product profile with Content Library Manager permissions, the IMS org id and sandbox name; decisions on OQ 1, 3, 6, 8. (AC3, AC6)
1. **Spikes AS1-AS8** against the real sandbox; write results into the README and the fake's fixtures; settle Decisions 9, 13, 14 branches. If no sandbox is available, build against the fake only and mark the unverified behaviours (OQ 1). (AC1, AC2, AC6)
2. **AJO fake and self-tests** (stateful fragments, etags, publication jobs, scripted `401/403/404/409/429/5xx`, header validation, token endpoint, outcome A/B switch, delete/PATCH/unpublish counters that must stay zero). (AC7)
3. **Module, test-first against the V1 suite plus AJ cases:** configuration check, token cache and re-auth, headers, list/describe, guards (syntax, size, kind/format/subtype), read-modify-write push with preservation and conflict retry, publish and poll, error map. (AC1, AC2, AC6, AC7)
4. **Registration and shell-with-AJO tests:** registry line, config and secret declarations, `.dev.vars.example`, extension README vendor row; mixed-vendor mapping and engine tests with AJO plus Marketo; footprint check. (AC3, AC7)
5. **Provider README** (setup, secrets, variables, caveats, no-site-config statement, `ref=local` and branch-ref notes) and the extension README row. (AC4)
6. **Hermetic e2e (Playwright) and runtime smoke** with AJO selected, real local worker and the fake AJO. (AC1, AC2, AC5, AC6)
7. **CI additions** (no secrets in CI): the AJO suite and footprint check run under the existing `worker-unit`, `worker-smoke`, `e2e`, `lint` jobs; no new job. (AC7)
8. **Deploy and manual verification in EW** AM0-AM9 plus the opt-in live sandbox script; record observed `Origin`, publish latency and spike results in the README. (AC1, AC2, AC5, AC6)
9. **Hand-off note** for #29-#32: the interface-fit lessons and proposals P1-P4.

---

# Testing Requirements

Runners as #27: Node built-in runner for worker code (`node:test`, #2 test kit), `@web/test-runner` for the app, Playwright (Chromium, hermetic) for e2e, a Node script for smoke and for the live sandbox check. A fetch guard fails any test that reaches a real external host. Fake clock, `sleep` and `random` in every timing test.

## 1. Fixtures and mocks

- **Fake AJO** (`providers/ajo/worker/fake`): requires `Authorization: Bearer <token it issued>`, `x-api-key`, `x-gw-ims-org-id`, `x-sandbox-name` matching the configured sandbox, and a unique `x-request-id` per request (records them; fails the test on a duplicate or missing header). Stateful fragments of both kinds (ids in UUID form, name, type, status `DRAFT/PUBLISHING/PUBLISHED`, `channels`, `source`, `parentFolderId`, `labels`, `editorContext`, expression subtype `TEXT/HTML/JSON`, draft content and live content, etag per version); listing with `limit`, `orderBy`, opaque `start` cursor, `type` and name filters; `PUT` with required `If-Match` (mismatch gives `409`); publication jobs with configurable duration, `202` + `Retry-After` + `Location`, `lastPublicationStatus` `inProgress` then `complete` or `error`; `liveFragment`; scripted `400/401/403/404/409/429/5xx`; a **semantic switch** for Outcome A (write creates a draft) and Outcome B (write changes live); no `DELETE`/`PATCH` handlers: any such request, any unexpected method or unknown path fails the test and increments a "destructive attempt" counter that the whole suite asserts is zero; token endpoint that checks the form body (not URL), issues tokens with `expires_in` and can expire or revoke them.
- **Fake IMS/DA/site, env factory, fake clock, fake vendor, in-memory store:** from #27's test kit. Canaries: `canary-ajo-secret-<random>`, `canary-ajo-token-<random>`, `canary-ajo-clientid-<random>`.
- **Value fixtures:** plain text, text with `&`, `<`, quotes and non-ASCII; sanitised HTML from #27's golden pages; HTML containing `{{profile.person.name}}`, `{{{x}}}`, `{%= x %}`, `{% let a = 1 %}`, a lone `{`/`}` and the substring `{ {`; values at 100 KB minus/plus one byte and 200 KB minus/plus one byte (UTF-8 multi-byte at the boundary); a 700 KB value.
- **Fragments:** visual `DRAFT`, visual `PUBLISHED` with a distinct live version, visual with `editorContext` and folder and labels, expression `TEXT`, `HTML`, `JSON`, an archived-looking item (shape per AS3), ids malformed (`../x`, `abc`, over-length), 120 fragments for pagination.

## 2. Fake AJO self-tests

AF1 header validation rejects each missing or wrong header and a repeated request id; AF2 etag changes on every write and a stale `If-Match` gives `409`; AF3 outcome A and B behave as modelled; AF4 publication job timing and statuses; AF5 listing, cursor and filters; AF6 token expiry and revocation; AF7 any `DELETE`, `PATCH`, unknown path or method is recorded as a destructive attempt.

## 3. Contract suite V1 run for the AJO module (seam V1)

The unmodified #27 suite, with the AJO module and fake AJO: **VC1-VC8** (descriptor complete and valid; `connect` outcomes; `listTargets` paging and filter; `describeTarget`; `push` writes exactly the slot given; per-slot failure isolation (trivially one slot; asserted via a two-target scenario); no raw vendor text; no delete or create-target operation). A suite failure that is not an AJO bug is a contract change and goes back to #27's owner.

## 4. AJO module cases (seam V1 plus W1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| AJ1 | Configuration check: missing secret or variable gives `vendor_not_configured` (generic) and `configured:false` in the descriptor; malformed org id or sandbox name fails before any call; no host or path component ever comes from a caller | AC6 |
| AJ2 | Token request: form-encoded body with client id, secret, grant type, scopes; secret never in the URL; request goes only to the fixed token host | AC6 |
| AJ3 | Token reuse until the safety margin; lazy mint (a tick with no changed pages mints zero tokens); expired token or `401` -> exactly one re-auth and one retry; second `401` -> `auth_failed`, no loop; never persisted (store dump has no token) | AC6 |
| AJ4 | Every API call carries all five headers; `x-request-id` unique per call and logged next to the worker request id; user IMS token never sent to the AJO or token hosts | AC6 |
| AJ5 | `listTargets`: kind -> type filter; name query escaped as a literal; `limit` honoured; cursor round trip until exhausted; item mapping (status lower-cased, folder as location); unknown kind rejected | AC1 |
| AJ6 | `describeTarget`: slot type per kind and subtype; wrong-kind id -> `target_not_found`; malformed id rejected before any call | AC1, AC6 |
| AJ7 | Push (visual `DRAFT`): read, `PUT` with `If-Match`, all non-content properties byte-identical after, `vendorState: draft`; no publish call | AC2 |
| AJ8 | Identical content already stored: zero writes; a second consecutive push is one read | AC2 |
| AJ9 | Preservation: name, description, folder, source metadata, labels, editor context unchanged after the write (diff on the fake) | AC2 |
| AJ10 | Conflict: stale etag -> `409` -> one re-read and one retry succeeds; two consecutive `409`s -> `vendor_unavailable` "fragment changed while syncing", retryable, nothing partially written | AC2 |
| AJ11 | Outcome A: pushing to a `PUBLISHED` fragment leaves live content unchanged and reports `draft`; Outcome B: the same push without `approve` is refused with `invalid_value` and the fake's live content is unchanged; with `approve` it is written and published | AC2 |
| AJ12 | Publish (opt-in): write, publish request, status poll honouring `Retry-After` under the fake clock; `complete` -> `published`; publication `error` -> non-retryable `invalid_value`; still `inProgress` at `AJO_PUBLISH_WAIT_MS` -> retryable `vendor_unavailable`; the next push (identical content, fragment now live) makes no write and no second publish | AC2 |
| AJ13 | Publish off: no publish call is ever made, for any status or kind (property across the suite) | AC2 |
| AJ14 | Format versus subtype: visual accepts only `html`; expression `TEXT` takes `text`/`url`/`image`; expression `HTML` takes `html` verbatim and escapes `text`/`url`/`image`; `JSON` -> `invalid_value` "not supported"; format outside the descriptor rejected by the shell before the module | AC1 |
| AJ15 | Personalization guard (AJ-G): every fixture containing `{{`, `{{{`, `{%` is rejected per slot before any AJO call (zero fake requests) with the fixed message, for each kind and format; lone braces and `{ {` pass | AC2, AC6 |
| AJ16 | Size guard: 100 KB / 200 KB exactly accepted, one byte more rejected before any call, multi-byte boundary counted in UTF-8 bytes; a server `400` maps to `invalid_value` | AC2 |
| AJ17 | Error map: `400`, `401`, `403`, `404`, `409`, `429` (with and without `Retry-After`), `500`, `503`, network error, timeout, malformed JSON body each map to the table in Decision 19 with `retryable` set correctly; raw titles, request ids, sandbox and org ids never reach any response | AC2, AC6 |
| AJ18 | `429`/`5xx` retried by the template helper with backoff under the fake clock and then reported; `PUT` retried on `5xx`; publish `POST` retried only because it carries the safe-to-retry flag | AC2 |
| AJ19 | Pacing: 60 bindings against the fake: never more than 2 concurrent calls or 5 per second; the per-tick budget defers the remainder fairly (shell behaviour exercised with AJO) | AC2 |
| AJ20 | Non-destructive: across the whole AJO suite the fake's destructive-attempt counter is zero, no request uses `DELETE` or `PATCH`, and no fragment is created | AC2, AC6 |
| AJ21 | Connection test route: success is `{ok:true}`; wrong secret, wrong sandbox, missing permission, unreachable each give a fixed reason; no secret, token, org id or `scope` echoed | AC6 |

## 5. Shell integration with AJO registered (seams W1, R1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| IN1 | A mapping with one AJO binding and one Marketo binding saves, reads back and validates (single kind has exactly one rule; slot uniqueness keyed by vendor, target, slot) | AC1 |
| IN2 | Tick with changed page: the AJO binding is pushed through the engine with no AJO knowledge in the engine; status shows `lastSyncedAt` and per-slot state | AC2 |
| IN3 | **Polled re-sync**: edit the fake page, advance the clock, tick: only the changed field's fragment is written; unchanged pages cause zero AJO calls (not even a read) | AC2 |
| IN4 | Per-item errors in the status view: a `403` fragment shows `permission_denied` with the fixed message; another binding in the same site syncs | AC2 |
| IN5 | A site with a bad AJO credential surfaces `auth_failed` for its AJO bindings without disturbing Marketo bindings or other sites | AC2, AC6 |
| IN6 | Publication-pending recovery: `inProgress` at the deadline, later tick completes with no duplicate write | AC2 |
| IN7 | Engine run with only the fake vendor registered passes the #27 SY scenarios (unchanged), and again with AJO registered | AC3 |
| IN8 | Source page 404 -> `source_unavailable`; zero AJO calls; fragment content untouched | AC2 |
| IN9 | Sync now with more bindings than the inline budget returns `remaining` and the next tick finishes it | AC2 |
| IN10 | `GET /vendors` lists `ajo` with `configured` true/false; the app's target picker and options render from the descriptor alone | AC1, AC3 |

## 6. Security (seams W1, V1; AC6)

| ID | Behaviour asserted |
|---|---|
| SEC1 | **Route enumeration with AJO registered:** every route and method returns `401` without a token before any fake (site, DA, AJO, token endpoint) receives a request (#27 AZ1 re-run; adding the vendor adds no unauthenticated path) |
| SEC2 | **Canary property test:** across success, every error code of Decision 19, AJO echoing the client secret, the access token or the sandbox in an error body, handler throw, missing-secret, connection test, token endpoint failure: the canary client secret, client id and access token never appear in any response body or header, log line, or stored row (store dump), including the D1 file in the smoke tier |
| SEC3 | The caller's IMS token reaches only the fake DA host; neither the fake AJO nor the fake token endpoint ever sees an `Authorization` derived from it |
| SEC4 | Inputs: malformed fragment ids, traversal, encoded separators, query smuggling, overlong strings, non-UUID ids -> `400` and zero AJO requests; sandbox name or org id cannot be influenced by any request field |
| SEC5 | Redirects from AJO or the token endpoint are not followed; the fake sees no second request |
| SEC6 | Disallowed `Origin` with a valid token -> `403` on AJO routes (template behaviour on this worker) |
| SEC7 | Authorisation: DA write required for save, preview, sync, import; read-only callers can list and see status; site not on the allowlist -> zero outbound requests (#27 AZ3/AZ6 with `vendor=ajo`) |
| SEC8 | Injection via content: hostile HTML (script, event handlers, `javascript:`) never reaches the fake AJO (shell sanitiser) and personalization syntax never reaches it (AJ15) |
| SEC9 | AJO error `report.tenantInfo` (sandbox and org) and request ids are absent from every response and log line |

## 7. App unit tests (seam S2; `@web/test-runner`)

UA1 vendor picker lists AJO from the descriptor; UA2 kind picker shows the two kinds with labels; UA3 expression-target selection disables formats not allowed by the reported slot type and shows "JSON fragments are not supported" for JSON; UA4 the approval option is shown for AJO, default off, with the generic or proposed (P1) label and a text describing its effect; UA5 target search sends the expected request (query, kind, cursor) and renders status text; UA6 per-slot errors (`invalid_value` for syntax, size, publication; `permission_denied`; `vendor_unavailable` "still publishing") render as fixed plain messages and are exposed to assistive technology as text; UA7 last-sync time and state render for AJO bindings; UA8 no secret, token, org id or sandbox appears in the DOM or console. (Shell-level UI cases UI1-UI12 from #27 are not repeated.)

## 8. End-to-end (seam S1; Playwright, Chromium, hermetic: static server `:3000`, real worker via `wrangler dev` `:8787`, local D1, fake IMS/DA/site/AJO as Node servers, #1 SDK stub)

| ID | Behaviour asserted | Proves |
|---|---|---|
| AE1 | Open app, choose vendor AJO, search and pick a visual fragment, map a block as HTML, preview, save, Sync now: the fake AJO holds the draft content; status shows last sync time | AC1, AC2, AC5 |
| AE2 | Expression fragment mapped from a heading as `text`: written to a `TEXT` fragment | AC1 |
| AE3 | Edit the fake page, advance the worker's test tick, reload status: fragment updated, other binding untouched | AC2 |
| AE4 | Fake AJO returns `403` for one fragment: status shows that item's plain error; the rest of the site synced | AC2 |
| AE5 | Publish option on: fragment published in the fake after write; off: never | AC2 |
| AE6 | Page contains `{{x}}` in the mapped field: preview and sync show the per-slot syntax error; fake AJO untouched | AC2, AC6 |
| AE7 | Request without a token to every worker route -> `401` visible to the browser (CORS headers present) | AC6 |
| AE8 | Page HTML, DOM text and all network responses contain neither the user token nor the canary AJO secrets/token | AC6 |
| AE9 | Only the static server, the worker, the SDK stub and (stubbed) `admin.da.live` are contacted from the browser | AC6 |

## 9. Runtime smoke (seam W2)

SA1 the worker with the AJO module bundles and starts under `wrangler dev`; bare request -> `401`. SA2 AJO module against the fake AJO over real HTTP including a `429` retry and a publish poll with real (tiny) timers. SA3 canary absent from all responses and the local D1 file (SEC2 over HTTP). SA4 scheduled hook runs a tick with an AJO binding against the fakes.

## 10. Repo and docs checks (seam S3, extended)

| ID | Behaviour asserted | Proves |
|---|---|---|
| UR-A1 | **Provider footprint:** given a changed-file list for an "add AJO" change, the rule accepts paths under `apps/marketing-automation-sync/providers/ajo/`, the named registration points (vendor registry, wrangler secret/variable declarations, `.dev.vars.example`, extension README vendor list), and fails any other path under `apps/marketing-automation-sync/` or `shared/`; temp-dir fixtures prove both directions; CI runs it on the real PR diff | AC3 |
| UR-A2 | `providers/ajo/` contains a worker module that passes the V1 suite (a provider that registers without a suite run fails, #27 UR5) | AC3, AC7 |
| UR-A3 | `providers/ajo/README.md` exists and mentions each secret and variable name from the config, the draft-first and no-delete behaviour, and states that no EW site configuration is read; the extension README has an AJO row linking to it | AC4 |
| UR-A4 | #2 hygiene rules hold: no tracked `.dev.vars*`, `AJO_CLIENT_ID`/`AJO_CLIENT_SECRET` only in `secrets` and `.dev.vars.example`, no secret-looking key in `vars` | AC6 |
| UR-A5 | Lint (ESLint 8 helix, Stylelint 16) and all test tiers run in CI on every push and PR; no new CI job needed; no secrets in CI | AC7 |

## 11. Live sandbox checks (opt-in Node script through the local worker against the real AJO sandbox; never in CI; budget: a handful of throwaway fragments, at most ~40 calls)

LS1 spikes AS1-AS8 outcomes recorded as fixtures; LS2 create (outside the module, by hand or with the script) a visual and an expression fragment, map, sync, and verify content in the AJO UI; LS3 draft-only sync of a live fragment shows a draft and the live version unchanged (Outcome A) or the refusal path (Outcome B); LS4 publish option publishes and the fragment reaches Live; LS5 a `{{` value is refused; LS6 a revoked credential gives `auth_failed` and a rotated one recovers with no code change; LS7 a missing "Publish Fragment" permission gives `permission_denied` on publish only. Findings update the fake and Decisions 9, 12-14.

## 12. Manual verification inside real Experience Workspace (needs interactive Adobe login; cannot be automated)

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, #1); an Adobe IMS identity with write access to the DA org/site and to edit its config; Chrome; a Cloudflare account with `wrangler login`; **an Adobe Journey Optimizer org and sandbox** (a development sandbox is the sensible target [ASSUMPTION: AEP development sandboxes are available with the AJO entitlement]) with: Developer Console access, a project with the AJO API and an OAuth Server-to-Server credential, a product profile with Content Library Manager permissions ("Manage library items", "Publish Fragment") and sandbox access, the IMS org id and sandbox name, one visual and one expression fragment (Text and HTML), and a published EW test page with a key/value block and a grid block (as #27). Never paste the IMS token, client secret or access token into chat, issue comments or logs.

- **AM0 (prereq):** deploy the worker with the AJO secrets (`wrangler secret put AJO_CLIENT_ID`, `AJO_CLIENT_SECRET`) and variables; `curl -i <worker>/v1/vendors` returns `401` (AC6); with a valid token the vendor list shows AJO `configured:true` and "Test connection" says connected (needs the sandbox).
- **AM1 (`ref=local`, full path):** `npm start` and the worker dev script; open `https://da.live/app/jazhou-adobe/ew-extensions/apps/marketing-automation-sync/marketing-automation-sync?ref=local`, accept the trust prompt; choose AJO; pick the visual fragment; map the block as HTML; preview; save; Sync now; in the AJO UI the fragment shows the new content as a draft; status shows last sync time (AC1, AC2, AC5).
- **AM2 (expression kinds):** map a heading as text to the Text expression fragment and an HTML block to the HTML expression fragment; sync; verify in AJO; confirm a JSON fragment is flagged unsupported (AC1).
- **AM3 (polled re-sync):** edit the heading in the EW editor and publish; without touching the app wait up to the polling interval (local scheduled trigger in `ref=local`); status shows a new last-synced time; AJO holds the new text; unedited bindings unchanged; record publish-to-sync latency in the README (AC2).
- **AM4 (per-item errors):** remove "Manage library items" from the profile, or map to a deleted fragment, or put `{{profile.person.name}}` in the page; Sync now shows the plain per-item error for that binding only; restore and see recovery (AC2).
- **AM5 (branch ref):** push a simple-named branch, wait for Code Sync, open the app URL with `?ref=<branch>` against the deployed worker; repeat AM1; record the page's actual `Origin` (`aem.live` or `preview.da.live`) in the README (AC5).
- **AM6 (draft versus live):** with a Live fragment, sync with publish off: observe whether live content changed (decides Outcome A/B in the README); turn publish on, sync: the fragment is Live with the new content and an email using it shows it; confirm AJO propagation behaviour matches Decision 10 (AC2).
- **AM7 (security):** with `curl`: no token -> `401`; valid token, user without write -> `403`; disallowed `Origin` -> `403`; site off the allowlist -> `403`; search page source, Network responses and DevTools storage for the client secret and access token (none) (AC6).
- **AM8 (rotation):** add a second client secret in Developer Console, `wrangler secret put AJO_CLIENT_SECRET` with the new value, sync again with no code change, delete the old secret in Console (AC6).
- **AM9 (apps menu and documentation):** the card at `https://da.live/apps#/jazhou-adobe/ew-extensions` opens the app; a reviewer follows `providers/ajo/README.md` from a clean checkout to a working local sync (AC4).

## 13. Acceptance-criteria traceability (ticket #28)

Labels A1 to A7 are #28's seven acceptance criteria in the order the ticket lists them.

| # | Acceptance criterion (#28) | Automated proof | Manual / review verification |
|---|---|---|---|
| A1 | Admin maps EW page/fragment content (by block and field) to the vendor's content objects and saves the mapping per site | AJ5, AJ6, AJ14 (targets, kinds, formats), IN1, IN10, UA1-UA5, AE1, AE2, plus #27's EX/MP/UI suites unchanged | **AM1**, **AM2**, LS2 |
| A2 | Content pushes on demand, and the worker re-syncs mapped pages whose published version changed (polled); the app shows last sync time and per-item errors | AJ7-AJ13, AJ15-AJ20 (push, publish, guards, errors, pacing, non-destructive), IN2-IN9 (engine, polled re-sync, per-item errors, recovery), UA6/UA7, AE1, AE3-AE6, SA2, SA4 | **AM1** (Sync now), **AM3** (publish then polled re-sync, latency recorded), **AM4** (per-item errors), **AM6** (draft versus live), LS3-LS5 |
| A3 | Added inside the existing `marketing-automation-sync` folder as a new provider; no changes needed in the shell beyond registering it | UR-A1 (footprint rule on the real diff), UR-A2, VC1-VC8 (V1 suite on AJO), IN7 (engine vendor-agnostic with AJO registered), IN10 | Review of the PR diff against the registration-point list in Build Analysis 5 |
| A4 | Extension README documents this vendor's setup (credentials, site config keys) | UR-A3 (provider README names every secret/variable, states no site config is read; extension README row) | **AM9** (clean-checkout walk-through), review; OQ 12 on the "site config keys" reading |
| A5 | Works in EW with `ref=local` and with a branch ref | AE1-AE9 (page at `localhost:3000` against a local worker), SA1-SA4; origin handling covered by the template's UC tests | **AM1** (`ref=local`), **AM5** (branch ref against the deployed worker; observed `Origin` recorded), **AM0** |
| A6 | Vendor credentials live only in this extension's worker (from the shared template); the browser never receives them; unauthenticated calls are rejected | AJ1-AJ4, AJ17, AJ21, SEC1-SEC9 (route enumeration, canary property test, SSRF/path inputs, no user token to Adobe hosts), UA8, AE7-AE9, SA1, SA3, UR-A4 | **AM0** (`curl` 401), **AM7** (security checks incl. page-source and storage search), **AM8** (rotation); review that AJO secrets appear only in worker config |
| A7 | Core logic covered by unit tests; lint and CI green | All worker and app unit tiers above (AF, AJ, IN, SEC, UA), CI jobs `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` (UR-A5) | Review: CI green on a PR; deliberately break a guard on a scratch branch (drop the syntax guard, send a write without `If-Match`, drop an auth check on one route) and see AJ15 / AJ10 / SEC1 fail |

Every acceptance criterion on #28 maps to at least one automated test or a numbered manual verification step above.

## 14. Open questions for the owner

1. **AJO access (R1).** Is there an AJO org and a development sandbox I can use (or that the owner will provision), and who creates the Developer Console credential and product profile? Without one, the module is built against the fake only, AM0-AM9 and LS1-LS7 are deferred, and Decisions 9, 13, 14 stay unproven.
2. **Which targets matter first.** Both kinds (visual and expression) in #28 as specified, or visual fragments only first? The expression kind depends on spike AS1 (can `subType` be read back). Any AJO "content template" use case wanted instead?
3. **Sandbox model.** One sandbox per worker deployment (this spec), or several sandboxes (for example stage and production) selectable per binding? The latter needs a new mapping field and so a shell change. Is "one deployment per sandbox" acceptable?
4. **Draft versus live default.** Confirm "write only, publish only when the binding opts in" (this spec). If AS2 shows Outcome B (writes change live content), is "refuse to write to Live fragments unless publishing is enabled" the right fallback, or should #28 target Draft fragments only?
5. **Blast radius of publish.** Publishing updates every live journey and campaign that references the fragment (and a Read Audience journey picks it up on its next run). Is an opt-in per-binding switch enough, or should publishing also require a second confirmation or an admin-only setting?
6. **Personalization syntax.** Reject `{{` and `{%` in synced content (this spec), or offer a deliberate pass-through (authors write AJO personalization into EW pages) or an escaping mode once AS8 shows how? Pass-through lets page authors execute expressions against customer profiles.
7. **Overwrite policy.** One-way, last write wins, no drift detection when someone edits the fragment in AJO. Acceptable? And for UI-authored visual fragments: may EW overwrite them, or only API-managed (`external`-origin) ones if AS5 shows the designer conflict?
8. **Secrets for unused vendors.** If `secrets.required` lists all vendors' secrets, a Marketo-only deployment must set AJO placeholders. Should #27's worker config decide the required list from a "vendors enabled" variable (recommended), or keep one required list?
9. **Interface proposals P1-P4.** Accept them as small additive amendments to #27's contract (approval label, `maxValueBytes`, list `note`, open `vendorState` vocabulary), or keep the fallbacks (generic UI labels, push-time errors)?
10. **Template amendments.** AJO needs R-T1, R-T2, R-T5 (not R-T3) from #27's list. Same decision as #27 Q5: extend #2 first or build fallbacks?
11. **Rate and budget.** No documented rate limit or quota for the Content API was found. Accept the shared conservative pacing (2 concurrent, 5 per second, per-tick and per-day budgets) until AS6 measures real behaviour, or does Adobe provide a figure?
12. **AC4 wording.** "Site config keys": this spec reads none (all settings are worker variables and secrets). Is documenting the worker keys and stating "no site configuration is read" the intended meaning, or should the provider read per-site settings (for example the target sandbox) from the EW site config?
13. **Polling interval and sizes.** Same 5-minute poll as #27 (OQ 8 there) for AJO? Use the smaller documented size limits (100 KB visual, 200 KB expression) until AS7 settles the 700 KB statement?
14. **Policy item (carry-over).** Confirm the Adobe outside-activity/IP position before a worker holding an AJO credential (customer-grade, able to change customer communications) runs under a personal Cloudflare account or is shared (#27 R1, #1 R1).
