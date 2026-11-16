# Spec: Pre-publish Content Linter

Ticket: jazhou-adobe/ew-extensions#10 (this spec: #48). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/` (type comes from its EW config-sheet row; this one is a **library plugin**, a row in the `library` tab); *worker* = the per-extension backend in `apps/<name>/worker/`, built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *rule* = one row of the site's lint rules sheet; *violation* = one finding of one rule on the page; *verdict* = the plugin's overall state for the page (blocked, ready, ...).

---

## Problem Statement

An author clicks Request Publish and an approver opens the email, looks at the preview and finds that images have no alt text, an `h3` follows an `h1`, the description is empty, a banned brand term is in the copy, or a link goes nowhere. The approver rejects it, the author fixes it, resubmits, and the approver is pulled in a second time. Request Publish allows only one pending request per page and approvers are a scarce resource, so every avoidable rejection wastes both people's time.

The checks that would catch this are site specific: which terms are banned, which pages must have which blocks and metadata, which problems are errors and which are only warnings differ per site and per section of a site. Experience Workspace (EW) already has two adjacent features, and neither does this: the **Preflight** panel runs Adobe's Governance Agent (an AI service) and enforces generic brand and compliance checks (https://www.aem.live/docs/ew/administering/preflight), and the EW AI assistant answers questions about a page. Neither lets a site administrator write down "on `/legal/*` the `disclaimer` block is required, `guarantee` is a banned word, missing alt text is an error" and have every author get a deterministic, explainable answer before they ask for approval.

## Solution

