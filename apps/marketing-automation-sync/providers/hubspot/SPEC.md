# Spec: Marketing Automation Sync: HubSpot (provider `hubspot`, custom module fields)

Ticket: jazhou-adobe/ew-extensions#31 (this spec: #69). #31 is blocked by #27 (extension shell, vendor interface, first provider Marketo; spec in `apps/marketing-automation-sync/SPEC.md`), which is itself blocked by #1 (repo scaffold, spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template, spec in `shared/worker-template/SPEC.md`). The sibling provider spec for Adobe Journey Optimizer (`apps/marketing-automation-sync/providers/ajo/SPEC.md`, #66) was read for conventions only; this spec does not depend on it.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as #1, #2, #27): **[VERIFIED]** = read in a primary source (URL given) on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision, a live-account check, or an answer from HubSpot.

Vocabulary follows #1, #2 and #27: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *source page*, *field*, *target*, *slot*, *binding*, *mapping*, *sync*, *re-sync*, *descriptor*, *V1 contract suite*, *fake vendor* are as defined in #27. HubSpot vocabulary used here: *module* = a reusable HubSpot CMS component (a folder ending `.module` in HubSpot's developer file system) made of a field definition file (`fields.json`), an HTML+HubL template (`module.html`) and a settings file (`meta.json`) [VERIFIED: https://developers.hubspot.com/docs/cms/start-building/building-blocks/modules/overview and https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/guide]; *module field* = one entry of `fields.json` (name, type, `default`); *default value* = the field's `default`; *module instance* = one use of a module in a template, page or email, which can override the defaults [VERIFIED: modules overview, "Module vs module instance"]; *global module* = a module whose `meta.json` sets `global: true`, so that all instances share the same content [VERIFIED: https://developers.hubspot.com/docs/cms/reference/modules/configuration, "Making a module global"]; *environment* = `draft` (unpublished) or `published` (live) in the Source Code API [VERIFIED: source-code guide]; *static token* = the access token of a HubSpot developer-platform app that uses static auth and is installed in one account [VERIFIED: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview].

This spec stays consistent with #27's provider interface (descriptor, `connect`, `listTargets`, `describeTarget`, `push`, normalised error taxonomy, V1 contract suite, fake vendor) and does **not** redesign the shell. Everything #27 fixed (mapping document, field addressing, extraction, formats, storage, sync engine, status, lease, pacing, authorisation, routes, folder layout, tooling, template amendments R-T1..R-T5) is reused by reference. Only HubSpot-specific decisions are made here. Where HubSpot does not fit the interface cleanly the spec says so (Decision 3, Build Analysis 4) and proposes the smallest amendment together with an in-module fallback.

