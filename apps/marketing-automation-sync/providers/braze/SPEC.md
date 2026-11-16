# Spec: Marketing Automation Sync: Braze (Content Blocks provider)

Ticket: jazhou-adobe/ew-extensions#29 (this spec: #67). Blocked by #27 (mapping shell + Marketo; spec in `apps/marketing-automation-sync/SPEC.md`, written under #65), which is itself blocked by #1 (repo scaffold; `apps/hello-world/SPEC.md`) and #2 (shared worker template; `shared/worker-template/SPEC.md`). Sibling vendor follow-ups: #28 (Adobe Journey Optimizer), #30 (Klaviyo), #31 (HubSpot), #32 (Iterable).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #27 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Braze/Cloudflare.

Vocabulary is inherited unchanged from the #27 spec: *extension*, *worker*, *provider*, *IMS token*, *source page*, *field*, *target*, *slot*, *binding*, *mapping*, *sync*, *re-sync*. Braze terms used here:

- **Content Block** = a reusable Braze content object (HTML or text, up to 50 KB) that campaigns, Canvases and email templates include with Liquid `{{content_blocks.${name}}}` [VERIFIED: https://www.braze.com/docs/user_guide/messaging/design_and_edit/content_blocks]. In the #27 vocabulary a Content Block is the **target**; its body is its **only slot**. The target kind is `content-block`, slot model `single`.
- **REST endpoint** = the instance-specific API host (`https://rest.iad-01.braze.com`, `https://rest.fra-01.braze.eu`, ...) [VERIFIED: https://www.braze.com/docs/api/basics].
- **REST API key** = a workspace-scoped secret with per-endpoint permissions, sent as a Bearer token [VERIFIED: same page].
- **State** = a Content Block is `draft` or `active`; an active block can never go back to draft [VERIFIED: update-endpoint error table, below].

Primary sources read (all 2026-11-16): Braze docs: [Create Content Block](https://www.braze.com/docs/api/endpoints/templates/content_blocks_templates/post_create_email_content_block), [Update Content Block](https://www.braze.com/docs/api/endpoints/templates/content_blocks_templates/post_update_content_block), [List Content Blocks](https://www.braze.com/docs/api/endpoints/templates/content_blocks_templates/get_list_email_content_blocks), [See Content Block information](https://www.braze.com/docs/api/endpoints/templates/content_blocks_templates/get_see_email_content_blocks_information), [API overview (endpoints, keys, permissions, IP allowlisting, Bearer auth)](https://www.braze.com/docs/api/basics), [Rate limits](https://www.braze.com/docs/api/api_limits), [API errors](https://www.braze.com/docs/api/errors), [Content Blocks user guide](https://www.braze.com/docs/user_guide/messaging/design_and_edit/content_blocks), [Templates endpoint index](https://www.braze.com/docs/api/endpoints/templates/content_blocks_templates/), [Connected Content](https://www.braze.com/docs/user_guide/messaging/design_and_edit/personalize/connected_content), [Braze x Contentful partner page](https://www.braze.com/docs/partners/message_orchestration/cms_dam/contentful); [Contentful Braze app listing](https://www.contentful.com/marketplace/braze); Cloudflare [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) (`secrets`). The ticket's reference https://www.contentful.com/blog/new-apps-integrations-marketplace/ returned `429` (Vercel checkpoint) to `curl` and to the reader; its content was confirmed only through a search snippet ("four marketing automation integrations (Klaviyo, HubSpot, Iterable, and an updated Braze app)") [partly VERIFIED]. The ticket's other reference https://www.aem.live/docs/ew/developing/apps-plugins is covered by the #1 spec and not re-read. Upstream `adobe-rnd/ew-extensions`: `gh search code braze --repo adobe-rnd/ew-extensions` returned no hits [VERIFIED 2026-11-16]; no Braze prior art exists there.

---

## Problem Statement

A team that runs campaign content in Experience Workspace (EW) also sends email and other messages through Braze. The headline, body copy, call-to-action and image URL that already exist as an EW page or fragment are retyped into Braze Content Blocks, which campaigns and Canvases include by Liquid tag. Every copy fix is made twice and the two copies drift. Contentful solved this for its users with a Braze app that syncs selected entry fields, per locale, into Braze Content Blocks [VERIFIED: https://www.braze.com/docs/partners/message_orchestration/cms_dam/contentful, https://www.contentful.com/marketplace/braze]; EW users have nothing comparable. The #27 shell already maps EW blocks and fields to vendor slots and keeps them in sync for Marketo; Braze must join it as the second real vendor without touching the shell.

What is different about Braze, and why a plain "port of the Marketo module" would be wrong:

1. **A Content Block has exactly one slot and no create-on-write.** Marketo tokens are created on first push; a Content Block must exist first, its name is permanent once saved, and a name can never be reused, "even if archived" [VERIFIED: Content Blocks user guide, specifications table]. There is no delete endpoint at all [VERIFIED: the templates index lists only list, info, create and update].
2. **Writes are live immediately for active blocks.** "If you choose to update a Content Block, it updates in all messages where the Content Block is inserted via Liquid"; earlier versions "can't be viewed or restored" [VERIFIED: user guide]. A bad sync is an instant production edit with no undo. The Marketo draft-then-approve safety net exists in Braze only for blocks still in `draft`; an active block cannot be written back to draft ("Active Content Block can not be updated to Draft") [VERIFIED: update endpoint].
3. **Content is executed as Liquid at send time.** The create/update errors include "Content contains malformed liquid" [VERIFIED], and Connected Content (`connected_content`) lets Liquid pull from a web server or public API [VERIFIED: Connected Content page]. Page text containing `{{...}}` or `{% ... %}` that is copied verbatim into a block would be evaluated by Braze for every recipient. This is a content-injection path the Marketo module does not have [INFERENCE from the two verified facts; confirmed by spike B3].
4. **The key is powerful and unscoped by IP.** Braze says REST keys "should never be publicly exposed" and must never be used from client-side code [VERIFIED: API overview], so the worker template is mandatory. Per-key IP allowlisting exists but Cloudflare Workers have no documented stable egress IP [ASSUMPTION; community threads only], so the key's blast radius must be limited by permissions instead.
5. **Errors are real HTTP statuses, limits are hourly.** Unlike Marketo, Braze signals failure with `4xx`/`5xx` [VERIFIED: API errors page], rate-limits at 250,000 requests per hour per workspace shared with most other endpoints, reset on the clock hour [VERIFIED: rate limits page], and tells clients when to retry through `X-RateLimit-*` headers rather than the standard `Retry-After` the template honours [VERIFIED headers; template behaviour per #2 Decision 8].

The maintainer needs a Braze module that fits the #27 vendor interface as it is written, adds no shell changes beyond registration, and handles the five differences above explicitly.

## Solution

Add one provider, `braze`, to the existing `marketing-automation-sync` extension. It is a worker-side vendor module plus a README; the app, the mapping model, the extraction, the sync engine, the store and the status view are untouched. When registered, the app's vendor picker shows **Braze** (driven by the descriptor), the admin picks a Braze **Content Block** from a searchable list, maps one EW field (or a whole block, as html) to it, previews, saves, and presses **Sync now**; afterwards the worker's 5-minute poll re-syncs the block when the page's published version changes, and the status view shows the last sync time and any per-item error.

What the user sees: open the app, choose `Braze`, search for `spring_hero_headline`, map the `hero` block's heading cell to it as `text`, preview, save, Sync now. The first sync writes the content into the Braze block as a **draft** (nothing live changes). In Braze the marketer reviews the draft and presses **Launch Content Block**, or the admin turns on the binding's approve option, after which each later publish in EW updates the live block within the polling interval. A block that is already live and a binding without the approve option shows a plain error ("Braze block is live; turn on approve to update it") instead of silently going live.

The module is deliberately conservative: it uses only the list, info and update endpoints (the API key needs only `content_blocks.list`, `content_blocks.info`, `content_blocks.update`; `content_blocks.create` is not needed), never creates, archives, deletes or blanks anything, and neutralises Liquid syntax in page content so that EW text can never execute inside Braze.

## User Stories

Admin (site or campaign admin who sets up the mapping):

1. As an admin, I want to pick Braze as the vendor in the same mapper I use for other vendors, so that I learn one workflow.
2. As an admin, I want to pick a Braze Content Block from a searchable list by name, so that I never copy ids around.
3. As an admin, I want the list to say how recently each block was edited in Braze, so that I choose the right one among similar names.
4. As an admin, I want to map one EW field to a Content Block as text, html, first-link URL or first-image URL, so that a headline, a rich section, a CTA link or an image URL each land in the right shape.
5. As an admin, I want to map a whole EW block to a Content Block as html, so that a reusable section stays in sync as HTML.
6. As an admin, I want the mapper to prevent a second rule on the same Content Block and the same block mapped from two bindings, so that two pages never fight over one block.
7. As an admin, I want to know whether the chosen block is HTML or text, so that I understand how my value will be encoded.
8. As an admin, I want the first sync to land in a draft block without going live, so that nothing changes in running campaigns before someone reviews it.
9. As an admin, I want an explicit per-binding approve option that makes writes live, so that going live is a deliberate decision.
10. As an admin, I want a clear message when a live block is mapped without the approve option, so that I know why nothing was written and what to change.
11. As an admin, I want a preview that shows the exact text that would be written, including any encoding Braze needs, so that I can trust the first real sync.
12. As an admin, I want to be told how many messages already use a block before I enable live writes, so that I understand the blast radius [optional, amendment PA3].
13. As an admin, I want the Braze connection check to say "connected" or a plain reason (wrong key, wrong region, missing permission), so that I can diagnose setup without logs.
14. As an admin, I want written setup steps for the Braze API key (which permissions, which endpoint region), so that setup needs no guesswork.
15. As an admin, I want to save the mapping per site and have a colleague's concurrent save rejected clearly, so that no one overwrites the other (shell behaviour, unchanged).

Campaign author / marketer:

16. As an author, I want my published EW edits to reach the Braze Content Block automatically, so that I do not retype copy in Braze.
17. As an author, I want to see when each block was last synced and whether it succeeded, so that I know the campaign shows my latest copy.
18. As an author, I want a Sync now button, so that I can push right after publishing.
19. As a marketer, I want the synced block to appear in the Braze Content Blocks library like any other block and be usable with the normal Liquid tag, so that my existing workflow needs no change.
20. As a marketer, I want a draft written by the sync to stay a draft until I launch it, so that I keep review control.
21. As a marketer, I want text from EW containing curly braces or Liquid-like syntax to appear literally, never run, so that a page edit can never trigger Connected Content or personalisation tags.
22. As an author, I want an unpublished or deleted source page to show "source unavailable" instead of blanking the Braze block, so that a mistake never wipes a live email.
23. As an author, I want an empty or missing field reported per item with the field named, so that I know which edit broke the mapping.

Maintainer / operator:

24. As the maintainer, I want the Braze API key only in the worker's secret store, so that no page, response or log can leak it.
25. As the maintainer, I want the key to need only list, info and update permissions, so that a leak cannot create content or touch other APIs.
26. As the maintainer, I want the REST endpoint to be a validated non-secret setting restricted to Braze's own hosts, so that the worker cannot be pointed anywhere else with the key.
27. As the maintainer, I want unauthenticated calls to every worker route rejected, including routes the shell already has, so that the Braze key cannot be spent by strangers.
28. As the maintainer, I want the worker to honour Braze's rate-limit headers and pace calls, so that this integration does not starve other API users of the workspace.
29. As the maintainer, I want one failed block not to block the others, so that one bad target does not stop a campaign.
30. As the maintainer, I want the module to never create, archive, delete or blank a block, so that automation cannot destroy assets that Braze cannot restore.
31. As the maintainer, I want an unchanged page to cause no Braze writes, and a forced sync of identical content to cause no Braze write either, so that Braze's "last edited" timestamp is not churned.
32. As the maintainer, I want structured logs with request ids, binding ids and error codes but no key, no Braze message text and no content, so that I can debug without a new leak.
33. As the maintainer, I want Braze added by registration only (module, descriptor, secret name, README), so that the shell is not modified by a vendor ticket.
34. As the maintainer, I want the extension README to document Braze setup (credentials, permissions, endpoint, the fact that no site configuration is read), so that a new person can enable it alone.
35. As the maintainer, I want the key's rotation to be a secret update plus a new Braze key with no code change, so that a leak is a five-minute fix.

Security reviewer:

36. As a security reviewer, I want proof that a canary Braze key never appears in any response, header, log line or stored row, including when Braze echoes it, so that "never reaches the browser" is tested.
37. As a security reviewer, I want proof that every route still returns 401 without a token with the Braze provider registered, so that a provider cannot add an unauthenticated path.
38. As a security reviewer, I want proof that the user's IMS token is never sent to Braze, so that token handling stays auditable.
39. As a security reviewer, I want proof that no value from a page can make Braze execute Liquid or Connected Content, so that page content cannot become a server-side request from Braze or a personal-data leak.
40. As a security reviewer, I want proof that only the configured Braze host is ever called and redirects are not followed, so that the key cannot be sent elsewhere.

Vendor developer (the owner or an agent working #28, #30 to #32):

41. As a vendor developer, I want a written verdict on where the vendor interface did and did not fit Braze, so that I can plan my own vendor against the same interface.
42. As a vendor developer, I want the Braze module to pass the shared contract suite unchanged, so that it is a worked second example next to Marketo.

## Implementation Decisions

(No file paths or code. Layout and contract shapes are in the Build Analysis. Decisions about the shell and template are phrased as requirements or optional amendments, never as edits made by this ticket.)

**Scope and shape**

1. **Braze is one provider module.** It lives in `apps/marketing-automation-sync/providers/braze/`; its worker module under `providers/braze/worker/` (per #2 Decision 3 [OPEN there: confirm that refinement]); its README next to it. It is registered in the extension worker's vendor registry list. Registration is the only change allowed outside the provider folder: one registry entry, the secret name in the worker config, the non-secret variable, the `.dev.vars.example` line, and a Braze section in the extension README (AC3 and AC4 of #29). A repo check enforces that no shell source file mentions the vendor (BR4).
2. **One target kind: `content-block`, slot model `single`, formats `text`, `html`, `url`, `image`, one slot named `content`, approval supported.** `url` and `image` formats are plain strings; they are legitimate in Braze because blocks are routinely used as values inside Liquid or attributes [ASSUMPTION about common use; no source]. The slot name is a constant the shell treats like the Marketo snippet's single slot [ASSUMPTION: confirm the constant the shell expects for `single` kinds when the Marketo module is built; OQ 13].
3. **Targets are existing Content Blocks only; the module has no create operation.** This matches the #27 interface ("no create-target") and the irreversibility facts above: names are permanent, cannot be reused, and nothing can be deleted. The admin creates the block in the Braze dashboard first (HTML editor, with placeholder content; the create endpoint would also need `content_blocks.create`, which the key deliberately lacks). A follow-up "create block from mapping" would be a cross-vendor interface change (OQ 3).
4. **Never destructive.** The module calls only `GET /content_blocks/list`, `GET /content_blocks/info` and `POST /content_blocks/update`. It never calls create, never sends `name`, `description` or `tags` on update, never archives, and refuses an empty or whitespace-only value before any call (Braze rejects blank content anyway: "Content cannot be blank" [VERIFIED]).
5. **Single-tenant, single workspace per deployment.** One Braze REST key (workspace-scoped [VERIFIED: "API keys are workspace-specific"]) and one REST endpoint per worker deployment. Per-site credentials and multi-workspace are out of scope (same stance as #27 Decision for Marketo; OQ 7).

**Auth and configuration**

6. **Auth: static Bearer key in the `Authorization` header** [VERIFIED: https://www.braze.com/docs/api/basics, "Bearer token authentication"]. There is no token exchange, no session and no expiry. The template `proxy` injects the secret by name into the header; the module never holds the raw value (template Decision 7 and 8). No R-T2 (dynamic secret) or body-secret injection is needed.
7. **Secrets and variables.** Secret: `BRAZE_API_KEY`. Non-secret variable: `BRAZE_REST_ENDPOINT` (a full origin). The module accepts only an `https` origin with no userinfo, port, path, query or fragment whose host matches the Braze REST host pattern: `rest.` followed by an instance id (`iad-NN`, `us-NN`, `fra-NN`, `au-01`, `id-01`, `jp-01`, `kr-01`) and `.braze.com` or `.braze.eu` [VERIFIED set of 15 documented hosts: https://www.braze.com/docs/api/basics; matching new instances by pattern is an ASSUMPTION, since Braze may add instances]. The proxy host allowlist for every Braze call is exactly that host. No URL comes from callers.
8. **`connect` makes one cheap probe**, `GET /content_blocks/list?limit=1`, and caches a *success* in isolate memory for 5 minutes [ASSUMPTION: TTL]. Braze has no whoami endpoint; list is the least-privilege read that proves key, endpoint and permission together. Outcome mapping: `200` yields a session; `401` `auth_failed` (invalid key, wrong region, wrong workspace; the three causes are indistinguishable [VERIFIED: errors page lists all as 401]); `403` `permission_denied`; `5xx`, `429` and network failure `vendor_unavailable` (retryable). The session holds only the validated base URL.
9. **Least-privilege key (documented in the README):** `content_blocks.list`, `content_blocks.info`, `content_blocks.update`. A Braze key's permissions and IP allowlist cannot be edited after creation; a new key replaces the old one [VERIFIED: API overview]. The README recommends leaving the IP allowlist empty only because stable Workers egress is not available [ASSUMPTION], and recommends a dedicated key and a dedicated workspace for testing (OQ 8).

**Interface mapping (the verdict required by #27 Open Question 13 for this vendor)**

10. **`descriptor`**: id `braze`, label "Braze"; one kind `content-block` (label "Content Block"), slot model `single`, formats all four, constant slot name, `supportsApproval: true`, required secret `BRAZE_API_KEY`, required variable `BRAZE_REST_ENDPOINT`. `configured` is true only when the key is present and not a sentinel, and the endpoint validates.
11. **`listTargets`**: `GET /content_blocks/list` with `limit` up to 1000 (default 100) and `offset` [VERIFIED]; the opaque cursor is the offset. Response items: `content_block_id`, `name`, `content_type` (`html`|`text`), `liquid_tag`, `inclusion_count`, `created_at`, `last_edited`, `tags` [VERIFIED]; the module returns `{ id, name, kind, updatedAt: last_edited }`. **There is no name search**; like the Marketo snippet listing, a `query` is applied in the worker over pages up to a bounded page budget (default 5 pages of up to 1000 blocks) and the response reports truncation [ASSUMPTION: budget]. Ordering and offset stability are undocumented [OPEN, spike B5]. No `status` is returned for blocks (list and info have no `state` field) [VERIFIED by absence]; the module cannot offer a draft/active badge.
12. **`describeTarget`**: `GET /content_blocks/info?content_block_id=...` [VERIFIED]; returns the single slot `content` whose `type` is the block's `content_type`. Info also returns `content`, `description`, `inclusion_count`, `created_at`, `last_edited`; the module never returns `content` or `description` to the browser (no bodies cross the boundary). `Content Block ID is invalid for this workspace` and `Content Block has been deleted—content not available` map to `target_not_found` [VERIFIED strings; mapping on message text is an ASSUMPTION; the HTTP status for them is undocumented, spike B1].
13. **`push`** per target, one slot only (more than one slot or a slot name other than the constant is `invalid_value` before any call), in this order:
    1. `info` (existence, `content_type`, current `content`).
    2. Build the final value (decisions 14 and 15). If it equals the current `content` exactly, **write nothing** and report `written` (idempotent no-op; keeps `last_edited` untouched) [ASSUMPTION: `info.content` is returned exactly as stored; spike B4. If not, this step is dropped and the shell's hash gate is the only no-op guard].
    3. `POST /content_blocks/update` with JSON `{ content_block_id, content, state }` where `state` is always explicit: `"active"` when `approve` is on, `"draft"` when off. Explicit state is deliberate: the docs say state "Defaults to `active` if not specified" for update, which on a draft block could silently launch it [VERIFIED wording; effect OPEN, spike B2].
    4. `vendorState` in the result is the state that was requested after a successful write [ASSUMPTION: the update response carries no state field; the documented response is `content_block_id`, `liquid_tag`, `created_at`, `message`].
    5. Success requires HTTP `2xx` and `message: "success"`; anything else is a `failed` slot with code `unknown` and `retryable: false` [ASSUMPTION].
14. **Approval semantics (one-way).** `approve` off: write as `draft`. This succeeds only for blocks that are still drafts; for an active block Braze rejects with "Active Content Block can not be updated to Draft" [VERIFIED] and the module returns `invalid_value` (non-retryable) so the status view shows a fixed message (README troubleshooting maps it to "block is live: enable approve to update it"; richer text needs amendment PA2). `approve` on: write as `active`; on a draft block this **launches it**, on an active block it updates it live. There is no way to stage an edit to an already-live block, so the admin is told, in the README and via the descriptor-driven approval option, that approve means "live". Default stays off, consistent with #27 Decision 20.
15. **Encoding of values (module-side, deterministic, idempotent).** The block's `content_type` comes from the `info` call.
    - **html block:** (a) `text`, `url` and `image` values are HTML-escaped (`& < > " '`); `html` values arrive already sanitised from the shell (#27 Decisions 9 and 42) and are not re-sanitised; (b) for all formats, every `{` that begins `{{` or `{%` is written as the numeric character reference `&#123;` so no Liquid opener remains in the stored content. Numeric references render as `{` in HTML and are not Liquid [ASSUMPTION: Braze's Liquid pass does not decode entities; confirmed by spike B3 with a preview render].
    - **text block:** values are written unmodified, except that a value containing `{{` or `{%` is **rejected** (`invalid_value`) because a text block has no safe encoding and Braze would execute it. (`{% raw %}` wrapping is not used: the only source found for Braze support is a third-party integration page, https://learn.better.email/docs/integrations/braze, not Braze documentation [ASSUMPTION]; revisit if spike B3 proves it.)
    - Per-author Liquid (deliberate personalisation tags written in EW) is out of scope (OQ 4).
16. **Size guard.** After encoding, the UTF-8 byte length must be at most 50,000 bytes; Braze documents "Maximum of 50 KB" and "Content must be smaller than 50kb" [VERIFIED text; whether KB is 1000 or 1024 bytes is OPEN, so the conservative figure is used]. Oversize is `invalid_value` before any write.
17. **Error classification** (all by HTTP status and the documented message strings; raw Braze text never leaves the worker):

    | Braze response | Module code | retryable |
    |---|---|---|
    | `401` (invalid key, wrong endpoint, wrong workspace) | `auth_failed` | no |
    | `403` (missing permission; or inactive account) | `permission_denied` | no |
    | `400` on info/update with "invalid for this workspace" or "deleted" | `target_not_found` | no |
    | `400` on update otherwise ("blank", "smaller than 50kb", "malformed liquid", "Active ... can not be updated to Draft", ...) | `invalid_value` | no |
    | `404` (invalid URL), `415` | `unknown` (configuration/bug; logged by code only) | no |
    | `429` | `rate_limited` | yes |
    | `5xx`, timeout, network failure, unfollowed `3xx` | `vendor_unavailable` | yes |
    | anything else | `unknown` | no |

    There is no Braze analogue of Marketo's daily quota; the module never emits `quota_exhausted` [VERIFIED: limits are per hour, reset on the clock hour].
18. **Retry and pacing.** Braze returns real statuses, so the template retry helper applies: `429` and `5xx` retried with backoff; the `update` POST is passed the template's explicit "safe to retry" flag (writing the same value twice is idempotent). For `429` Braze documents `X-RateLimit-Retry-After` (seconds) and `X-RateLimit-Reset` (UTC epoch seconds), lower-case under HTTP/2 [VERIFIED: rate limits page]; the template honours only `Retry-After` [VERIFIED per #2 Decision 8]. Requirement PT1 below asks the template for a vendor-supplied retry-delay hook; the fallback is a module-owned loop above `proxy` with `retries: 0`. Pacing: at most 2 concurrent calls and 5 calls per second from this worker [ASSUMPTION; Braze documents no per-second limit for these endpoints], each push costs 2 calls (info and update), counted against the shell's per-day budget (`DAILY_CALL_BUDGET`); the 250,000 per hour limit is shared with `content_blocks/*`, `templates/*`, campaign and segment reads and more [VERIFIED list], so the worker reads `X-RateLimit-Remaining` and logs it as a number (no secrets) and pauses when it is low [ASSUMPTION: threshold 5%].
19. **No source-event or drift features.** Change detection, hashing, retry schedule, leases, partial failure and status are the shell's, unchanged. Edits made inside Braze are overwritten by the next sync of a changed page (last write wins; same stance as #27 Out of Scope).

**Registration and documentation**

20. **Provider README (`providers/braze/README.md`) and an extension-README section** document: creating a dedicated REST key with exactly the three permissions; finding the REST endpoint (**Settings > APIs and Identifiers > API Keys**, copy the endpoint shown) [VERIFIED path: API overview]; setting `BRAZE_API_KEY` with `wrangler secret put` and `BRAZE_REST_ENDPOINT` as a non-secret variable; creating a target block in the HTML editor first; draft versus approve behaviour including the "cannot go back to draft" and "no history" warnings; the Liquid/encoding behaviour; the fact that the extension reads **no EW site configuration** (the shell's statement, repeated) so the "site config keys" for Braze are the worker variables and secrets above plus the shell's site allowlist; key rotation (create new key, set secret, delete old key) [VERIFIED: keys cannot be edited]; troubleshooting table keyed to the fixed status messages; policy note carried from #1 R1.
21. **Multi-vendor secret declaration is a deployment decision, not a Braze one.** The #27 shell declares vendor secrets in the worker's `secrets.required`, and Wrangler fails `deploy` when a required secret is missing, while loading only the listed keys from `.dev.vars` [VERIFIED: https://developers.cloudflare.com/workers/wrangler/configuration/]. With six vendors queued, one worker cannot both require every vendor's secret and deploy for Marketo only. Baseline for this ticket: `BRAZE_API_KEY` is added to `secrets.required` like Marketo's, and a deployment that does not use Braze sets the sentinel value `unset`, which the module reports as `configured: false` (`vendor_not_configured`). Owner decision needed (OQ 6); alternatives are per-vendor Wrangler environments or removing vendor secrets from `required`.

## Testing Decisions

**What makes a good test here.** Same rule as #27: assert external behaviour only. Given an HTTP request or a cron tick and a fake outside world (fake Braze, fake published site, fake DA admin, fake IMS, fake clock, in-memory store), assert the response, what the fake Braze received (operations, order, count, bodies), what the status route then says, and what was logged. Never assert on internal helper names or how many internal functions ran. Properties asserted as negatives across every path: (1) the canary API key never appears in any response, header, log line or stored row; (2) no handler or Braze call happens before authentication and authorisation succeed; (3) the fake Braze's create, archive, delete and blank-update counters stay at zero for the whole suite; (4) an unchanged page, and a forced sync of already-identical content, cause zero `update` calls; (5) the stored content in the fake never contains a Liquid opener (`{{` or `{%`) unless the source was a rejected text-block value.

**Proposed seams** (recorded instead of asked, per #67). **No new seam is introduced**; every Braze test hits a seam #27 already defined:

| # | Seam | Status | Used by (Braze) | How the outside world is faked |
|---|------|--------|-----------------|--------------------------------|
| V1 (primary) | Vendor contract suite: one behavioural suite that takes a vendor module and a fake of that vendor's API | reused from #27 | The Braze module: descriptor, connect, listTargets, describeTarget, push, error taxonomy, encoding, pacing | `fakeBraze` (stateful HTTP handler; see Testing Requirements 1) |
| W1 | Worker HTTP boundary `worker.fetch(request, env, ctx)` | reused from #2/#27 | Provider registration, vendor route, mapping validation with the Braze descriptor, auth enumeration with the provider registered, canary property | Constructed `Request`, env factory, fake IMS, `fakeSite`, `fakeDa`, `fakeBraze` as scripted fetch handlers |
| R1 | Worker tick `worker.scheduled(...)` plus the on-demand sync route on a fake clock | reused from #7/#27 | Change detection, hash gating, retry, partial failure with Braze registered | Same fakes plus controllable clock |
| R2 | Store contract | reused | none new | none |
| S1 | Entry page plus SDK module boundary | reused from #1 | Playwright e2e with the real local worker and a Node `fakeBraze` server | #1 SDK stub; `wrangler dev`; Node fakes |
| S2 | Render/logic module plus SDK result | reused from #1 | WTR check that the app renders Braze from the descriptor alone | Injected `fetch`; hand-built SDK result |
| S3 | Repo convention check | reused from #1/#2/#27 | Provider folder completeness, README, secret hygiene, "no vendor name in shell" | Temp-dir fixtures |
| W2 | Same worker in the real workers runtime | reused from #2 | Smoke tier | `wrangler dev` with local D1 and local fake servers |

Why V1 is primary: AC3 ("later vendors only add a module") is a property of the interface, and this ticket is the second real proof of it. The Braze module passes the same suite as Marketo and the in-repo fake vendor, with Braze-specific cases layered on the same seam. The real boundary to Braze and real EW is covered only by manual verification.

**Modules tested:** Braze module (auth, configuration validation, listing, info, push, encoding, classification, pacing); the shell's registry, mapping validation, sync engine and status with Braze registered (to prove they need no change); the app's descriptor-driven rendering with Braze; repo checks.

**Prior art:**
- This repo: #27's V1 suite, MK1-MK10 for the Marketo module (`apps/marketing-automation-sync/SPEC.md`), #2's test kit (fake IMS, fake upstream, env factory, canary), #1's seams S1-S3.
- Upstream `adobe-rnd/ew-extensions`: no Braze or worker code; only the dependency-injection pattern (`fetchImpl`, `storage`, `now`) and the stub-only e2e idea, as cited in #1/#2/#27.
- Braze's own error and limit tables (cited above) are the source for the fake's behaviour.

## Out of Scope

- Creating, renaming, archiving, deleting, tagging or describing Content Blocks (the API has no delete and no un-archive; create is deliberately not used).
- Braze email templates, campaigns, Canvases, Connected Content, catalogs, Content Cards, in-app messages, and sending anything. Content Block **translation** endpoints (Braze has `GET/PUT` translation endpoints for Content Blocks [VERIFIED in the API index]) and per-locale blocks; a localised page is just another page (#27 Out of Scope). A per-locale follow-up is OQ 13.
- Edits made in Braze flowing back to EW; drift detection when someone edits a block in Braze (the next sync overwrites; `info` exposes `last_edited` so a later ticket could warn).
- Author-written Liquid or personalisation in EW copy (neutralised, not supported).
- Multi-workspace or per-site Braze credentials entered in the app (single-tenant, as #27).
- Dashboard drag-and-drop blocks as a supported target (README warns; spike B6 decides whether the API can safely update them).
- Any change to the mapping UI, mapping model, extraction, store, sync engine or status view.
- The Adobe outside-activity/IP policy decision (owned by #1 R1).

## Further Notes

- **Interface verdict (answers #27 OQ 13 for Braze).** The #27 interface fits Braze with no change to the shell: one `single`-slot kind, existing targets only, explicit approval, normalised errors. Four optional additive amendments would improve the product but are not required (Build Analysis section 6). The one genuinely cross-vendor finding is that vendor modules may need to transform values (escape, neutralise template syntax) and then the shell's preview is not "exact"; Klaviyo, HubSpot and Iterable execute template syntax too [INFERENCE; not researched], so this affects #30-#32.
- **Contentful's Braze app is the closest comparator** and differs by design: it runs in Contentful's UI, takes a key typed into the app installation, syncs on demand per locale, and needs `content_blocks.create`, `.update`, `.info` and `.list` [VERIFIED: partner page]. This module keeps the key out of the browser, syncs on publish by polling, and needs no create permission.
- **Connected Content is the alternative architecture** for "always-current content": Braze would fetch the EW page's published content at send time, with no worker, no polling and no write permission (Contentful offers it beside block syncing [VERIFIED: partner page]). It is out of scope for this ticket and worth owner consideration for time-sensitive content; it needs a public, CORS-agnostic content URL and Braze's own caching and abort rules.
- **No sandbox is available to the agent.** Braze does not appear to offer a public self-serve sandbox [ASSUMPTION; not verified]; every Braze behaviour here comes from documentation. The `fakeBraze` fixtures are hand-written from the docs until spikes B1-B6 run against a real workspace.
- **Rate-limit headers:** documented for requests "subject to standard REST API rate limiting"; whether the content-block endpoints return them is not stated per endpoint [VERIFIED statement; effect OPEN, spike B5].
- **`apps/marketing-automation-sync/providers/braze/SPEC.md`** is a planning artefact; keep or delete it when the provider is built (same low-stakes decision as the other specs).

---

# Build Analysis

## 1. Architecture and responsibilities

```
 EW app "Marketing Automation Sync"  (unchanged shell; vendor picker rendered from GET /vendors)
        │  Authorization: Bearer <IMS token>   (template: origin gate, IMS auth, site allowlist, DA permission)
        ▼
 ┌─────────────────────── Worker (shared/worker-template core; shell unchanged) ──────────────────────────┐
 │ vendor registry:  marketo | fake-vendor (test) | braze   <-- the only shell edit: one registry entry   │
 │ tick / Sync now → engine → vendor.push(session, {kind:"content-block", id}, [{content,format,value}])  │
 │ Braze module (providers/braze/worker):                                                                │
 │    connect: probe list?limit=1 (cached 5 min)  │ listTargets: list (limit≤1000, offset)               │
 │    describeTarget/push: info → encode → (equal? skip) → update{content_block_id,content,state}        │
 │ proxy: header-injected secret BRAZE_API_KEY, allowedHosts=[BRAZE_REST_ENDPOINT host], no redirects    │
 └───────────────┬────────────────────────────────────────────────────────────────────────────────────┘
                 ▼  HTTPS, Authorization: Bearer <BRAZE_API_KEY>
        https://rest.<instance>.braze.(com|eu)/content_blocks/{list,info,update}
```

| Concern | App (browser, public static) | Worker (holds secrets) |
|---|---|---|
| Braze key | never | only place; secrets store; injected by `proxy` into the `Authorization` header |
| REST endpoint | never (not even shown) | non-secret var, validated against the Braze host pattern |
| Content Block listing, search | renders from the worker's response | pages `list`, filters by name, strips to `{id,name,updatedAt}` |
| Value encoding (escape, Liquid neutralisation) | none; preview shows the worker's result | all, module-side |
| State (draft/active) | shows the approve option from the descriptor | explicit `state` on every write |
| Rate limits, retries | none | status handling, `X-RateLimit-*`, pacing |

## 2. EW integration points

- **Type:** the provider adds no EW surface. The extension stays a fullscreen **app** (`apps` sheet row; type `app` in the extensions table); Braze changes neither the row, the entry page nor the README table row (AC3, AC5 of #27 stay as built). No `library` row.
- **SDK usage:** none new. `token` and `context` as in #27; the page never talks to Braze.
- **Config-sheet rows:** none new. "Site config keys" read by the extension: **none** (#27 Decision 3). Braze configuration is two worker-side items: secret `BRAZE_API_KEY`, variable `BRAZE_REST_ENDPOINT`.
- **`ref=local`:** page at `http://localhost:3000`, worker at `http://localhost:8787` (`wrangler dev`, local D1); local `.dev.vars` carries `BRAZE_API_KEY` (must be listed in `secrets.required` to be loaded locally [VERIFIED: Wrangler docs], decision 21); `BRAZE_REST_ENDPOINT` set in the local environment's `vars`. Against a real Braze test workspace or the local `fakeBraze`. The local-only content-origin override and cron trigger documented in #27 apply unchanged.
- **Branch ref:** page on `{branch}--{site}--{org}.aem.live` (or `.preview.da.live`) calls the **deployed** worker; Braze credentials and mappings are per worker deployment, not per branch (#27 OQ 15 carries over).

## 3. External APIs and auth flows

| API | Use | Auth | Source / status |
|---|---|---|---|
| `GET {rest}/content_blocks/list?limit&offset[&modified_after&modified_before]` → `{ count, content_blocks: [{ content_block_id, name, content_type, liquid_tag, inclusion_count, created_at, last_edited, tags }] }`; `limit` default 100, max 1000 | list targets; connection probe (`limit=1`) | Bearer key with `content_blocks.list` | [VERIFIED] https://www.braze.com/docs/api/endpoints/templates/content_blocks_templates/get_list_email_content_blocks ; ordering/offset stability [OPEN, B5] |
| `GET {rest}/content_blocks/info?content_block_id=...[&include_inclusion_data]` → `{ content_block_id, name, content, description, content_type, tags, created_at, last_edited, inclusion_count, inclusion_data, message }` | describe target; pre-write read (type, current content) | key with `content_blocks.info` | [VERIFIED] .../get_see_email_content_blocks_information ; error strings "Content Block ID is invalid for this workspace", "Content Block has been deleted—content not available" |
| `POST {rest}/content_blocks/update` JSON `{ content_block_id (req), name?, description?, content?, state?, tags? }` → `{ content_block_id, liquid_tag, created_at, message: "success" }`; `state` `active` or `draft`, "defaults to active if not specified"; errors incl. "Content must be smaller than 50kb", "Content contains malformed liquid", "Content cannot be blank", "Content Block name cannot be updated for active Content Blocks", "Active Content Block can not be updated to Draft. Create a new Content Block." | write content | key with `content_blocks.update` | [VERIFIED] .../post_update_content_block ; effect of omitted `state` [OPEN, B2] |
| `POST {rest}/content_blocks/create` | **not used** (documented only to explain why the key lacks `content_blocks.create`) | `content_blocks.create` | [VERIFIED] .../post_create_email_content_block |
| Endpoint hosts | per-instance REST hosts (15 listed) | n/a | [VERIFIED] https://www.braze.com/docs/api/basics |
| Auth | `Authorization: Bearer <REST API key>`; keys are workspace-scoped; permissions and IP allowlist fixed at creation; optional IP allowlist; rotate by new key plus delete old | n/a | [VERIFIED] same page |
| Rate limits | 250,000 requests/hour default, shared across `content_blocks/*`, `templates/email/*`, campaign/canvas/segment reads and more; resets on the clock hour; `429` plus `X-RateLimit-Limit`, `-Remaining`, `-Reset` (epoch s) and (on 429) `X-RateLimit-Retry-After` (s); lower-case header names | n/a | [VERIFIED] https://www.braze.com/docs/api/api_limits ; per-endpoint header presence [OPEN, B5] |
| Errors | `401` (bad key, wrong endpoint, wrong workspace), `403` (insufficient permission or inactive account), `400`, `404`, `415`, `429`, `5xx` (retry with exponential backoff); success body `{ "message": "success" }` | n/a | [VERIFIED] https://www.braze.com/docs/api/errors ; exact body shape for 4xx on these endpoints [OPEN, B1] |
| Payload limit | most endpoints 4 MB request bodies | n/a | [VERIFIED] rate-limits page; Content Block content cap is 50 KB |
| Content Block rules | name ≤ 100 chars, letters/digits/`-`/`_`, immutable once saved, never reusable (even archived); content ≤ 50 KB; archived blocks read-only and cannot be archived while in use; no version history | n/a | [VERIFIED] https://www.braze.com/docs/user_guide/messaging/design_and_edit/content_blocks |
| Cloudflare `secrets.required` semantics | deploy fails on missing required secrets; only listed keys load from `.dev.vars` | n/a | [VERIFIED] https://developers.cloudflare.com/workers/wrangler/configuration/ |

**Auth flows.**
1. *App to worker*: unchanged (#27): SDK token, template IMS check, site allowlist, DA permission check with the caller's own token sent only to `admin.da.live`.
2. *Worker to Braze*: `BRAZE_API_KEY` from `env` injected by `proxy` into `Authorization: Bearer`; host allowlist = the configured REST host; redirects not followed; the caller's IMS token is never forwarded. Redaction covers the key value (static secret; no dynamic registration needed).
3. *Cron*: no user, no IMS token; uses the stored mapping, anonymous content fetch and the Braze key only.

## 4. Data contracts

All shell contracts are unchanged (#27 section 4). Braze-specific values:

**Descriptor entry** (`GET /vendors`): `{ id: "braze", label: "Braze", configured, targetKinds: [ { kind: "content-block", label: "Content Block", slotModel: "single", valueFormats: ["text","html","url","image"], slotName: { maxLength: <constant>, pattern?: <constant> }, supportsApproval: true } ] }`.

**Module operations** (names from #27's table; Braze behaviour):

| Operation | Braze behaviour |
|---|---|
| `connect(env)` | validate `BRAZE_REST_ENDPOINT` and `BRAZE_API_KEY` locally; probe `list?limit=1`; session `{ baseUrl }` |
| `listTargets(session, "content-block", { query, cursor, limit })` | `list` with `offset = cursor`, `limit = min(1000, ...)`; name filter in-worker within the page budget; items `{ id, name, kind: "content-block", updatedAt }`; `nextCursor` = next offset; truncation flag when the budget stops a filtered scan |
| `describeTarget(session, "content-block", id)` | `info`; `{ id, name, kind, slots: [{ name: <constant>, type: content_type }] }` |
| `push(session, {kind,id}, [{ name, format, value }], { approve })` | `info`, encode, no-op if equal, else `update` with explicit `state`; per-slot `{ outcome, error? }` and `vendorState` |

**Error taxonomy mapping:** decision 17. **Mapping document:** a `braze` binding is `{ vendor: "braze", target: { kind: "content-block", id, name }, rules: [ exactly one { field, format, slot } ], options: { approve } }`; the shell's existing validation (`single` kinds have exactly one rule; no two rules write the same (vendor, target, slot)) applies unchanged.

**Configuration:** non-secret `BRAZE_REST_ENDPOINT`; shell variables unchanged (`SITE_ALLOWLIST`, `VALUE_MAX_BYTES`, `TICK_CALL_BUDGET`, `DAILY_CALL_BUDGET`, `ALLOWED_IMS_CLIENT_IDS`, local-only `ALLOW_LOCALHOST` and `CONTENT_ORIGIN_OVERRIDE`). **Secrets:** `BRAZE_API_KEY` (plus Marketo's, per decision 21).

**Status/Errors visible to users:** fixed messages keyed by code only; Braze `message` text is never forwarded (it can name blocks).

## 5. Folder layout (fits #1, #2 and #27)

```
apps/marketing-automation-sync/
├─ README.md                            + a "Braze" section (credentials, permissions, endpoint, draft vs approve, rotation); states "reads no site config"
├─ worker/                              shell, unchanged except: vendor registry list (+ braze), wrangler secrets.required (+ BRAZE_API_KEY), vars (+ BRAZE_REST_ENDPOINT), .dev.vars.example (+ BRAZE_API_KEY)
└─ providers/braze/
   ├─ SPEC.md                           this file
   ├─ README.md                         vendor setup, troubleshooting, limits, rotation
   └─ worker/                           Braze module + descriptor; test/ with fakeBraze, the V1 suite run, Braze cases, fixtures
```

No new top-level files, no new dependencies (the module uses only `fetch` through `proxy`).

## 6. Interface fit and amendment proposals (input to the owner; none is required for #29)

Concept mapping, Marketo (as specified in #27) to Braze:

| Concept | Marketo | Braze | Fit |
|---|---|---|---|
| Target kind(s) | program (named slots), snippet (single) | Content Block (single) | Fits (`single` kind reused) |
| Create-on-write | tokens created on first push | not possible without create; target must pre-exist | Fits the "no create-target" rule; weaker UX (decision 3) |
| Approval | snippet draft, `approveDraft`; stageable, reversible | state `draft`→`active`, one-way; an active block cannot be staged | Fits the boolean option; semantics differ (decision 14) |
| Errors | HTTP 200 plus in-body codes | real HTTP statuses | Simpler (R-T3 not needed); `X-RateLimit-*` needs PT1 |
| Quota | 50,000/day, 100 per 20 s | 250,000/hour shared, no per-second figure | `quota_exhausted` unused |
| Value transform | token type by format | HTML escaping and Liquid neutralisation by block content type | Needs preview fidelity (PA1) |
| Name search | programs by name; snippets none | none | Same in-worker filter pattern (MK7 analogue) |
| Auth | two-legged OAuth, 1 h token | static Bearer key | Simpler (`connect` = probe) |

Proposed amendments (each cross-vendor, additive, optional; baseline in the last column keeps the ticket within AC3 as written):

| ID | Proposal | Why Braze needs it | Baseline without it |
|---|---|---|---|
| PA1 | `push` accepts `dryRun`: returns per slot the final value and `would_write`, performs reads only | Preview must show the encoded content (decision 15), not the pre-encoding extraction | Preview shows the extracted value; README states Braze encodes `{{`/`{%` and HTML-escapes text. Marked as a known gap in AC1 "preview exact values" for Braze |
| PA2 | `push` result error may carry a module-defined `reason` mapped by the shell to a fixed message | "block is live: enable approve", "contains Liquid delimiters", "too large" are all `invalid_value` today and indistinguishable | Single fixed message for `invalid_value`; README troubleshooting table explains the reasons |
| PA3 | `describeTarget` returns optional `meta` (`inclusionCount`, `contentType`) shown by the picker | Story 12: warn before live writes to a block used in many messages; story 7 | None shown |
| PA4 | Descriptor `approval` copy (label, one-way flag, effect text) | "Approve" means "go live" and cannot be undone for Braze | Generic label; README explains |
| PT1 (template) | `proxy` accepts a vendor-supplied retry-delay function for `429` (reads `X-RateLimit-Retry-After`/`X-RateLimit-Reset`) | Template honours only `Retry-After` [VERIFIED per #2] | Module owns the retry loop above `proxy` with `retries: 0` (same fallback #27 gives R-T3) |
| S-1 (deployment) | Resolve multi-vendor `secrets.required` (decision 21) | Required-secret failure blocks single-vendor deploys | Sentinel `unset` value |

## 7. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No Braze workspace for build verification**; no public sandbox known [ASSUMPTION] | High | Spikes B1-B6 are the first steps that need credentials; fake fixtures hand-written from docs until then; manual MB0-MB9 blocked without a workspace; OQ 1 |
| R2 | **Live writes with no undo or history** [VERIFIED] | High | Draft by default; explicit `state`; approve is a deliberate opt-in; README warning; optional PA3 usage warning; no-op write skip; OQ 2 and 10 |
| R3 | **Liquid injection** from page text through the block (Connected Content) | High | Mandatory neutralisation (decision 15) with a property test (BL1) and a manual proof (MB4); spike B3 confirms entity behaviour; text blocks reject |
| R4 | **Key blast radius** (REST key unrestricted by IP; powerful if given more permissions) | High | Three permissions only; key only in worker; README least-privilege steps; rotation story; OQ 8 and 15 |
| R5 | **Draft/active state is invisible to the API** (no `state` in list or info) | Medium | Explicit `state` on every write; classify the documented rejection; spike B2 checks omitted-state behaviour and drafts in list |
| R6 | **Error classification by message text** (`400` for several causes) | Medium | Narrow use (info target existence, documented strings); unknown `400` is `invalid_value` non-retryable; fixtures from real responses after B1 |
| R7 | **`info.content` may not round-trip** (normalisation) so the no-op check could misfire | Low-Med | Drop the equality skip if B4 shows normalisation; the shell hash gate remains |
| R8 | **Shared hourly limit** with other Braze API users (e.g. a Contentful app) | Medium | 2 concurrent, 5 per second [ASSUMPTION], daily budget, header-aware pause; OQ 11 |
| R9 | **Rate-limit headers not guaranteed** on these endpoints | Low-Med | Treat as best effort; `429` and backoff are the safety net; B5 |
| R10 | **Names are permanent and not reusable**; admin picks a wrong block | Low-Med | Picker shows name and last edited; preview; draft default |
| R11 | **Dashboard drag-and-drop blocks** may break if overwritten as HTML | Medium | README: target HTML-editor blocks only; B6 tests; PA3 `contentType` shows `html`/`text` only (cannot distinguish) [OPEN] |
| R12 | **List ordering/offset stability and scale** (1000 per page, filter by scan) | Low-Med | Page budget with truncation flag; B5 |
| R13 | **Multi-vendor secrets deployment** (decision 21) | Medium | Sentinel baseline; OQ 6 |
| R14 | **Docs drift**: the Braze permissions table links `content_blocks.update` to `/content_blocks_update` (a typo in the docs' endpoint column) while the endpoint page says `/content_blocks/update` | Low | Use the endpoint page; canary in spike B1 |
| R15 | **Adobe outside-activity/IP policy** and a customer-grade Braze key under a personal Cloudflare account (carries over from #1 R1, #2 R1, #27 R1) | High for publishing | [OPEN] README note; OQ 15 |

**Spikes (build-plan step 1; results recorded in the provider README and fixtures; all need a real Braze workspace):**
- **B1** Key and errors: confirm the three-permission set is sufficient and `create` is not needed; record real `401`/`403`/`400` bodies and statuses for list, info and update (including "invalid for this workspace", "deleted", archived block, missing permission, wrong region); confirm `403` variants.
- **B2** State: does `update` with `state` omitted activate a draft; can a draft be written as `draft` and launched with `active`; does a draft appear in list/info; what does update do on an archived block; does `include`-count change on write.
- **B3** Liquid: confirm `&#123;&#123;` stays literal and renders `{{` in preview and in a sent test; confirm `{{`/`{%` in stored content executes; test whether `{% raw %}` works (optional upgrade for text blocks); how "malformed liquid" is detected.
- **B4** Round trip: does `info.content` equal what was sent (whitespace, entities, unicode/emoji, line endings); is "50 KB" 50,000 or 51,200 bytes; blank and whitespace-only handling.
- **B5** Limits and paging: are `X-RateLimit-*` and `X-RateLimit-Retry-After` returned for these endpoints; ordering and offset behaviour of `list` with `limit=1000`; undocumented per-second limits.
- **B6** Editor type: what happens when the API overwrites a drag-and-drop block; does `content_type` distinguish it.

## 8. Ordered build plan (sized to #29's acceptance criteria)

0. **Prerequisites (owner):** #27 landed (shell, V1 suite, fake vendor, `fakeMarketo` patterns); a Braze workspace with a REST key (list, info, update) and a second key with `create` for test seeding only, or an explicit decision to build against the fake only; decisions on OQ 2, 3, 6; no shell edits needed.
1. **Spikes B1-B6**; commit findings to fixtures and README notes. (AC1, AC2)
2. **Fixtures and `fakeBraze`** first: stateful list/info/update/create with name immutability, active-to-draft rejection, 50 KB cap, blank rejection, deleted/other-workspace ids, per-key permission sets, hourly window with `X-RateLimit-*`, scripted `401/403/429/5xx`, a Liquid-opener detector, delete/archive/create/blank counters. (AC7)
3. **Module skeleton and descriptor**; V1 suite run for Braze goes red, then green (VC1-VC8). (AC3)
4. **Configuration validation, `connect`, secrets and host allowlist** test-first (BA). (AC6)
5. **`listTargets`, `describeTarget`** test-first (BT). (AC1)
6. **Encoding and Liquid neutralisation** test-first, property-based (BL). (AC1, AC6)
7. **`push` with state matrix, no-op skip and error classification** test-first (BP, BE). (AC2)
8. **Pacing, `X-RateLimit-*` handling** (BE2, BE5) using PT1 or the fallback loop. (AC2)
9. **Registration** (registry entry, `secrets.required`, vars, `.dev.vars.example`) and the engine/worker integration tests with Braze registered (BI). (AC2, AC3, AC6)
10. **Provider README and extension-README Braze section**; repo checks BR1-BR5. (AC3, AC4, AC7)
11. **Playwright e2e with a Node `fakeBraze`** (BX); **runtime smoke** (BSM). (AC1, AC2, AC5, AC6)
12. **Deploy and manual verification MB0-MB9** against a real workspace; record results and the observed `Origin` in the README. (AC1, AC2, AC5, AC6)
13. **Hand-off note** to #28, #30-#32: interface verdict and PA1-PA4/PT1/S-1 outcomes.

---

# Testing Requirements

## 1. Fixtures, fakes and conventions

All tests use #27's tiers and tooling: worker and module tests under the Node 22 built-in runner (`node:test`), app tests in `@web/test-runner`, e2e in Playwright (Chromium, hermetic), Node 22, ESLint 8 + helix config, Stylelint 16, husky. Tests live in the extension folder (module tests in `providers/braze/worker/test/`).

- **`fakeBraze`** (stateful fetch handler; also runnable as a local Node server for the e2e and smoke tiers): blocks `{ id, name, content, content_type, state (draft|active|archived|deleted), created_at, last_edited, inclusion_count }`; `GET /content_blocks/list` (limit default 100, max 1000, offset, documented errors), `GET /content_blocks/info` (documented fields and errors), `POST /content_blocks/update` (JSON; enforces: `content_block_id` required, blank content rejected, 50,000-byte cap, "malformed liquid" for unbalanced `{{`/`{%`, name immutable once active, active→draft rejected with the documented message, `state` defaults to `active` when omitted [ASSUMPTION per docs; spike B2], bumps `last_edited` only when content changes), `POST /content_blocks/create` (present only so tests can assert it is never called). Per-key permission sets (`list`, `info`, `update`, `create`) → `403`; unknown key or other-workspace id → `401`/`400`; clock-hour rate window with `x-rate-limit-*` lower-case headers and `429` with `x-ratelimit-retry-after`; scripted `5xx`, timeouts, `3xx`. A **Liquid-opener detector** over every stored `content`; a **render function** that decodes numeric character references to simulate the preview. Counters: create, archive, delete, blank-update, update, info, list. Fixtures are hand-written from the cited docs until spikes B1-B6 supply recorded, scrubbed responses.
- **Shared from #27/#2:** `makeEnv()` with production-like config and canary `BRAZE_API_KEY`; `fakeIms`; `fakeSite`; `fakeDa`; fake clock, `sleep`, `random`; in-memory store; `fakeVendor`. Golden `.plain.html` fixtures reused unchanged.
- **Test-data rules:** the canary key is a unique high-entropy string; no real key, workspace id or block name is ever committed; recorded fixtures are scrubbed of ids and names.

## 2. Vendor contract suite (seam V1)

VC1-VC8 from #27 run against the Braze module with `fakeBraze` and must pass **unchanged**. Mapping notes: VC2 `connect` = the probe; VC5 "push writes exactly the slots given" = one slot, one `update`; VC6 "per-slot failure isolation" is trivial for a single-slot kind and is proven across targets by BI6; VC8 (no delete or create-target) is asserted by the fake's counters.

## 3. Braze module tests (seam V1; behaviour through the public interface only)

| ID | Behaviour asserted |
|---|---|
| BA1 | Every outbound request carries `Authorization: Bearer <key>` (POST also `Content-Type: application/json`); host is exactly the configured REST host over `https`; the key appears in no URL, query or body; no header derives from the IMS token |
| BA2 | `BRAZE_REST_ENDPOINT` malformed set (`http`, other host, `rest.iad-01.braze.com.evil.example`, userinfo, port, path, query, IP literal, mixed case tricks, empty) → not configured and zero outbound calls; all 15 documented hosts accepted; `BRAZE_API_KEY` missing, empty or the `unset` sentinel → `configured: false`, `vendor_not_configured`, only the secret *name* in logs |
| BA3 | `connect` issues exactly one `GET /content_blocks/list?limit=1`; `200` session; `401` `auth_failed`; `403` `permission_denied`; `5xx`/`429`/network `vendor_unavailable` (retryable); a success is reused within the TTL (no second probe), a failure is not cached |
| BA4 | The shell's `POST /vendors/braze/test` returns `{ok:true}` or a fixed reason without Braze text, key or endpoint echo |
| BA5 | Least privilege: a key with only list, info, update works end to end and the fake's create counter is zero; a key without `info` or `update` gives `permission_denied` for `push` only while listing keeps working as allowed |
| BT1 | Descriptor complete: kind, slot model `single`, formats, constant slot name, approval true, secret and variable names; the app can render a picker and rule editor from it alone (feeds UI test BU1) |
| BT2 | `listTargets` pages by offset; per-call `limit` never exceeds 1000; `nextCursor` until exhausted; items carry only `id`, `name`, `kind`, `updatedAt` (no content, description, tags, inclusion data) |
| BT3 | `query` filters by case-insensitive name substring across pages within the page budget; a match on page 3 is found; a scan stopped by the budget reports truncation, never a false "no results" |
| BT4 | `describeTarget` returns the one slot with `type` from `content_type`; unknown id, deleted block and other-workspace id → `target_not_found`; ids are URL-encoded and validated as non-empty bounded strings; no content or description returned |
| BP1 | `push` order is `info` then `update`; the update body has exactly `content_block_id`, `content`, `state` (never `name`, `description`, `tags`) |
| BP2 | State matrix on the fake: draft + approve off → content updated, still draft (`vendorState: draft`); draft + approve on → updated and active; active + approve on → updated live; active + approve off → `failed` `invalid_value`, non-retryable, block untouched |
| BP3 | Value equal to the current content → zero `update` calls, outcome `written`, `last_edited` unchanged (skipped if spike B4 shows normalisation; then the shell hash gate is the test) |
| BP4 | First write to a placeholder block succeeds; the stored content equals the encoded value |
| BP5 | A slot name other than the constant, or more than one slot, → `invalid_value` before any call; empty or whitespace-only value → `invalid_value`, zero calls (defence in depth beyond the shell's `empty_value`) |
| BP6 | Replay safety: an update whose response is lost and which is replayed leaves the fake in the same state; the update is retried at most per the template policy and only with the safe-to-retry flag |
| BP7 | A `2xx` without `message: "success"` → `failed` `unknown`, non-retryable |
| BP8 | Call accounting: one push costs exactly two fake calls (info, update), one when the no-op skip applies; the count is what the shell's budget sees |
| BL1 | Liquid property test: for generated values (`{{`, `{%`, `{{{`, `{%-`, `{{ content_blocks.${x} }}`, `{% connected_content https://example.test :save r %}`, braces split by markup, unicode look-alikes) in every format into an **html** block, the stored content never contains `{{` or `{%`; the fake's preview render equals the source text; `connected_content` and personalisation tags are never present as executable text |
| BL2 | **text** block + value containing `{{` or `{%` → `invalid_value`, zero `update` calls; values without them are written unmodified |
| BL3 | `text` format into an html block: `& < > " '` escaped; into a text block: unmodified |
| BL4 | `url` and `image` formats: same escaping in html blocks (`&` in a query string becomes `&amp;`); unmodified in text blocks |
| BL5 | Determinism and idempotence: encoding the same source twice yields identical stored content, so a repeated sync hits BP3 |
| BL6 | `html` format passes through unchanged apart from brace neutralisation (the shell's EX4/EX5 own sanitisation; this test only asserts the module does not undo it) |
| BL7 | Size: encoded UTF-8 length exactly 50,000 bytes succeeds; 50,001 → `invalid_value` before any write; multibyte characters counted in bytes; brace neutralisation growth counted |
| BE1 | Status and message mapping per decision 17: `401`→`auth_failed`, `403`→`permission_denied`, `400` "invalid for this workspace"/"deleted"→`target_not_found` (also when the block disappears between info and update), other `400`→`invalid_value`, `404`/`415`→`unknown`, `429`→`rate_limited`, `5xx`/timeout/network/`3xx`→`vendor_unavailable`; none retryable except the last two; raw Braze text never appears in any result |
| BE2 | `429` handling on the fake clock: waits for `x-ratelimit-retry-after` seconds, else until `x-ratelimit-reset` epoch, bounded by the cap; lower-case header names honoured; exhausted retries → `rate_limited`, retryable |
| BE3 | `5xx` on `info` and `list` retried with backoff; on `update` retried only because of the safe flag; exhausted → `vendor_unavailable` |
| BE4 | Redirects are not followed; the fake sees no second request; result `vendor_unavailable` |
| BE5 | Pacing: with 150 targets against the fake's window, concurrency never exceeds 2 and the run never provokes `429`; a low `x-ratelimit-remaining` pauses new calls until the reset |
| BE6 | The module never emits `quota_exhausted` |
| BS1 | Never destructive: across the whole module suite the fake's create, archive, delete and blank-update counters are zero |
| BS2 | Canary: the canary API key never appears in any result, error, log line or stored row, including when the fake echoes it in a `400` body and in an upstream-error path |
| BS3 | Only `fakeBraze` receives an `Authorization` header; it contains the canary key only; no other fake (site, DA) ever sees it |

## 4. Worker and engine with Braze registered (seams W1 and R1)

| ID | Behaviour asserted |
|---|---|
| BI1 | `GET /vendors` lists `braze` with the descriptor and `configured` true/false by secrets and endpoint; registering the provider adds **no route** (the route table is identical with and without Braze) |
| BI2 | Mapping validation with the Braze descriptor: exactly one rule per binding; format must be allowed; same (vendor, target, slot) in two bindings rejected; save/read/If-Match behaviour unchanged |
| BI3 | First sync of a Braze binding (draft block, approve off): the fake holds the extracted text, state stays draft; status `in_sync`, `lastSyncedAt` set |
| BI4 | Tick with `304`, and a republished page with identical mapped values: zero Braze calls; Sync now on identical content: `info` calls only, zero `update` |
| BI5 | Edit one field of a two-binding page: exactly one `info` and one `update`, on the edited binding's block only |
| BI6 | Key lacking `update`: that binding `error` with a fixed `permission_denied` message; a second binding on another vendor (fake vendor) in the same tick still syncs; the tick does not crash |
| BI7 | Active block + approve off → slot error shown, no retry storm (non-retryable); toggling approve and saving → next Sync now succeeds |
| BI8 | `429` storm: retries follow the shell's 5, 15, 60 minute schedule for the retryable error; status shows `rate_limited` fixed message; no content lost |
| BI9 | Source page 404 → `source_unavailable`, zero Braze calls, existing block content untouched; unmap/disable/remove never calls Braze |
| BI10 | Mixed-vendor site (Marketo fake and Braze fake): pacing and failures are independent; one vendor's `429` does not delay the other |
| BI11 | AZ1 route enumeration (401 without token on every route) and SE1 canary matrix pass unmodified with the provider registered, extended with the Braze scenarios of BS2 |
| BI12 | The IMS token reaches only the fake DA host (AZ5) and never `fakeBraze` |

## 5. App unit tests (seam S2)

| ID | Behaviour asserted |
|---|---|
| BU1 | With a descriptor list containing `braze`, the app renders Braze in the vendor picker, a Content Block target picker (search, paging requests as expected), a single-rule editor, the approve option shown because `supportsApproval` is true, with **no** Braze-specific code path in the app source (BR4 asserts the absence of the vendor name) |
| BU2 | Status view renders Braze per-item errors as fixed text for `invalid_value`, `permission_denied`, `rate_limited`, `target_not_found` without any raw vendor text |
| BU3 | Preview shows the worker-returned value; when the worker marks a value as encoded by the vendor (baseline: documentation note only; with PA1: the dry-run value) the displayed text matches the written text |

## 6. End-to-end (seam S1; Playwright, Chromium, hermetic, no network beyond localhost)

Config as #27: #1 static server on `:3000`, real worker via `wrangler dev` on `:8787` with local D1, fakes as Node servers including `fakeBraze` on a local port (endpoint override in the local environment only; the production pattern check stays in force by allowing a loopback host solely under `ALLOW_LOCALHOST`).

| ID | Behaviour asserted |
|---|---|
| BX1 | Open the app, choose Braze and a page from the fake site, pick a block, map the heading as `text`, preview, save, Sync now: the fake holds the text as a draft; status shows the last sync time |
| BX2 | Edit the fake page's heading, advance the scheduled test hook, reload status: new last-synced time and updated block content; a second block untouched (zero extra writes) |
| BX3 | Fake returns `403` for update: the status shows the plain per-item error; the other binding succeeded |
| BX4 | Active block: without approve the plain "live" error shows; after enabling approve the block updates |
| BX5 | A page containing `{{ x }}` and `{% connected_content ... %}` text: the fake stores no Liquid openers and the browser shows only text |
| BX6 | No-token requests to every worker route → `401` visible to the browser with CORS headers; page HTML, DOM, console and all network responses contain neither the SDK token nor the canary Braze key |

## 7. Runtime smoke (seam W2)

BSM1 the worker with the Braze module bundles and starts in workerd; a bare request gets `401`. BSM2 the Braze module against `fakeBraze` over real HTTP including a `429` with real (tiny) timers and header-driven delay. BSM3 canary absent from all responses over HTTP. BSM4 records wall time of a 50-target sync (informational, R8).

## 8. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| BR1 | `apps/marketing-automation-sync/providers/braze/` contains `SPEC.md`, `README.md` and a `worker/` module with its own tests including the V1 suite run (UR5: a provider without a suite run fails the check) |
| BR2 | The extension README has a Braze section that names `BRAZE_API_KEY`, `BRAZE_REST_ENDPOINT`, the three required permissions, the draft/approve behaviour, the rotation steps, and states that no EW site configuration is read |
| BR3 | Secret hygiene (UR4): `BRAZE_API_KEY` is in `secrets.required` and in `.dev.vars.example`, never in `vars`; the worker config has no Braze value committed |
| BR4 | Shell untouched: no vendor name (`braze`) appears in the app source, the mapping/engine/store/extraction modules or the shared template; the only shell-area diff is the allowlisted registration set (registry entry, `secrets.required`, `vars`, `.dev.vars.example`, README section); a failing fixture proves the check bites |
| BR5 | Lint (ESLint, Stylelint) and all CI tiers (`lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e`) green on a PR; no secrets in CI |

## 9. Manual verification inside real Experience Workspace (needs interactive Adobe login and a Braze workspace; cannot be automated)

Accounts and credentials needed: everything in #27 section 6 (GitHub admin for Code Sync, an IMS identity with write on the DA org/site and config rights, Chrome, a Cloudflare account with `wrangler login`) **plus a Braze workspace** (no sandbox is known to be self-serve [ASSUMPTION]; OQ 1) with: dashboard access to create REST keys; the REST endpoint; a key with `content_blocks.list`, `.info`, `.update`; (for seeding only, kept off the worker) a second key with `content_blocks.create`; three test HTML Content Blocks created in the dashboard (one left as draft, one launched/active, one unused) and a test email campaign draft that includes a block via `{{content_blocks.${name}}}`; a published test page with a key/value block and a grid block. Never paste the IMS token or any Braze key into chat, issue comments or logs.

- **MB0 (prereq):** deploy; `wrangler secret put BRAZE_API_KEY`; set `BRAZE_REST_ENDPOINT` and the site allowlist; `curl -i <worker>/v1/vendors` returns `401` (AC6). The vendor picker (once signed in) lists Braze and "test connection" reports connected.
- **MB1 (`ref=local`, full path, draft):** `npm start` (3000) and the worker dev script (8787) with local D1. Open `https://da.live/app/jazhou-adobe/ew-extensions/apps/marketing-automation-sync/marketing-automation-sync?ref=local`, accept the trust prompt (#1 2.4). Choose Braze, pick the draft block, map the heading as `text`, preview, save, Sync now. In Braze (**Content > Content Blocks**) the block shows the new content while still a draft; the email preview does not yet use it live (AC1, AC2).
- **MB2 (approve and go live):** launch the draft in Braze (or enable approve and sync); change the EW heading, publish, run the local scheduled trigger; the status shows a new last-synced time and the block text changes; the **last edited** time advances only for blocks whose content changed; an unchanged block's last-edited time does not move (AC2, BP3). Record publish-to-sync latency in the README.
- **MB3 (per-item errors):** (a) enable approve off on the active block: plain "block is live" error, block unchanged; (b) create a new key without `content_blocks.update` and set it: plain permission error; restore the good key (secret rotation, MB8); (c) map to a block, archive it in Braze, sync: record the real error and classification (spike B1/B2); (d) set a wrong-region endpoint: plain "could not authenticate" (AC2).
- **MB4 (Liquid safety):** put `{{ "now" | date: "%Y" }}`, `{{${first_name}}}` and `{% connected_content https://example.test/x :save r %}` into the page copy, publish, sync into an html block; Braze **Preview** shows the text literally; the Connected Content Debugger shows no call; a text block with the same copy is rejected with the fixed error (AC1, R3).
- **MB5 (branch ref):** push branch `mas-braze` (simple name), wait for code sync, open the app with `?ref=mas-braze` against the deployed worker; repeat MB1's save and sync; record the page's actual `Origin` (`aem.live` or `preview.da.live`) in the README (AC5; #2 R2).
- **MB6 (provider registration only):** check out the commit before the Braze PR, run the app (no Braze), apply only the registration set (registry entry, config, `.dev.vars.example`, README), and confirm Braze appears in the picker with no other change (AC3).
- **MB7 (security):** with `curl`: no token → `401`; valid token from a user without write → `403`; disallowed `Origin` → `403`; site not on the allowlist → `403`; search page source, Network responses and DevTools storage for the Braze key (none) (AC6).
- **MB8 (rotation):** create a new Braze key, `wrangler secret put BRAZE_API_KEY`, delete the old key in Braze; the next sync succeeds with no code change (AC6).
- **MB9 (limits):** seed ~100 test blocks with the separate create key (throwaway script, not committed); sync a 100-binding mapping; confirm no `429` in the worker logs, the Braze **API usage dashboard** (linked from the rate-limits page: https://www.braze.com/docs/user_guide/analytics/dashboards/api_usage; not read) shows the expected request count (about 2 per changed block), and the daily budget guard stops at its configured value (R8).

## 10. Acceptance-criteria traceability (ticket #29)

Labels: P1 to P7 are #29's seven acceptance criteria in the order the ticket lists them.

| # | Acceptance criterion (#29) | Automated proof | Manual / review verification |
|---|---|---|---|
| P1 | Admin maps EW page/fragment content (by block and field) to the vendor's content objects and saves the mapping per site | BT1-BT4 (descriptor, listing, search, describe), BI1-BI2 (registration, validation, per-site save with the shell's MP tests unchanged), BU1, BX1, BX4, BL1-BL7 (what lands in the block); shell suites EX/MP/UI re-run with Braze registered | **MB1** (map, preview, save, sync), **MB4** (Liquid safety), review of the PA1 baseline gap (preview shows pre-encoding text) |
| P2 | Content pushes on demand and the worker re-syncs mapped pages whose published version changed (polled); the app shows last sync time and per-item errors | BP1-BP8, BE1-BE6, BI3-BI10, BU2, BX1-BX4, BSM2 | **MB1** (Sync now), **MB2** (publish then polled re-sync, latency recorded), **MB3** (per-item errors), **MB9** (limits) |
| P3 | Added inside the existing `marketing-automation-sync` folder as a new provider; no shell changes beyond registering the provider | VC1-VC8 (suite unchanged), BI1 (no new route), BI11, BU1, **BR1 and BR4** (provider folder complete; no vendor name in shell sources; diff limited to the registration set) | **MB6** (registration-only walk-through); review of section 6 (no amendment is required) |
| P4 | Extension README documents this vendor's setup (credentials, site config keys) | BR2 (README section present with the named secret, variable, permissions, no-site-config statement), BR3 | Review: follow the README from a clean clone to a working Braze sync once (**MB0-MB1**) |
| P5 | Works in EW with `ref=local` and with a branch ref | BX1-BX6 (page at `localhost:3000` against the local worker), BSM1-BSM3; origin handling is the template's UC tests | **MB1** (`ref=local`), **MB5** (branch ref against the deployed worker; observed `Origin` recorded) |
| P6 | Vendor credentials live only in this extension's worker (built from the shared template); the browser never receives them; unauthenticated calls to the worker are rejected | BA1-BA5, BS2-BS3, BI1, BI11 (AZ1 route enumeration and SE1 canary with Braze), BI12, BX6, BR3, BSM1, BSM3 | **MB0** (`curl` 401), **MB7** (security checks incl. page-source and storage search), **MB8** (rotation); review that `BRAZE_API_KEY` appears only in worker config |
| P7 | Core logic covered by unit tests; lint and CI green | All of BA, BT, BP, BE, BL, BS, BI, BU plus the V1 suite; CI jobs `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` (BR5) | Review: CI green on a PR; deliberately break a rule on a scratch branch (let `{{` through for an html block, send `state` omitted, or call create) and see BL1, BP2 and BS1 fail |

Every acceptance criterion on #29 maps to at least one automated test or a numbered manual verification step above.

## 11. Open questions for the owner

1. **Braze access (R1).** Which Braze workspace can be used for verification? Braze does not appear to offer a self-serve sandbox [ASSUMPTION]; does Adobe or a partner programme provide one, or should the build proceed against `fakeBraze` only with MB0-MB9 deferred? Who creates the keys?
2. **Draft versus live.** Accept "approve means go live and cannot be undone; default off; a live block needs approve to be updated"? Or force a different policy (always draft-only, which cannot update live blocks; or always live)?
3. **Create target.** Accept "the block must already exist" (needs only three key permissions), or add a cross-vendor `createTarget` to the interface later? Block names are permanent and unreusable, which argues for care.
4. **Liquid policy.** Accept "page text can never run as Liquid in Braze; text blocks reject `{{`/`{%`"? Or should an admin be able to allow author-written Liquid per binding (a shell option change)?
5. **Preview fidelity (PA1).** Approve the optional `dryRun` amendment so previews show the exact encoded content, or accept the baseline gap (preview shows the extracted text; README documents the encoding)?
6. **Multi-vendor secrets (decision 21).** Sentinel `unset` for unused vendors, per-vendor Wrangler environments, or drop vendor secrets from `secrets.required`? Applies to all of #28-#32.
7. **Tenancy.** Single Braze workspace per worker deployment (this spec), or per-site keys stored encrypted (#27 OQ 2)?
8. **IP allowlisting.** Leave the key's IP allowlist empty because Workers egress is not stable [ASSUMPTION], or require a fixed egress (extra infrastructure)?
9. **Usage warning (PA3).** Show `inclusion_count` before enabling approve so admins see how many messages a live write affects?
10. **No history.** Braze keeps no version history for blocks [VERIFIED]. Is "last write wins, no snapshot" acceptable, given the worker is designed not to store content bodies (#27 Decision 23), or should the worker keep the last pushed value per block to allow a manual restore?
11. **Rate budget.** Confirm the default share of the workspace's 250,000/hour (≈2 calls per changed block, 5 calls/s, daily budget) [ASSUMPTION], especially if other tools (e.g. a Contentful Braze app) call the same workspace.
12. **Editor type.** Restrict targets to HTML-editor blocks (README) or detect and refuse drag-and-drop blocks once spike B6 shows how?
13. **Slot name and localisation.** Confirm the constant slot name the shell expects for `single` kinds; and whether per-locale blocks (Contentful's pattern; Braze translation endpoints exist) are a wanted follow-up.
14. **Connected Content alternative.** Should a "Connected Content" delivery mode (Braze fetches the published EW content at send time) be considered instead of, or beside, block syncing for time-sensitive content?
15. **Policy and custody (R15).** Confirm the Adobe outside-activity/IP position before a worker holding a customer-grade Braze key runs under a personal Cloudflare account.