A **library plugin** (a row in the site's `library` tab) that checks the page the author is editing against **rules the site administrator defines in a config sheet** and tells the author, before Request Publish, what is wrong and how to fix it.

- The administrator adds a tab of rules (rule type, severity, path pattern, parameters) to the EW site (or org) config. Built-in rule types cover missing image alt text, heading-level jumps, empty or duplicate title/description metadata, banned or brand-restricted terms, broken internal links, required blocks and required metadata per path pattern, and external link reachability.
- The author opens the plugin from the editor library and runs it. The plugin lists violations **grouped by severity** (errors, warnings, info), each showing the offending text or element. Selecting a violation expands an explanation of the fix.
- **Errors block the "ready to request publish" state.** While any error remains the plugin says so and offers no route onward. Only when no errors remain does it show "Ready" and a button that takes the author to Request Publish. Editing the page after a run invalidates the verdict, so "ready" always refers to the content as it is now.
- Everything except external link reachability runs in the browser against the live editor document and the DA Admin API under the user's own session. External links are probed by the extension's own **worker**, because browsers cannot make cross-origin reachability requests to arbitrary sites (CORS). The worker holds no vendor credential (there is no vendor), requires the caller's IMS token, and is hardened against being used as an open proxy.

It is deterministic and rule driven (no AI), which is the differentiator against Preflight and the assistant. It is an **advisory** gate: EW offers no way for a plugin to veto another plugin or the Publish button (see Further Notes), and the spec says so plainly instead of promising enforcement.

## User Stories

Author (content editor in EW):

1. As an author, I want to run a check on the page I am editing from the editor library, so that I find problems before I ask for approval.
2. As an author, I want the check to include my unsaved edits, so that the result describes the page I am looking at and not an older saved copy.
3. As an author, I want violations grouped by severity with errors first, so that I fix what blocks me before what merely advises me.
4. As an author, I want each violation to show the offending text or element (the image source, the heading text, the banned word in its sentence, the broken link target), so that I can find it in the page without guessing.
5. As an author, I want to select a violation and read how to fix it, so that I do not have to ask an administrator what a rule means.
6. As an author, I want the explanation to include my site's own guidance when the administrator wrote some, so that the advice matches house style and not just a generic rule.
7. As an author, I want a clear count of errors, warnings and info items, so that I can see at a glance how far I am from ready.
8. As an author, I want the plugin to tell me plainly when errors remain and that I cannot proceed yet, so that I do not try to request publish and get rejected.
9. As an author, I want a "Ready" state and a button to Request Publish that appear only when no errors remain, so that the next step is one click once the page is clean.
10. As an author, I want the "Ready" state to disappear when I edit the page after a run, so that I never request publish on the strength of a stale result.
11. As an author, I want to re-run the check with one action, so that I can confirm my fixes.
12. As an author, I want warnings and info items not to block me, so that style advice does not stop an urgent publish.
13. As an author, I want to see which checks could not run (for example external link checking was unavailable) and a "ready, with caveats" state in that case, so that I know what was not verified.
14. As an author, I want links that look dead only because the target site blocks bots to be reported as "could not verify" and not as broken, so that I am not told to remove valid links.
15. As an author, I want broken internal links reported with the target path, so that I can fix a typo in a link or create the missing page.
16. As an author, I want the checks that apply to my page to depend on where it lives (for example `/legal/*` has extra rules), so that I only see rules that matter to my content.
17. As an author, I want a clear message when no rules are configured for my site, so that I do not mistake "nothing was checked" for "nothing is wrong".
18. As an author without permission to read the site configuration, I want a plain explanation of what access is missing, so that I can ask the right person.
19. As an author, I want the plugin to show a short "checking" state while it works and a bounded wait, so that the editor never feels hung.
20. As an author, I want the plugin to handle pages with many links and images without freezing the editor, so that long pages stay usable.
21. As an author, I want text from the page shown as plain text everywhere in the plugin, so that odd or hostile content cannot break or script the panel.

Site administrator:

22. As an administrator, I want to define rules in a config sheet (rule, severity, path pattern, parameters), so that I control what is checked without a code change.
23. As an administrator, I want to give each rule a severity of error, warning, info or off, so that I decide what blocks authors.
24. As an administrator, I want path patterns with the same semantics as the Request Publish workflow config (exact, `/section/*`, `/*`, most specific wins), so that I learn one convention.
25. As an administrator, I want a more specific rule (or `off`) to override a broader one for a section, so that a section can opt out or tighten a rule.
26. As an administrator, I want several rows of the same rule type at one specificity to all apply, so that I can keep separate banned-term lists for separate reasons.
27. As an administrator, I want banned and brand-restricted terms with an optional suggested replacement, so that authors see what to write instead.
28. As an administrator, I want to require blocks and metadata keys per path pattern, so that every page of a type has its mandatory parts.
29. As an administrator, I want to switch external link checking on per path pattern and set what counts as an error there, so that I can start with warnings and tighten later.
30. As an administrator, I want to write a custom explanation per rule row, so that authors get my guidance in the fix text.
31. As an administrator, I want configuration mistakes (unknown rule type, bad severity, invalid pattern or parameter) reported to the author as configuration problems and not swallowed, so that a typo does not silently disable a check, and I want them visible enough that I notice.
32. As an administrator, I want the config to live at site level with an org-level fallback, so that one org can share rules across sites and a site can replace them.
33. As an administrator, I want the plugin installed with a single `library` row, so that enabling it is copy-paste.
34. As an administrator, I want a documented way to tell the plugin where Request Publish is configured, so that the "Request Publish" button goes to the right place for my site.
35. As an administrator, I want a README that lists every rule type, its parameters and an example row, so that I can write rules without reading code.

Maintainer / reviewer:

36. As the maintainer, I want all of the extension in one self-contained folder with a README, so that it follows the repo convention and can be moved or deleted cleanly.
37. As the maintainer, I want the extension listed in the README extensions table, so that the table stays the source of truth.
38. As the maintainer, I want the rule logic tested without EW, a browser session or network access, so that CI stays credential free.
39. As the maintainer, I want the worker to reject unauthenticated callers and requests from other origins, so that nobody can use it as a free link scanner.
40. As the maintainer, I want the worker to refuse to probe internal or non-web addresses, so that it cannot be turned against private infrastructure.
41. As the maintainer, I want the worker to receive only a list of URLs, never page content, so that author content does not leave the author's session more than necessary.
42. As the maintainer, I want the README rule table to be machine-checked against the rules that actually exist, so that documentation cannot drift from behavior.
43. As the maintainer, I want it to work with `ref=local` and with a branch ref, so that reviewers can try a branch before merge.

Security reviewer:

44. As a security reviewer, I want proof that the IMS token goes only to the DA Admin API and to this extension's worker, so that a compromise of any other host cannot replay it.
45. As a security reviewer, I want proof that the worker origin and the DA org/site cannot be changed by a URL parameter, so that a crafted link cannot redirect the token or the config read.
46. As a security reviewer, I want proof that probing localhost, private ranges, cloud metadata addresses and non-HTTP schemes is refused even through redirects, so that the worker is not an SSRF primitive.

## Implementation Decisions

(Decision level only; file layout is in the Build Analysis.)

1. **Extension type: library plugin.** Registered in the `library` tab (not `apps`, not `prepare`). Default `experience` is `inline` because the output is a list the author works through next to the page. Owner decision recorded in #1: type comes from the config row, folder is `apps/prepublish-linter/`. The `fullsize-dialog` experience also works for the same entry page (the Request Publish plugin supports both: https://www.aem.live/docs/ew/administering/request-publish); not the default.
2. **Content under test = the live editor document, with the saved source as fallback.** The plugin takes one snapshot of the live document through the SDK's `subscribeLiveDocument` action, then unsubscribes; if the host does not deliver a snapshot within a short bounded wait, it reads the saved document from the DA Admin API (`GET /source/{org}/{site}/{path}.html`) and labels the result "saved version". It keeps its own subscription active between runs only to detect that the document changed (decision 10). [VERIFIED: `subscribeLiveDocument` exists in https://da.live/nx/utils/sdk.js and the host broadcasts `{ html, selection, editable }` on a 150 ms debounce in https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js; the library handshake advertises `capabilities.liveDocument`.]
3. **One parsed-document model feeds every rule.** The HTML (live or saved) is parsed once in the browser with `DOMParser` into a normalized model (sections, blocks by first class name, the metadata block as key/value rows, headings, images, links, text nodes). Rules are pure functions over that model plus injected services, so a rule never touches the network or the SDK itself. The live HTML is not the same markup as the saved source (it is produced by the editor for SDK use and may carry editor instrumentation and rewritten image URLs). [ASSUMPTION on exact differences; see R3.] The model adapter is the only place that knows both shapes.
4. **Rules are defined in an EW config tab named `prepublish-lint-rules`.** Same mechanism and same read path Request Publish uses for `publish-workflow-config`: a custom tab in the EW config sheet read through `GET https://admin.da.live/config/{org}/{site}` (multi-sheet JSON, rows under `data`) [VERIFIED shape: https://docs.da.live/developers/api/config and `fetchDaConfigs` in https://github.com/adobe/da-live/blob/main/blocks/shared/utils.js]. The site-level tab wins when it exists; otherwise the org-level tab (`GET /config/{org}`) is used, mirroring Request Publish ("read from the site-level config first, with an automatic fallback to the org-level config": https://www.aem.live/docs/ew/administering/request-publish). Optional second tab `prepublish-lint-settings` (`key`, `value`) for plugin-wide settings (decision 12). Header names are matched ignoring case.
   Rule row columns:

   | Column | Meaning |
   |---|---|
   | `rule` | one of the built-in rule types (decision 5) |
   | `severity` | `error`, `warning`, `info`, or `off` |
   | `pattern` | path pattern; blank means `/*` |
   | `params` | `key=value` pairs separated by `;`; lists inside a value separated by `\|` (the pipe convention EW already uses for library block options: https://www.aem.live/docs/ew/administering/set-up-library) |
   | `message` | optional administrator text appended to the built-in fix explanation |

5. **Built-in rule types (v1).** Each has a fixed built-in explanation of the fix; unknown types are configuration problems, not violations.
   - `image-alt`: image without an `alt` attribute, or with a blank one (decorative images allowed with `allow-empty=true`).
   - `heading-order`: a heading more than one level below the previous heading (h1 to h3), plus optional `single-h1=true` and `start` (lowest allowed first heading).
   - `required-metadata`: listed metadata keys (`keys=title|description`) missing or blank in the page's metadata block; duplicate keys in the metadata block; `title` equal to `description`; optional `min`/`max` length per key.
   - `banned-terms`: listed `terms` (case-insensitive, whole word or phrase, no regex) found in text and, optionally, in `alt`/`title` attributes (`include-attrs=true`); optional `suggestion` shown as the replacement.
   - `required-block`: listed `blocks` (first class name of a block table, case-insensitive; variants count as the block) that must appear, with optional `min` count.
   - `internal-links`: links to pages, folders or files on this same site that do not exist in DA content (decision 7), with an `ignore` list of path patterns (default ignores code-bus paths such as scripts, styles, fonts, and `media_` hashes) [ASSUMPTION: default list; owner to confirm].
   - `external-links`: absolute links to other sites that the worker finds unreachable (decision 8).
   "Duplicate title/description metadata" is implemented as the within-page cases above. Cross-page uniqueness (the same title on two pages) needs a site-wide index and is **not** in v1 (see Out of Scope and Open Question 6).
6. **Rule resolution per page.** The page path from the SDK context is normalized (leading slash, `.html` and trailing slash removed). A pattern is an exact path, `/a/*` or `/*`; `/a/*` matches `/a` and everything below it on a path-segment boundary (`/ab` is not matched) [same semantics as documented for Request Publish: https://www.aem.live/docs/ew/administering/request-publish and https://github.com/adobe-rnd/aem-apps/blob/main/tools/plugins/request-for-publish-v2/README.md]. Specificity is the number of matching path segments (an exact match highest). **Per rule type**: only the rows with the highest matching specificity apply; all rows at that specificity apply together (additive); if the highest-specificity rows are `off`, the rule type does not run for the page.
7. **Internal links use the DA Admin API only.** Each same-site link is normalized (relative, root-relative, and absolute links on this site's `aem.page`, `aem.live` or `preview.da.live` hosts, the latter two with any branch label; hash/query stripped; `mailto:`, `tel:` and fragment-only skipped). Existence is decided with `GET /list/{org}/{site}/{folder}` once per distinct folder (child names and extensions), where `/x` matches `x.html`, `x.json` or a file named `x.<ext>`, and `/folder/` matches `index.html`. A miss is confirmed with a single `GET /source/...` for that path before it is reported, so a truncated folder listing cannot create false errors [OPEN: pagination of the list API is undocumented]; `401`, `403`, `5xx` or a network error on the confirmation yields "could not verify", not "broken". Existence in DA content is the test; whether the target is published is not (see Out of Scope). [VERIFIED endpoints and response shape: https://docs.da.live/developers/api/list, https://docs.da.live/developers/api/source.]
8. **External links go through the worker and nothing else does.** Absolute `http(s)` links to hosts other than this site's own are deduplicated and sent to the worker in chunks (small, capped chunks; see Build Analysis section 4). The worker returns, per URL, a state (`ok`, `broken`, `unverified`) and a reason. `broken` = `404`/`410`, persistent `5xx` after one retry, or connection failure; `unverified` = bot-blocking style responses (`401`, `403`, `429`, `451`, `999`), timeouts, redirect limits [OPEN: owner confirms the mapping, Question 5]. Only `broken` becomes a violation at the rule's severity; `unverified` becomes an `info` item and marks the run as incomplete. The worker never receives page content, only URLs.
9. **Worker = the shared template's contract, with one deliberate difference.** Auth (IMS token or `401`), CORS (`https://da.live` and the site's own origins), error shape, request ids, logging, and the pipeline order are exactly those in `shared/worker-template/SPEC.md` Decisions 4 to 10. The route is declared "METHOD + path -> handler" and receives a verified identity. This worker **has no secrets**: there is no vendor. Acceptance criterion 8 therefore reduces to its second half (the browser never receives credentials: it never holds any beyond its own IMS token; unauthenticated calls are rejected) plus "the worker never forwards the caller's IMS token". The template's outbound `proxy` helper is **not** used, because it requires a per-route host allowlist and injects a vendor secret; this route probes arbitrary public hosts, so it uses the runtime `fetch` through its own guard (decision 11). [OPEN: whether #2 should expose a "public egress without secret" helper instead; Question 2.]
10. **The verdict is bound to the content it was computed from.** States: `not-configured` (no rules tab, or no rule applies to this page), `not-run`, `running`, `blocked` (at least one error), `ready` (run complete, zero errors), `ready-incomplete` (zero errors but some checks could not run), `stale` (content, path or rules changed after the run), `failed` (the run itself could not complete, for example the page could not be read). A run records a content fingerprint; any later change to the live document or to the path moves the verdict to `stale`. Only `ready` and `ready-incomplete` offer the Request Publish route, and only while the fingerprint matches. `not-configured` is **fail closed**: it does not offer the route (an unconfigured linter must not read as a pass) and tells the author what to ask for. Warnings and info never block.
11. **Worker hardening (this is the main security decision).** The worker accepts only a capped number of URLs per call; allows only `http`/`https` on the default ports without URL credentials; rejects IP-literal hosts (including decimal, hex and IPv6 forms), `localhost`, and internal-looking suffixes; follows redirects manually (limited hops) and re-applies the guard on every hop; sends no cookies and no caller headers (never the IMS token), a fixed user agent; uses `HEAD`, falling back to a `Range`-limited `GET` when `HEAD` is refused; never reads, stores or returns target bodies or headers; returns only a fixed response schema; applies per-URL and overall time limits. [ASSUMPTION: Cloudflare Workers cannot reach RFC1918 or loopback addresses from the edge, so the literal-IP and name guards are defence in depth; not confirmed. See R7.] A local-only flag (never set in production config, machine-checked) lets smoke tests probe a loopback fixture server.
12. **Request Publish handoff.** The plugin cannot call Request Publish or block it. The only verified way to route the author to another extension is the SDK's `showPanel(name)`, which makes the host open the tools-panel view with that id. [VERIFIED: https://da.live/nx/utils/sdk.js defines `showPanel`; the host dispatches a panel-open event with `{ section: 'tools', id }` in iframe-protocol.js (read 2026-11-16).] Whether a library-registered Request Publish row's panel id equals its configured title is not confirmed [OPEN, R5]. Therefore a `prepublish-lint-settings` key names the library title of the Request Publish entry (default `Request Publish`), and a second key states whether Request Publish is registered in the `library` tab or in the Prepare menu. In the Prepare-menu case no programmatic way for a plugin to open a Prepare item was found [VERIFIED: the SDK in https://da.live/nx/utils/sdk.js has no matching action; the first ~150 lines of https://github.com/adobe/da-live/blob/main/blocks/canvas/editor-utils/prepare-menu.js showed menu items opened only by the menu UI; the rest of that file was not read, so treat as ASSUMPTION for completeness], so the plugin shows an instruction ("open Prepare, then Request Publish") instead of a button. Request Publish stays reachable by other routes; the plugin is advisory (Further Notes).
13. **Where the IMS token goes.** The page uses the token from the SDK result and sends it only as `Authorization: Bearer` to (a) `https://admin.da.live` and (b) this extension's worker. It does not use the SDK's `daFetch`, because that helper triggers an interactive IMS sign-in redirect on a `401` [VERIFIED: https://da.live/nx/utils/daFetch.js `handleSignIn()` on 401], which is wrong inside an iframe plugin; the plugin handles `401` itself with a message. The upstream repo already calls `admin.da.live` from extension pages with the SDK token (https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/utils/da-fetch.js), so cross-origin access from `aem.live` and `localhost:3000` is expected to work [ASSUMPTION for plugin origins; confirmed by manual step M3].
14. **Fixed constants, never URL-driven.** The worker origin is a constant (loopback worker only when the page itself is served from `localhost`, as in #2 Decision 13); org, site and path come from the SDK `context`, never from the query string.
15. **UI.** A single panel: header with run button and verdict, severity groups with counts, each violation a button that expands the fix explanation (accessible disclosure), a "configuration problems" group, an "incomplete checks" note, and the Request Publish route. All page-derived strings are rendered as text. The token is never rendered or logged. Plain DOM, no framework (as hello-world).
16. **Tooling as pinned in #1/#2** (ESLint 8 + helix config, Stylelint 16, `@web/test-runner`, Playwright, Node 22, husky; worker tests on `node:test`); no new dependency is needed for the linter itself.
17. **Violation contract (stable for tests and UI):** rule type, severity, a message, the offending text or element description (plain text, with a short bounded context window for text rules), the rule row it came from, a fix explanation (built-in text plus the row's `message`), and a stable order (severity, then document order).

## Testing Decisions

**What makes a good test here.** Assert external behavior only: given a document, a rule sheet and a fake outside world, assert which violations appear (severity, offending text, fix text), which network calls were made (host, method, bodies), what the panel shows, and which SDK actions fire. Never assert on helper names, internal module layout, or CSS classes. The two properties tested across every path as negatives are: "an error never leaves the plugin in a state that offers Request Publish" and "the token and page content never go anywhere except the documented hosts".

**Proposed seams** (recorded instead of asked, per #48). All reused from #1/#2; no new seam kinds.

| # | Seam | From | Used by | How the outside world is faked |
|---|------|------|---------|-------------------------------|
| S2 (primary, highest for logic) | The lint engine + config parser + verdict state machine, called with a document string, a rule sheet (config JSON) and injected services (`pathExists`, `checkExternal`) | #1 S2 | WTR unit tests for all rule types, resolution, verdict | hand-built HTML fixtures, hand-built config JSON, fake services returning scripted results |
| S1 | Entry HTML page + SDK module boundary + network | #1 S1 | Playwright e2e | #1's SDK stub extended with a scripted `subscribeLiveDocument`, `showPanel` call log; `page.route` stubs for `admin.da.live` (config, list, source) and for the worker origin; everything else aborted |
| W1 | The worker's HTTP boundary (`worker.fetch(request, env, ctx)`) | #2 W1 | Node tests for the link-check route | #2's test kit (fake IMS, signed tokens, env factory) + injected outbound `fetch` replaying scripted redirects/statuses |
| W2 | The same worker in workerd over real HTTP | #2 W2 | Smoke tier | `wrangler dev` with a throwaway local target server (redirects, 404, slow) |
| S3 | Repo convention check | #1 S3 | CI lint job | filesystem fixtures; extended with a README-vs-rule-registry consistency check |

Why S2 is the right top seam for the rules: all seven rule types, the resolution matrix and the verdict logic are deterministic over (document, rules, services); driving them through a browser would multiply runtime with no extra signal. S1 then proves the wiring (SDK, DA Admin, worker, UI) once per behavior, not per rule. The real EW boundary (real IMS login, real live-document HTML, real Request Publish) is covered only by manual verification.

**Modules tested:** config parser and resolver, document model adapter (live and saved fixtures), each rule, engine/ordering, verdict state machine, content source (live preferred, saved fallback), internal-link existence service (list + confirm), external-link client (chunking, mapping, failure), panel render and bootstrap, README-vs-registry check, worker route and its guard.

**Prior art.** From #1: WTR + import-map SDK stub, `stubDaApi`-style network stubbing, the Tier 1 stub-only e2e. From #2: the node:test + test-kit pattern for the worker, the `fetchImpl`/`now` injection style (upstream `tools/brand-visibility/session-auth.js`). Upstream `adobe-rnd/ew-extensions` has no content-linting prior art (no linter in its tree as checked 2026-11-16 via the GitHub tree API); the nearest analogue is the native Preflight panel (`blocks/canvas/ew-preflight/` in https://github.com/adobe/da-live), which adapts a remote AI evaluation, not local rules.

## Out of Scope

- Any AI evaluation, tone or brand-voice judgment, and the Governance Agent / `experience-context` API that Preflight uses. This plugin is deterministic.
- **Hard enforcement.** Blocking the Request Publish plugin, the Publish button, or bulk publishing. The EW-native publish gate is `editor.enforcePreflight` with a Preflight view (https://www.aem.live/docs/ew/administering/preflight); making this linter that gate is a separate investigation (Open Question 1).
- Cross-page duplicate title/description detection (needs a site-wide index; Open Question 6).
- Checking that a link target is **published** or live (only existence in DA content, and reachability for external URLs). Link anchors (`#id`) and `redirects` sheet resolution.
- Automatic fixing, writing back to the document, or selecting/scrolling to the offending element (the SDK exposes no select-element action; `sendHTML` replace exists but auto-fixing is a different product).
- Media (images, PDFs) as the page under test; the plugin targets pages (`.html` documents) only.
- Spell checking, readability scoring, SEO scoring, Lighthouse-style performance checks, accessibility checks beyond alt text and heading order.
- Custom user-supplied rule code or regex rules (a code/regex surface in an authored sheet is a safety and review burden; term lists only).
- Any vendor integration or credential; org-wide dashboards or reporting; storing lint history.
- A per-site rule *editor* UI (rules are edited in the config sheet).
- Multi-language rule variants, non-`.html` page paths (`.json` sheets).
- Cloudflare account policy, deployment automation, and the Adobe outside-activity/IP question (owned by #1 R1 and #2 R1).

## Further Notes

- **Advisory gate, stated plainly.** The ticket asks that errors "block a ready to request publish state" and that the plugin links to Request Publish only when no errors remain. That is exactly what the panel does, but the author can still open Request Publish from its own menu entry. I found no SDK action or documented extension point that lets one plugin veto another; the only gating feature found is `editor.enforcePreflight`, which gates the Publish button, not Request Publish (https://www.aem.live/docs/ew/administering/preflight). The README must say "advisory".
- **Preflight extensibility, with a docs/source mismatch.** The Preflight doc says a custom Preflight can be supplied "by supplying a plugin with the same title in your prepare config", yet `prepare-menu.js` in da-live executes `merged.delete('Preflight')` with the comment that Preflight moved into a side panel and should no longer appear in the Prepare menu [both VERIFIED 2026-11-16]. So the documented extension route may be stale; do not build on it without asking the EW team. This is the most valuable question to take to Adobe because a custom Preflight would be a real gate.
- **Request Publish needs Adobe onboarding.** Its email backend is "managed by Adobe and is provisioned per customer" and onboarding is by an AEM Engineering contact [VERIFIED: request-publish doc]. The test org/site may not have it; manual verification therefore includes a stand-in (a differently titled library entry named `Request Publish`), see Testing Requirements M5.
- **Authors need `read` on the site CONFIG** to load rules (the same requirement the library documents: https://www.aem.live/docs/ew/administering/permissions). The README must say so.
- **Docs gap, again.** The EW developer doc cited by the ticket (https://www.aem.live/docs/ew/developing/apps-plugins) documents `sendText`, `sendHTML`, `closeLibrary` and the SDK handshake; `subscribeLiveDocument`, `saveDocument`, `showPanel`, `openComparison` appear only in SDK source (https://da.live/nx/utils/sdk.js, read 2026-11-16). Everything the plugin relies on beyond the three documented actions is therefore source-derived and could change without notice; the SDK stub contract test from #1 plus a manual check (M4) guard it.
- **Naming.** Folder and entry page are named `prepublish-linter` (ticket's folder); EW row title suggestion: `Pre-publish Linter` (avoid the reserved library names `blocks`, `templates`, `icons`, `placeholders`, `aem-assets*`, per #1 section 2.5).

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace editor (da.live)
  ├─ library panel: iframe → https://{ref}--{site}--{org}.aem.live/apps/prepublish-linter/prepublish-linter.html
  │     (or .preview.da.live, or http://localhost:3000 with ref=local)
  │     SDK handshake → { token (IMS), context {org, site, ref, path, ...}, actions }
  │
  │   live document ◄── actions.subscribeLiveDocument (one snapshot, then change detection)
  │   rules/settings ◄── GET https://admin.da.live/config/{org}/{site}  (+ /config/{org} fallback)   [Bearer IMS]
  │   saved page (fallback) ◄── GET https://admin.da.live/source/{org}/{site}/{path}.html            [Bearer IMS]
  │   internal link existence ◄── GET https://admin.da.live/list/{org}/{site}/{folder}  (+ /source confirm) [Bearer IMS]
  │   external link reachability ──► POST {worker}/links/check { urls[] }                              [Bearer IMS]
  │                                       │ template pipeline: CORS gate → IMS verify → route
  │                                       ▼ guarded fetch (HEAD, manual redirects) → public sites
  └─ author clicks "Request Publish" (only when no errors) → actions.showPanel(<Request Publish title>)
```

| Concern | Browser extension (static files, public) | Worker (private runtime) |
|---|---|---|
| Config/rules, page content, internal links | all (DA Admin API under the user's session) | none |
| Rule evaluation, verdict, UI | all | none |
| External reachability | requests it, maps results to violations | performs the probes, SSRF guard, limits |
| Credentials | holds only the SDK-provided IMS token (never rendered/logged) | holds none; verifies the caller's token; never forwards it |
| Request Publish | routes via `showPanel` | none |

## 2. EW integration points

- **Library plugin vs app:** library plugin (one `library` row). Registration row (README documents it, site config at https://da.live/config#/{org}/{site}/):

  | title | path | format | ref | icon | experience |
  |---|---|---|---|---|---|
  | `Pre-publish Linter` | `/apps/prepublish-linter/prepublish-linter.html` | | | | `inline` |

  Path semantics (`/`-relative resolves to `http://localhost:3000` under `?ref=local`, otherwise `https://{branch}--{site}--{org}.aem.live`; row `ref` filter) are from #1 section 2.5 (source: `ew-panel-extensions/helpers.js`). [VERIFIED per #1.]
- **Config-sheet rows read (in addition to its own `library` row):** tabs `prepublish-lint-rules` (required for any output) and `prepublish-lint-settings` (optional). Read by every author, so authors need `read` on CONFIG (permissions doc above). Site tab wins; org tab is the fallback.
  Settings keys (v1): `request-publish.panel` (library title to open, default `Request Publish`), `request-publish.location` (`library` default, or `prepare`), `external-links.max` (cap on distinct external URLs checked per run, default per Section 4), `internal-links.ignore` (default ignore list, overridable). [ASSUMPTION: key names; owner may rename.]
- **SDK actions used:** `subscribeLiveDocument` (snapshot + change detection; unsubscribes when the plugin closes), `showPanel` (Request Publish route), `closeLibrary` (optional; not required). Context fields used: `org`, `site` (fall back to `repo`), `path`, `ref`. Capability presence is feature-checked at runtime, not assumed. The SDK promise never resolves outside EW, so the plugin has the same "waiting then not inside EW" state as hello-world.
- **`ref=local` and branch ref:** as in #1 and #2: static server on port 3000 (`ref=local`), local worker on 8787 for `ref=local`, deployed worker for branch refs and main. The plugin page's real `Origin` in each case is covered by the template allowlist (`da.live`, site `aem.live`/`aem.page`/`preview.da.live`, `localhost:3000` only in the local env).

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| DA Admin `GET /config/{org}/{site}` and `/config/{org}` | rules + settings tabs (`data` rows per tab) | Bearer IMS | https://docs.da.live/developers/api/config ; read pattern in https://github.com/adobe/da-live/blob/main/blocks/shared/utils.js (`fetchDaConfigs`) |
| DA Admin `GET /source/{org}/{site}/{path}.html` | saved-page fallback; existence confirm for a missed link | Bearer IMS | https://docs.da.live/developers/api/source |
| DA Admin `GET /list/{org}/{site}/{folder}` | internal link existence (children: `path`, `name`, `ext`, `lastModified`) | Bearer IMS | https://docs.da.live/developers/api/list |
| DA App SDK `subscribeLiveDocument`, `showPanel` | live content; route to Request Publish | SDK port | https://da.live/nx/utils/sdk.js ; host side: https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js |
| This extension's worker `POST /links/check` | external reachability | Bearer IMS (template) | `shared/worker-template/SPEC.md` ; Cloudflare limits https://developers.cloudflare.com/workers/platform/limits/ |
| Adobe IMS key set (worker side) | verify caller | none | per #2 |

Auth flow: SDK handshake gives the page the IMS token; the page sends it as `Authorization: Bearer` to `admin.da.live` and to the worker only; the worker verifies it with the template; the worker contacts third-party sites with no credentials at all. No vendor account or key exists in this ticket.

**Unverified [OPEN]:** that `admin.da.live` allows cross-origin reads from the plugin's `aem.live`/`localhost:3000` origins with a Bearer token (prior art says yes; M3 confirms); that the DA list API paginates or truncates (R9); the shape differences of the live HTML (R3); the panel id used by `showPanel` for a library-registered Request Publish (R5).

## 4. Data contracts

All are behavior contracts, not code.

**Rule sheet (`prepublish-lint-rules`):** columns in Decision 4. Example rows (illustrative, goes in the README):

| rule | severity | pattern | params | message |
|---|---|---|---|---|
| `image-alt` | `error` | `/*` | | Describe the image for screen readers. |
| `heading-order` | `warning` | `/*` | | |
| `required-metadata` | `error` | `/*` | `keys=title\|description` | |
| `banned-terms` | `error` | `/legal/*` | `terms=guarantee\|risk-free; suggestion=may reduce` | Legal review rejects absolute claims. |
| `required-block` | `error` | `/legal/*` | `blocks=disclaimer` | |
| `internal-links` | `error` | `/*` | | |
| `external-links` | `warning` | `/blog/*` | | |
| `heading-order` | `off` | `/blog/archive/*` | | |

**Settings sheet (`prepublish-lint-settings`):** `key`/`value` rows (Decision 12 and Section 2).

**Engine output:** an ordered report of violations (Decision 17), a list of configuration problems (row reference + reason), a list of checks that could not run (with reason), a content fingerprint, and the verdict (Decision 10).

**Worker route `POST /links/check`:**
- Request: JSON `{ urls: [ ... ] }`, `Content-Type: application/json`, `Authorization: Bearer <IMS>`. Each URL is an absolute string of bounded length; the array has a bounded size (starting point 8 per call, so that one call's worst case of probes and redirect hops stays under the Workers Free 50-subrequest limit even with the JWKS fetch: https://developers.cloudflare.com/workers/platform/limits/) [ASSUMPTION: numbers; measured in smoke test SM-L4].
- Response `200`: `{ results: [ { url, state: "ok"|"broken"|"unverified", reason, httpStatus?, finalHost? } ] }` in request order; `reason` from a fixed set (`ok`, `redirected`, `not-found`, `server-error`, `unreachable`, `blocked-by-site`, `timeout`, `too-many-redirects`, `redirect-loop`, `invalid-url`, `blocked-target`). Nothing else: no headers, no bodies, no echo of query strings.
- Errors: the template's error contract (`400 bad_request` for a malformed or over-cap body, `401`, `403 forbidden_origin`, `404`, `405`, `413`, `429`, `5xx`); CORS headers on every response to an allowed origin.
- Probe policy: Decision 11. A per-URL result of `invalid-url`/`blocked-target` is returned (not an HTTP error) so one bad URL does not fail the whole call.

**Browser constants:** worker origin (loopback on `localhost`, otherwise one fixed deployed origin), the DA Admin origin, the default settings.

## 5. Folder layout (proposed; fits #1/#2)

```
apps/prepublish-linter/
├─ SPEC.md                        this file
├─ README.md                      setup, library row, config tabs and every rule type (table), what permissions authors need, advisory-gate note, local dev
├─ prepublish-linter.html         entry page (SDK script + extension script)
├─ prepublish-linter.js           bootstrap: awaits SDK, wires services into the UI
├─ prepublish-linter.css
├─ lib/                           side-effect-free logic: config parse/resolve, doc model adapter, rules/*, engine, verdict, services interfaces
├─ ui/                            render module (pure render from state)
├─ test/unit/                     WTR tests (S2) + fixtures (html pages, config sheets)
├─ test/e2e/                      Playwright specs (S1)
└─ worker/                        copy of shared/worker-template/scaffold: wrangler config, route list, link-check route, SSRF guard, README, test/ (W1) and smoke (W2)
```

(No `providers/` folder: there is no vendor.) Conventions: no cross-extension imports; the worker imports the shared core by relative path as decided in #2; `.hlxignore` hides `test/` and `worker/`.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Advisory only.** Nothing prevents an author opening Request Publish directly; no SDK veto exists. Product expectation vs reality. | High (expectation) | State "advisory" in README and UI copy; take the `editor.enforcePreflight`/custom Preflight question to the EW team (Q1); do not overpromise. |
| R2 | **Overlap** with native Preflight (Governance Agent) and the AI assistant (the ticket's own overlap risk 3/5). | Medium | Differentiate: deterministic, site-config rules, no AI call; do not depend on or duplicate the Governance API. |
| R3 | **Live HTML shape** from `subscribeLiveDocument` is editor-produced and undocumented (instrumentation, rewritten image URLs, `hr` section markers seen in da-live helpers). A rule that works on saved source could misfire on live HTML. | Medium-High | Document model adapter with fixtures for both shapes; manual M4 captures a real live snapshot and the fixtures are updated from it; unit tests run every rule against both. |
| R4 | Authors lack `read` on CONFIG, so no rules load. | Medium | Distinct, plain error state (US18); README states the permission; manual M8. |
| R5 | **Request Publish routing**: `showPanel` id for a library row is not verified; Prepare-menu placement cannot be opened programmatically. | Medium | Settings keys; instruction fallback for Prepare; manual M5 verifies the id; README records the finding. |
| R6 | **Request Publish needs Adobe onboarding**; the test site may not have it. | Medium | Stand-in plugin for M5; real Request Publish confirmation is a nice-to-have manual run (Q7). |
| R7 | **Worker as SSRF / open scanner.** Any authenticated Adobe user (offline JWT check) could probe public sites at our expense, and a bad guard could reach internal targets. | High | Decision 11 guard + tests WK5-WK7; template client-id allowlist and `authorize` hook (#2 R3); caps per call; optional Cloudflare rate-limit binding documented (#2 Out of Scope), not built. [ASSUMPTION on Cloudflare network isolation.] |
| R8 | **Template fit:** `proxy` requires an allowlist and a secret; template may require at least one `secrets.required` name; CI checks UR1-UR5 assume one. | Medium | Q2/Q3; worker uses runtime `fetch` with its own guard; confirm zero-secret workers pass #2's repo checks (WK13). |
| R9 | **Internal link false positives:** code-bus paths, `redirects` targets, folder listing truncation, case-sensitivity, `index` pages. | Medium | Ignore list, confirm-on-miss via `/source`, unverified (not broken) on non-404; fixtures for each case; owner reviews defaults (Q8). |
| R10 | **External link flakiness and bot blocking** (`403`/`429`/`999`, slow hosts, single-vantage view from Cloudflare). | Medium | `unverified` is not a violation; severity per rule row; default recommended `warning`; documented. |
| R11 | **Free-plan limits** (10 ms CPU, 50 subrequests, 100k requests/day). | Low-Medium | Small chunks, sequential/low-concurrency client, cap on distinct URLs, SM-L4 measures; paid plan is an owner choice (#2 Q1). |
| R12 | **Stale result.** Author edits after the run and publishes on an old "ready". | Medium | Fingerprint + `stale` state; tests V5-V6, P3; one-click re-run. |
| R13 | **Authoring the `params` column** is error prone (separators, pipes in values). | Low-Medium | Strict parser with clear config-problem messages; README examples; tests C2, C4-C8. |
| R14 | **Unsupported/changed SDK actions** (source-derived, undocumented). | Medium | Runtime feature checks with graceful states; SDK stub contract test from #1; manual M4; optionally the "SDK canary" job #1 R4 proposed. |
| R15 | **Config problems fail open** (author is not blocked by a broken rule they cannot fix), so a typo could silently weaken the gate. | Medium | Show config problems prominently in the panel header; marks the verdict as a caveat; Q4 asks whether to fail closed instead. |
| R16 | Adobe outside-activity/IP policy and which Cloudflare account hosts this worker (carried from #1 R1 and #2 R1). | High for publishing | Owner decision; no technical dependency. |
| R17 | Large pages (hundreds of links/images). | Low | Parse once, dedupe, bounded concurrency, cap on external URLs with an "N not checked" caveat. |

## 7. Ordered build plan (sized to #10's acceptance criteria)

0. **Prerequisites (owner):** #1 merged (tooling, CI, SDK stub, hello extensions, Code Sync); #2 merged (template, test kit, deployed hello worker); decide Open Questions 2-4 (they change the worker shape); a DA test org/site with config access.
1. **Folder + registration skeleton** (AC5, AC6): `apps/prepublish-linter/` from the hello-plugin copy; README with the library row and an empty rule table; row appended to the root README extensions table; S3 check passes.
2. **Config parser and resolver**, test-first (C1-C12). AC1.
3. **Document model adapter** with live and saved fixtures (D1-D4). Enables every rule.
4. **Rules, one at a time, test-first** (R-img, R-head, R-meta, R-terms, R-block): `image-alt`, `heading-order`, `required-metadata`, `banned-terms`, `required-block`. AC1 (built-in types), AC2 (offending text).
5. **Engine, ordering, fix text, verdict state machine** (E1-E6, V1-V9). AC2, AC3.
6. **Internal links** with a fake DA Admin service (I1-I9). AC1, AC4 (client side).
7. **Worker:** `POST /links/check` with the guard behind the template pipeline, test-first (WK1-WK14), then smoke (SM-L1-SM-L4). AC4, AC8.
8. **External-links rule + client** (X1-X7). AC1, AC4.
9. **UI + bootstrap** (U1-U10): grouping, fix disclosure, config problems, incomplete note, Request Publish route, standalone state. AC2, AC3.
10. **Content source + wiring** (live snapshot, fallback, staleness) (S1-S5); e2e (P1-P8). AC2, AC3, AC4, AC8.
11. **README completion** (every rule type and parameter, settings keys, permissions, advisory note, local dev, worker deploy per #2) and the README-vs-registry check (UR-L1). AC5.
12. **CI** green via #1/#2 jobs (no new jobs required); fix lint. AC9.
13. **Deploy the worker; manual verification M0-M10** in real EW with `ref=local` and a branch ref; record findings (live HTML shape, `showPanel` id, CORS) in the README and update fixtures. AC7, AC8.
14. **Hand-off notes**: record in the PR what was learned about gating (Q1) for the owner.

---

# Testing Requirements

## 1. Unit tests (seam S2, `@web/test-runner`)

Fixtures/mocks: HTML pages as strings in both shapes (saved-source shape and captured live-editor shape; placeholder until M4 captures a real one) under the extension's `test/unit` fixtures; config JSON shaped like the DA config multi-sheet response (`:names`, per-tab `data` rows); a fake `services` object (`pathExists(path) → exists|missing|unknown`, `checkExternal(urls) → results|throws`) that records calls; an injected `now`/timers. The #1 SDK stub is reused for bootstrap/UI tests. Tests call the engine/parser/renderer with these and assert outputs; no network, no EW.

### 1.1 Config parsing and resolution (AC1)

| ID | Behaviour asserted |
|---|---|
| C1 | A valid row (`rule`, `severity`, `pattern`, `params`, `message`) parses into a typed rule; header names match case-insensitively; extra columns ignored |
| C2 | `params`: `a=1; b=x\|y`, extra whitespace, empty pairs, a value containing `=`, trailing `;`, duplicate keys (last wins, reported) parse as specified; malformed pair is a config problem naming the row |
| C3 | Unknown rule type → config problem, row skipped, other rows still run |
| C4 | Invalid severity (anything but error/warning/info/off, case-insensitive) → config problem |
| C5 | Blank `pattern` = `/*`; invalid pattern (no leading slash, `*` mid-path) → config problem |
| C6 | `severity=off` removes the rule type for matching pages |
| C7 | Unknown/invalid params for a type (bad `min`, non-boolean flag, empty `terms`) → config problem, not an exception |
| C8 | Site tab present → used alone; absent → org tab; both absent → `not-configured`; tab present with zero data rows → `not-configured` |
| C9 | Specificity: exact beats `/a/b/*` beats `/a/*` beats `/*`; `/a/*` matches `/a`, `/a/b`, not `/ab`; `.html`, trailing slash and a leading `/` are normalized before matching |
| C10 | Same specificity, same type, several rows → all apply (additive); a more specific `off` disables the broader row; a more specific non-off row replaces it |
| C11 | Settings tab: known keys read, unknown keys ignored, malformed value falls back to default with a config problem |
| C12 | A rule sheet is data only: a `message` or param containing HTML/script is carried as text (never interpreted) |

### 1.2 Document model adapter (feeds every rule)

| ID | Behaviour asserted |
|---|---|
| D1 | Saved-source fixture and live-shape fixture of the same page produce the same model (blocks, metadata, headings, images, links) |
| D2 | Sections, nested blocks with variant classes (`hero dark`), and the metadata block are located; an absent metadata block yields an empty key/value set |
| D3 | Editor instrumentation attributes and wrapper elements in the live shape are ignored; script/style content is ignored for text rules |
| D4 | Empty, whitespace-only and malformed HTML do not throw |

### 1.3 Rules (AC1 built-in types, AC2 offending text); every case run against both document shapes

| ID | Behaviour asserted |
|---|---|
| R-img1 | `image-alt`: `<img>` without `alt` and with blank/whitespace `alt` → violation showing the image source; non-blank alt → none; `allow-empty=true` allows `alt=""` only |
| R-img2 | Images in `<picture>`, inside blocks and linked images are found; the offending item is identified by source and nearest text, not by position only |
| R-head1 | `heading-order`: h1→h3 flagged at the h3 with its text and "h1 to h3"; h2→h1 and h2→h2 not flagged; skipped on pages with no headings |
| R-head2 | `single-h1=true` flags a second h1; `start=2` flags a page whose first heading is h1 |
| R-meta1 | `required-metadata`: key missing, key present with blank value, whitespace-only value → one violation per key naming the key; present → none |
| R-meta2 | No metadata block at all → one violation per required key; keys matched case-insensitively and trimmed |
| R-meta3 | Duplicate keys in the metadata block flagged; `title` equal to `description` (normalized) flagged; `min`/`max` length enforced per key |
| R-term1 | `banned-terms`: case-insensitive whole word and multi-word phrase; not matched inside longer words (`class` vs `ass`); every occurrence listed with a bounded context window; text shown as text |
| R-term2 | `include-attrs=true` also inspects `alt`/`title`; default does not; `suggestion` appears in the violation; regex metacharacters in terms are literal |
| R-term3 | Several rows at one specificity combine; unicode and punctuation-adjacent terms (`risk-free.`) match as designed |
| R-blk1 | `required-block`: absent → violation naming the block; present with variant classes → none; `min=2` counts occurrences |
| R-int1 | `internal-links` normalization table: relative (`../a`), root-relative, same-site absolute on `aem.page`/`aem.live`/`preview.da.live` with any branch; query/hash stripped; `mailto:`/`tel:`/`#x`/other-site links skipped; `/x` ↔ `x.html`/`x.json`/`x.pdf`; `/folder/` ↔ `index.html` |
| R-int2 | Missing target → violation with the target path and the link text; present → none; duplicates of one target reported once with all occurrences |
| R-int3 | `ignore` patterns and the default ignore list suppress code-bus paths and `media_` hashes; the list service is called once per distinct folder |
| R-int4 | Miss in the listing but `200` on the `/source` confirm → no violation; `404` confirm → violation; `401`/`403`/`5xx`/network error on confirm → `unverified` info + incomplete, not a violation |
| R-ext1 | `external-links`: only absolute `http(s)` links to other hosts are sent to the service; same-site links and non-http schemes never are; duplicates are sent once; chunking at the documented cap and URL-count cap with an "N not checked" caveat |
| R-ext2 | Result mapping: `broken` → violation at the row severity; `unverified` → info + incomplete; `ok` → nothing; a result missing for a sent URL is treated as unverified |
| R-ext3 | Service throws/rejects/times out → rule reported as "could not run" (incomplete), no violation, no exception; no service call at all when the page has no external links or the rule is off/not applicable |

### 1.4 Engine and ordering (AC2)

| ID | Behaviour asserted |
|---|---|
| E1 | Only the rule rows that resolve for the page run (C9/C10 applied end to end) |
| E2 | Violations are grouped error → warning → info, document order within a group, stable across runs |
| E3 | A rule that throws is reported as an internal "rule failed" item and does not stop the others |
| E4 | Each violation carries a non-empty built-in fix explanation; a row's `message` is appended; custom text is escaped/plain |
| E5 | Output contains counts per severity matching the list |
| E6 | Deterministic: the same inputs give byte-identical output |

### 1.5 Verdict (AC3)

| ID | Behaviour asserted |
|---|---|
| V1 | No rules → `not-configured`; no route to Request Publish |
| V2 | At least one error → `blocked`; route absent |
| V3 | Zero errors, only warnings/info → `ready`; route offered; warnings did not block |
| V4 | Zero errors but a check could not run → `ready-incomplete`; route offered with the caveat shown |
| V5 | Document changes after a run → `stale`; route removed; re-run produces a new verdict |
| V6 | Page path or rule sheet change after a run → `stale` |
| V7 | Cannot read the page → `failed`; route absent |
| V8 | `running` state offers no route; a second run request while running is ignored |
| V9 | Property test: across generated reports and verdict transitions, the route is offered iff (verdict ∈ {ready, ready-incomplete}) and the fingerprint equals the current content |

### 1.6 Content source and services

| ID | Behaviour asserted |
|---|---|
| S1 | Live snapshot delivered → used and labeled "current edits"; the subscription taken for the snapshot is released |
| S2 | No snapshot within the bounded wait → saved source from DA Admin used, labeled "saved version" |
| S3 | Saved source `404`/`401`/`403`/`5xx` → `failed` with a plain message per case (no stack, no token) |
| S4 | `401` from DA Admin never triggers a sign-in redirect (no SDK `daFetch` use); shows a re-open message |
| S5 | Config `403` → "no access to site configuration" message; `404` on both levels → `not-configured` |

### 1.7 Panel render and bootstrap (AC2, AC3, AC5-6 via bootstrap)

| ID | Behaviour asserted |
|---|---|
| U1 | Severity groups render in order with counts; empty groups are omitted |
| U2 | Each violation shows rule label and offending text; HTML/script in page text, alt text, link targets or rule messages renders as literal text with no elements created |
| U3 | Activating a violation (click, Enter, Space) toggles its fix explanation (`aria-expanded`); the explanation includes the row's custom `message` |
| U4 | Config problems and incomplete checks are listed in their own groups |
| U5 | `blocked`: the panel says Request Publish is not available yet and shows no button or link to it |
| U6 | `ready`: "Ready" and a Request Publish button; click calls `actions.showPanel` exactly once with the configured title (default `Request Publish`) and nothing else |
| U7 | `request-publish.location=prepare` shows the instruction text and no button |
| U8 | `stale` shows "page changed since last check" and a run button, no route |
| U9 | Standalone (SDK never resolves) shows the waiting then "not inside Experience Workspace" state; run is disabled |
| U10 | The token never appears in the DOM, console output or snapshots; `?worker=`, `?org=`, `?site=` query parameters are ignored (worker origin and org/site come from constants/SDK context) |

### 1.8 Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR-L1 | The README rule table lists exactly the rule types the registry implements, each with its parameters and an example row (fixture-tested drift check) |
| UR-L2 | The extension has an entry page named after the folder, README, tests, and a row in the root README extensions table with type `library plugin` (the #1 convention check) |
| UR-L3 | The README documents the `library` row and both config tabs (rule and settings), and the permission note and advisory note headings exist (marker check) |

## 2. Worker tests (seam W1, `node:test` via #2's test kit)

Fixtures/mocks: #2's `makeEnv`, `fakeIms`/`signToken`; a scripted `fetch` that returns configured statuses, redirect chains (`Location`), slow responses, thrown network errors, and records every outbound request (URL, method, headers). Template-wide behavior (token matrix, CORS matrix, error contract, canary) is inherited from #2's UA/UC/US tests and not repeated; the tests below cover only what this route adds.

| ID | Behaviour asserted | Proves |
|---|---|---|
| WK1 | `POST /links/check` without a token → `401` with CORS headers for an allowed origin; the scripted fetch recorded zero outbound requests | AC8 |
| WK2 | Disallowed origin with a valid token → `403`; no outbound request | AC8 |
| WK3 | Valid token and body → `200` results in request order with the documented schema and nothing else | AC4 |
| WK4 | Body validation: not JSON, missing/`non-array` `urls`, more than the cap, non-string or over-length entries → `400 bad_request`; empty array → `200` empty | AC4 |
| WK5 | Guard matrix returns `blocked-target`/`invalid-url` with **no outbound fetch**: `http://localhost`, `127.0.0.1`, `[::1]`, `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `0.0.0.0`, decimal `2130706433`, hex `0x7f000001`, octal forms, `file:`, `ftp:`, `javascript:`, `http://user:pass@host`, port `8080`, `host.local`, `host.internal`, empty host | AC8 (open proxy) |
| WK6 | Redirects: a 301→200 chain is `ok/redirected`; a hop to `http://127.0.0.1` or a private host is refused (`blocked-target`) and not fetched; a loop → `redirect-loop`; more than the hop cap → `too-many-redirects`; `Location` relative and absolute forms handled | AC8 |
| WK7 | Status mapping per Decision 8: `200/204/301→200` ok; `404`/`410` broken `not-found`; `500` retried once then broken `server-error`; `401/403/429/451/999` unverified `blocked-by-site`; timeout unverified `timeout`; network error broken `unreachable` | AC4 |
| WK8 | `HEAD` refused (`405`/`501`) → one `GET` with `Range`; response bodies are never read or returned (the stream is cancelled) | AC4 |
| WK9 | Outbound hygiene: no `Authorization`, `Cookie` or forwarded headers on any probe; fixed user agent; the inbound IMS token string appears in no outbound request and no response/log line | AC8 |
| WK10 | Response contains only whitelisted fields; target response headers/bodies/`Set-Cookie` never appear | AC8 |
| WK11 | Per-URL timeout and overall deadline: slow targets yield `timeout`, the call still returns `200` before the deadline; concurrency never exceeds the cap | AC4 |
| WK12 | Worst-case subrequest count for a maximal body (all URLs redirecting to the hop cap, with retries) stays within the documented budget | AC4 |
| WK13 | Zero-secret worker passes the #2 repo checks (UR1-UR5 variants for "no `secrets.required`"), and its wrangler config has no loopback-allow flag in the production environment (the flag is local/test only) | AC8 |
| WK14 | Pipeline order inherited: unknown route without token → `401`; with token → `404`; wrong method → `405` | AC8 |

## 3. Runtime smoke tier (seam W2, workerd via wrangler, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SM-L1 | The worker bundles (shared core resolves) and a bare request returns `401` (deployed-liveness signal) |
| SM-L2 | With the local-only loopback flag, a valid test-signed token and the fixture target server (200, 301→200, 404, slow, 405-on-HEAD): real results match WK7/WK8; preflight from an allowed origin and from `evil.example` behave as UC4/UC5 over real HTTP |
| SM-L3 | With the flag **off**, the same loopback target is refused (`blocked-target`) over real HTTP |
| SM-L4 | Records wall time and subrequest count for a maximal call (informational against R11; sets the real cap, replacing the starting values) |

## 4. End-to-end tests inside the extension (seam S1, Playwright, Chromium, hermetic)

Server: #1's static dev server on `:3000`; `page.route` serves the stub SDK module and fulfils `admin.da.live` routes (config tab, list, source) and the worker origin from fixtures; every other request is aborted. The stub SDK delivers a scripted live document through `subscribeLiveDocument`, can re-emit a changed document (simulating an author edit), and logs calls (`showPanel`).

| ID | Behaviour asserted | Proves |
|---|---|---|
| P1 | Page with seeded problems (missing alt, h1→h3, empty description, banned term, broken internal link, dead external link) → Run → violations grouped by severity with offending text for each rule type | AC1, AC2 |
| P2 | Activating a violation reveals its fix explanation including the row's custom message | AC2 |
| P3 | Gate: with an error the panel offers no route to Request Publish; after the stub emits a corrected document the verdict is `stale`; re-run → `ready`; the button appears; click logs `showPanel('Request Publish')`; a further document change removes the button | AC3 |
| P4 | Network audit: the only hosts contacted are the SDK stub URL, `admin.da.live` (stubbed) and the worker origin; internal link checks and config/page reads never hit the worker; worker request bodies contain only a `urls` array of external URLs (no page text, no internal paths) | AC4 |
| P5 | Worker down / `401` / network error: external-links rule reported "could not run", verdict `ready-incomplete` (when no errors), nothing else affected | AC3, AC4 |
| P6 | The IMS token is sent only as `Authorization` to `admin.da.live` and the worker origin; it appears in no request to any other host and not in page HTML or text | AC8 |
| P7 | `?worker=https://evil.example`, `?org=x&site=y` in the page URL change nothing (requests go to the configured worker and the context org/site) | AC8 |
| P8 | Standalone (SDK route never fulfilled) → standalone state, no network calls | AC7 (graceful) |
| P9 | Narrow-viewport render (library panel width) keeps groups, buttons and text readable and operable by keyboard | AC2 |
| P10 | Rule scoping: the same document under two different page paths (`/legal/x`, `/blog/y`) yields different violation sets per the sheet | AC1 |

Tier 2 (real session) stays manual, as decided in #1.

## 5. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login, a Cloudflare account)

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, #1); an Adobe IMS identity with edit access to the DA org/site content and **write** on the site config (to add rows), plus a second identity with content access and CONFIG **read** only (and a third without CONFIG read, for M8); Chrome; a Cloudflare account with Wrangler login (#2); no vendor sandbox, no API key, no third-party account. Test content: a DA site with a "fixture" page (missing alt text, an h1→h3 jump, empty description, the term `guarantee`, a link to a page that does not exist, a link to `https://example.com/definitely-missing-404`, a link to a good external URL, an unsaved-edit scratch page) and the rule tab from Build Analysis section 4. Never paste a real IMS token into chat, issues or logs.

- **M0 (prereq):** #1 M0 passes (code site reachable); the worker is deployed (`wrangler deploy` from `apps/prepublish-linter/worker/`, no secret to set) and `curl -i <worker>/links/check` returns `401`; set the worker origin constant by a normal PR.
- **M1 (register):** add the `library` row and the `prepublish-lint-rules`/`prepublish-lint-settings` tabs at `https://da.live/config#/{org}/{site}/`. Proves AC1 (rules in a config sheet), AC5/AC6 (documented row, reachable from the library).
- **M2 (`ref=local`):** `npm start` (port 3000) and the local worker (port 8787); open the fixture page in the EW editor with `?ref=local`; open the library → the plugin is listed; Run. Expect grouped violations per the rule tab, each with offending text; open one for its fix; the dead external link shows as a violation, the good one does not. Proves AC2, AC4, AC7.
- **M3 (branch ref, deployed worker):** push branch `prepublish-linter` (simple name), wait for code sync, open the same page with `?ref=prepublish-linter`; repeat M2. In DevTools Network confirm: calls only to `admin.da.live` and the worker; preflight `204` with the allowed `Access-Control-Allow-Origin`; record the page's real `Origin` and whether `admin.da.live` allows it (resolves the DA Admin CORS assumption and R3's network side). Proves AC4, AC7, AC8.
- **M4 (live vs saved, SDK reality):** type into the page without saving, remove one alt-less image, Run → the violation disappears (live content used); then simulate no live snapshot is available (close and reopen quickly, or run before the host delivers) and confirm the "saved version" label. Capture the live-document HTML once (DevTools, own data only) to refresh the live-shape fixture; note instrumentation and image URL rewrites in the README. Proves AC2; resolves R3, R14.
- **M5 (gate and handoff):** with errors present, the panel offers no route; fix everything, Run → Ready and the Request Publish button. Click: the Request Publish panel opens. If Request Publish is not onboarded for the test site, retitle an existing library entry (the #1 hello plugin) to `Request Publish` in the library sheet for this check and confirm `showPanel` opens it; also test `request-publish.location=prepare` shows the instruction. Edit the page → the button disappears. Record the observed panel id behavior in the README. Proves AC3; resolves R5.
- **M6 (worker negatives, deployed):** `curl` the route with no token → `401`; with a valid token and `Origin: https://evil.example` → `403`; with a valid token and a URL list containing `http://169.254.169.254/`, `http://localhost`, `file:///etc/passwd` → results `blocked-target`/`invalid-url`, nothing probed; preflight from `https://da.live` → `204`. Proves AC8.
- **M7 (secret hygiene):** search page source, network responses and Application storage for the IMS token (it must appear only in `Authorization` headers to the two hosts); confirm the worker has no secrets (`wrangler secret list` empty) and logs (Workers Logs) contain no token. Proves AC8.
- **M8 (permissions negative):** as the identity without CONFIG read, open the plugin → plain "no access to site configuration" message; as the read-only identity → rules load and Run works. Resolves R4.
- **M9 (scoping and overrides):** on a `/legal/*` page verify the legal-only rows apply; on `/blog/archive/*` verify `heading-order=off` suppresses it. Proves AC1.
- **M10 (README/table/discoverability review):** README table row exists and matches the S3 check; a fresh admin can enable the plugin from the README alone (follow it on a scratch site). Proves AC5, AC6.

## 6. CI (no credentials)

No new jobs: the extension's tests are discovered by the existing globs. `lint` (ESLint + Stylelint + the S3 check, including UR-L1..L3 and the zero-secret worker rules), `unit` (S2, all of section 1), `worker-unit` (WK1-WK14), `worker-smoke` (SM-L1..L4), `e2e` (P1-P10), as defined in #1 and #2, all on every push and pull request. No Cloudflare or Adobe credential enters CI.

## 7. Acceptance-criteria traceability (ticket #10)

| # | Acceptance criterion (#10) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Rules are defined in a site config sheet (rule, severity, path pattern, parameters); built-in rule types cover the examples | C1-C12 (parse, resolution, overrides, org fallback); R-img1-2, R-head1-2, R-meta1-3, R-term1-3, R-blk1, R-int1-4, R-ext1-3 (each example rule type); E1; P1, P10; UR-L1 (docs match registry) | **M1** (rows in a real config sheet), **M9** (path scoping/override), README review of the rule table |
| AC2 | Running the plugin lists violations grouped by severity with the offending text/element; clicking a violation explains the fix | E2, E4, E5; R-* offending-text cases; U1-U4; P1, P2, P9 | **M2**, **M4** (current page incl. unsaved edits) |
| AC3 | Errors block a "ready to request publish" state; the plugin links to Request Publish only when no errors remain | V1-V9 (including the property test), U5-U8; P3, P5 | **M5** (real gate behavior, route opens Request Publish or stand-in; disappears after edit) |
| AC4 | External link checks go through the worker; everything else client-side via the DA Admin API | R-ext1-3, R-int1-4, S1-S5; WK3, WK4, WK7, WK8, WK11, WK12; P4 (network audit: only DA Admin, SDK, worker; worker receives URLs only); SM-L2 | **M2**, **M3** (Network panel shows only the documented hosts) |
| AC5 | Self-contained folder per the convention, README covering setup, the config-sheet row, and the site config it reads | UR-L1, UR-L2, UR-L3 (S3 check: folder structure, README markers) | **M10**; reviewer checks the README for the library row, both tabs, permission and advisory notes |
| AC6 | Listed in the repo README extensions table and reachable from the editor library | UR-L2 (table row ↔ folder ↔ entry page) | **M1**, **M2** (plugin is listed in the library), **M10** |
| AC7 | Works in EW with `ref=local` and with a branch ref | P8 (standalone), P7 (URL-parameter immunity); hermetic proxies for the loop; SM-L2 | **M2** (`ref=local`), **M3** (branch ref), M5 |
| AC8 | Vendor credentials live only in the worker (built from the template); the browser never receives them; unauthenticated calls are rejected | WK1, WK2, WK5-WK10, WK13, WK14 (+ inherited #2 UA/UC/US); P6, P7; U10; SM-L1, SM-L3 | **M0** (bare `curl` → 401), **M6**, **M7**; note: this extension has no vendor credential at all, the criterion's content is "no secret reaches the browser, no IMS token forwarded, unauthenticated rejected" (Decision 9; confirm in Q3) |
| AC9 | Core logic covered by unit tests; lint and CI green | Sections 1 and 2 run by `npm test`/`npm run test:worker`; CI jobs `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` green on push and PR | Review: all checks green on the PR; deliberately break a rule on a scratch branch (for example loosen `/a/*` boundary matching) and see C9 fail |

Every acceptance criterion on #10 maps to at least one automated test or a numbered manual verification step above.

## 8. Open questions for the owner

1. **Real gating.** The ticket's "block" is advisory only (Further Notes, R1). Is advisory acceptable, or should we ask the EW team whether a custom Preflight (`editor.enforcePreflight`, and the doc/source mismatch about Preflight in the Prepare menu) or another hook can make the linter an actual publish gate? Who at Adobe can answer?
2. **Template fit (R8).** Should #2's template gain a "public egress without a secret" helper (allowing arbitrary public hosts with an SSRF guard), or is the link-check route allowed to use the runtime `fetch` directly with its own guard (this spec's choice)? Is a worker with no secrets acceptable to the template's checks?
3. **AC8 wording.** There is no vendor credential here, so the acceptance criterion reduces to "no secrets reach the browser, IMS token is never forwarded, unauthenticated calls rejected". Confirm that reading, or name a credential you expect the worker to hold (for example a link-checker API key).
4. **Fail open or closed on configuration problems (R15).** This spec fails closed when no rules apply and open (visible, non-blocking) on broken rule rows because the author cannot fix a typo. Do you prefer fail closed for broken rows too?
5. **External link semantics (R10).** Confirm the mapping: `404`/`410`/connection failure/persistent `5xx` = broken; `401`/`403`/`429`/`451`/`999`/timeouts = unverified (info, not a violation). Default severity for the `external-links` rule in the README example (`warning`)?
6. **Cross-page duplicate title/description.** The ticket's "duplicate title/description metadata" is implemented as within-page checks only. A site-wide check would need an index (for example the site's `query-index.json`, fetched from the content origin, which is not the DA Admin API and may hit CORS). Include it in v1, defer, or drop?
7. **Request Publish availability (R5, R6).** Is Request Publish onboarded for your test org/site? If not, are you content to verify the handoff with a retitled stand-in plugin? Which location do you use: `library` or Prepare menu?
8. **Internal link defaults (R9).** Confirm the default ignore list (scripts, styles, fonts, `media_` hashes), that "exists in DA content" is the right test (not "is published"), and whether `redirects` sheet targets should count as existing.
9. **Config location.** Rules live in an EW config tab (needs authors to have CONFIG read) rather than a content sheet under `/.da/` (needs content read, like Request Publish's requests sheet). Any objection? The tab and settings key names (`prepublish-lint-rules`, `prepublish-lint-settings`, `request-publish.panel`, ...) are proposals.
10. **Default experience.** `inline` panel by default, or `fullsize-dialog` for long violation lists?
11. **Worker limits and policy.** Free or Paid Cloudflare plan (R11)? Any need for per-user rate limiting beyond #2's client-id allowlist, given that any authenticated Adobe user could call a link-probing route (R7)? Which Cloudflare account hosts it (#2 Q1, #1 R1)?
12. **Naming.** Library title `Pre-publish Linter` and worker name `ew-prepublish-linter-worker`: acceptable?