Primary sources read (2026-11-16): [Source Code API guide](https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/guide) and its endpoint pages ([create or update a file](https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/update-source-code-file), [retrieve file metadata](https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/get-file-metadata), [download a file](https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/get-source-code-file), [validate](https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/validate-source-code-file)); [Modules overview](https://developers.hubspot.com/docs/cms/start-building/building-blocks/modules/overview); [Configuring a module](https://developers.hubspot.com/docs/cms/reference/modules/configuration); [Global content](https://developers.hubspot.com/docs/cms/start-building/building-blocks/global-content); [Module and theme fields](https://developers.hubspot.com/docs/cms/reference/fields/module-theme-fields) and [fields overview](https://developers.hubspot.com/docs/cms/reference/fields/overview); [API usage guidelines and limits](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines); [Authentication overview](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview), [Scopes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes) and [Manage apps](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot); [Account types](https://developers.hubspot.com/docs/getting-started/account-types); [Platform and API versioning](https://developers.hubspot.com/docs/developer-tooling/platform/versioning); [Account information API](https://developers.hubspot.com/docs/api-reference/latest/account/account-information/guide); [CMS CLI commands](https://developers.hubspot.com/docs/developer-tooling/local-development/hubspot-cli/commands/cms-commands); alternatives considered: [Pages API guide](https://developers.hubspot.com/docs/api-reference/latest/cms/pages/guide), [publish a landing page draft](https://developers.hubspot.com/docs/api-reference/latest/cms/pages/landing-pages/drafts/publish-landing-page-draft), [Marketing emails guide](https://developers.hubspot.com/docs/api-reference/latest/marketing/marketing-emails/guide), [HubDB table publish](https://developers.hubspot.com/docs/api-reference/latest/cms/hubdb/tables/publish-table-draft); comparable product: [Contentful's HubSpot app (marketplace page)](https://www.contentful.com/marketplace/hubspot/) and [announcement](https://www.contentful.com/blog/new-apps-integrations-marketplace/). Upstream `adobe-rnd/ew-extensions` has no `hubspot` reference (`gh search code hubspot --repo adobe-rnd/ew-extensions` returned no hits, 2026-11-16) and no worker code; prior art is #27's.

---

## Problem Statement

A team that runs its campaign copy in Experience Workspace (EW) and builds its emails and pages in **HubSpot** writes the same headline, body copy, call-to-action link and image URL twice: once as an EW page or fragment, once inside a HubSpot **custom module** (the reusable, field-driven component that HubSpot emails and pages are assembled from). Every copy fix is repeated by hand and the two copies drift. #27 gives EW a vendor-neutral mapping shell plus Marketo; HubSpot is not available in it. Contentful ships exactly this for HubSpot: map entry fields to fields of custom modules, with content updates "automatically synced to HubSpot" [VERIFIED: https://www.contentful.com/blog/new-apps-integrations-marketplace/ and https://www.contentful.com/marketplace/hubspot/ ("syncing Contentful entry content to custom email modules")]. EW users have nothing comparable.

Six things make HubSpot different from Marketo, the vendor the shell was built around:

1. **No named-token API; the writable thing is a field default inside a source file.** HubSpot has no "set module field" endpoint. A module's field definitions and their default values live in the module's `fields.json`, a file in the HubSpot developer file system, which is read and written through the Source Code API as whole files (multipart upload) [VERIFIED: source-code guide]. Updating one field is a read-modify-write of the whole file; the rest of the file (labels, validation, layout, other fields) must survive untouched.
2. **What a default value changes is subtle.** The documentation says that for normal modules "the content of each instance of a module in a page, email or template is independent" and that defaults "can also be overridden at the template level" [VERIFIED: configuring-a-module page; modules overview]. It does not say which instances pick up a changed default. A module default reaches coded-template usages that do not override it, instances added afterwards, and (by definition) all instances of a *global* module; instances already placed in a page or email with their own saved values most likely keep them [ASSUMPTION; **spike HS1**]. The product must tell admins this instead of promising more than HubSpot does.
3. **Draft and live are environments of a file, and publishing a file clears its draft.** Uploading to `published` "is equivalent to pressing the Publish button in the Design Manager. As such, whatever is currently in `draft` will be cleared." [VERIFIED: source-code guide]. A naive publish would publish, or destroy, somebody else's unpublished edit. Writing to `draft` is the safe default; publishing must check what else is in the draft.
4. **Developer-owned files.** Many teams keep modules in git and deploy with the HubSpot CLI, which overwrites the file system on upload [VERIFIED: CLI upload "will be live immediately", `--clean` flag; cms-commands page]. A sync that edits `fields.json` defaults and a deploy that restores them will fight each other. The README must say so and the module must never change anything except default values.
5. **Auth is a single-account static token, with scope and plan gates.** Marketo used client credentials; HubSpot's single-account auth is a static access token from an app installed in one account [VERIFIED: authentication overview]. The Source Code API needs the `content` scope, which is "Available to CMS Hub Professional or Enterprise, or Marketing Hub Professional or Enterprise accounts only" [VERIFIED: scopes page; spec header lists `cms: STARTER` as the API tier, so the two statements are not obviously consistent, [OPEN] spike HS5]. The token must never reach the browser, so #2's worker is mandatory.
6. **No account is available to the author of this spec.** Free developer test accounts and CMS sandboxes exist [VERIFIED: account-types page], but none was used; every behaviour in this spec comes from documentation. Several behaviours the documentation leaves open (HS1 to HS8, Build Analysis 7) are explicit spikes, and the design branches on their outcome instead of guessing.

The maintainer needs HubSpot added **as one provider module**, inside the existing `marketing-automation-sync` folder, without changing the shell, so campaign copy is authored once in EW and reaches HubSpot module fields with draft-first safety.

## Solution

Add the HubSpot provider to `marketing-automation-sync`: one worker module under `providers/hubspot/` registered in the shell's vendor registry, plus its README, fake HubSpot, tests and a descriptor. No shell logic changes.

What the admin sees, unchanged from #27: in the existing app they choose vendor **HubSpot**, choose a **target** from a searchable list of the account's custom modules, choose a module field (a **slot**) for each EW field they map, preview exactly what would be written, save the mapping for the site, press **Sync now**, and watch the status view show last sync time and per-item errors. After an author edits and publishes the EW page, the worker's poll notices the changed published version and re-syncs the module within the polling interval.

What is specific to HubSpot:

- **Targets are existing custom modules** under folders the maintainer configures (for example the theme's modules folder). The module never creates, deletes, renames or moves modules or files (the interface has no such operation).
- **Slots are existing module fields**, addressed by field name (a dotted path through field groups). The module never adds a field: a new field without matching template code would render nothing. Supported field types: text, rich text, URL, link and image. Other types and repeating groups are not offered.
- **A sync changes only default values** inside `fields.json`; every other property of the file and every other file of the module is carried through unchanged. Many slots of one binding are written with a single read-modify-write.
- **Draft first.** A sync writes the module's **draft**; HubSpot shows it as unpublished changes in the Design Manager and live content is unchanged. Publishing happens only when the binding's `approve` option is on (the UI calls it "Publish" for this vendor), and only if the draft contains nothing but the synced values.
- **Personalization syntax is refused, not passed through.** Values containing `{{`, `{%` or `{#` are rejected per slot, so page content cannot become HubL or personalization tokens inside emails.
- **Auth and secrets stay in the worker.** The static access token is a Cloudflare secret; the account id check, module folders and API host are non-secret worker variables; every route is authenticated exactly as #27 specifies.

## User Stories

Admin (site or campaign admin who sets up the mapping):

1. As an admin, I want to choose HubSpot as the vendor for a binding, so that I can keep HubSpot module content in sync with EW pages.
2. As an admin, I want to search the HubSpot custom modules in my configured folders by name from the app, so that I never copy module paths around.
3. As an admin, I want to see, once I select a module, whether it is a global module and which content types it is for (email, page, and so on), so that I pick the module that email or page authors actually use.
4. As an admin, I want to see the list of fields of the chosen module with their types, so that I map to real fields instead of guessing names.
5. As an admin, I want to map an EW heading cell to a text field, a body block to a rich text field, a CTA link to a URL or link field and a picture to an image field, so that each HubSpot field receives the right shape.
6. As an admin, I want the app to disable format choices that the chosen field cannot take (for example HTML into a plain text field), so that I find mistakes before saving.
7. As an admin, I want fields inside field groups listed with their group path, so that grouped modules are usable.
8. As an admin, I want a clear note that repeating field groups and unsupported field types are not offered, so that I know why a field is missing.
9. As an admin, I want a preview that shows the exact values and the HubSpot operations that would run (read, draft write, optional publish) without changing anything, so that I can trust the first sync.
10. As an admin, I want to save the mapping per site and be told if a colleague saved first (all #27 behaviour), so that nobody's work is silently lost.
11. As an admin, I want a per-binding "Publish" option that is off by default, so that nothing goes live in HubSpot without someone reviewing it in the Design Manager.
12. As an admin, I want that option to tell me what it does (publishes the module's changed field defaults), so that I choose it knowingly.
13. As an admin, I want a binding to refuse to publish when the module has other unpublished edits, and to say so plainly, so that I never publish a colleague's half-finished change.
14. As an admin, I want a README note on which usages of a module pick up a changed default and which keep their own values, so that I know what "synced" means in HubSpot.
15. As an admin, I want the "Test connection" check to say "connected" or a plain reason (token rejected, scope missing, wrong account, module folder not found), so that I can diagnose setup without reading logs.
16. As an admin, I want the README to tell me how to create the HubSpot app with static auth, which scope to grant and where to copy the token, so that setup needs no guesswork.
17. As an admin, I want to disable a binding without deleting it, so that I can pause syncing for a campaign.
18. As an admin, I want to export and import the mapping as JSON, so that I can back it up or reuse it on another site.

Campaign author (edits and publishes in EW):

19. As an author, I want my published edits to reach the HubSpot module without me doing anything, so that I do not repeat the copy there.
20. As an author, I want to see when a page was last synced and whether it succeeded, so that I know the module holds my latest copy.
21. As an author, I want to see that a sync landed as a *draft* in HubSpot and needs publishing, so that I know whether the content is live there.
22. As an author, I want a Sync now button for a page, so that I can push right after publishing instead of waiting for the next poll.
23. As an author, I want an unpublished or deleted source page to show "source unavailable" rather than blank out the module, so that a mistake does not wipe a live email.
24. As an author, I want a missing or empty field to be reported per slot with the field named, so that I know which edit broke the mapping.
25. As an author, I want a field that HubSpot rejects to fail alone while the other fields of the module still sync, so that one bad value does not block the campaign.

Maintainer / operator:

26. As the maintainer, I want the HubSpot access token only in the worker's secret store, so that no page, response, log line or database row can leak it.
27. As the maintainer, I want every worker route (including HubSpot's) to reject unauthenticated callers before doing anything, so that nobody can read mappings or use the HubSpot token.
28. As the maintainer, I want the worker to call only the HubSpot API host and only paths built from validated module paths inside the configured folders, so that user input cannot cause server-side request forgery or reach other files in the account.
29. As the maintainer, I want the provider to touch only the `fields.json` of the target module and only the `default` values of the mapped fields, so that templates, styles, settings and other modules are never modified.
30. As the maintainer, I want the provider to never delete or clear anything in HubSpot, so that automation cannot destroy a theme.
31. As the maintainer, I want a repeated sync with unchanged content to make no HubSpot writes, so that polling costs almost no calls.
32. As the maintainer, I want one read-modify-write per module regardless of the number of mapped fields, so that large modules do not multiply calls.
33. As the maintainer, I want writes to detect that the file changed while the sync was running and to re-apply once on the fresh content, so that my sync does not overwrite a developer's concurrent change.
34. As the maintainer, I want HubSpot throttling and transient errors handled by the worker's retry logic and the shell's pacing, so that a run recovers by itself and stays under the account's limits.
35. As the maintainer, I want a check that the token belongs to the configured HubSpot account id, so that a production token is never used against a test configuration or the reverse.
36. As the maintainer, I want to rotate the token with one command and no code change, so that the recommended six-month rotation is cheap.
37. As the maintainer, I want the README to list every secret and variable of this provider and to state that no EW site configuration is read, so that a new person can enable it alone.
38. As the maintainer, I want adding HubSpot to touch only the provider folder and the named registration points, so that the shell stays vendor-neutral.

Security reviewer:

39. As a security reviewer, I want proof that a canary HubSpot token never appears in any response, header, log line or stored row, even when HubSpot echoes it in an error body, so that "never reaches the browser" is tested.
40. As a security reviewer, I want proof that every route still returns 401 without a token with HubSpot registered, so that adding a vendor cannot open a route.
41. As a security reviewer, I want proof that the user's IMS token is never sent to HubSpot, so that token handling is auditable.
42. As a security reviewer, I want proof that synced values containing HubL or personalization syntax are refused and that HTML is sanitised before reaching HubSpot, so that page content cannot inject code into emails.
43. As a security reviewer, I want proof that module paths with traversal, encoded separators or other characters cannot select another file, so that the provider cannot be used to read or write arbitrary developer-file-system content.

Vendor developer (the owner or an agent working the remaining vendor tickets):

44. As a vendor developer, I want HubSpot to pass the unmodified V1 contract suite, so that the interface is proven to hold for a "write defaults into a source file" vendor.
45. As a vendor developer, I want the interface gaps HubSpot exposed written down with optional amendments and in-module fallbacks, so that the interface improves without surprise for the other vendors.
46. As a vendor developer, I want a fake HubSpot with environments and published/draft semantics in the repo, so that every behaviour above is testable without an account.

## Implementation Decisions

(No file paths of the repo and no code. Layout and shapes are in the Build Analysis. Everything not stated here is as in #27.)

**Product shape and scope**

1. **One provider module, registered, nothing else in the shell.** The HubSpot module lives with its vendor folder (`providers/hubspot/`, worker code under `providers/hubspot/worker/` per #2 Decision 3). Registration = one entry in the shell's vendor registry, the HubSpot secret name in the worker config, the non-secret variables, `.dev.vars.example`, and one row in the extension README's vendor list. No change to mapping, extraction, storage, sync engine, status, UI or routes. This is enforced by a footprint check (Testing, UR-H1), the same delta AJO's spec introduces; whichever provider lands first adds it.
2. **Scope of #31 = HubSpot provider for existing custom modules' field defaults, on-demand and polled sync through the shell, draft-first.** Out: creating modules or fields, editing templates, writing page or email instances, HubDB, blogs, reading content back into EW.
3. **Interface fit (verdict).** HubSpot fits #27's interface with **no breaking change**: one target kind, the `named-slots` model, many slots per `push`, per-slot results, descriptor-driven UI, the taxonomy. Five non-breaking gaps are handled inside the module, each with an optional amendment (Build Analysis 4, proposals HP1-HP5). The fit is better than #27 assumed for HubSpot ("module fields" as named slots is accurate); the surprise is that slots must already exist and that "approve" means "publish the file".
4. **Tenancy.** Single-tenant per worker deployment, like Marketo (#27 Decision 18, OQ 2): one HubSpot account, one token. A deployment that needs a test account and a production account runs one worker per account [OPEN, Open Question 3].
5. **Never destructive.** The module never issues a `DELETE`, never creates a file, never touches any file other than the target module's `fields.json`, and never changes any property of `fields.json` other than `default` values of mapped fields. Upload uses the upsert endpoint only against a path it has just read.
6. **What "synced" means is documented, not promised (spike HS1).** The README explains, with the HS1 results, which usages pick up a changed module default. The spec's recommended, safest targets are global modules and modules used in coded templates without overrides [ASSUMPTION pending HS1]. If HS1 shows that defaults reach no existing usage at all, the owner decides between page/email instance writes (Build Analysis 3, "Alternatives considered") and stopping (Open Question 1); the build does not start before HS1 answers.

**Targets, kinds, slots**

7. **One target kind: `module`.** Target id = the module's path in the developer file system (a folder ending `.module`, for example `my-theme/modules/hero.module`). Slot model `named-slots`; formats `text`, `html`, `url`, `image`. Global modules and non-global modules are the same kind; `describeTarget` returns a note saying "global" and showing the module's allowed content types from `meta.json` (`content_types`, for example EMAIL) [VERIFIED property names: configuring-a-module page; older docs and the CLI call it `host_template_types`/`--content-types`, [OPEN] which spelling the file uses, HS3].
8. **Listing is bounded by configured module roots.** Non-secret variable `HUBSPOT_MODULE_ROOTS` lists the folders (for example the theme's `modules` folder) whose direct children ending `.module` are the offered targets. The module lists a root with the metadata endpoint, which returns a folder's child names [VERIFIED: source-code guide, "Fetching file and folder metadata"]; it filters children by the `.module` suffix, filters by the `query` text (case-insensitive substring of the path), sorts, and pages through the result in the worker with an opaque cursor. Reasons: the documentation does not say how to address the account's root folder [OPEN, HS3], listing recursively would cost one call per sub-folder, and a configured allowlist also limits what an admin can pick or a crafted id can reach. HubSpot's own default modules are read-only and are simply not configured as roots. List items carry `{ id, name, kind }` only (no `updatedAt`, no `status`, no `note`): folder metadata gives names, and the global flag and content types need one `meta.json` read per module, which is deferred to `describeTarget` (under proposal HP3 an optional lazily fetched note could appear in the list).
9. **`describeTarget` reads the module.** It downloads `fields.json` (and `meta.json` for the note) and returns the supported slots: each slot is `{ name, type }` where `name` is the dotted path of field names through non-repeating groups (nesting is allowed to a depth of three [VERIFIED: fields overview]) and `type` is the HubSpot field type (`text`, `richtext`, `url`, `link`, `image`). Omitted, with a count reported in the note: fields of other types (number, boolean, choice, date, colour, CTA, form, and so on), fields inside repeating groups (those with an `occurrence` setting [VERIFIED: fields overview, "occurrence"]), and fields whose name contains characters outside `[A-Za-z0-9_]` (names "cannot contain spaces or special characters" [VERIFIED: fields reference]). The UI uses the reported slot `type` to disable impossible format choices (the convention AJO's spec also uses for expression fragments); the module still enforces it at push.
10. **Format versus field type (module-enforced).** Rows are slot type -> accepted formats and the value written to the field's `default`:

    | HubSpot field type | Accepted formats | Written value |
    |---|---|---|
    | `text` | `text`, `url`, `image` | the string (an `image` value is the absolute URL string) |
    | `richtext` | `html`; also `text`, `url`, `image` (HTML-escaped) | the HTML string |
    | `url` | `url` | the existing `default` object with `href` set to the value, `type` `EXTERNAL`, `content_id` `null` [VERIFIED shape: fields reference, URL field]; refused if the field's `supported_types` is present and excludes `EXTERNAL` |
    | `link` | `url` | the existing `default` object with `url.href` set, `url.type` `EXTERNAL`, `url.content_id` `null`; `open_in_new_tab`, `no_follow` and other properties kept [VERIFIED shape: fields reference, Link field] |
    | `image` | `image` | the existing `default` object with `src` set to the absolute URL; `alt`, `size_type`, `width`, `height`, `loading` and all other properties kept [VERIFIED shape: fields reference, Image field] |

    `html` into a `text`, `url`, `link` or `image` field, `image` into a `url`/`link` field, and anything into an unsupported type are `invalid_value` with fixed messages. Image alt text is not synced in #31 (the shell's `image` format is the absolute `src`); the existing alt stays [OPEN, Open Question 8]. Whether HubSpot accepts an external image URL in an image field's `src`, or requires a File Manager URL, is [OPEN, HS4].
11. **Slots must exist; the module never creates fields.** A slot name that is not in the module's current supported fields is `invalid_value` (fixed message "field not found in module") for that slot only. Marketo's "name a new token and create it on first sync" has no equivalent: a new field needs matching template code to be rendered.

**Value rules**

12. **Personalization/HubL guard.** A value containing `{{`, `{%` or `{#` is rejected before any HubSpot call with `invalid_value` and the fixed message "content contains HubL or personalization syntax", for every format. Rationale: HubSpot module values are rendered by a HubL-based system and emails support personalization tokens [ASSUMPTION on whether *default values* of fields are re-evaluated, HS6]; an EW page is public, author-edited content, and a sync must not be a way to inject template syntax into live emails. The shell's HTML sanitiser (#27 Decision 9) still runs first; this guard is the module's second line. A deliberate pass-through option is Open Question 6.
13. **Size.** The module rejects before writing: a value over the shell's `VALUE_MAX_BYTES` (default 100 KB) is already refused by the shell; the module also refuses a resulting `fields.json` over a configured cap (default 1 MB [ASSUMPTION]; HubSpot's file size limit for source files is not documented in the pages read [OPEN, HS2]). A server-side rejection maps to `invalid_value`. Byte counting is UTF-8 on the serialised value.
14. **Missing and empty are the shell's job** (#27 Decision 10): the module never receives an empty value to write; it also never writes an empty string.

**Write semantics (the central safety decision, gated by spikes HS1-HS2)**

15. **Push = one read-modify-write of `fields.json` for all slots of the binding.** Steps, in order: (a) guards per slot (name shape, syntax, size, type/format), failing slots get their own results; (b) read metadata and content of the file in both environments; the **base** is the draft if a draft exists and differs from the published file, otherwise the published file, so that other people's unpublished edits are the starting point and are preserved; (c) parse as JSON (an unparseable file or a non-array root is `invalid_value` for every slot, fixed message "module fields file is not valid JSON") and locate each slot's field; (d) compute the new defaults per Decision 10; if every valid slot's default already equals the base (semantic comparison of the parsed values, not bytes), the push is a no-op success with no write; (e) serialise the file preserving key order of the original, two-space indentation and a trailing newline [ASSUMPTION: HubSpot does not care about formatting; the byte diff may include whitespace noise on the first sync, documented]; (f) validate the result with the validate endpoint in the draft environment (`400` returns the list of errors [VERIFIED: source-code guide, "Validating file contents"]); (g) re-check that the draft's metadata hash is still the one read in (b); if it moved, re-read and re-apply once, and a second change is a retryable `vendor_unavailable` with the message "module changed while syncing"; (h) upload the new bytes to the **draft** environment (multipart upload, field `file`, upsert [VERIFIED: update-a-file page]); (i) if `approve` is on, publish per Decision 17.
16. **Per-slot isolation.** A guard or type failure fails only its slot. If step (f) rejects the combined document, the module re-validates one slot at a time on top of the base, applies the slots that pass and fails the others with `invalid_value`; the number of extra validate calls is bounded by the mapping's per-binding rule cap (50). The final `push` result names each slot. A failure of the single upload call fails all slots that were included in it, with the same error code.
17. **Publish step (opt-in).** With `approve` on, the module decides **before** step (h) of Decision 15 whether publishing is safe, and publishes **only if the draft contains nothing but this sync's changes**: it computes the published file with the same slot values applied; if that equals the new draft (semantic comparison), step (h) uploads those bytes to the `draft` environment as usual and the module then uploads the same bytes to the `published` environment, which publishes the file and clears its draft [VERIFIED behaviour: source-code guide]. Otherwise nothing at all is written (no draft write, no publish) and every slot of the binding fails with `invalid_value` and the fixed message "module has other unpublished changes; publish or discard them in HubSpot, or turn Publish off"; the person's draft is left exactly as it was. After a publish the module reads the published metadata to confirm the new hash. Result `vendorState: published`; with `approve` off, `vendorState: draft`. If the module has no published version at all (never published), `approve` is refused with `invalid_value` [ASSUMPTION about the environment semantics of unpublished modules; HS2].
18. **Preserve everything the module does not own.** The upload contains the whole file as read with only the mapped fields' `default` values replaced: field order, labels, help text, `visibility`, validation, display options, groups, `id` properties, unknown properties and the `alias_mapping` are carried through. `module.html`, `meta.json`, CSS, JS and all other files are never written. Whether HubSpot rewrites the file on save (adding ids, reformatting) is [OPEN, HS4]; if it does, the equality test in Decision 15(d) is semantic so a rewrite never causes endless writes.
19. **Concurrency inside the worker.** Two bindings (on one site or two) may target the same module with different slots. The hash re-check of Decision 15(g) makes the second writer re-read and re-apply, so both sets of slots end up in the file; combined with the shell's per-site lease this is enough for the worker's own writers. A human or CLI deploy writing in the window between the re-check and the upload is not detectable (the API has no conditional write [ASSUMPTION: none documented in the pages read]); the window is a few hundred milliseconds and the README says so.

**Auth, transport, errors**

20. **Auth: static access token, header transport.** The module sends `Authorization: Bearer <token>` on every call, with the token from the worker secret `HUBSPOT_ACCESS_TOKEN`. The token comes from a HubSpot app that uses static auth and `private` distribution, installed in one account, with the `content` scope [VERIFIED: authentication overview and manage-apps pages; scope: scopes page and the endpoint pages, `oauth2: content`]. A legacy private app's token is expected to work the same way (the usage-guidelines page treats both identically) [ASSUMPTION, HS5]. HubSpot recommends rotating a static token every six months [VERIFIED: manage-apps page]; changing the scopes requires reinstalling the app [VERIFIED: same page]. There is no token exchange, no refresh and nothing cached; a `401` is `auth_failed` with no retry loop.
21. **Fixed host and API version.** Production host `api.hubapi.com` [VERIFIED: `servers` in the endpoint definitions]. API version `2026-09`, written as a constant in the module: paths are `/cms/source-code/2026-09/{environment}/content/{path}`, `/metadata/{path}` and `/validate/{path}` [VERIFIED: source-code guide]. HubSpot releases a version every March and September and marks a version unsupported 18 months after its release (2026-09 until about March 2028, [ASSUMPTION: derived from the versioning page]) [VERIFIED: versioning page]; the README documents the bump procedure and the fake mirrors the pinned version. Legacy `/cms/v3/source-code/...` paths exist but are not used [VERIFIED: referenced as `legacy` in the API docs index]. An EU-hosted account may use a regional host (`api-eu1.hubapi.com` exists [VERIFIED weakly: it serves the developer site, 2026-11-16]; whether it is required for EU accounts is [OPEN, HS5]); the host is a non-secret variable restricted to an allowlist of the two known hosts, and a local override exists only under `ALLOW_LOCALHOST`.
22. **Account check.** Non-secret variable `HUBSPOT_PORTAL_ID` (the account id). `connect` calls the account details endpoint (`GET /account-info/2026-09/details`, returns `portalId`, `accountType`, `dataHostingLocation`) and compares [VERIFIED: account-information guide]. A mismatch is `auth_failed` with the fixed message "token belongs to a different HubSpot account". The required scope of that endpoint is not stated on the page read [OPEN, HS5]; if it needs more than `content`, the check is skipped when `HUBSPOT_PORTAL_ID` is unset, and the README lists the extra scope.
23. **Configuration.** Secret: `HUBSPOT_ACCESS_TOKEN`. Non-secret variables: `HUBSPOT_MODULE_ROOTS`, `HUBSPOT_PORTAL_ID`, `HUBSPOT_API_HOST` (default `api.hubapi.com`), `HUBSPOT_MAX_FILE_BYTES`. The browser sends and receives none of these; no route returns the account id or the token; connection checks say only `ok` or a fixed reason.
24. **Validated inputs.** A target id must be a path inside one configured root, made of segments matching `[A-Za-z0-9._-]` (no empty segment, no `.` or `..` segment, no encoded separators, no backslash, no leading slash, total length capped) and ending `.module`; anything else is rejected before any call (`target_not_found`). The environment is a constant chosen by the module, never by callers. Redirects are not followed. Paths containing spaces or other characters, which HubSpot allows, are not supported in #31 and are skipped from listings with a note [OPEN, Open Question 9].
25. **Error classification (module-local; messages fixed; no upstream text to the browser).** HubSpot reports failures with real HTTP statuses and an error body with `category`, `correlationId`, `message` and optional `context` [VERIFIED: error schema in the endpoint definitions; rate-limit body shape with `policyName`, usage page].

    | HubSpot signal | Taxonomy code | Retry |
    |---|---|---|
    | `401` | `auth_failed` | no |
    | `403` (missing scope or permission) | `permission_denied` | no |
    | `404` on the module or its `fields.json` | `target_not_found` | no |
    | `400` from validate or upload | `invalid_value` (after slot isolation, Decision 16) | no |
    | `409` or hash moved twice | re-read and retry once; then `vendor_unavailable` "module changed while syncing" | yes |
    | `429` with `policyName` `DAILY` | `quota_exhausted` | no until next day |
    | `429` otherwise (10-second window) | `rate_limited`, honour `Retry-After` | yes |
    | `5xx`, network error, timeout | `vendor_unavailable` | yes |
    | anything else | `unknown` | no |

    Unlike Marketo, HubSpot reports throttling with HTTP `429`, so #2's proxy retry helper (`429` and `5xx`, `Retry-After`) covers transport retries and **template amendment R-T3 (response classifier hook) is not needed for HubSpot**; R-T2 (dynamic secret redaction, form-body injection) is not needed either because the token is a static secret sent in a header. R-T1, R-T4 and R-T5 apply as for every provider. One new requirement, R-T6, is raised in Build Analysis 6 (multipart bodies through the proxy). `PUT` and `GET` are retried on `5xx` by the helper; the validate `POST` has no side effects and is passed with the template's explicit "safe to retry" flag.
26. **Pacing.** Calls per push are bounded and independent of the number of slots: about 7 for a draft write (draft metadata, published metadata, draft content, published content, validate, hash re-check, upload) and about 9 with publish (upload to published and a confirming metadata read); slot isolation adds at most one validate per failing slot. The module obeys the shell's pacing (at most 2 concurrent, 5 per second, per-tick budget, per-day counter). HubSpot's usage page lists the Source Code API as exempt from the 10-second and daily limits, while warning that heavy use can still return `5xx`, to be handled like `429` [VERIFIED: usage guidelines, "Exemptions"]; the shell's conservative pacing therefore applies unchanged and the daily-budget default needs no HubSpot-specific value. Steady state is hash-gated by the shell and costs nothing.

**Documentation and registration**

27. **README (AC4).** `providers/hubspot/README.md` documents: what the provider does, draft-first and no-delete behaviour, and the "what picks up a changed default" findings from HS1; creating a HubSpot developer project with a static-auth, privately distributed app with the `content` scope, installing it in the account and copying the token (and the legacy private app alternative, if HS5 confirms it); the plan or account requirement for the scope; the worker secret and variables with the exact `wrangler` commands (`HUBSPOT_ACCESS_TOKEN` via `wrangler secret put`, variables in the worker config); how to find the account id; how to choose the module folders; the supported field types and formats; the statement that HubSpot reads **no EW site configuration** (all settings are worker variables and secrets, #27 Decision 3), which is this ticket's "site config keys"; token rotation; `ref=local` and branch-ref notes; the caveat about git/CLI deploys overwriting defaults (Problem 4); and the caveats of Decisions 12, 17 and 24. The extension README's vendor list gets a HubSpot row linking to it.

## Testing Decisions

**What makes a good test here.** As in #27: assert external behaviour only. Given an HTTP request or a cron tick and a fake outside world (fake HubSpot, fake published site, fake DA admin, fake IMS, fake clock, in-memory store), assert the response, what the fake HubSpot received (operations, order, count, environments, bytes of every uploaded file), what the status routes say, and what was logged. Never assert internal helper names or how many internal functions ran. Five properties are asserted as negatives across every HubSpot path: (1) a canary token never appears in any response, header, log line or stored row; (2) no HubSpot call happens before authentication and authorisation succeed; (3) nothing is ever deleted, and no file other than the target module's `fields.json` is ever written; (4) in an uploaded `fields.json` nothing differs from the base except the mapped fields' `default` values; (5) the `published` environment is written only when `approve` is on and the draft held nothing else.

**Proposed seams (recorded instead of asked): no new seams.** The ideal number is one; #27 already provides the right ones and HubSpot is, after AJO, another test that they are vendor-independent.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| V1 (primary) | Vendor contract suite: takes a vendor module and a fake of that vendor's API | reused from #27 | HubSpot module (VC1-VC8) plus HubSpot-specific cases | Fake HubSpot HTTP handler (stateful developer file system with `draft` and `published` environments per path, content hashes, multipart upload, validate, scripted errors); the suite calls only the module's public interface |
| W1 | Worker HTTP boundary `worker.fetch` | reused from #2/#27 | Routes with `vendor=hubspot`: targets, describe, test, preview, mapping, sync, status; security tests | Constructed `Request`; env factory with a canary HubSpot token; fake IMS, fake DA, fake site, fake HubSpot as scripted fetch handlers |
| R1 | Worker tick `worker.scheduled` on a fake clock | reused from #27 | Polled re-sync of HubSpot bindings, retries, mixed-vendor sites | Same fakes plus a controllable clock |
| S1 / S2 / S3 / W2 / R2 | Entry page + SDK stub; render module; repo convention check; real workers runtime; store contract | reused from #1, #2, #27 | Playwright e2e with HubSpot selected; WTR cases for descriptor-driven options; footprint check (UR-H1); smoke (real multipart over HTTP); no change | As #27 |

A *delta*, not a seam: the S3 convention check's **provider-footprint rule** (a change that adds a provider may touch only that provider's folder and the named registration points). If the AJO ticket lands first the rule exists and HubSpot reuses it; otherwise HubSpot adds it.

**Modules tested:** the HubSpot module (config and account check, request construction, listing by roots, describe and type mapping, field defaults per type, read-modify-write with environments, publish rule, concurrency re-check, value guards, error classification, pacing integration), the fake HubSpot itself (self-tests), the shell with HubSpot registered (mixed-vendor mapping, vendor-agnostic engine), the footprint rule, README presence.

**Prior art:** #27's seams and tests (V1 suite, fake vendor, fake Marketo, SE canary property tests, SY engine tests); #2's test kit (canary secrets, fake IMS, env factory); AJO spec (#66) conventions for per-provider fakes and cases; the injected `fetchImpl`/`storage`/`now` pattern in upstream `tools/brand-visibility/session-auth.js` [VERIFIED by #2 and #27].

## Out of Scope

- Creating, deleting, renaming, moving, cloning or archiving modules, fields or any file; editing `module.html`, `meta.json`, CSS, JS, templates or themes; adding fields to a module.
- Writing module **instances** in pages, landing pages, blog posts or marketing emails (the Pages and Marketing Emails APIs with their own draft and publish flows), and HubDB rows. Considered and recorded as alternatives (Build Analysis 3); a follow-up if HS1 demands it (Open Question 1).
- Field types other than text, rich text, URL, link and image; repeating field groups; fields whose names contain characters outside `[A-Za-z0-9_]`; image alt text; module folders with spaces or special characters in paths (Decisions 9, 10, 24).
- Reading content back from HubSpot into EW; drift detection when someone edits the module in HubSpot (last EW write wins on the next changed sync, apart from the safe-write checks of Decision 15 and 19; README says so).
- Multi-account or per-site HubSpot credentials entered in the app (#27 Decision 18 / OQ 2); OAuth for marketplace distribution (the static token covers a single account [VERIFIED]).
- A HubSpot Marketplace listing for this integration; HubSpot webhooks as a trigger.
- Any change to the mapping UI, storage, sync engine, authorisation, extraction or the shell's other behaviour; template amendments beyond R-T1, R-T4, R-T5 and the new R-T6.
- CI-driven worker deployment and Cloudflare or HubSpot credentials in CI (#2 Decision 15).
- The Adobe outside-activity/IP policy decision for running infrastructure that holds a HubSpot token on a personal Cloudflare account (flagged in #27 R1; owned by #1 R1).

## Further Notes

- **How Contentful does it.** Contentful's HubSpot app maps "structured entry content directly to custom modules in HubSpot" and keeps them synced; its marketplace page says content is synced "to custom email modules", lets editors "rename HubSpot modules during setup", and requires "access to generate a private app in HubSpot" [VERIFIED: the two Contentful pages]. How it writes to HubSpot (module defaults via the Source Code API, or something else) is not stated [OPEN]; the phrase "rename HubSpot modules" suggests it may create modules, which this spec deliberately does not (Decision 11).
- **Private apps are now "legacy".** HubSpot's current guidance for single-account integrations is a developer-platform app with static auth; legacy private apps are still supported and have the same rate limits [VERIFIED: usage-guidelines page]. The README documents the current path first.
- **Static token limits.** A static-auth app can be installed in one standard account at a time and in up to 10 developer test accounts [VERIFIED: manage-apps page], so the same token configuration can be exercised against a free developer test account before a real account.
- **Source Code API rate behaviour.** "Certain source code API endpoints" are exempt from the 10-second and daily limits and are not logged in HubSpot's API usage view; log outbound calls externally if an audit trail is needed [VERIFIED: usage guidelines, "Exemptions"]. The worker's own structured logs (no bodies) serve that purpose.
- **Download response shape.** The 2026-09 download endpoint page declares no success response schema; the guide says to send `Accept: application/octet-stream` and describes a binary response [VERIFIED: guide and endpoint page]. The module treats the body as UTF-8 text and the fake mirrors that.
- **Date-versioned APIs.** HubSpot moved to date-based versions on 2026-03-30; the 2026-09 version is the current one in the docs and `2027-03-beta` also appears [VERIFIED: versioning page, docs index].
- **Developer test accounts expire** after 90 days without API calls and have limits on content counts [VERIFIED: account-types page]; the live sandbox checks are meant to be run often enough, or the account renewed.
- **This SPEC.md** is a planning artefact; keep or delete it when the provider is built, as decided for #1's spec [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

```
 EW (da.live)  ── iframe ──►  EW app "Marketing Automation Sync"     (unchanged from #27)
                                │  Authorization: Bearer <IMS>
                                ▼
 ┌──────────────── Worker (Cloudflare, from shared/worker-template; #27 shell) ────────────────────────────────────┐
 │ fetch(): origin gate → IMS auth → site allowlist + DA permission → routes (/vendors, /targets, /mapping, /sync…) │
 │ scheduled() every 5 min: lease → due bindings → conditional GET live .plain.html → extract → hash → changed     │
 │                          slots → vendor registry → providers/hubspot module.push(…) → state                    │
 │ vendor registry: marketo · ajo · hubspot (this ticket) · fake-vendor (test only)                                 │
 │ Secret: HUBSPOT_ACCESS_TOKEN        Vars: HUBSPOT_MODULE_ROOTS, HUBSPOT_PORTAL_ID, HUBSPOT_API_HOST, …          │
 └───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                             │ Bearer <static token>, fixed host
                                                             ▼
   https://api.hubapi.com/cms/source-code/2026-09/{draft|published}/{metadata|content|validate}/{module path}/fields.json
   https://api.hubapi.com/account-info/2026-09/details                                      (account check, connect only)
```

| Concern | App (browser) | Worker shell (#27) | HubSpot module (this ticket) |
|---|---|---|---|
| HubSpot token | never | passes env to module; redaction of the secret | only consumer; header on every call |
| Module list, field list, formats | renders from descriptor and `describeTarget` | routes, paging | roots listing, `fields.json` parsing, type mapping |
| Field extraction, hashing, change detection, retry, status | UI only | all of it | none |
| Draft vs publish, preservation, concurrency check, error mapping | shows `vendorState` | stores it | all of it |
| Auth of callers, site allowlist, DA permission | sends SDK token | all of it | none |

The module has no state of its own: no cache beyond a short in-isolate list cache (60 s [ASSUMPTION]), no database rows, no token cache (the token is static).

## 2. EW integration points

Unchanged from #27: fullscreen app (an `apps` sheet row), no library plugin, SDK `token`/`context`/`actions.daFetch`, `ref=local` against a local worker at `http://localhost:8787` with the local D1, branch ref against the deployed worker. HubSpot adds only:

- **Extension README row** for the vendor list and the provider README (Decision 27).
- **Local development**: with `ref=local` the module talks either to a **local fake HubSpot** (default for tests and `npm run dev` with `ALLOW_LOCALHOST`) or to a real HubSpot developer test account with a token in `.dev.vars` (never committed). The API host override exists only under `ALLOW_LOCALHOST`.
- **No EW site configuration is read.** All HubSpot settings are worker variables and the secret.

## 3. External APIs and auth flows

| API | Use | Auth | Source / status |
|---|---|---|---|
| `GET /cms/source-code/2026-09/{environment}/metadata/{path}` (`Accept: application/json`) -> `{ id, name, folder, children?, hash, createdAt, updatedAt, archivedAt? }`; optional `properties` filter | list a root's children; read a file's `hash`/`updatedAt` for change detection and the concurrency re-check | `Bearer` static token, scope `content` | [VERIFIED] https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/get-file-metadata (schema `AssetFileMetadata`); the folder `children` field is names only [VERIFIED: guide]; addressing the account's root is [OPEN, HS3] |
| `GET /cms/source-code/2026-09/{environment}/content/{path}` (`Accept: application/octet-stream`) | download `fields.json`, `meta.json` | same | [VERIFIED] guide and https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/get-source-code-file ; success schema not declared on the endpoint page; behaviour of `draft` when no draft exists [OPEN, HS2] |
| `PUT /cms/source-code/2026-09/{environment}/content/{path}`, `multipart/form-data`, binary field `file` -> `AssetFileMetadata` | upsert `fields.json` in `draft`; publish by uploading to `published` (clears the draft of that file) | same | [VERIFIED] https://developers.hubspot.com/docs/api-reference/latest/cms/source-code/update-source-code-file and the guide ("uploading to `published` is equivalent to pressing the Publish button... whatever is currently in `draft` will be cleared"); supported file types include `json` [VERIFIED: guide]; whether publish clears the draft of the whole module or one file [OPEN, HS2] |
| `POST /cms/source-code/2026-09/{environment}/validate/{path}`, `multipart/form-data`, field `file` | validate the new `fields.json` before upload; `400` with the list of errors | same | [VERIFIED] guide, "Validating file contents"; error body shape per slot [OPEN, HS2] |
| `GET /account-info/2026-09/details` -> `{ portalId, accountType, timeZone, uiDomain, dataHostingLocation, ... }` | account check at `connect` | same | [VERIFIED] https://developers.hubspot.com/docs/api-reference/latest/account/account-information/guide ; required scope [OPEN, HS5] |
| Limits | pacing design | n/a | [VERIFIED] privately distributed apps: 100 requests per 10 s per app (Free/Starter) or 190 (Professional/Enterprise), 250,000 to 1,000,000 per day per account; `429` with `policyName`; headers `X-HubSpot-RateLimit-*`; Source Code API endpoints exempt from the 10 s and daily limits but may return `5xx` under heavy load: https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines ; `Retry-After` on `429` is not listed [ASSUMPTION; the template helper honours it when present] |
| Auth: static token from an app with `auth.type: static`, `distribution: private`, installed in one account; token shown on the app's Distribution tab; rotate about every six months; reinstall after scope changes | credentials | n/a | [VERIFIED] https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview , https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot |
| Scope `content` | all Source Code API endpoints | n/a | [VERIFIED] endpoint pages (`oauth2: content`); scopes page: available to CMS Hub or Marketing Hub Professional/Enterprise [VERIFIED statement; consistency with `cms: STARTER` tier header [OPEN], HS5] |
| Accounts for testing | free developer test accounts (up to 10; 90-day Enterprise trial; expire after 90 days without API calls), free CMS sandbox (CMS Hub Enterprise features) | n/a | [VERIFIED] https://developers.hubspot.com/docs/getting-started/account-types |
| Field definitions | slot model, `default` shapes per type, groups, repeaters | n/a | [VERIFIED] https://developers.hubspot.com/docs/cms/reference/fields/module-theme-fields (Text, Rich text, URL, Link, Image), https://developers.hubspot.com/docs/cms/reference/fields/overview (groups, nesting to three levels, `occurrence`) |
| Module settings | `global`, content types | n/a | [VERIFIED] https://developers.hubspot.com/docs/cms/reference/modules/configuration ; global content https://developers.hubspot.com/docs/cms/start-building/building-blocks/global-content |
| EU data centre host `api-eu1.hubapi.com` | regional accounts | n/a | [ASSUMPTION] exists (the host serves the developer site); whether required [OPEN, HS5] |

**Alternatives considered (not chosen; kept for Open Question 1):**

| Option | HubSpot mechanism | Why not first |
|---|---|---|
| A. **Module default values** (chosen) | Source Code API, `fields.json` | Matches "custom module fields" and Contentful's "custom modules"; draft and published environments give draft-first safety; one write per module; exempt from rate limits. Weakness: propagation to existing instances unproven (HS1) |
| B. Module instances in pages/landing pages | Pages API: landing/site pages have a draft and `POST .../draft/push-live`; page content is nested `layoutSections` with module `params` per instance [VERIFIED: Pages guide and publish endpoint page] | Reaches the real content, but needs instance addressing inside deeply nested layout JSON, a page picker, and edits customer-facing pages; no field-level API [ASSUMPTION: PATCH of the draft replaces whole objects]; much larger mapping-model change (a target is a page + instance + field) |
| C. Module instances in marketing emails | Marketing Emails API: draft endpoints exist; `/publish` and `/unpublish` need Marketing Hub Enterprise or the transactional add-on [VERIFIED: Marketing emails guide] | Same instance-addressing problem; publish gated by plan; sent emails are immutable in practice [ASSUMPTION] |
| D. HubDB tables | HubDB draft rows and table `/publish` [VERIFIED: HubDB docs] | Typed content model that fits well, but it is not "custom module fields"; modules need `hubdb_table` fields to read it; a candidate follow-up provider kind |

**Auth flows.**
1. *App to worker*: as #27 (SDK token → bearer → IMS verification → site allowlist → DA permission → handler).
2. *Worker to HubSpot*: secret from `env` → header on each call to the fixed host; the IMS token is never sent to HubSpot. The token is a plain secret: the template's baseline secret redaction covers it (R-T2 not needed).
3. *Cron*: no user; the stored mapping, anonymous content fetch, and the HubSpot token.

## 4. Data contracts

All routes, the mapping document, the status document and the stored state are #27's, unchanged. HubSpot-specific values only:

**Descriptor** (`GET /vendors`, entry `hubspot`): `configured` true when the secret is set and the module roots variable is valid; one kind:

| kind | label | slotModel | valueFormats | supportsApproval | slotName |
|---|---|---|---|---|---|
| `module` | Custom module (field defaults) | `named-slots` | `text`, `html`, `url`, `image` | true | `{ maxLength: 100 [ASSUMPTION], pattern: identifiers separated by dots }` |

Required secret names: `HUBSPOT_ACCESS_TOKEN`.

**Operations (module interface as #27 section 4):**

| Operation | HubSpot behaviour |
|---|---|
| `descriptor` | as above |
| `connect(env)` | validate configuration (secret present, roots well-formed, host on the allowlist); `GET account-info details` and compare `portalId` when configured; first root's metadata as a token and scope probe; failures -> `auth_failed` / `permission_denied` / `vendor_unavailable` / (missing root) `target_not_found`. No state is kept |
| `listTargets(session, 'module', query?, cursor?, limit?)` | per configured root: metadata of the root in `published`; children ending `.module`; `query` as a case-insensitive substring of the path; sorted; items `{ id: <root>/<name>, name, kind: 'module' }`; `nextCursor` from an offset-based opaque cursor over the sorted list (list cached in the isolate for 60 s) |
| `describeTarget(session, 'module', id)` | id validation (Decision 24); download `fields.json` (and `meta.json` for the note) from the base environment; `slots: [{ name: <dotted path>, type: text \| richtext \| url \| link \| image }]`; note: global flag, content types, count of omitted fields; unreadable JSON -> `invalid_value`; unknown module -> `target_not_found` |
| `push(session, {kind:'module', id}, slots[], {approve?})` | Decisions 15-19 and 12-13: guards -> read both environments -> base -> apply -> no-op check -> validate -> hash re-check -> upload to `draft` -> optional publish -> `{ results: [{slot, outcome, error?}], vendorState: draft \| published }` |

`push` accepts up to the shell's per-binding rule cap of slots (50) and returns one result per slot.

**Interface-fit proposals (all optional; each has a no-shell-change fallback).** Numbered HP to avoid collision with other providers' proposals; HP1, HP3 and HP4 are the same ideas as AJO's P1, P3 and P4 and should be accepted or rejected together.

| # | Gap found with HubSpot | Proposed amendment (to #27's contract) | Fallback used if declined |
|---|---|---|---|
| HP1 | "Approve" means "publish the module's field file" | Descriptor gains an optional label for the approval option (as AJO P1) | UI shows the generic "approve" label; README explains it means publish |
| HP2 | Slots must already exist (no create-on-first-push like Marketo tokens) | Descriptor gains `slotsMustExist: true`; the UI offers only `describeTarget` slot names and the preview can flag an unknown name | Free-text slot names are allowed; an unknown name fails at push with `invalid_value` "field not found in module" (the UI still suggests names from `describeTarget`, #27 story 7) |
| HP3 | Admins need hints per target: global flag, content types, omitted-field count | `listTargets` items and `describeTarget` gain an optional short `note` (as AJO P3) | The global flag and content types are shown only after selection, from the `describeTarget` slot list header; README documents it |
| HP4 | `vendorState` vocabulary (`draft`, `published`) | Document `vendorState` as an open vocabulary the UI renders as text (as AJO P4) | UI renders the string; no behavioural coupling |
| HP5 | Slot `type` must drive format choices per slot, not per kind (a module mixes text, rich text, link and image fields) | Document that `describeTarget` slot `type` is the authoritative source for which formats the UI offers for that slot | UI offers every kind-level format; push-time `invalid_value` rejects the wrong ones (the module enforces anyway) |

No proposal changes engine behaviour. Lessons for the remaining vendor tickets: (a) vendors whose write path is "edit a source file" hide a read-modify-write, a draft/publish pair and a concurrency check behind `push`; (b) one binding can map to *many* slots written in *one* vendor call, so per-slot isolation needs a vendor-side validate-and-bisect rather than one call per slot; (c) the descriptor cannot express per-slot allowed formats, so `describeTarget` slot types carry them (HP5).

**Configuration:** secret `HUBSPOT_ACCESS_TOKEN`; variables `HUBSPOT_MODULE_ROOTS` (comma-separated folder paths, required), `HUBSPOT_PORTAL_ID` (recommended), `HUBSPOT_API_HOST` (default `api.hubapi.com`; allowlist of two), `HUBSPOT_MAX_FILE_BYTES` (default 1,048,576 [ASSUMPTION]); local-only `ALLOW_LOCALHOST`-gated host override.

## 5. Folder layout (proposed; fits #1, #2, #27)

```
apps/marketing-automation-sync/providers/hubspot/
├─ SPEC.md                              this file
├─ README.md                            setup: static-auth app, scope, token, account id, module roots, wrangler commands, supported fields, caveats (HS1), no site config read, ref=local, branch ref
└─ worker/                              HubSpot module: descriptor, config, request layer, listing/describe, field-default editing, push, error mapping
   ├─ fake/                             fake HubSpot (developer file system with environments, hashes, multipart, validate, scripted errors)
   ├─ fixtures/                         golden fields.json / meta.json / error bodies (recorded in live spikes; hand-written until then)
   └─ test/                             V1 suite run, HubSpot cases, fake self-tests, security tests
```

Registration points outside this folder (the only allowed edits, enforced by UR-H1): the shell's vendor registry (one entry); the worker config (`secrets.required` and the variables); `.dev.vars.example`; the extension README's vendor list; the shell worker's allowed outbound host list if the template declares hosts per route; CI needs no change. The V1 suite, fake vendor and shell tests stay as #27 placed them.

## 6. Template amendment requirements (inputs to the owner decision on #2/#27)

HubSpot needs from #27's list: **R-T1** (D1, cron, `scheduled` with the same request id/logging/redaction), **R-T4** (caller's token to `admin.da.live` for the permission check) and **R-T5** (extension error codes). It does **not** need R-T2 or R-T3 (Decision 25). One new requirement:

- **R-T6** the outbound proxy can send a **buffered `multipart/form-data` body** (the `file` part of a Source Code upload) with a stable boundary across retry attempts and with the secret header injected as usual; fallback: the module builds the multipart bytes itself and passes them as a buffered body with an explicit `Content-Type` including the boundary, which the template's "request bodies are buffered" rule (#2 Decision 8) should already allow [ASSUMPTION: confirm in the template implementation]. A runtime-smoke test proves the real multipart round trip (SM-H1).

## 7. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Propagation of module defaults is unproven**: the product value (content changes where authors expect it) depends on which usages pick up a changed default (HS1) | High | Spike HS1 first; README documents findings; recommended targets (global modules, coded-template usages) chosen from it; owner decision if nothing propagates (Open Question 1, alternatives B-D) |
| R2 | **No HubSpot account or token available**; every behaviour here is from documentation | High | Free developer test account (up to 10, 90-day enterprise trial [VERIFIED]); live spikes as the first step needing credentials; fixtures hand-written until then; manual steps blocked without an account |
| R3 | **Draft/publish semantics of the Source Code API** (draft read when absent, per-file vs per-module publish, "module never published" states, draft-only modules visibility) | High | Spike HS2; conservative algorithm (Decisions 15-17) refuses to publish when anything else is in the draft; tests parametrised over the alternative semantics in the fake |
| R4 | **Concurrent edits**: no conditional write; developers deploy modules from git and overwrite defaults, or edit in the Design Manager while a sync runs | Medium | Hash re-check, re-apply once, draft-first, README warning; documented residual window (Decision 19); OQ 4 on whether the target modules are source-controlled |
| R5 | **Scope/plan gate**: `content` scope availability vs the API's `cms: STARTER` tier; test accounts' trials expire | Medium | Spike HS5; README states the requirement found; renew test account via API calls |
| R6 | **HubL/personalization evaluation of default values** (security of injecting page text into emails) | Medium | Syntax guard (Decision 12) regardless of outcome; spike HS6 decides whether the guard can be relaxed |
| R7 | **fields.json round-trip fidelity**: HubSpot may normalise, add `id`s, or reject unknown properties; formatting noise | Medium | Semantic comparison; preserve unknown properties; spike HS4; golden fixtures from a real module |
| R8 | **Image `src` constraints** (external URL vs File Manager) and image alt | Medium | Spike HS4; if external URLs are refused, `image` is limited to `text` fields until a File Manager upload step is specified (out of scope) |
| R9 | **Listing without root addressing**; many modules | Low-Med | Configured module roots (Decision 8); bounded calls; spike HS3 for recursion |
| R10 | **API versioning**: 2026-09 is supported until about March 2028 [ASSUMPTION], beta versions exist | Low | Version constant, documented bump procedure, contract fixtures tagged with the version |
| R11 | **Rate behaviour**: Source Code API is exempt from documented limits but may `5xx` under load; `Retry-After` unspecified | Low-Med | Shell pacing, template retries, spike HS5 measures |
| R12 | **Template amendments** R-T1/R-T4/R-T5/R-T6 block this ticket if #2/#27 do not take them | Medium | Same dependency as every provider; fallbacks listed |
| R13 | **Interface fit** was assumed in #27 for HubSpot; Decision 3 confirms it with five non-breaking gaps | Low | HP1-HP5 reviewed by the owner; in-module fallbacks exist |
| R14 | **Adobe outside-activity/IP policy** and a HubSpot token held under a personal Cloudflare account (carries over from #1 R1, #27 R1) | High for publishing | [OPEN] README note; owner decides the account before sharing |
| R15 | **Cross-site collisions**: two EW sites may map to the same module slot in the one HubSpot account; the shell validates uniqueness per site | Low-Med | Hash re-check serialises writes; last writer wins; OQ 10 |

**Spikes (build-plan step 1; results recorded in the README, the fixtures and the fake):**
- **HS1** Propagation: in a developer test account create (a) a module used in a coded email/page template without overriding, (b) a module added to a drag-and-drop page and email before the change, (c) one added after, (d) a global module. Change a field default through the API (draft, then published) and record which usages change, when, and what the Design Manager shows.
- **HS2** Environments: `GET draft` when no draft exists (404 or published content?); a file only in draft; does uploading to `published` clear the draft of that file only or of the whole module; module state while only `fields.json` has a draft; validate error body per field; file size limits; effect of uploading to `draft` while a draft exists; whether `hash` changes on every upload and on identical content.
- **HS3** Listing: metadata of a folder (children names, files vs folders), the root path, behaviour for missing paths, `meta.json` property names (`content_types` vs `host_template_types`), whether `@hubspot` and marketplace folders are listed.
- **HS4** Field defaults: external image `src`; text with `validation_regex`; link/url types; rich text sanitising by HubSpot; whether HubSpot rewrites `fields.json` (ids, key order) after an upload; `fields.js`-built modules.
- **HS5** Auth and limits: static token with only `content` against all endpoints used; `account-info` scope; legacy private app token; EU host requirement; the real `429`/`5xx` behaviour and `Retry-After` at sustained call rates; whether Free/Starter or developer test accounts accept the `content` scope.
- **HS6** Whether default values containing `{{ }}`, `{% %}` or personalization tokens are evaluated in module rendering and in emails.
- **HS7** Concurrency: two simultaneous uploads to the same file; conditional headers (`If-Match`, `If-Unmodified-Since`) if any are honoured.
- **HS8** Developer workflows: what a `hs cms upload` of an unchanged repo does to API-edited defaults (confirms Problem 4 and the README wording).

## 8. Ordered build plan (sized to #31's acceptance criteria)

0. **Prerequisites (owner):** #27 landed (shell, V1 suite, fake vendor, footprint rule or the delta here); template amendments R-T1/R-T4/R-T5 (and R-T6 confirmed); a HubSpot developer test account with a static-auth app and token, or an explicit decision to build against the fake only; decisions on Open Questions 1, 2, 3, 5.
1. **Spikes HS1-HS8** against the test account; record results as fixtures, fake behaviour and README text. HS1 and HS2 gate step 5. (A2, A5, A6)
2. **Fake HubSpot and fixtures first**: developer file system with environments, hashes, multipart parsing, validate, metadata children, scripted errors (`401`, `403`, `404`, `409`, `429` DAILY and 10-second, `5xx`), call log with destructive-attempt counter; golden `fields.json`/`meta.json`. Fake self-tests. (A7)
3. **Descriptor, config, request layer** (fixed host, headers, version, id validation, error mapping), test-first against the fake. (A6, A7)
4. **Listing and describe** by roots, type mapping, groups and omissions, notes. (A1)
5. **Field-default editing and push** (guards, per-type values, preservation, no-op, validate and bisect, hash re-check, draft write), test-first; then **publish** rule (Decision 17). (A2)
6. **V1 contract suite run** for HubSpot; fix to pass without changing the suite. (A3, A7)
7. **Registration**: registry entry, `secrets.required`, variables, `.dev.vars.example`, README vendor row; footprint check green. (A3)
8. **Shell integration tests with HubSpot registered** (mixed-vendor site, polled re-sync, per-item errors, draft state in status). (A1, A2)
9. **Security tests** (route enumeration with HubSpot registered, canary property test, SSRF/path inputs, no IMS token to HubSpot). (A6)
10. **App unit and Playwright e2e** with HubSpot selected, descriptor-driven options (HP1-HP5 or fallbacks). (A1, A2, A5)
11. **Runtime smoke** (real multipart over HTTP through the proxy; `429` retry with real timers). (A5, A6)
12. **README** (`providers/hubspot/README.md`, extension README row) written from the spike results. (A4)
13. **Live sandbox script run** and **manual verification in EW** M0-M8; record results, observed `Origin`s and publish-to-sync latency in the README. (A1, A2, A5, A6)
14. **Hand-off note** to the remaining vendor tickets: gaps HP1-HP5 and the read-modify-write lesson.

---

# Testing Requirements

Runners as #27: Node built-in runner for worker code (`node:test`, #2 test kit), `@web/test-runner` for the app, Playwright (Chromium, hermetic) for e2e, a Node script for smoke and for the live sandbox check. A fetch guard fails any test that reaches a real external host. Fake clock, `sleep` and `random` in every timing test. Test ids are prefixed `H` where they could collide with #27 or AJO ids.

## 1. Fixtures and mocks

- **Fake HubSpot** (`providers/hubspot/worker/fake`): requires `Authorization: Bearer <configured token>` (any other value `401`), checks the scope list of the token (`content` present, else `403` with `category: MISSING_SCOPES` and a `context`), serves `api.hubapi.com` paths for version `2026-09` only (any other version or the legacy `/cms/v3/...` path is recorded as a test failure). Stateful developer file system: per path, a `published` file and an optional `draft` file, each with bytes and a content `hash` that changes when bytes change; folders with `children` names; modules as `<name>.module/{fields.json,meta.json,module.html}`; metadata, download (`application/octet-stream`), `PUT` multipart upload (requires a single `file` part; rejects non-multipart; `draft` upload writes the draft; `published` upload writes published **and clears that path's draft**, with a switch to model "clears the whole module's drafts" for HS2), validate (`400` with an errors array on invalid JSON or an invalid field definition, `200` otherwise), `GET draft` behaviour switchable between "404 when no draft" and "returns published". Account details route (`portalId`, `accountType`, `dataHostingLocation`). Scripted failures: `401`, `403`, `404`, `409`, `429` with `policyName` `DAILY` and `TEN_SECONDLY_ROLLING` (with and without `Retry-After`), `5xx`, connection reset, truncated body, redirects. Call log with method, path, environment and bytes of every upload; counters for destructive attempts (`DELETE`, uploads to any path other than a configured module's `fields.json`, uploads that change anything but a `default`), all of which must stay zero across the whole suite. A hook that lets a test mutate a file between two requests (concurrency tests).
- **Fake IMS/DA/site, env factory, fake clock, fake vendor, in-memory store:** from #27's test kit. Canaries: `canary-hubspot-token-<random>`, a canary portal id.
- **Module fixtures** (golden, recorded from a real account during HS1-HS4; hand-written until then): flat module with text, rich text, URL, link, image fields; module with a group and a nested group (depth three); module with a repeating group (`occurrence`); module with unsupported types (number, boolean, choice, date, colour, CTA, form); module with a field name containing a hyphen; `fields.json` with `id` properties, `visibility`, `alias_mapping`, `validation_regex`, `help_text` and unknown properties; CRLF and tab-indented variants; an empty array; an object root (invalid); invalid JSON; a global module (`meta.json` `global: true`) and an email-only module; a module with a draft that differs from published in another field; a module with an identical draft and published; a module never published; a 1 MB-plus `fields.json`.
- **Value fixtures:** plain text with `&`, `<`, quotes, non-ASCII and newlines; sanitised HTML from #27's golden pages; HTML containing `{{ contact.firstname }}`, `{{{x}}}`, `{% if x %}`, `{# note #}`, a lone `{`, and the substring `{ {`; absolute and relative URLs; a value at and one byte over `VALUE_MAX_BYTES`.
- **Paths:** valid (`my-theme/modules/hero.module`), traversal (`../x.module`, `a/../b.module`), encoded (`%2e%2e`, `%2f`), backslash, leading slash, double slash, uppercase/space/unicode, over-length, outside every root, no `.module` suffix, a root with trailing slash.

## 2. Fake HubSpot self-tests

FH1 authentication and scope checks; FH2 upload to `draft` leaves `published` untouched and changes only the draft hash; FH3 upload to `published` publishes and clears the draft (both switch positions); FH4 multipart validation (missing `file` part, wrong content type, two parts); FH5 validate errors shape; FH6 metadata children and `GET draft` alternatives; FH7 any `DELETE`, unknown path, unknown version or upload outside the allowed set is recorded as a destructive attempt; FH8 `429`/`5xx` scripting and `Retry-After`; FH9 the concurrency hook.

## 3. Contract suite V1 run for the HubSpot module (seam V1)

The unmodified #27 suite with the HubSpot module and fake HubSpot: **VC1-VC8** (descriptor complete and valid; `connect` outcomes; `listTargets` paging and filter; `describeTarget` slots; `push` writes exactly the slots given; per-slot failure isolation (here with a combined-validation failure, see HS-P15); no raw vendor text; no delete or create-target operation). A suite failure that is not a HubSpot bug is a contract change and goes back to #27's owner.

## 4. HubSpot module cases (seam V1 plus W1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| HS-C1 | Configuration check: missing token, malformed or empty `HUBSPOT_MODULE_ROOTS`, host not on the allowlist -> `vendor_not_configured` (generic) and `configured:false` in the descriptor; no host or path component ever comes from a caller | A6 |
| HS-C2 | Every call carries `Authorization: Bearer <token>` and no other credential; no token in any URL or query string; only the fixed host and version `2026-09`; the user's IMS token never reaches the fake HubSpot | A6 |
| HS-C3 | `connect`: good token -> session; `401` -> `auth_failed` (one call, no retry loop); `403 MISSING_SCOPES` -> `permission_denied` with the fixed message; `5xx` -> `vendor_unavailable` (retryable); missing root -> `target_not_found` | A2, A6 |
| HS-C4 | Account check: `portalId` equal to `HUBSPOT_PORTAL_ID` passes; mismatch -> `auth_failed` "different HubSpot account"; the id never appears in a response; unset variable skips the call | A6 |
| HS-L1 | `listTargets`: children of each root filtered by the `.module` suffix; non-module children and files ignored; `query` substring (case-insensitive) on the path; stable sort; `limit` and cursor round trip until exhausted; unknown kind rejected | A1 |
| HS-L2 | Two roots merged and sorted; a missing root reports `target_not_found` for the connection test but does not break listing of the other (item-level degrade) [decision pending OQ 9] | A1 |
| HS-L3 | Listing makes one metadata call per root and none per module; items carry no `note`, `status` or `updatedAt` under the HP3 fallback; paths with unsupported characters are skipped and counted | A1 |
| HS-D1 | `describeTarget` slots and types for the flat fixture; names are dotted paths for grouped fields (to depth three); repeater-group fields, unsupported types and names with hyphens omitted and counted in the note | A1 |
| HS-D2 | Global module flag and content types surfaced in the note; `meta.json` missing or invalid does not fail `describeTarget` | A1 |
| HS-D3 | Id validation: every bad path in the path fixtures is rejected before any call; a valid id outside the roots is rejected; wrong suffix is `target_not_found` | A6 |
| HS-D4 | Invalid JSON, empty array, object root -> `invalid_value` (fixed message), never a stack trace | A2 |
| HS-P1 | Text field: string written; `text`, `url`, `image` formats accepted; `html` format -> `invalid_value` for that slot only | A1, A2 |
| HS-P2 | Rich text field: `html` written as is; `text`/`url`/`image` HTML-escaped (`&`, `<`, `>`, quotes) | A2 |
| HS-P3 | URL field: `default` object keeps its other properties, `href` set, `type` `EXTERNAL`, `content_id` null; `supported_types` without `EXTERNAL` -> `invalid_value`; non-`url` formats rejected | A2 |
| HS-P4 | Link field: `url.href` set; `open_in_new_tab`, `no_follow` and `supported_types` unchanged | A2 |
| HS-P5 | Image field: `src` set; `alt`, `size_type`, `width`, `height`, `loading` unchanged; `image` format only | A2 |
| HS-P6 | Unknown slot name, slot inside a repeating group, slot of an unsupported type -> `invalid_value` "field not found in module" for that slot only; others written | A2 |
| HS-P7 | Personalization/HubL guard: `{{`, `{{{`, `{%`, `{#` rejected for all formats before any HubSpot call; a lone `{`, `}` or `{ {` accepted | A2, A6 |
| HS-P8 | Size: value cap and resulting-file cap (`HUBSPOT_MAX_FILE_BYTES`) -> `invalid_value` before the upload; boundary bytes (UTF-8 multi-byte at the boundary) | A2 |
| HS-P9 | **One read-modify-write for many slots**: 10 slots -> exactly one validate and one upload; the number of calls is the same for 1 and 50 slots | A2 |
| HS-P10 | **Preservation**: in the uploaded bytes everything except the mapped fields' `default` values is semantically identical to the base (property-test over the fixtures: key order, ids, `visibility`, `alias_mapping`, unknown properties); no file other than `fields.json` is written; CRLF/tab fixtures do not cause errors | A2 |
| HS-P11 | **No-op**: values already equal to the base (semantically, including different formatting of the same JSON) -> zero uploads, `written`; second consecutive push is metadata/content reads only | A2 |
| HS-P12 | Idempotent replay: an upload interrupted (connection reset) and replayed leaves the same final state | A2 |
| HS-P13 | Slot isolation by validation: the combined document fails validate; the module re-validates per slot, writes the passing ones, fails the rest with `invalid_value`; extra validate calls bounded by the failing slots | A2 |
| HS-P14 | Per-slot results always list every slot given; an upload failure fails exactly the slots included in it with the same code | A2 |
| HS-W1 | Default (`approve` off): only a `draft` upload; `published` bytes and hash unchanged; `vendorState: draft` | A2 |
| HS-W2 | Base is the existing draft when it differs from published: another field's unpublished edit is preserved in the uploaded draft | A2 |
| HS-W3 | `approve` on, draft absent or identical to published: draft upload then `published` upload of the same bytes; draft cleared; metadata confirms; `vendorState: published`; run with both draft-clearing semantics of the fake | A2 |
| HS-W4 | `approve` on and the draft holds other changes: **nothing is written** (no draft upload, no `published` upload), every slot is `invalid_value` with the fixed "other unpublished changes" message, and the person's draft bytes and hash are unchanged | A2 |
| HS-W5 | `approve` on for a never-published module -> `invalid_value`; draft-only write still works with `approve` off | A2 |
| HS-W6 | Both `GET draft` alternatives (404 when absent / returns published) give the same results | A2 |
| HS-K1 | **Concurrency**: the file changes between read and upload (hook): the module re-reads, re-applies and writes; the other change survives; a second change -> retryable `vendor_unavailable`; engine retry then succeeds | A2 |
| HS-K2 | Two bindings, same module, different slots, same tick: both slot sets end up in the file; the uploads are sequential | A2 |
| HS-E1 | Error table: `401` -> `auth_failed` (no retry); `403` -> `permission_denied`; `404` -> `target_not_found`; `400` -> `invalid_value`; `409` -> one re-read then `vendor_unavailable`; all with fixed messages and no upstream text | A2, A6 |
| HS-E2 | `429` `DAILY` -> `quota_exhausted`, no further HubSpot calls that day (fake clock); `429` 10-second window -> `rate_limited`, `Retry-After` honoured as a minimum delay, then success; exhausted retries -> retryable failure | A2 |
| HS-E3 | `5xx`, reset, truncated body, timeout -> `vendor_unavailable` (retryable); GET and PUT retried by the template helper, validate POST retried only with the safe flag; no redirect followed | A2 |
| HS-R1 | Pacing: calls per push within the documented bound (7 or 9, plus isolation validates); concurrency never above 2 under the shell's pacing with 150 slots across modules | A2 |
| HS-S1 | Non-destructive: across the whole suite the fake's destructive-attempt counter is zero (no `DELETE`, no upload outside `fields.json` of the target module, no non-`default` change, no `published` upload without `approve`) | A2 |
| HS-S2 | The module exposes no create/delete operation and no way for a caller to choose environment, version or host | A6 |

## 5. Shell integration with HubSpot registered (seams W1, R1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| SH1 | Mixed-vendor site (Marketo, HubSpot, fake vendor bindings): mapping save, preview, sync and status route work; the engine contains no HubSpot knowledge (the same scenarios pass with only the fake vendor registered) | A1, A3 |
| SH2 | Polled re-sync: edit the fake page, advance the clock, tick -> only the changed slot's field default changes in the fake HubSpot draft; status shows new `lastSyncedAt` and `vendorState` draft | A2 |
| SH3 | Unchanged page (`304` or identical hash) -> zero HubSpot calls | A2 |
| SH4 | Sync now returns per-item results; per-slot errors (`invalid_value`, `target_not_found`, `permission_denied`) show fixed messages while other slots sync; recovery after the cause is fixed | A2 |
| SH5 | Source page 404 -> `source_unavailable`; no HubSpot call; the field defaults keep their previous values | A2 |
| SH6 | `quota_exhausted` pauses HubSpot only; Marketo bindings in the same tick continue; items stay `pending` | A2 |
| SH7 | Disabled or removed binding is skipped; nothing is ever reverted or cleared in the fake HubSpot (counter) | A2 |
| SH8 | Descriptor via `GET /vendors` lists HubSpot with the `module` kind and `configured` truthfully; the UI renders from it (see section 7) | A1 |

## 6. Security (seams W1, V1; A6)

| ID | Behaviour asserted | Proves |
|---|---|---|
| SEH1 | Route enumeration (#27 AZ1) re-run with HubSpot registered: every route and method without `Authorization` returns `401` before any fake (site, DA, HubSpot) receives a request; a new HubSpot route not in the registry fails the test | A6 |
| SEH2 | Canary property test: matrix (success, every error in HS-E1, HubSpot echoing the token or `Authorization` header in an error body, handler throw, missing-secret path, connection test, publish path) -> the canary token never appears in any response body, header, log line or stored row | A6 |
| SEH3 | The caller's IMS token reaches only the fake DA host; the fake HubSpot never sees it; HubSpot hosts never receive an `Authorization` value derived from the user | A6 |
| SEH4 | Input validation: module ids and query strings from the path fixtures, slot names with dots/slashes/`__proto__`/over-length -> `400`/`target_not_found` and zero outbound requests; the fake sees no path outside a configured root | A6 |
| SEH5 | Redirects from HubSpot are not followed; the fake sees no second request; a redirect to another host never carries the token | A6 |
| SEH6 | Responses carry fixed messages: HubSpot `message`, `correlationId` and `context` (which can name scopes) never appear; the account id never appears | A6 |
| SEH7 | Disallowed `Origin` with a valid token -> `403` on HubSpot routes; no route can trigger a tick; `POST /vendors/hubspot/test` with a missing token returns the generic `vendor_not_configured` | A6 |
| SEH8 | XSS/injection: values reaching HubSpot never contain `<script>`, event handlers, `javascript:` URLs or HubL syntax (#27 EX5 reused with the HubSpot module as sink) | A6 |

## 7. App unit tests (seam S2; `@web/test-runner`)

| ID | Behaviour asserted | Proves |
|---|---|---|
| UIH1 | Vendor picker shows HubSpot when the descriptor lists it; target picker uses kind `module`; search and paging send the expected requests | A1 |
| UIH2 | Slot picker offers the `describeTarget` slot names with their types (grouped paths shown readably); unsupported-field note shown; under HP2 only listed names are selectable, under the fallback free text works and an unknown name shows the push-time error after sync | A1 |
| UIH3 | Format options for a mapped slot follow the slot type (HP5): `html` disabled for text/url/link/image slots, `url` only for url/link, `image` for image and text; impossible choices cannot be saved or are flagged | A1 |
| UIH4 | Approval option label and help text under HP1; generic label under the fallback; default off; help states what publish does | A1, A2 |
| UIH5 | Status view shows `vendorState` "draft" as visible text ("saved as a draft in HubSpot; publish it in the Design Manager") for HubSpot bindings, distinguishable from "published", and per-slot errors with fixed messages | A2 |
| UIH6 | Worker calls carry `Authorization: Bearer <sdk token>` to the constant worker origin; the token and any vendor secret never appear in the DOM, console or storage; `?worker=` ignored | A6 |

## 8. End-to-end (seam S1; Playwright, Chromium, hermetic: static server `:3000`, real worker via `wrangler dev` `:8787`, local D1, fake IMS/DA/site/HubSpot as Node servers, #1 SDK stub)

| ID | Behaviour asserted | Proves |
|---|---|---|
| EH1 | Full path: open the app, choose HubSpot and a module from the fake account, map a heading to a text field and a body block to a rich text field, preview, save, Sync now; the fake HubSpot draft holds the two new defaults and the published file is unchanged | A1, A2, A5 |
| EH2 | Edit the fake page, advance the worker's scheduled test hook, reload status: new last-synced time, the changed field updated, the other untouched | A2 |
| EH3 | One field rejected by the fake (`400` validate): status shows that slot's plain error and the other slot succeeded | A2 |
| EH4 | Publish option on: published bytes updated and draft cleared; with another field's unpublished edit present: the plain "other unpublished changes" error and nothing written to either environment | A2 |
| EH5 | Request without a token to every worker route -> `401` visible to the browser (CORS headers present) | A6 |
| EH6 | Page HTML, DOM text and all network responses contain neither the user token nor the canary HubSpot token | A6 |
| EH7 | Only expected hosts contacted from the browser (static server, worker, SDK stub, stubbed `admin.da.live`) | A5, A6 |

## 9. Runtime smoke (seam W2)

SM-H1 the worker (with the HubSpot module, `shared/` imports and the D1 binding) bundles and starts; a bare request gets `401`; the module uploads a **real multipart body** through the proxy over HTTP to the fake, which parses the boundary and the `file` part and returns metadata (proves R-T6 or its fallback). SM-H2 a scripted `429` retried with real timers (tiny delays) and a `5xx` retry of a `PUT`. SM-H3 the scheduled hook runs a tick that edits the fake HubSpot draft. SM-H4 the canary token is absent from every response over real HTTP (SEH2 over HTTP).

## 10. Repo and docs checks (seam S3, extended)

| ID | Behaviour asserted | Proves |
|---|---|---|
| UR-H1 | **Provider-footprint rule** on a temp-dir fixture and on the real diff: adding the HubSpot provider touches only `providers/hubspot/` and the named registration points; a fixture change that edits the sync engine, mapping model or UI fails the rule | A3 |
| UR-H2 | `providers/hubspot/` contains `README.md`, `worker/` with tests; the V1 suite run for HubSpot is present (a provider that registers without a suite run fails, #27 UR5) | A3, A7 |
| UR-H3 | The provider README names `HUBSPOT_ACCESS_TOKEN` and every variable of Decision 23, the `content` scope, the account requirement, the supported field types, and states "reads no EW site configuration"; the extension README vendor list has a HubSpot row that resolves | A4 |
| UR-H4 | Hygiene (#2 rules) pass: `HUBSPOT_ACCESS_TOKEN` is in `secrets.required` and `.dev.vars.example`, not in `vars`; no tracked `.dev.vars*` | A6 |
| UR-H5 | Lint (ESLint 8 + helix config, Stylelint 16) and all test tiers run in CI on every push and PR; no HubSpot credentials in CI | A7 |

## 11. Live sandbox checks (opt-in Node script through the local worker against a real HubSpot developer test account; never in CI; budget: a throwaway module or two, at most ~60 calls)

Needs: a developer test account (free, [VERIFIED] account-types page), a static-auth app with `content` scope installed in it, the token in `.dev.vars`, a throwaway theme folder with three modules (flat, grouped, global), one coded email/page template using them, and a drag-and-drop page and email placed before the test. The script prints results only (never the token) and records fixtures.

| ID | Check | Settles |
|---|---|---|
| LV1 | Which usages pick up a changed published default (coded template, earlier instance, later instance, global module) and what the Design Manager shows for a draft | HS1 |
| LV2 | Draft/published semantics: draft read when absent, publish clearing, whole-module vs file, draft-only modules, validate errors, size limit, hash behaviour | HS2 |
| LV3 | Root and folder metadata, `meta.json` property names, listing of default and marketplace folders | HS3 |
| LV4 | Field defaults per type including external image `src`, rich text sanitising, `fields.json` rewriting by HubSpot | HS4 |
| LV5 | Token scope sufficiency, `account-info` scope, EU host, `429`/`5xx` at ~5 calls per second for a few minutes, `Retry-After` | HS5 |
| LV6 | HubL and personalization evaluation of default values in a rendered page and an email preview | HS6 |
| LV7 | Concurrent uploads and conditional headers | HS7 |
| LV8 | A `hs cms upload` of an unchanged local copy over API-edited defaults | HS8 |

## 12. Manual verification inside real Experience Workspace (needs interactive Adobe login; cannot be automated)

Accounts and credentials needed: those of #27 section 6 (GitHub admin, Adobe IMS identity with write access to the DA org/site, Chrome, Cloudflare account with `wrangler login`) **plus** the HubSpot developer test account and token above, and a published test page with a key/value block and a grid block. Never paste the IMS token or the HubSpot token into chat, issue comments or logs.

- **HM0 (prereq):** deploy; `wrangler secret put HUBSPOT_ACCESS_TOKEN`; set `HUBSPOT_MODULE_ROOTS` (and `HUBSPOT_PORTAL_ID`); `curl -i <worker>/v1/vendors` returns `401` (A6).
- **HM1 (`ref=local`, full path):** `npm start` (port 3000) and the worker dev script (port 8787) with local D1 and the real developer test account. Open `https://da.live/app/jazhou-adobe/ew-extensions/apps/marketing-automation-sync/marketing-automation-sync?ref=local`, accept the trust prompt (#1 2.4). Run vendor test (connected); pick HubSpot and the test module; map the heading to a text field, a body block to a rich text field, the CTA link to a link field; preview; save; Sync now; in HubSpot's Design Manager the module shows **unpublished changes** with the new defaults (A1, A2, A5).
- **HM2 (published edit, polled re-sync):** in the EW editor change the heading, publish; wait up to the polling interval (use the local scheduled trigger in `ref=local`); status shows a new last-synced time and the module's draft holds the new text; the unedited field is unchanged. Record publish-to-sync latency in the README (A2).
- **HM3 (per-item errors):** map a field to a name that does not exist and a field with a link into a text slot `html`; Sync now shows plain per-slot errors while the rest syncs; fix and see recovery (A2).
- **HM4 (publish):** enable the publish option, sync; the module's published defaults update and the draft is cleared; then edit another field of the module in the Design Manager without publishing and sync again: the binding reports "other unpublished changes" and publishes nothing (A2).
- **HM5 (usages):** open a page/email that uses the module in each way from HS1 and record in the README which show the new copy after publish (A2; HS1 result).
- **HM6 (branch ref):** push branch `hs-spec` (simple name), wait for code sync, open the app with `?ref=hs-spec` against the deployed worker; repeat HM1's save and sync; record the page's actual `Origin` in the README (A5; #2 R2).
- **HM7 (apps sheet and menu):** the `apps` row from #27 resolves; the card appears and opens the app with HubSpot available (A3, A5).
- **HM8 (security):** with `curl`: no token -> `401`; valid token without DA write -> `403`; disallowed `Origin` -> `403`; search page source, Network responses and DevTools storage for the HubSpot token (none); rotate the token in HubSpot, `wrangler secret put`, next sync succeeds with no code change (A6).

## 13. Acceptance-criteria traceability (ticket #31)

Labels A1 to A7 are #31's seven acceptance criteria in the order the ticket lists them.

| # | Acceptance criterion (#31) | Automated proof | Manual / review verification |
|---|---|---|---|
| A1 | Admin maps EW page/fragment content (by block and field) to the vendor's content objects and saves the mapping per site | HS-L1-L3, HS-D1-D4, HS-P1-P6 (targets, slots, formats), SH1, SH8, UIH1-UIH4, EH1, plus #27's EX/MP/UI suites unchanged | **HM1**, **HM7**, LV3 |
| A2 | Content pushes on demand, and the worker re-syncs mapped pages whose published version changed (polled); the app shows last sync time and per-item errors | HS-P7-P14, HS-W1-W6, HS-K1-K2, HS-E1-E3, HS-R1, HS-S1 (push, draft/publish, concurrency, errors, pacing, non-destructive), SH2-SH7 (polled re-sync, per-item errors, recovery), UIH5, EH1-EH4, SM-H2, SM-H3 | **HM1** (Sync now), **HM2** (publish then polled re-sync, latency recorded), **HM3** (per-item errors), **HM4** (publish rule), **HM5** (usages), LV1, LV2 |
| A3 | Added inside the existing `marketing-automation-sync` folder as a new provider; no changes needed in the extension shell beyond registering the provider | UR-H1 (footprint rule on the real diff), UR-H2, VC1-VC8 (V1 suite on HubSpot), SH1 (engine vendor-agnostic with HubSpot registered) | Review of the PR diff against the registration-point list in Build Analysis 5; **HM7** |
| A4 | Extension README documents this vendor's setup (credentials, site config keys) | UR-H3 (provider README names the token, scope, variables, supported fields, "reads no EW site configuration"; extension README row) | Clean-checkout walk-through of the README by a reviewer who follows it once against a developer test account; OQ 7 on the "site config keys" reading |
| A5 | Works in EW with `ref=local` and with a branch ref | EH1-EH7 (page at `localhost:3000` against a local worker), SM-H1-H4; origin handling covered by the template's UC tests | **HM1** (`ref=local`), **HM6** (branch ref against the deployed worker; observed `Origin` recorded), **HM0** |
| A6 | Vendor credentials live only in this extension's worker (built from the shared worker template); the browser never receives them; unauthenticated calls are rejected | HS-C1-C4, HS-S2, SEH1-SEH8 (route enumeration, canary property test, SSRF/path inputs, no user token to HubSpot, fixed messages, injection), UIH6, EH5-EH7, SM-H1, SM-H4, UR-H4 | **HM0** (`curl` 401), **HM8** (security checks incl. page-source and storage search; rotation); review that the HubSpot token appears only in worker config |
| A7 | Core logic covered by unit tests; lint and CI green | All worker and app unit tiers above (FH, VC, HS, SH, SEH, UIH), CI jobs `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` (UR-H5, UR-H2) | Review: CI green on a PR; deliberately break a rule on a scratch branch (let the module upload a changed `label`, publish with another draft present, drop auth from one route, drop the syntax guard) and see HS-P10 / HS-W4 / SEH1 / HS-P7 fail |

Every acceptance criterion on #31 maps to at least one automated test or a numbered manual verification step above.

## 14. Open questions for the owner

1. **What should "custom module fields" write to? (R1, highest priority).** This spec writes module field **default values** through the Source Code API (draft first). HubSpot's docs say instances in pages and emails are independent of each other and can override defaults, so existing instances placed with their own values will likely not change; defaults reach coded-template usages, later instances and global modules (to be proven in spike HS1). Is that what you mean by "HubSpot custom module fields" and "Contentful's custom modules"? If not, which should be the target: module instances inside pages/landing pages or marketing emails (alternatives B and C; a much larger mapping-model change), or HubDB (D)? The build does not start before HS1 and your answer.
2. **HubSpot access (R2).** Can the owner provision a free developer test account with a static-auth app (`content` scope) and share the token with the worker only through `wrangler secret put` / `.dev.vars`? Without one, the module is built against the fake only, HM0-HM8 and LV1-LV8 are deferred, and Decisions 15-18 stay unproven.
3. **Tenancy.** One HubSpot account per worker deployment (this spec), with a separate deployment for a test and a production account? Or per-site accounts entered in the app (a shell change, #27 OQ 2)?
4. **Are the target modules source-controlled?** If the theme lives in git and is deployed with the CLI, every deploy overwrites synced defaults (HS8). Is "sync only modules that are edited in HubSpot, not deployed from git" an acceptable rule, or should the provider write to a dedicated content-only module folder the developers do not deploy over?
5. **Draft versus publish default.** Confirm "write draft only; publish only when the binding opts in and the draft holds nothing else" (this spec). Should publishing also need an admin-only setting?
6. **Personalization syntax.** Reject `{{`, `{%`, `{#` in synced content (this spec), or offer a deliberate pass-through or escaping mode after HS6 shows how defaults are evaluated? Authors might want HubSpot personalization tokens in email copy.
7. **AC4 wording.** "Site config keys": this spec reads none (all settings are worker variables and the secret). Is documenting the worker keys and stating "no site configuration is read" the intended meaning, or should the provider read per-site settings (for example the module folders) from the EW site config?
8. **Image alt text and richer fields.** Alt text is not synced (the shell's `image` format is the `src`); numbers, booleans, choices, dates and repeating groups are not offered. Acceptable for #31, or is alt text (needs a shell format change) or a field type a must-have?
9. **Module folders and paths.** Is a configured list of module folders (one level, no spaces or special characters in paths) enough for your account? Should an unreachable root fail the whole listing or only be reported?
10. **Cross-site and cross-binding collisions.** Two EW sites mapping to the same module field overwrite each other (last writer wins; uniqueness is checked per site). Acceptable?
11. **Interface proposals HP1-HP5.** Accept as small additive amendments to #27's contract (approval label, `slotsMustExist`, `note`, open `vendorState` vocabulary, per-slot format source), or keep the fallbacks (generic labels, push-time errors)? HP1, HP3 and HP4 repeat AJO's P1, P3, P4.
12. **Template amendments.** HubSpot needs R-T1, R-T4, R-T5 and the new R-T6 (multipart bodies), not R-T2 or R-T3. Same decision as #27 Q5: extend #2 first or build fallbacks?
13. **Plan and account requirements.** The `content` scope is documented as available to CMS Hub or Marketing Hub Professional/Enterprise only. Which HubSpot tier does the target account have, and is the README allowed to state that requirement as found in HS5?
14. **Polling interval and sizes.** Same 5-minute poll as #27 (OQ 8 there) for HubSpot? The Source Code API is exempt from the documented rate limits, so a faster poll is possible if wanted.
15. **Policy item (carry-over).** Confirm the Adobe outside-activity/IP position before a worker holding a HubSpot token (able to change live marketing content) runs under a personal Cloudflare account or is shared (#27 R1, #1 R1).
