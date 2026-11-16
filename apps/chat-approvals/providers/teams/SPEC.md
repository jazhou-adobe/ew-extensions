# Spec: Slack / Teams Approvals: Microsoft Teams (provider for the chat-approvals relay)

Ticket: jazhou-adobe/ew-extensions#21 (this spec: #59). Blocked by #20 (relay + Slack; spec in `apps/chat-approvals/SPEC.md`), which is itself blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #20 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe / Microsoft / Cloudflare.

Vocabulary follows #1, #2 and #20: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/`, built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *Request Publish*, *relay*, *chat provider*, *notification event* as defined in #20 (the relay is the Request Publish email-provider endpoint; a chat provider is a vendor module behind the `ChatProvider` contract in #20 section 5.3). Additions for this ticket: *Teams provider* = the Microsoft Teams module of the relay; *bot* = the Teams bot identity (Microsoft's current documentation calls it an **agent** and the transport service **Agent Communication Service (ACS)**; the older names are *bot* and *Bot Framework Connector*; this spec says "bot" and "Connector" because the ticket, the auth docs and the wire protocol still use those words) [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/registering-agent-teams-platform]; *conversation reference* = the stored address of a Teams chat or channel (service URL, conversation id, tenant id); *scope* = where the Teams app is installed (`team` or `personal`).

---

## Problem Statement

Approvers in the Request Publish workflow learn about a pending request only from an email. #20 fixes that for Slack. Many organisations use Microsoft Teams instead of, or alongside, Slack, and Contentful's marketplace features both Slack and Teams approval apps (ticket reference; not fetched). Without Teams delivery, an approver who lives in Teams still has to context-switch to email, Experience Workspace and the Publish Requests Inbox just to see what changed.

Teams is not "Slack with a different SDK". Four differences drive this spec:

1. **No OAuth install handled by our worker.** A Teams bot is registered once in Microsoft Entra ID and the Agent Communication Service, packaged as a Teams app (a manifest plus two icons), uploaded to the customer's tenant, and added to teams and chats by Teams users or admins. Nothing resembles Slack's "Connect Slack" consent redirect [VERIFIED: registering-agent-teams-platform; https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package].
2. **Approvers cannot be addressed by email.** "Email addresses and User Principal Names (UPNs) can't be used to address proactive messages in any scope"; a personal chat needs the user's Entra object id and requires the bot to be installed in the user's personal scope, otherwise the platform answers `403` [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages]. #20 already anticipated this in the `resolveRecipients` contract.
3. **Inbound traffic is authenticated by Bot Framework JWTs, not Slack signatures.** The platform posts activities (installs, membership changes) to our messaging endpoint with a signed JWT that the worker must fully verify; the Bot Framework SDK that normally does this is no longer supported for new development, and the Teams SDK is Node-based [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/legacy-tools-sdks]. The worker must therefore speak the protocol itself, which Microsoft documents for exactly this case [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/connect-agent-without-sdk].
4. **The card format is Adaptive Cards with Teams-specific limits**: Markdown is always interpreted in text, `{{DATE()}}` functions are interpreted, `positive`/`destructive` action styling is not supported, and an `Action.OpenUrl` to a domain missing from the app manifest triggers a "URL may lead to untrusted content" warning [VERIFIED, sources in Implementation Decisions 12 to 15].

The relay shell must not change: ticket AC4 says Teams is added "as a new provider; no changes needed in the extension shell beyond registering the provider".

## Solution

Add a **Teams provider** to the `chat-approvals` relay, living entirely under `apps/chat-approvals/providers/teams/`, implementing the `ChatProvider` contract from #20 and registered by one line in the worker entry. From the user's side:

1. **A site admin** registers a Teams bot (Teams Developer Portal or the Teams developer CLI), gives the worker its app id, tenant id and client secret, builds and uploads the Teams app package for their tenant, and adds the app to a team and channel. The admin app (unchanged, descriptor-driven) shows a **Microsoft Teams** card with status, step-by-step manual connection instructions and the exact messaging endpoint to paste into the bot registration. Mapping a path pattern to a **channel** works like Slack: the admin pastes the Teams channel link (or channel id) into the same mapping editor.
2. **For every notification event** the relay already derives, the Teams provider posts an **Adaptive Card** to the mapped channel and/or to each resolved approver's personal chat: page path, author, note, approvers (mentioned only when resolved), and **Preview**, **Diff**, **Approve in Inbox** and **Reject in Inbox** link buttons. Exactly as in Slack (#20 decision 6), the Approve and Reject buttons are deep links into the Publish Requests Inbox review page because a Teams identity cannot be bound to an Adobe approver identity.
3. **When the outcome email arrives** the relay asks the Teams provider to **update the original card** (buttons removed, status line added, live link on approval, reason on rejection) and to **reply in the same thread**. A resend produces a reminder in the existing thread.
4. **Security**: every inbound activity is authenticated with the Bot Framework JWT checks (issuer, audience, signature, expiry, service URL claim, channel endorsement) and a tenant check before any handler runs; every outbound call carries a bot token the worker acquires itself; the client secret is a worker secret, never reaches the browser, and no token is stored in KV.

The browser app, the core pipeline, the thread store and the email path are untouched.

## User Stories

Site admin:

1. As a site admin, I want the Chat Approvals app to show a Microsoft Teams card next to Slack, so that I set up Teams in the same place without leaving Experience Workspace.
2. As a site admin, I want clear, ordered setup steps (register bot, package app, upload, add to team and channel, paste channel link), so that I can finish without reading Microsoft's whole documentation set.
3. As a site admin, I want the app to show me the exact messaging endpoint URL to paste into the bot registration, so that onboarding is copy-paste.
4. As a site admin, I want to see whether Teams is connected, which tenant it is bound to, which teams have the app installed and what last failed, so that I know the integration is healthy.
5. As a site admin, I want to map path patterns to Teams channels by pasting a channel link, so that I do not hunt for opaque ids.
6. As a site admin, I want the same delivery modes as Slack (channel, per-approver personal chat, or both), so that I can balance visibility against noise.
7. As a site admin, I want approvers matched to Teams users automatically from the installed teams' member lists, so that I do not maintain a second directory.
8. As a site admin, I want to override the match for specific people (an Entra object id per email), so that edge cases (alias addresses, guests) work.
9. As a site admin, I want a "send test message" that posts a real card to the mapped channel, so that I can prove the bot is installed and permitted before real requests arrive.
10. As a site admin, I want a plain explanation when delivery fails ("bot is not installed in this team", "client secret expired", "tenant not allowed"), so that I can fix it myself.
11. As a site admin, I want to disconnect Teams (forget stored conversation references and caches), so that I can offboard cleanly, with the instruction to remove the Teams app in the Teams admin center.
12. As a site admin, I want only people with write access to the site config to change Teams settings (inherited from #20), so that an ordinary author cannot redirect approvals.
13. As a site admin, I want email and Slack to keep working while Teams is added, so that I adopt Teams gradually.
14. As a site admin, I want a README section for Teams (credentials, worker variables and secrets, config keys, package build, tenant requirements), so that I can do this alone.
15. As a site admin in a deployment that only uses Slack, I want the Teams provider to stay inert and harmless until configured, so that adding Teams to the codebase changes nothing for me.

Approver (in Teams):

16. As an approver, I want a Teams message when a request needs me, so that I see it without checking email.
17. As an approver, I want to see page path, who asked and their note on the card, so that I can triage at a glance.
18. As an approver, I want Preview, Diff and review links on the card, so that I can judge the change before approving.
19. As an approver, I want **Approve in Inbox** to take me straight to the request's review screen, so that I publish as myself.
20. As an approver, I want **Reject in Inbox** to take me to the same screen, so that I reject with a reason as myself.
21. As an approver, I want to be @-mentioned only if I am actually an approver on this request, so that I am not pinged for others' requests.
22. As an approver, I want a reminder in the same thread when the author resends, so that my channel does not fill with duplicates.
23. As an approver, I want the thread to show the outcome (approved with the live link, or rejected with the reason), so that everyone knows it is done.
24. As an approver, I want the card's buttons to disappear once the request is closed, so that I do not click a dead request.
25. As an approver not in Teams, I want to still get the normal email, so that I am not left out.
26. As an approver who has the bot only in a team (not in my personal scope), I want to still be mentioned in the channel card, so that I am reached even without a personal chat.
27. As an approver, I want stale card links to land on the inbox's "No Pending Request" page, so that old messages are harmless.

Author:

28. As an author, I want my submission to reach approvers in the chat they actually read, so that approval is faster.
29. As an author, I want my note shown to approvers exactly as text (never as Teams Markdown, links, mentions or card functions), so that my note cannot ping people, plant links, or break the card.
30. As an author, I want to still receive the normal approved/rejected email, so that the existing workflow is unchanged.

Maintainer / operator:

31. As the maintainer, I want every inbound Teams activity verified with the full Bot Framework JWT procedure plus a tenant check before any handler runs, so that nobody can forge install or membership events.
32. As the maintainer, I want the messaging endpoint to reject everything without a valid Connector token and to refuse browser-origin calls, so that the internet cannot reach provider logic.
33. As the maintainer, I want the client secret to live only in the worker's secret store and no bot token to be stored in KV, so that a storage leak is not a credential leak.
34. As the maintainer, I want the bot token cached per isolate and refreshed before expiry, so that the free plan's subrequest budget is not wasted.
35. As the maintainer, I want outbound calls to Teams to go only to an allow-listed service host over HTTPS, with the service URL treated as untrusted input, so that a forged or tampered conversation reference cannot make the worker send its bot token elsewhere.
36. As the maintainer, I want Teams failures classified into `retryable`, `permanent` and `install_revoked`, so that the core reacts the same way as for Slack.
37. As the maintainer, I want Teams rate limits and `Retry-After` honoured and message sends not blindly retried on server errors, so that approvers do not get duplicate cards.
38. As the maintainer, I want one structured log line per inbound request with no tokens, secrets, activity bodies, emails or notes, so that debugging does not create a leak.
39. As the maintainer, I want the free Cloudflare plan to suffice for a small team, so that cost is zero until real usage.
40. As the maintainer, I want the Teams app manifest kept in the repo as a template, so that dev and prod bots are reproducible.
41. As the maintainer, I want the manifest's `validDomains`, the link allow-list and the README to be checked consistent in CI, so that approvers never see an "untrusted content" warning on our buttons.
42. As the maintainer, I want the Teams provider to pass the same conformance suite as Slack and the fake provider, so that "Teams only adds a provider" is proven, not asserted.

Security reviewer:

43. As a security reviewer, I want proof that a forged activity (wrong audience, wrong issuer, self-signed key, expired token, mismatched service URL claim, missing endorsement, wrong tenant) is rejected before any handler or outbound call, so that "Bot Framework auth is validated" is tested.
44. As a security reviewer, I want proof that author-controlled text (note, path, emails, names) cannot inject Teams Markdown links, `<at>` mentions, or `{{DATE()}}` card functions, so that the relay is not a phishing amplifier.
45. As a security reviewer, I want proof that only allow-listed link hosts appear on card buttons and that those hosts are covered by the manifest `validDomains`, so that a stolen relay key cannot plant arbitrary links.
46. As a security reviewer, I want proof that a canary of every secret and of a bot access token never appears in any response, log or KV value, so that "never echoed" is tested rather than promised.
47. As a security reviewer, I want proof that a stored conversation reference pointing at a non-allow-listed host is never used for an outbound call, so that tampered KV cannot exfiltrate the bot token.

Extension author (later providers):

48. As the author of a later provider, I want the Teams provider to need no core change, no browser change and no new seam, so that it proves the #20 contract is sufficient (and shows precisely where it was not; see Further Notes).

## Implementation Decisions

(No file paths or code, except where noted. Paths and layout are in the Build Analysis.)

1. **A provider module, nothing else.** The Teams provider implements every member of the `ChatProvider` contract from #20 section 5.3: `id` (`teams`), `displayName` (Microsoft Teams), `descriptor`, `routes`, `authenticators`, `beginInstall`, `resolveRecipients`, `deliver`, `update`, `reply`, `disconnect`, plus the three-kind error taxonomy. It is registered by one line in the worker entry. The core, the thread store, the email ingest and the admin app are not modified; the provider name literal appears only under the provider folder and the registration site (#20 check UR3 is the gate). Items that the core cannot do without changes are listed in Further Notes as gaps found in #20, not silently designed around.

2. **Protocol, not SDK.** The provider implements the Agent Communication Service REST protocol directly, using the documented "connect an agent without an SDK" procedure: client-credential token request to Entra, REST calls to the activity's `serviceUrl`, JWT verification of inbound activities [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/connect-agent-without-sdk]. Reasons: (a) the Bot Framework SDK is "no longer supported" for new bots and Teams SDK is the successor [VERIFIED: legacy-tools-sdks]; (b) neither SDK targets the Workers runtime [ASSUMPTION: not tested; the Teams SDK TypeScript package is a Node server framework]; (c) the protocol surface needed here is small (five REST operations, one inbound route). The REST operations used: send to conversation, reply in a thread (`replyChains`), update activity, create conversation (1:1), paged members [VERIFIED: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0 and agent-chat-threads].

3. **Registration model: Teams-managed bot registration, client-secret auth, HTTPS messaging endpoint.** Microsoft recommends a Teams-managed registration unless SSO or OAuth is needed; it needs no Azure subscription, but "can be configured and managed only by the Microsoft 365 account used to create it" [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/choose-agent-registration-type]. This ticket needs neither SSO nor OAuth. An Azure-managed registration (Azure Bot resource, `Single Tenant` bot type) is an equally valid alternative documented in the README. Runtime auth is a **client secret** because the worker cannot use Azure managed identity (it requires Azure hosting) [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/configure-agent-runtime-authentication]. Delivery is by **HTTPS endpoint**; socket mode is preview, development-only, and needs a persistent outbound connection a Worker cannot hold [VERIFIED: configure-delivery-methods-for-agents; the Workers statement is [ASSUMPTION]]. Creating new multi-tenant *Azure Bot* resources is deprecated, but the Teams developer CLI and Developer Portal still produce an Entra app registration whose audience is typically multi-tenant [VERIFIED: https://learn.microsoft.com/en-us/azure/bot-service/bot-service-quickstart-registration?view=azure-bot-service-4.0 and https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/agent-tenancy]; the provider supports both by taking the token authority as configuration.

4. **One customer tenant per deployment; tenant validation in code.** Mirrors #20 decision 10 (one Slack workspace per deployment). The deployment is configured with the allowed customer tenant id. Microsoft requires that agents for a known set of tenants "always validate the tenant ID of incoming activity payloads in their application code"; app-registration settings are "not substitutes" [VERIFIED: agent-tenancy]. Every inbound activity whose tenant is not the configured one is refused (`403`, no side effects); every stored conversation reference and every outbound call carries and re-checks the tenant id. Multi-tenant fan-out (one worker, many customer tenants) is out of scope.

5. **Inbound authentication: the full Bot Framework Connector-to-bot JWT procedure, in the worker, fail-closed.** The provider supplies a named authenticator (`bot-framework-jwt`, #20 E1) that checks, in order, before any handler: bearer scheme; well-formed RS256 JWT; issuer `https://api.botframework.com`; audience equal to the bot's app id; validity period with 5 minutes of clock skew; signature by a key from the Connector key set; the token's `serviceUrl` claim equal to the activity's `serviceUrl`; and, for the Teams channel id, that the signing key carries the `msteams` endorsement (HTTP `403` if absent) [VERIFIED procedure: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0 steps 1 to 7; the same five checks are listed for HTTPS endpoints in connect-agent-without-sdk]. The key set is fetched from the static OpenID metadata location `https://login.botframework.com/v1/.well-known/openidconfiguration` whose `jwks_uri` is `https://login.botframework.com/v1/.well-known/keys` [VERIFIED by `curl` 2026-11-16: `issuer` `https://api.botframework.com`, RS256 only; 232 keys of which 73 carry the `msteams` endorsement]. The documented cache rule applies: keys are cached and refreshed at least every 24 hours, new keys can appear at any time, so an unknown `kid` triggers a bounded refetch with a cooldown. Only the key whose `kid` matches is imported (cheap on the Free CPU budget). If the key set cannot be fetched the provider fails closed with `503` (same code family as #2's `auth_unavailable`), never accepting an unverified token. There is **no switch that disables validation**, as Microsoft requires; the Bot Framework Emulator and `skipAuth` playground modes are not supported (tests use a test-signed Connector token against a fake key set, the key-set origin being a variable overridden only in local and test environments and checked absent from the production config).

6. **Outbound authentication: client-credential token acquired by the worker, cached per isolate, never stored.** The provider requests `https://login.microsoftonline.com/{authority}/oauth2/v2.0/token` with grant `client_credentials`, scope `https://api.botframework.com/.default`, where the authority is the app registration's tenant id or `botframework.com` for a multi-tenant registration [VERIFIED: connect-agent-without-sdk and bot-framework-rest-connector-authentication]. The token is cached in memory per isolate until shortly before it expires (single flight), is sent only to the Connector host, and is never written to KV, logs or responses. The Microsoft rule that the token "should be handled with great care" and must not be sent to any other service is enforced by decision 7. Failure mapping: Entra `invalid_client` or `unauthorized_client` (for example an expired client secret, or "missing service principal in the tenant", AADSTS7000229 [VERIFIED error text: configure-agent-runtime-authentication]) means `install_revoked`; Entra `5xx`/network is `retryable`. The secret is injected into a form body, which the template's proxy helper cannot do today (needs template item N5, Further Notes).

7. **The service URL is untrusted input; outbound hosts are an allow-list.** Conversation references come from inbound activities and from KV; Microsoft tells implementers to use the `serviceUrl` of the incoming activity or conversation reference and, only when none exists, the global public URL `https://smba.trafficmanager.net/teams/` [VERIFIED: send-proactive-messages]. The provider requires `https`, no userinfo, no port override, and a host in a fixed allow-list before using any service URL for an outbound call; v1 allows the public-cloud host only. GCC, GCC High and DoD hosts exist (`smba.infra.gcc.teams.microsoft.com`, `smba.infra.gov.teams.microsoft.us`, `smba.infra.dod.teams.microsoft.us`) [VERIFIED: send-proactive-messages] but are out of scope and untested (Out of Scope). Conversation ids, activity ids and tenant ids are validated against strict character sets before being placed in a URL path (and percent-encoded), so an id cannot add path segments, query strings or traversal. A reference that fails validation is dropped and logged by reason only. This is also the template's host-allow-list rule (#2 UP11) applied to a provider.

8. **No credential, no installation ledger of secrets in KV.** Unlike Slack, there is no per-install bot token: the bot identity is one deployment-level credential. KV therefore holds only conversation references, a hashed roster index, caches and status. A canary check proves that no token or secret appears in any KV value written during a full scenario.

9. **Install model: manual connect, event-driven state.** There is no consent redirect. `beginInstall` returns manual instructions (kind `manual` in the descriptor) containing: the worker's messaging endpoint URL; the values to give the worker (app id and tenant id as variables, client secret as a secret; the secret is never shown or asked for in the browser); the steps to build and upload the app package; how to add it to a team and channel; how to copy a channel link. "Connected" is **observed, not asserted**: the provider records conversation references from the `installationUpdate` and `conversationUpdate` activities Teams sends when the app is added to a team or personal scope, and the descriptor reports `connected` only when credentials are configured and at least one installation is recorded. `needs_reconnect` is reported when token acquisition fails with an invalid-credential error or when the last installation is removed; `not_connected` when configuration is absent (inert provider, story 15). `disconnect` deletes every record the provider owns for the deployment (references, roster index, caches); there is no token to revoke, and removing the app from the tenant is an admin step documented in the descriptor [VERIFIED that uninstall is signalled by `installationUpdate` with action `remove`: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/subscribe-to-conversation-events]. Whether a notification-only bot (decision 19) still receives installation events for each scope is [ASSUMPTION], checked in MVT2.

10. **Recipients: the provider's job, never by email.** `resolveRecipients` resolves approver emails to **Entra object ids** with this order: (1) the admin override table (email to object id); (2) a short-lived cache; (3) the **member list of every team where the bot is installed**, fetched with the paged-members call (page size within the documented 50 to 500 bounds) and kept as one hashed index per team in KV (one write per refresh, refresh on a miss no more often than every 10 minutes, at most 3 pages per refresh). Resolution results carry `{ aadObjectId, upn, displayName }` as the opaque reference the core passes back to `deliver`. Unresolved approvers are shown as plain text and not mentioned. Graph-based lookup (`GET /users/{id|userPrincipalName}` needs the application permission `User.Read.All`, admin consent) is deliberately not in v1; it would resolve approvers outside the installed teams but costs a second token audience and a consent step [VERIFIED permission: https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0&tabs=http; decision to defer is [OPEN] Question 5]. That roster entries expose `email`, `userPrincipalName` and `aadObjectId` is [ASSUMPTION], confirmed by capture in MVT3 (the members API is documented in https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/get-teams-context; the field names are not shown there).

11. **Delivery targets and modes follow #20 decision 9.** `channel` posts one top-level card to the mapped channel (mentions for resolved approvers); `dm` posts one card per resolved approver to a personal chat; `both`. The channel target is a Teams channel link or raw channel id stored in the core's mapping; the provider normalises it. Posting to a channel requires the bot to be installed in that team [VERIFIED: send-proactive-messages]; a personal chat requires installation in the user's personal scope, else `403` (`ForbiddenOperationException`); a user who blocked or uninstalled the bot yields `403` with sub-code `MessageWritesBlocked` [VERIFIED: same page]. Personal chats are created once (`create conversation` with the object id and tenant id) and the conversation id is stored for reuse [VERIFIED: "Create the conversation only once, and store the resulting `conversationId`"]. Per-target failures are isolated (one blocked user does not stop the others). Proactive Graph installation of the bot for approvers (`TeamsAppInstallation.ReadWriteSelfForUser.All`) is not in v1 (Out of Scope) [VERIFIED permission: https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/proactive-bots-and-messages/graph-proactive-bots-and-messages].

12. **Approve and Reject are link buttons, exactly as in Slack.** The relay's decision (#20 decision 6) is unchanged: identity cannot be bound safely, so the card carries `Action.OpenUrl` buttons **Approve in Inbox** and **Reject in Inbox** to the inbox review URL, plus **Preview** and **Diff**. The card has no `Action.Submit` or `Action.Execute`, so Teams sends no `invoke` activity for a click and no acknowledgement deadline exists (contrast Slack's 3-second ack). One platform difference is accepted and documented: "Positive or destructive action styling is not supported in Adaptive Cards on the Teams platform" [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference], so the two buttons are distinguished by label and order only, not by colour. This is the one place "exactly as in Slack" is behavioural, not visual [OPEN] Question 8.

13. **Card format: Adaptive Card 1.5, a deliberately small element subset.** Teams supports Adaptive Cards version 1.6 or earlier for bot-sent cards, and mobile renders up to 1.6 [VERIFIED: cards-reference]; the provider uses 1.5 and the elements `TextBlock`, `FactSet`, `Container` and `ActionSet`/actions of type `Action.OpenUrl` only. Message size limit for a bot message is 100 KB [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-format]; the provider's caps (note length, count of mentions) keep it far below. A short plain `summary` accompanies every card for notification previews and clients that cannot render cards [ASSUMPTION: Teams uses `summary` rather than `text` for this, since `text` plus a card attachment shows both; MVT13 decides]. Requests are sent with UTF-8 charset (needed for emoji) [VERIFIED: cards-format note].

14. **Untrusted text is neutralised for three interpreters, not one.** Teams interprets author-controlled strings in a card in three ways: (a) **Markdown** is always applied in `TextBlock` and `FactSet` (bold, italic, lists, `[title](url)` hyperlinks) [VERIFIED: cards-format]; (b) **text-feature functions** `{{DATE(...)}}` and `{{TIME(...)}}` are evaluated in text [VERIFIED: https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/text-features]; (c) **mention markup** `<at>name</at>` is meaningful only together with a mention entity, but must not be able to imitate one [VERIFIED mechanism: cards-format "Mention support within Adaptive Cards"]. One escape function covers every untrusted field (note, path, requester, approver names, reason, emails): control and bidirectional characters removed, line breaks normalised, Markdown-active characters backslash-escaped, `<` and `>` neutralised, `{{` broken so a function cannot form. That Teams honours backslash escapes inside Adaptive Card Markdown is [ASSUMPTION]; MVT12 renders hostile samples in a real tenant, and if backslashes are not honoured the function switches to breaking sequences with a zero-width character without changing its callers (unit tests assert the absence of active sequences in the output, not exact strings, so either strategy passes the same tests). Channel and team mentions are not possible in bot messages [VERIFIED: cards-format note], which removes the "@channel" class entirely; mentions are generated only for resolved approvers, using the Entra object id as the mention id (object id and UPN are accepted mention ids in bot cards) [VERIFIED: cards-format, "Microsoft Entra Object ID and UPN in user mention"].

15. **Link policy and the manifest are one contract.** The core already restricts button links to an allow-list derived from the event's org/site (#20 decision 16). Teams adds a second layer: `Action.OpenUrl` to a domain not listed in the app manifest's `validDomains` shows **"URL may lead to untrusted content"** [VERIFIED: cards-actions]; `validDomains` supports wildcards such as `*.example.com` and has a maximum of 100 entries [VERIFIED: https://learn.microsoft.com/en-us/microsoft-365/extensibility/schema/root]. The manifest template therefore lists the allow-list host patterns (`da.live`, `*.preview.da.live`, `*.aem.live`, `*.aem.page`, `tools.aem.live`), and a repo check fails when a host pattern is in one list and not the other. Because wildcards in `validDomains` are broader than the per-event allow-list, the per-event allow-list stays the security control and `validDomains` is only the warning suppressor.

16. **Thread model.** A channel post is a top-level message; the activity id returned by the send is the thread root [VERIFIED: agent-chat-threads, "Store this ID as the root message ID"]. `reply` posts in that thread using the `replyChains` endpoint (documented for new implementations; threading capabilities are marked preview) and falls back to the older reply-chain conversation-id form (`{channelId};messageid={rootId}` on the activities endpoint) when `replyChains` answers `400`/`404`, and finally to a new top-level message in the same conversation [VERIFIED endpoints and error table: agent-chat-threads; the fallback order is [OPEN] Question 9]. `update` rewrites the earlier card with the update-activity call using the cached activity id [VERIFIED: send-proactive-messages]; if the activity no longer exists the provider falls back to reply-only (the same degradation as Slack SL8). Personal chats use the same operations; thread replies in one-on-one chats are preview-only, so the final fallback (a new message in the chat) is the expected behaviour there until preview ends. The core's thread record stores the provider's opaque message reference (conversation id, activity id, root id, service URL, kind); the provider re-validates every stored field before use (decision 7).

17. **Error taxonomy.** Mapping the provider returns to the core: `retryable` = HTTP `429` (with `Retry-After`), `502`, `504`, `412`, Entra/Connector `5xx` and network failures [VERIFIED retry set: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/rate-limit says 429, 412, 502 and 504 "must be retried"]; `permanent` = `400`, `404 ConversationNotFound`, `403` with `ForbiddenOperationException` (bot not installed in scope), `403 MessageWritesBlocked` (user blocked or uninstalled; the user's stored reference is dropped), the "not a thread id" `400 BadArgument`; `install_revoked` = Entra `invalid_client`/`unauthorized_client`, Connector `401` after a fresh token (credentials invalid or revoked), and the removal of the last installation. HTTP `200` with an unparsable body is `retryable` once, then `permanent`. Retry policy on the wire follows #2/#20: sends (POST) are retried on `429` only by default, because Teams documents `412/502/504` as retryable for rate-limit handling but a blind POST retry can duplicate a card [ASSUMPTION: `412`/`502`/`504` on POST may or may not have been processed; this is a deliberate deviation, [OPEN] Question 10]; updates (PUT) and reads (GET) are idempotent and retried on `429`, `412`, `5xx`.

18. **Rate limits and pacing.** Documented limits: per bot per conversation 7 sends per second, 8 per 2 seconds, 60 per 30 seconds and 1,800 per hour; create-conversation has the same table; get-members 14 per second; global 50 requests per second per app per tenant; thread limits are "for estimation only" [VERIFIED: rate-limit]. A typical request is one send per target, so the per-conversation limits are not approached; the provider paces successive sends to one conversation (injected `sleep`) and honours `Retry-After`. The core's DM cap (default 15) plus the provider's member-list cap bound the Free plan's 50 subrequests per invocation [VERIFIED limit: #20 R11 source; arithmetic in Build Analysis section 8].

19. **Inbound activities handled, everything else acknowledged and ignored.** `installationUpdate` (add: record references for the scope that carries the conversation id and, for a team, the team id and tenant; remove: delete the scope's references, and update status); `conversationUpdate` where the bot itself is in `membersAdded` (record) or `membersRemoved` (delete), and team or channel deletion events (delete matching references). Any other type (`message`, `invoke`, `typing`, reactions) is acknowledged with `200` and ignored; the bot is declared **notification-only** in the manifest, so users cannot converse with it [VERIFIED manifest property: https://learn.microsoft.com/en-us/microsoft-365/extensibility/schema/root-bots, `isNotificationOnly`: "one-way notification only bot, as opposed to a conversational bot"]. HTTPS delivery requires a reply within **25 seconds** [VERIFIED: connect-agent-without-sdk]; the provider answers immediately (KV writes are done before the response, they are short; nothing is sent to Teams from this route). Activity bodies are never logged.

20. **Storage is provider-namespaced KV, no new storage system.** Records (all under the `teams:` namespace, enforced by the core per #20 5.4): installation references per scope (tenant id, service URL, conversation id, team id and name if provided, kind), personal-chat conversation ids per approver object id, per-team hashed member index (24 h), resolution cache (24 h), roster refresh throttle marker, last error code per target kind. No record contains the client secret, any token, an activity body, or a note. Emails appear only as SHA-256 hashes of the lowercased address; display names (needed for mention text) are stored with the 24 h index TTL and documented in the README's privacy note [OPEN] Question 12.

21. **Provider enablement and configuration.** The provider is *enabled* when its variables and secret are present; when absent it is registered but inert (routes answer `401` like any route with no valid credential, descriptor `not_connected` with a stable reason code, no outbound calls, no log noise), so a Slack-only deployment is unaffected (user story 15). Variables (non-secret): bot app id; the token authority (tenant id or `botframework.com`); the allowed customer tenant id; the OpenID key-set origin (local/test override only); the Teams service host override (local/test only); caps. Secret: the bot client secret. Everything is named in Build Analysis section 5.5 and mirrored in the README. The interaction with the wrangler `secrets.required` guard is Risk R16 and [OPEN] Question 3.

22. **Admin surface unchanged; Teams-specific values travel in the descriptor.** The admin app renders the descriptor's manual-connect panel, status, mapping field validation hints (a channel link or channel id pattern) and the override field hint (an Entra object id), all as text (#20 WB1, WB7). The provider declares its mapping-target validation in the descriptor so that the core does not need to know the Teams id format (Further Notes G2). The messaging endpoint URL shown to the admin is derived from the worker's own origin. The client secret is never requested, shown or transmitted by the browser.

23. **Tooling and conventions follow #1, #2 and #20** (owner decisions): ESLint 8 + helix config, `node:test` for worker code, `@web/test-runner` for browser code (no browser code is added), Playwright, Node 22 (>=22.12), husky; tests live inside the folder; server code lives in `providers/teams/worker/` (#2 decision 3, itself [OPEN] there). `jose` (already a template dependency) is used for JWT verification. No Microsoft SDK package is added.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only. For the worker: given a `Request` (headers, body) and a fake outside world (fake IMS, fake Bot Framework key set and signer, fake Entra token endpoint, fake Teams Connector, fake DA admin, in-memory KV, injected `sleep`/`random`/`now`), assert the `Response`, the outbound calls (host, path, headers, body, count, order, timing), the persisted records as seen through later requests, and the logs. Never assert on internal function names, module structure or internal call counts. Three negative properties are tested across **every** path: (1) "every secret canary, and the bot access token, never appears in any response, header, log line or KV value"; (2) "no handler, store access or outbound call runs before the route's authenticator succeeds"; (3) "no outbound call goes to a host outside the allow-list, whatever the stored or inbound service URL says". Card tests assert on the **wire payload** (card element types, action types, absence of active markup sequences in untrusted fields), because how Teams renders it can only be checked manually (MVT12).

**Proposed seams** (recorded here instead of asked, per #59). **No new seam is needed.** All seams exist from #1, #2 and #20 and are reused:

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | The worker's HTTP boundary `worker.fetch(request, env, ctx)` | reused from #2/#20 | Node unit tests: inbound activities, admin routes, full email-to-Teams pipeline | Constructed `Request`s; `makeEnv`; in-memory KV; injected `fetch` routing to `fakeIms`, `fakeDaAdmin`, `fakeUpstream` (existing) and **new fakes `fakeTeams`** (Entra token endpoint plus Connector REST: send, reply chains, update, create conversation, paged members, scripted errors and `Retry-After`) and **`fakeBotFramework`** (RSA key pair, key-set document with `endorsements`, `signConnectorToken` with claim overrides) |
| PV | The `ChatProvider` interface | reused from #20 | #20's conformance suite run for Teams (plus Slack and the fake provider) | `fakeTeams` behind the Teams provider |
| W2 | Same worker in workerd over real HTTP | reused | Smoke | `wrangler dev` with local fake servers for the key set, Entra, Connector; local KV |
| S1 / S2 | Entry page + SDK module; render logic | reused | Admin app tests only if the descriptor-driven panel needs a case beyond #20's WB7 | #1 SDK stub; injected `fetch` |
| S3 | Repo convention check | reused, extended | CI lint job | temp-dir fixtures |

Why no new seam: the provider boundary (PV) already isolates it from the core, and the HTTP boundary (W1) already covers everything Teams-specific (inbound JWT, outbound calls). New *fakes* are test-kit additions, not seams. The real Teams client rendering, real Entra, real Connector behaviour and the real Request Publish round trip are covered only by manual verification (MVT matrix).

**Modules tested:** Bot Framework JWT authenticator and key-set cache; token acquisition and cache; service URL and id validation; Connector client (send, reply with fallbacks, update, create conversation, paged members); error taxonomy; card renderer and escape function; recipients (override, cache, roster index, hashing); inbound activity handling and state; descriptor, status, `beginInstall`, `disconnect`; provider conformance; secret hygiene and unauthenticated matrix extensions; manifest, README and wrangler consistency checks.

**Prior art:**
- #20 test groups and kit (`signSlack`, `fakeSlack`, `makeEnv` with canaries, IN/RL/SL/SG/OA/AD/PV/SC/UK) in `apps/chat-approvals/SPEC.md`; #2 kit (`fakeIms`, `fakeUpstream`) in `shared/worker-template/SPEC.md`; #1 SDK stub and convention check in `apps/hello-world/SPEC.md`.
- Upstream `adobe-rnd/ew-extensions` has no worker, Slack or Teams code (GitHub tree API, path search for `teams|slack|chat|approv|worker`, 2026-11-16: no matches), so prior art is the in-repo specs.
- Microsoft's own protocol description is the executable reference for the authenticator checklist (https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/connect-agent-without-sdk); there is no Microsoft-published test vector for Connector tokens, so tests mint tokens with `node:crypto`/`jose` against a fake key set (the same approach #20 took for Slack signatures).

## Out of Scope

- Approving or rejecting **from inside Teams** as the approver (`Action.Execute`/`Action.Submit` flows, SSO, OAuth). #20 decision 6 applies unchanged.
- Changes to the relay core, the thread store, the email ingest/parser, the admin app, or the Slack provider; any new seam; any change to Adobe's Request Publish plugin, inbox or worker. Gaps found in #20 are reported (Further Notes), not fixed here.
- **Multi-tenant fan-out** (one deployment serving several customer tenants) and Teams Store / org-catalog publishing beyond a documented manual upload.
- **Sovereign clouds** (GCC, GCC High, DoD) and Teams in China: the host allow-list is public cloud only in v1.
- **Microsoft Graph**: email-to-user lookup for people outside installed teams (decision 10), proactive app installation for approvers, activity-feed notifications, and reading channel lists or team names beyond what installation events carry. A Graph-based resolver is a documented follow-up (Question 5).
- Group chats, meeting chats, targeted messages, message streaming, message extensions, tabs, adaptive-card inputs and refresh, localisation.
- Teams Incoming Webhook / Workflows delivery as an alternative path: Office 365 connectors (including connector-based incoming webhooks) were retired in May 2026, and the Workflows replacement is tied to a workflow owner, is not authenticated by Bot Framework and cannot satisfy ticket AC3 [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook].
- Azure-hosted conveniences (managed identity, Bot Service channels page), the Bot Framework SDK, the Teams SDK runtime, socket mode, the Microsoft 365 Agents Playground.
- Persistent audit history, digests, schedules, per-user opt-out (as in #20).
- The Adobe outside-activity / IP and customer-data-handling policy decisions carried from #1 R1 / #20 R1 (flagged in Build Analysis R1).
- A CI deploy workflow and Cloudflare/Microsoft credentials in GitHub (#2 decision 15).

## Further Notes

- **The Microsoft docs are in flux.** Bots are now "agents", Bot Framework SDK is unsupported, Teams SDK is the successor, threading in channels and 1:1 chats is a preview, socket mode is a preview, and several pages carry 2026-06 to 2026-11 dates [VERIFIED: pages cited]. Everything wire-level here comes from the SDK-less protocol page (updated 2026-11-13) and the Connector REST reference (older, same endpoints). Re-check these pages when the build starts; the Testing Requirements list the contract assertions that would fail first if Microsoft changes behaviour.
- **Parity with Slack (#20) at a glance:**

| Capability | Slack (#20) | Teams (this spec) |
|---|---|---|
| Connect | OAuth v2 consent via worker | Manual: bot registration + app package upload; connection observed from install events |
| Inbound auth | HMAC signature + 5-minute window | Bot Framework JWT (issuer, audience, RS256 key set, 5-minute skew, `serviceUrl` claim, `msteams` endorsement) + tenant check |
| Outbound auth | bot token per install (encrypted in KV) | client-credential token per isolate (never stored) |
| Addressing | `users.lookupByEmail` | override table, cache, member list of installed teams (Entra object id) |
| Message | Block Kit | Adaptive Card 1.5, restricted subset |
| Approve / Reject | link buttons to the inbox | link buttons to the inbox (no colour styling available) |
| Click handling | ack within 3 s | none needed (no `invoke`) |
| Thread | `thread_ts` | `replyChains` (with fallbacks) |
| Outcome | `chat.update` + reply | update activity + reply |
| Escaping | `& < >` entities | Markdown, `{{ }}` functions, `<at>` neutralised |
| Uninstall | `app_uninstalled` | `installationUpdate` action `remove` |

- **Gaps found in the #20 contract (reported, not redesigned).** Each is workable inside the provider, but the core owner should know:
  - **G1** `beginInstall` for a non-OAuth provider returns instructions, not a URL (the contract allows "or manual instructions"; the admin app must render them as text).
  - **G2** #20's admin test AD3 mentions validating a "channel id format". Provider-specific target formats must be declared by the provider in its descriptor (pattern and hint), not coded in the core, or the core would learn the Teams format.
  - **G3** `reply(ctx, receipt, text)` takes plain text. The Teams provider sends replies as a restricted Adaptive Card whose only text is escaped; the core must not assume the text is rendered verbatim.
  - **G4** `disconnect` means "forget" for a provider with nothing to revoke.
  - **G5** The Slack-oriented stored records and error taxonomy fit, but "bot token expiry/rotation" has a Teams analogue (client secret expiry) that surfaces as `install_revoked`.
  - **G6** The wrangler `secrets.required` guard is per worker; a second provider's secrets make it impossible to deploy a Slack-only environment unless environments differ (R16, Question 3).
  - **G7** Template items E1 to E7 are assumed accepted; Teams additionally needs **N5**: the proxy helper must be able to place a worker secret in a **form body** field (Entra's token endpoint takes `client_secret` that way); otherwise the provider reads the secret through the accessor and builds the body itself, which weakens the "route code never holds the raw value" property (still redacted and canary-tested).
- **Local verification is better for Teams than for Slack.** Slack and Adobe cannot call `localhost`, but Teams needs only *outbound* calls for sending. A local worker holding a dev bot's client secret can post to a real channel in a real tenant through the documented global service URL fallback, provided the admin-entered channel link identifies the channel and the app is installed in that team. Inbound install events still need a deployed endpoint (MVT2).
- **Ownership risk:** a Teams-managed registration can be managed only by the Microsoft 365 account that created it [VERIFIED: choose-agent-registration-type]; the README states who owns the bot identity and how to transfer (Question 2).
- **Client secrets expire** (Entra enforces a maximum lifetime configured per app registration) [ASSUMPTION: exact limits are tenant policy, not read]. The descriptor surfaces an expired secret as `needs_reconnect` with a stable code; rotation is `wrangler secret put` with no redeploy (as #20 MV11).
- **Dev tenant:** the Microsoft 365 Developer Program sandbox is free only for eligible members (Visual Studio Professional/Enterprise subscribers, ISV Success / eligible partner tiers, Premier or Unified Support) [VERIFIED: https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program-faq]. The Teams sample-data sandbox enables custom app upload by default; other tenants must allow custom app upload [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/prepare-your-o365-tenant].
- **Free-plan fit** [ASSUMPTION, measured in SMT4]: a typical request costs one token fetch per isolate, one send per target, and 2 to 4 KV writes; the member index is one write per refresh.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)                                   Microsoft Teams (customer tenant)
 ├─ Request Publish plugin (Adobe) ──► Adobe publish-requests-worker (private)
 │                                          │ approver / author email  (SendGrid-style JSON, x-auth-api-key)
 │                                          ▼
 │                       ┌─────────────────────────────────────────────────────────────┐
 │                       │ chat-approvals relay worker (#20; unchanged core)           │
 │                       │  POST /v1/email  → parse → NotificationEvent → fan out      │
 │                       │  providers: slack (#20) | teams (this ticket) | fake (tests)│
 │                       │  ┌───────────────────────── teams provider ───────────────┐ │
 │                       │  │ POST /teams/messages  (bot-framework-jwt authenticator)│◄── Agent Communication Service
 │                       │  │   installationUpdate / conversationUpdate → KV refs    │    (install, membership events)
 │                       │  │ deliver / update / reply / resolveRecipients           │──► {serviceUrl}/v3/... (bot token)
 │                       │  │ token: Entra client-credentials, cached per isolate    │──► login.microsoftonline.com
 │                       │  └────────────────────────────────────────────────────────┘ │
 │                       └──────────────┬──────────────────────────────────────────────┘
 ├─ Chat Approvals admin app (#20, unchanged) ── Bearer IMS ──► /admin/* (descriptor lists Teams)
 └─ Publish Requests Inbox (Adobe) ◄── approver clicks Approve/Reject in Inbox on the card ──► outcome email → /v1/email → update card + reply
```

| Concern | Browser extension (static, public) | Relay worker (private, holds secrets) |
|---|---|---|
| Bot client secret, bot access tokens | never | secret in Cloudflare secret store; tokens only in isolate memory |
| Admin identity and authorization | IMS token from the SDK | validated by the core (#20) |
| Teams inbound authentication | none | provider's `bot-framework-jwt` authenticator |
| Conversation references, roster index | none | provider-namespaced KV |
| Card rendering and escaping | none | provider renderer |
| Manual setup instructions, endpoint URL | renders the descriptor as text | descriptor content |
| Teams app package (manifest, icons) | none | none (built by a repo script; not served) |
| Approving / rejecting | none | none (deep links only) |

## 2. EW integration points

- **Library plugin vs app:** no change. The admin surface remains #20's single fullscreen app, registered once in the `apps` sheet; **no new config-sheet row, no library row, no new SDK action** [reuses #20 section 2 and #1 section 2.5]. The Teams card appears because the worker reports the provider's descriptor.
- **Site config read:** none. As in #20 decision 14, mapping and delivery mode live in the worker; the README states the extension reads no DA site config. The "site config keys" the AC5 README must document are therefore the **worker variables and secrets** (section 5.5) and the mapping fields.
- **`ref=local`:** the page at `http://localhost:3000` calls the local worker at `http://localhost:8787`. Teams cannot reach localhost, so install events and any inbound activity are exercised locally only with test drivers; **outbound posting to a real Teams channel from the local worker works** (secret in `.dev.vars`, service URL fallback), which MVT1 uses.
- **Branch ref:** pages on `*.aem.live` / `*.preview.da.live` call the deployed dev worker, whose public URL is the bot's messaging endpoint, so real install events arrive (MVT2).
- **Requirements on the customer tenant (not owned by this extension):** custom app upload permitted (or an admin uploading to the org catalog), a team and channel for the bot, approvers who are members of that team (or personal-scope installs), and the Request Publish onboarding prerequisites from #20 [VERIFIED upload requirement: https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/quickstart-create-agent-teams-sdk].

## 3. Findings about Microsoft Teams that drive the design (all read 2026-11-16)

| Fact | Source | Consequence |
|---|---|---|
| Inbound activities carry a Connector JWT; checks: issuer `https://api.botframework.com`, audience = app id, expiry (5 min skew), signature from the OpenID key set, `serviceUrl` claim = activity `serviceUrl`, channel endorsement (403 if missing); keys refreshed at least every 24 h | https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0 ; connect-agent-without-sdk | Custom `bot-framework-jwt` authenticator (decision 5); AC3 |
| OpenID metadata static URL, `jwks_uri` `https://login.botframework.com/v1/.well-known/keys`; 232 RS256 keys, 73 with `msteams` endorsement (observed) | `curl` 2026-11-16 | Import only the `kid`-matched key; endorsement check is real, not theoretical |
| Outbound token: client credentials to `login.microsoftonline.com/{tenant or botframework.com}/oauth2/v2.0/token`, scope `https://api.botframework.com/.default`; send/reply/update/delete REST table | connect-agent-without-sdk | Decision 6; protocol, not SDK |
| Bot Framework SDK is no longer supported for new development; Teams SDK is the successor | https://learn.microsoft.com/en-us/microsoftteams/platform/legacy-tools-sdks | REST client in the worker |
| Teams-managed registration needs no Azure subscription, can be managed only by its creating account; Azure-managed needs a subscription; SSO/OAuth require Azure-managed | https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/choose-agent-registration-type | Teams-managed by default; ownership risk R3 |
| Registrations produced by CLI/Developer Portal are typically multi-tenant; tenant validation in code is mandatory | https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/agent-tenancy | Decision 4 |
| Runtime auth is client secret or Azure managed identity; "missing service principal" error AADSTS7000229 | https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/configure-agent-runtime-authentication | Client secret as worker secret; error mapping |
| Proactive messages: needs conversation id; user addressed by Entra object id in personal scope, never by email/UPN; bot must be installed in scope else 403; store `conversationId` and reuse; public global service URL fallback | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages | Recipient resolution is the provider's job (decision 10/11) |
| 403 `MessageWritesBlocked` = user blocked/uninstalled | same | Per-target `permanent` |
| Threads: top-level send returns id = root; `POST .../replyChains/{rootId}`; thread feature is preview; error table (400 BadArgument, 404 ConversationNotFound, 404 ActivityNotFoundInConversation) | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/agent-chat-threads | Decision 16, fallbacks |
| Update activity `PUT /v3/conversations/{id}/activities/{activityId}`; cache the id from the original post | send-proactive-messages; Connector REST reference | Outcome update |
| Rate limits per conversation (7/s, 8/2 s, 60/30 s, 1,800/h), global 50 RPS per app per tenant; retry 429, 412, 502, 504 with exponential backoff and jitter | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/rate-limit | Decisions 17, 18 |
| Members: paged API (page size 50 to 500), non-paged deprecated/throttled | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/get-teams-context | Roster index with paging |
| Adaptive Card ≤ 1.6 on Teams; no positive/destructive action style; Markdown in TextBlock/FactSet; mentions via `<at>` + `msteams.entities`; Entra object id and UPN accepted as mention ids; channel/team mentions unsupported in bot messages; bot message limit 100 KB | cards-reference; cards-format | Decisions 12 to 15 |
| `Action.OpenUrl` needs the target domain in manifest `validDomains`, otherwise "URL may lead to untrusted content" | https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions | Decision 15, check URT3 |
| `{{DATE()}}` and `{{TIME()}}` evaluated in card text | https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/text-features | Escape function breaks `{{` |
| Manifest `bots[]`: `botId`, `scopes` (`team`, `personal`, `groupChat`, `copilot`), `isNotificationOnly`; `validDomains` wildcards allowed, max 100 | https://learn.microsoft.com/en-us/microsoft-365/extensibility/schema/root-bots ; .../schema/root | Manifest template |
| Install/uninstall signalled by `installationUpdate` (`add`/`remove`); `conversationUpdate` with `membersAdded` including `28:<appId>`; for team installs `conversation.id` is the selected channel id | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/subscribe-to-conversation-events | Install-state machine (decisions 9, 19) |
| HTTPS delivery: respond within 25 s; socket mode preview/dev only | connect-agent-without-sdk; configure-delivery-methods-for-agents | HTTPS endpoint; fast ack |
| Office 365 connector webhooks retired May 2026 | https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook | Webhook alternative rejected |
| Graph `GET /users/{id\|userPrincipalName}` needs `User.Read.All` (application); proactive install needs `TeamsAppInstallation.ReadWriteSelfForUser.All` and an org-catalog app | Graph user-get; graph-proactive-bots-and-messages | Graph deferred |
| Dev sandbox eligibility; custom app upload default-on in sample-data sandbox | Developer Program FAQ; prepare-your-o365-tenant | Tenant prerequisite R2 |

## 4. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Bot Framework OpenID metadata + key set (`login.botframework.com/v1/.well-known/openidconfiguration`, `.../keys`) | verify inbound JWTs | none (public) | authentication doc above |
| Entra token endpoint `https://login.microsoftonline.com/{authority}/oauth2/v2.0/token` | bot token (`client_credentials`, scope `https://api.botframework.com/.default`) | client id + secret | connect-agent-without-sdk |
| Connector REST on the activity's `serviceUrl` (public host `smba.trafficmanager.net`): send, replyChains, update, create conversation, paged members | deliver, reply, update, resolve | `Authorization: Bearer <bot token>` | Connector REST reference; agent-chat-threads; get-teams-context |
| Inbound `POST /teams/messages` from ACS | installs, membership events | Connector JWT | authentication doc; connect-agent-without-sdk |
| DA Admin config (#20) | admin authorization | caller's IMS token | #20 |
| Cloudflare Workers KV, `ctx.waitUntil` | storage, background | bindings | #20 |
| Teams Developer Portal / Teams developer CLI (`teams app create`, `teams login`) | human-only: register bot, manage manifest, secrets | M365 work account | https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/quickstart-create-agent-teams-sdk ; configure-delivery-methods-for-agents |

**Auth flows.**
- *ACS to relay:* Connector JWT in `Authorization`; verified by the provider authenticator; tenant check on the activity; handler sees only verified, tenant-checked activities.
- *Relay to Teams:* token from Entra (cached), sent only to the allow-listed Connector host.
- *Admin app to relay:* unchanged (#20).
- *Manual connection:* admin registers the bot, sets worker variables/secret, uploads the package, adds the app to a team; ACS calls the messaging endpoint; references are recorded; status becomes `connected`.

## 5. Data contracts

All contracts are behaviour contracts, not code.

### 5.1 Inbound activity contract (ACS to `POST /teams/messages`)

Header `Authorization: Bearer <Connector JWT>`; JSON activity body. Responses: `200` (accepted and handled or ignored; empty body), `401` invalid/missing token, `403` missing endorsement or tenant not allowed, `413` over cap, `503` key set unavailable. No response detail beyond the template error JSON. Route has no CORS and refuses a request carrying `Origin` (#20 E5/SC3).

### 5.2 Provider contract mapping (against #20 section 5.3)

| `ChatProvider` member | Teams behaviour |
|---|---|
| `id`, `displayName` | `teams`, Microsoft Teams |
| `descriptor(siteCtx)` | status (`not_connected`, `connected`, `needs_reconnect`, `error`); tenant label (allowed tenant id); connect kind `manual`; settings hints: mapping target (channel link or id) and override value (Entra object id), each with a validation pattern; installed scopes count; last error code only |
| `routes()` | `POST /teams/messages` with authenticator `bot-framework-jwt`; no others |
| `authenticators()` | `bot-framework-jwt` |
| `beginInstall(ctx)` | manual instructions: messaging endpoint, worker variables/secret names, package steps, team/channel steps, channel-link hint |
| `resolveRecipients(ctx, emails)` | override, cache, roster index; `{ resolved: [{ email, ref: { aadObjectId, upn, displayName } }], unresolved }` |
| `deliver(ctx, event, plan)` | channel target: top-level card with mentions; dm targets: card per resolved approver (create-conversation once); receipts `{ target, messageRef }` |
| `update(ctx, receipt, event, status)` | PUT card without actions + status line (+ live link on `approved`); falls back to reply-only |
| `reply(ctx, receipt, text)` | thread reply (replyChains, then messageid form, then top-level in conversation) as a restricted card with escaped text |
| `disconnect(ctx)` | delete provider records; no revoke |
| Error taxonomy | decision 17 |

### 5.3 Card contract (what a reviewer can assert)

| Aspect | Contract |
|---|---|
| Version and elements | Adaptive Card 1.5; `TextBlock`, `FactSet`, `Container`, actions of type `Action.OpenUrl` only; no `Action.Submit`, no `Action.Execute`, no inputs, no `style` on actions, no images (v1) |
| Requested card | header (event title and org/site), facts: page path, requested by, note (truncated, escaped), approvers (mentions for resolved, escaped text for unresolved), cc (text); actions in order: Preview, Diff, Approve in Inbox, Reject in Inbox (each only if its link passed the core allow-list) |
| Mentions | one `mention` entity per resolved approver, id = Entra object id, name = escaped display name; none for unresolved; never a channel/team mention |
| Outcome (update) | same facts; actions removed; status line: approved (with live link as `Action.OpenUrl` if present) / rejected (reason, escaped) / closed |
| Reply card | single `TextBlock` with escaped text |
| Notification text | plain `summary` (no Markdown, no mention markup) |
| Limits | note truncated to the core's `NOTE_MAX_CHARS`; at most as many mentions as the DM cap; payload far below 100 KB |

### 5.4 Stored records (KV; all provider records under the `teams:` namespace)

| Record | Key (conceptual) | Content | Lifetime |
|---|---|---|---|
| Installation reference | `teams:scope:{tenantId}:{scopeKey}` | kind (`team`/`personal`), service URL, conversation id, team id and name if provided, aad object id for personal, installed-at | until `remove`/uninstall/disconnect |
| Personal chat | `teams:dm:{tenantId}:{aadObjectId}` | service URL, conversation id | until blocked/removed/disconnect |
| Roster index | `teams:roster:{tenantId}:{teamId}` | array of { sha256(lowercased email), aadObjectId, upn, displayName }, fetched-at | 24 h, refresh on miss max once per 10 min |
| Resolution cache | `teams:user:{tenantId}:{email-hash}` | object id or not-found marker | 24 h |
| Status | `teams:status` | last error code per kind, last success time | until changed |

No record contains the client secret, any token, an activity body, a note, or a raw email. The core's thread record carries the opaque `messageRef` (see 5.2).

### 5.5 Worker configuration (additions to #20 section 5.6)

| Name | Kind | Meaning |
|---|---|---|
| `TEAMS_BOT_APP_ID` | var | the bot's Microsoft app id (audience of inbound tokens, `client_id` for the token request); its absence disables the provider |
| `TEAMS_TOKEN_AUTHORITY` | var | app registration tenant id, or `botframework.com` for a multi-tenant registration |
| `TEAMS_ALLOWED_TENANT_ID` | var | the one customer tenant whose activities are accepted |
| `TEAMS_BOT_APP_PASSWORD` | secret | the app registration's client secret |
| `TEAMS_KEYS_ORIGIN` | var | `https://login.botframework.com` in production; local/test override only; never in prod config (check URT4) |
| `TEAMS_SERVICE_HOST_OVERRIDE`, `TEAMS_TOKEN_ORIGIN` | vars | local/test overrides to point at fakes; never in prod config |
| `TEAMS_MAX_ROSTER_PAGES`, `TEAMS_ROSTER_MIN_REFRESH_SECONDS` | vars | member-list caps (defaults 3 and 600) |

Existing #20 variables (`MAX_DM_RECIPIENTS`, `NOTE_MAX_CHARS`, `INBOX_APP_URL`, `LINK_HOST_ALLOWLIST_EXTRA`, `CHAT_KV`) are reused. The client secret name must satisfy the #2 `secrets.required`/`.dev.vars.example` consistency rule (check URT5; see R16 for the deployment coupling).

### 5.6 Teams app package (human-built, not served)

A zip of `manifest.json` and two PNG icons (a colour and an outline icon, required by Teams [VERIFIED: https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/apps-package]). The manifest template declares one bot with the bot app id placeholder, scopes `team` and `personal`, `isNotificationOnly: true`, and `validDomains` (decision 15). The manifest schema version is pinned at build time to the version the Developer Portal accepts [OPEN, low stakes; the current published schema moniker list reaches 1.30 per https://learn.microsoft.com/en-us/microsoft-365/extensibility/schema/root-bots]. Icons need real artwork [OPEN] Question 13.

## 6. Folder layout (fits #1, #2 and #20 section 6)

```
apps/chat-approvals/
├─ (shell, core worker, Slack: unchanged by this ticket)
├─ worker/                  one registration line for the Teams provider; wrangler vars + secret declaration; .dev.vars.example entry
└─ providers/teams/
   ├─ SPEC.md                    this file
   ├─ README.md                  Teams setup: registration, worker vars/secret, package build and upload, team/channel, channel-link mapping, privacy note
   ├─ teams-app-manifest/        manifest template + icons + package build script (script placement per #1 conventions, [OPEN])
   └─ worker/                    authenticator, key-set cache, token client, Connector client, url/id validation, error mapper, renderer + escape, recipients + roster index, activity handler, descriptor/status, test/
```

`providers/teams/` is not an extension for the #1 convention check (it already treats `providers/<vendor>/` as sub-structure).

## 7. Dependencies on #2 / #20 and proposed resolutions

Reuses E1 to E7 from #20 section 7 (assumed accepted: named authenticators, raw body, KV binding on context, HTML responses, per-route no-CORS, dynamic outbound credential, `waitUntil` budget). Teams-specific additions:

| # | Need | Proposed resolution |
|---|---|---|
| N5 | Entra token request needs the client secret in a form body field | Proxy option `auth` gains "in form body, field name" (or the provider uses the secret accessor; weaker, still redacted/canary-tested) |
| N6 | Per-route authenticator that needs **async key-set fetch** and sees the parsed activity (to compare the `serviceUrl` claim) | Authenticator receives the buffered body (E2 already) and may return a verified claims object; the handler receives both |
| N7 | Provider-declared validation for mapping targets and override values | Descriptor field contract carries a pattern and a hint (G2); core applies it generically |
| N8 | Provider inert when unconfigured without failing the deploy | Per-environment `secrets.required` or optional-secret semantics (R16) |

If #20's core ships without N7, the Teams provider can still function (the core accepts any string target; Teams validates at delivery and at test-message) but the admin would get late errors instead of early validation.

## 8. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Customer data and policy** (carries #1 R1, #20 R1): the relay now also handles Microsoft tenant identifiers, approver names and Teams message content; hosted on a personal Cloudflare account; bot registered by an individual account | High, blocks real onboarding | [OPEN] Question 1; synthetic payloads first; no non-synthetic traffic before sign-off |
| R2 | **Test tenant and accounts:** a Teams tenant with custom app upload, users, ability to register an Entra app/bot. Dev Program sandbox is conditional on eligibility | High (schedule) | [OPEN] Question 2; hermetic tiers need none; MVT blocked without one |
| R3 | **Registration ownership:** a Teams-managed bot is managed only by its creating account; a departed owner strands the bot | Medium | README ownership note; consider Azure-managed registration (needs subscription); Question 2 |
| R4 | **Client secret expiry** silently stops delivery | Medium | `needs_reconnect` with stable code; rotation doc; monitoring of last-error in descriptor |
| R5 | **Multi-tenant bot, single customer:** any tenant can install the app and Teams will call our endpoint | High if tenant check is wrong | Decision 4; tests BF9, IA4, SCT; no data stored for other tenants |
| R6 | **DM requires personal-scope install** and an Entra object id; emails not usable | Medium | Channel is the default; DM failures reported per target; Graph deferred (Question 5) |
| R7 | **Roster field names and email vs UPN mismatch** unverified (`email` may be empty for guests; UPN may differ from the Request Publish approver email) | Medium | Override table; unresolved shown as text; MVT3 captures real shape |
| R8 | **Markdown / `{{ }}` / `<at>` injection** through author text | High if unmitigated | Escape function, tests CD*, MVT12 in a real tenant |
| R9 | **"Untrusted content" warning** on buttons if `validDomains` drift | Low-Med | Check URT3; MVT13 |
| R10 | **Reply/update route variants** (`replyChains` preview; update on channel messages needing a particular conversation id form) | Medium | Fallback chain (decision 16); tests DL5 to DL8; MVT14 decides the primary |
| R11 | **Rate limits** | Low-Med | Pacing, `Retry-After`; per-conversation limits far above usage |
| R12 | **JWT details drift** (issuer for new ACS token types, `serviceUrl` claim presence, endorsement semantics) since Microsoft's own docs describe two token paths | Medium | Implement exactly the documented list; log rejection reason code (not token) in a counter; capture real tokens' claim names in MVT3 (claims only, never the token) |
| R13 | **SDK status:** Bot Framework SDK unsupported; Teams SDK is Node-oriented; protocol page is new | Medium | Protocol implementation kept thin and covered by contract fakes; re-read docs at build time |
| R14 | **Free-plan CPU/subrequests:** RS256 verify with a 232-key set; roster paging; KV ops may count as subrequests [ASSUMPTION] | Low-Med | Single key import; caps; SMT4 measures; paid plan owner decision |
| R15 | **Notification-only bot and install events:** whether `installationUpdate` is still delivered per scope | Medium | MVT2; fallback: drop `isNotificationOnly` (then handle `message` safely: acknowledge and ignore) |
| R16 | **`secrets.required` coupling** (G6): listing the Teams secret breaks Slack-only deploys; not listing it hides it from `.dev.vars` locally (#2 R8) | Medium | Per-environment declaration; provider inert when `TEAMS_BOT_APP_ID` absent; Question 3 |
| R17 | **Template item N5** (secret in form body) not accepted | Low-Med | Fallback described in section 7 |
| R18 | **Service URL / SSRF / path injection** through inbound or stored references | High if unmitigated | Decision 7; tests TK4 to TK7, SCT |
| R19 | **Documentation churn** (agent/bot renaming, preview threading, retiring features) | Low-Med | Source URLs recorded; re-check at build start |
| R20 | **Button styling parity** impossible (no positive/destructive) | Low | Accepted difference (Question 8) |
| R21 | **PII at rest in KV** (hashed emails, display names, tenant/team ids, conversation ids) | Low-Med | TTLs, hashing, README privacy note, disconnect deletes (Question 12) |
| R22 | **Sovereign clouds / non-public hosts** excluded | Low | Out of scope; allow-list is one constant to extend |
| R23 | **Retry deviation:** not retrying POST on 502/504/412 may drop a card (email still arrives) | Low | Question 10 |

## 9. Ordered build plan (sized to #21's acceptance criteria)

0. **Owner prerequisites:** #1, #2 and #20 implemented and merged (including #20's `ChatProvider` registry, conformance suite entry point, fake provider, `makeEnv`, in-memory KV, and the template extensions E1 to E7); Questions 1 to 4 decided; a Teams-capable tenant and an account that can register a bot (for steps 12 and later; steps 1 to 11 need none).
1. **Test-kit additions** (no product code): `fakeBotFramework` (key pair, key-set document with endorsements, `signConnectorToken` with claim overrides), `fakeTeams` (Entra token endpoint and Connector REST with scripted statuses, `Retry-After`, request recording), activity fixtures tagged `doc` (shape from Microsoft docs) versus `assumed` (listed in a manifest so MVT3 knows what to replace). Self-check tests (UKT group).
2. **Authenticator** `bot-framework-jwt`, test-first (BF group). AC3.
3. **Token client, URL/id validation, Connector client, error mapper**, test-first (TK group). AC3, AC7.
4. **Card renderer and escape function**, test-first (CD group). AC1, AC2.
5. **Recipients and roster index**, test-first (RC group). AC1.
6. **deliver / update / reply**, test-first against `fakeTeams` (DL group). AC1, AC2.
7. **Inbound activity handler and state** (IA group); **descriptor, status, `beginInstall`, `disconnect`** (ST group). AC3, AC4.
8. **Registration** (one line, wrangler declarations, `.dev.vars.example`) and **conformance** (PVT group); run #20's PV suite for Teams. AC4.
9. **Manifest template, icons, package script, READMEs; consistency checks** (URT group). AC4, AC5, AC7.
10. **Smoke** (SMT group), **e2e** (ET group), **CI additions**. AC6, AC7, AC8.
11. **Local posting check** (MVT1) against a real dev tenant from the local worker; fix surprises (reply route, summary vs text, escape strategy) and update fixtures.
12. **Deploy the dev worker, register the bot, upload the app, capture real activities (MVT2, MVT3), run the MVT matrix** with a real Teams client and (when Adobe onboarding exists) real Request Publish traffic. AC1, AC2, AC3, AC6.
13. **Hand-off:** README section complete; gaps G1 to G7 and N5 to N8 filed against #20/#2 as tickets or PR notes; update #20's README "providers" table.

---

# Testing Requirements

## 1. Worker unit tests (seam W1; Node built-in runner; kit from #2/#20 plus additions)

Fixtures/mocks: `makeEnv` (production-like: `ALLOW_LOCALHOST` false, Teams override variables unset) with canaries for `TEAMS_BOT_APP_PASSWORD` and a canary bot access token (the fake Entra endpoint issues a token containing a canary string), plus the existing #20 canaries; `fakeBotFramework`; `fakeTeams`; `fakeIms`, `fakeDaAdmin`, `fakeUpstream`, in-memory KV with TTL; injected `sleep`, `random`, `now`. Activity fixtures under `test/fixtures/teams/`, each tagged `doc` or `assumed`.

### 1.1 Inbound Bot Framework authentication (AC3)

| ID | Behaviour asserted |
|---|---|
| BF1 | A correctly signed Connector token (issuer, audience = app id, in-window, `serviceUrl` claim equal to the activity's, key with `msteams` endorsement) with a valid activity from the allowed tenant: `200`; handler reached once |
| BF2 | No `Authorization`, wrong scheme, empty bearer, two headers, non-JWT garbage: `401`; no KV access, no outbound call, no handler |
| BF3 | Wrong issuer (including `https://sts.windows.net/...` and a look-alike of `api.botframework.com`): `401` |
| BF4 | Wrong audience (another app id, empty, array without ours): `401` |
| BF5 | Signed by a key not in the key set; `alg: none`; HS256 using the public key as secret; RS384; unknown `kid`: `401` (no crash, no `500`) |
| BF6 | Expired token (outside the 5-minute skew) and not-yet-valid token (`nbf` in the future beyond skew): `401`; just inside the skew: accepted (injected `now`) |
| BF7 | `serviceUrl` claim missing, or different from the activity `serviceUrl` by scheme, host, path or trailing slash semantics the spec treats as different: `401` |
| BF8 | Signing key lacks the `msteams` endorsement while the activity `channelId` is `msteams`: `403`; key with the endorsement: accepted |
| BF9 | Valid token but activity tenant (`channelData.tenant.id` / `conversation.tenantId`) is not the configured tenant, or absent: `403`; zero KV writes, zero outbound calls |
| BF10 | Key-set cache: two valid requests produce one key-set fetch; unknown `kid` triggers a refetch after the cooldown and then succeeds; within the cooldown it does not re-fetch repeatedly; a key set older than 24 h is refreshed |
| BF11 | Key-set fetch failure/garbage/5xx with nothing cached: `503`, handler not called (fail closed), distinct from `401`; with a still-valid cached key set a transient fetch failure does not reject valid traffic |
| BF12 | No configuration switch, variable or header disables validation (the production-like env with every Teams variable set to odd values still rejects an unsigned request) |
| BF13 | A request carrying an `Origin` header is refused with no CORS headers (browser must not drive the route), even with a valid token; bare `OPTIONS` is not answered |
| BF14 | Token string and key material never appear in any response or log line across BF1 to BF13 |

### 1.2 Outbound token and Connector client (AC3, AC7)

| ID | Behaviour asserted |
|---|---|
| TK1 | First send triggers one token request to `login.microsoftonline.com/{authority}/oauth2/v2.0/token` with `client_credentials`, scope `https://api.botframework.com/.default`, the app id and the secret in the form body (not URL); a second send reuses the cached token; a send after expiry minus margin fetches a new one; concurrent sends make one token request (single flight) |
| TK2 | Authority `botframework.com` versus a tenant id is honoured from configuration; nothing else about the request changes |
| TK3 | Entra `invalid_client` / `unauthorized_client` (including the "missing service principal" AADSTS7000229 shape) maps to `install_revoked` and status `needs_reconnect`; Entra `5xx`/network maps to `retryable`; no further Teams call is attempted on a failed token |
| TK4 | Service URL policy: `https` required; hosts outside the allow-list (look-alikes, other hosts, IP literals, `localhost` in a production-like env), userinfo, explicit ports, schemes other than https: zero outbound calls (including no token send), outcome `permanent` with reason `untrusted_service_url` |
| TK5 | A conversation reference loaded from KV with a tampered service URL is never used; the bot token never leaves toward a non-allow-listed host |
| TK6 | Id validation: conversation, activity and tenant ids containing `/`, `?`, `#`, `..`, whitespace or control characters are rejected before any call; valid ids (`19:...@thread.tacv2`, `a:1...`, `;messageid=` forms) are percent-encoded exactly once in the path |
| TK7 | The Authorization header with the bot token appears only on Connector calls; Entra requests carry no bearer; inbound `Authorization`, `Cookie`, `Host` never reach Teams |
| TK8 | Error mapping table (decision 17): `429`+`Retry-After`, `412`, `502`, `504` = `retryable`; `400`, `404`, `403 ForbiddenOperationException`, `403 MessageWritesBlocked` = `permanent`; Connector `401` after a fresh token = `install_revoked`; `200` with garbage body = `retryable` once then `permanent` |
| TK9 | Send (POST) retried on `429` only, honouring `Retry-After` (injected `sleep`); `502`/`504`/`412` on POST are not retried; update (PUT) and members (GET) are retried on `429`, `412`, `5xx`; bounded by the template's attempt and deadline caps |
| TK10 | Successive sends to one conversation are spaced (injected `sleep`) and never exceed the documented 7 per second; the token is never placed in KV (SCT4 scan) |

### 1.3 Cards (AC1, AC2)

| ID | Behaviour asserted |
|---|---|
| CD1 | `requested` card: Adaptive Card version 1.5; body contains page path, org/site, requester, note, approvers, cc; actions are exactly Preview, Diff, Approve in Inbox, Reject in Inbox, in that order, each present only when its link exists |
| CD2 | **Supported-subset whitelist:** only `TextBlock`, `FactSet`, `Container`; only `Action.OpenUrl`; no `Action.Submit`/`Action.Execute`/inputs; no `style` property on any action; payload under 100 KB with maximum-size inputs |
| CD3 | **Approve and Reject are link buttons**: `Action.OpenUrl` with the inbox review URL for the event key; labels identify the destination; no state-changing data; absent when no valid review link can be formed (same rule as Slack SL3) |
| CD4 | Escaping matrix: note, path, requester, approver names, reason and emails containing `[x](https://evil.example)`, `**bold**`, `_i_`, backticks, `<at>everyone</at>`, `<a href>`, `{{DATE(2020-01-01T00:00:00Z, LONG)}}`, `{{TIME(...)}}`, newlines, bidirectional and zero-width characters: the output contains no unescaped Markdown link sequence, no `<at>` tag outside generated mention markup, no intact `{{` function, no control or bidi characters |
| CD5 | Mentions: one entity per resolved approver, `mentioned.id` equals the object id, text is the matching `<at>name</at>` with an escaped name; unresolved approvers have no entity and no `<at>`; a display name containing `</at>` cannot terminate or forge a mention |
| CD6 | No channel- or team-level mention can be produced for any input (no entity with a non-user id exists) |
| CD7 | Link policy double check: every `url` on every action passes the core allow-list; links failing it are dropped and logged by host only; `javascript:`, `data:`, userinfo and look-alike hosts never appear |
| CD8 | Outcome update: same facts, no actions except an `Action.OpenUrl` live link on `approved` when `links.live` exists; status text for approved/rejected/closed; rejection reason is inert text |
| CD9 | Reply card: single `TextBlock`, text escaped by the same function; the `summary` is plain text without Markdown or mention markup |
| CD10 | Truncation: over-long note, path and reason are cut at the configured caps with an ellipsis marker; truncation never cuts inside an escape sequence |

### 1.4 Recipients (AC1)

| ID | Behaviour asserted |
|---|---|
| RC1 | Override beats cache and roster; the override value must be an object id (invalid values rejected at the descriptor pattern and ignored at runtime) |
| RC2 | Roster hit: email (case-insensitive, trimmed) matches `email` or `userPrincipalName` of a member of an installed team; result carries object id, UPN and display name |
| RC3 | Roster paging: members across pages within the page-size bounds are all considered; at most `TEAMS_MAX_ROSTER_PAGES` pages per refresh; refresh on a miss no more than once per minimum interval (injected `now`) |
| RC4 | Resolution cache: a second resolution of the same email makes no members call; not-found markers expire after the TTL |
| RC5 | The stored roster index and cache keys contain only SHA-256 hashes of emails, never raw emails (SCT4 style KV scan) |
| RC6 | No approver resolved: `unresolved` lists them; the card shows them as plain text without mentions; delivery to the channel still happens |
| RC7 | Members `429` is honoured; a members `403`/`404` for one team does not stop resolution through other teams |
| RC8 | The core receives opaque `ref` values and passes them back untouched (shape owned by the provider; PV5 analogue) |
| RC9 | An approver found in the roster of team A only is resolved; resolution never queries a team from another tenant |

### 1.5 Deliver, update, reply (AC1, AC2)

| ID | Behaviour asserted |
|---|---|
| DL1 | `channel` plan: one send to `{serviceUrl}/v3/conversations/{channelId}/activities` with the card attachment and `summary`; receipt carries the returned activity id as thread root; the channel link or raw id in the mapping is normalised to the channel id |
| DL2 | Channel target without a stored service URL uses the documented global public host; with one, uses it; neither is accepted if not allow-listed (TK4) |
| DL3 | `dm` plan: conversation created once (object id and tenant id), conversation id stored and reused on the next event (no second create call); send to that conversation; `both` posts to the channel and each DM |
| DL4 | Per-target isolation: a `403 MessageWritesBlocked` or `ForbiddenOperationException` for one approver is `permanent` for that target only; others delivered; the blocked user's stored conversation is dropped; the failure is recorded by code in status |
| DL5 | `reply` uses `replyChains/{rootId}` for the stored conversation; on `400`/`404` it retries once with the `;messageid=` conversation id form; on a further failure it posts a top-level message in the same conversation; each degradation is logged by code |
| DL6 | `update` issues a PUT to `.../activities/{activityId}` with the outcome card; `404 ActivityNotFoundInConversation` degrades to reply-only |
| DL7 | Reminder (resend) event: reply in the existing thread, never a new top-level message (RL5 analogue via the core with the Teams provider) |
| DL8 | `approved` consolidated across several pages: each referenced thread updated/replied exactly once (RL6 analogue) |
| DL9 | `rejected`: reply contains the reason as inert text; card updated; no thread record means no outbound call |
| DL10 | A send that returns `5xx` is not retried (no duplicate card); `429` is retried after `Retry-After` and results in one card |
| DL11 | Failure of the Teams provider (any kind) never changes the email response status and never stops the Slack/fake providers (PV4 analogue) |
| DL12 | Background budget: delivery completes within the `waitUntil` budget with scripted `429`; work beyond the budget is dropped and logged, not half-applied |

### 1.6 Inbound activities and state (AC3, AC4)

| ID | Behaviour asserted |
|---|---|
| IA1 | `installationUpdate` action `add` in a team: a team reference is stored with the selected channel id as conversation id, service URL, tenant id; descriptor shows `connected` (credentials present); response `200` |
| IA2 | `installationUpdate` add in personal scope: a personal-chat reference keyed by the user's object id is stored for DM reuse |
| IA3 | `installationUpdate` action `remove`: the matching references are deleted; if none remain the status becomes `needs_reconnect`; subsequent deliveries to that scope are not attempted |
| IA4 | `conversationUpdate` with the bot (`28:<appId>`) in `membersAdded` records; in `membersRemoved` deletes; team deleted or channel deleted removes matching references; other members added/removed make no change |
| IA5 | `message`, `invoke`, `typing`, `messageReaction`, unknown types and unknown event names: `200`, no outbound call, no KV write |
| IA6 | The service URL on an activity is validated (TK4) before being stored; an activity with a non-allow-listed service URL is acknowledged with `200` but nothing is stored (it already passed JWT checks, so this guards a malformed but authentic activity) |
| IA7 | Duplicate delivery of the same installation activity is idempotent |
| IA8 | Activity bodies, display names and ids never appear in logs (one structured line: route pattern, activity type, outcome code, duration, request id) |
| IA9 | Oversized body: `413`; malformed JSON after a valid token: `400`; neither writes state |
| IA10 | Response time of `/teams/messages` is independent of Teams latency (scripted slow Connector): nothing is sent to Teams from this route |

### 1.7 Descriptor, install, disconnect (AC4, AC5)

| ID | Behaviour asserted |
|---|---|
| ST1 | Descriptor with no `TEAMS_BOT_APP_ID`: `not_connected` with stable reason `unconfigured`; no outbound call, no secret read; routes answer `401` for any request; the rest of the worker is unaffected |
| ST2 | Descriptor with configuration but no installation: `not_connected` with reason `no_installation`; with an installation and valid credentials: `connected`; with a recorded `install_revoked` outcome: `needs_reconnect`; contains tenant label, installed-scope count and last error **code only**; never a secret, token, id of another tenant or message body |
| ST3 | `beginInstall` returns manual instructions containing the messaging endpoint URL for the worker's own origin and the names (not values) of the variables and secret to set; no URL to open; no secret asked for |
| ST4 | Descriptor field hints: mapping target pattern accepts a Teams channel link and a raw channel id and rejects other strings; override pattern accepts a GUID only |
| ST5 | `disconnect` deletes every `teams:` record for the deployment and nothing outside the namespace; idempotent; descriptor afterwards `not_connected` |
| ST6 | Descriptor evaluation makes no outbound call (status computed from KV and last-error record) |
| ST7 | Test message (core route AD5) posts a real-shaped card to the mapped channel through the Teams provider; errors surface as actionable codes (`not_installed_in_team`, `needs_reconnect`, `untrusted_service_url`, `tenant_not_allowed`) |
| ST8 | Tenant label shows the configured tenant id only; no other tenant's data is retrievable |

### 1.8 Provider contract and Teams-readiness proof (AC4)

| ID | Behaviour asserted |
|---|---|
| PVT1 | The #20 conformance suite (recipients, deliver receipts, update, reply, error taxonomy, descriptor shape, disconnect) passes for the Teams provider backed by `fakeTeams`, unchanged, alongside Slack and the fake provider |
| PVT2 | Registering Teams requires no change to core code: the core source tree is byte-identical between a build without and a build with the registration line (checked by the S3 provider-name rule and by a build that deletes the Teams registration and still passes the Slack/fake suites) |
| PVT3 | Per-provider namespace: Teams cannot read Slack or fake-provider records and vice versa (PV3 analogue); a Teams record key can never collide with another provider's |
| PVT4 | An email event reaches Slack, fake and Teams; a Teams timeout or throw does not stop the others and does not change the email response (PV4 analogue) |
| PVT5 | Teams routes use their own authenticator; with no credential they are `401`; `/v1/email` and `/slack/*` are unaffected by Teams configuration |

### 1.9 Secret hygiene and unauthenticated matrix (AC3, AC7)

| ID | Behaviour asserted |
|---|---|
| SCT1 | Canary matrix over success and every error path of the Teams provider and `/teams/messages`: no client-secret canary, no bot-token canary, no IMS token appears in any response body, header or log line |
| SCT2 | For every registered route including `/teams/messages` and unknown paths: no credential and wrong credential yield `401`/`403`; zero KV reads or writes, zero outbound calls (extends #20 SC2) |
| SCT3 | `/teams/messages` has no CORS headers and refuses a request carrying `Origin` (extends #20 SC3) |
| SCT4 | KV scan over a full scenario (install events, roster refresh, delivery, outcome, disconnect): no client secret, no bot token, no raw email, no activity body, no note text in any stored value |
| SCT5 | Outbound hygiene: the bot token appears only in `Authorization` of calls to the allow-listed Connector host; the client secret appears only in the Entra token request body; neither appears in any other outbound request |

### 1.10 Test-kit self-check

UKT1: `signConnectorToken` output verifies with an independent `jose` verification against the fake key set, header has `kid` and `alg RS256`, claims have issuer, audience, `serviceUrl`, `nbf`, `exp`. UKT2: `fakeTeams` replays scripts in order, records requests (method, path, headers, body) and returns activity ids. UKT3: fixtures tagged `assumed` are listed in a manifest so MVT3 knows what to replace with captured ones. UKT4: the fake key-set document carries endorsements in the same shape as the live document observed 2026-11-16 (`endorsements` array on each key).

## 2. Admin page tests (seam S2, WTR)

No new page code. Two cases are added to #20's WB group only if a gap appears:

| ID | Behaviour asserted |
|---|---|
| WBT1 | A Teams-shaped descriptor (manual connect kind, instruction text with `<`/`{{` characters, a validation pattern hint) renders as text with no HTML injection and a working connect panel (WB7 with the real Teams descriptor as fixture) |
| WBT2 | The page shows the messaging endpoint from the descriptor and never asks for, shows or sends the client secret |

## 3. Browser to real worker (seam S1 extended, Playwright, Chromium, hermetic)

As #20 section 3, with the worker started in the local environment and fake servers for IMS, DA admin, Slack, and **Teams (key set, Entra, Connector)** started in global setup. A test driver plays Adobe's worker (fixture emails with the relay key) and Azure/ACS (signed install activities).

| ID | Behaviour asserted |
|---|---|
| ET1 | Driver posts a signed `installationUpdate` add; the page's provider card shows Teams `connected` with the manual-connect panel and the endpoint; real cross-origin admin calls with preflight succeeded |
| ET2 | Driver posts a `requested` email: fake Connector received one card POST with the expected elements and link buttons; mapping set through the page earlier determined the channel |
| ET3 | Driver posts an `approved` email: fake Connector received a thread reply and an update PUT removing the actions |
| ET4 | Forged activity (self-signed token) and key-less email: `401`; fake Connector saw nothing |
| ET5 | Page HTML, DOM, console and all network responses contain neither the IMS token, the client secret canary nor the bot token canary; only expected hosts contacted |

## 4. Runtime smoke tier (seam W2; Node test driving `wrangler dev` locally, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SMT1 | Worker bundles with the Teams provider (shared core + provider + `jose`) and starts; bare request to `/teams/messages` returns `401` |
| SMT2 | RS256 verification of a driver-signed Connector token in workerd accepts the valid token and rejects tampered ones; the endorsement and `serviceUrl` checks behave as in BF7/BF8 over real HTTP |
| SMT3 | Full flow over real HTTP with local KV: install activity, email event, card POST, outcome update; token acquisition against a local fake Entra endpoint |
| SMT4 | Records CPU/wall time, KV operation count and subrequest count for one request with 5 approvers and a roster refresh (informational against R14; no hard threshold until a baseline exists) |
| SMT5 | Canary secrets absent from all responses (SCT1 over real HTTP) |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| URT1 | The #1/#20 convention check passes for `providers/teams/`: README, worker folder with tests; the folder is treated as a provider, not an extension |
| URT2 | The provider name literal `teams` appears only under `providers/teams/` and the single registration site (extends #20 UR3: core and admin page have none) |
| URT3 | Every host pattern in the core link allow-list appears in the manifest template's `validDomains` and the other way round (modulo documented exceptions); `validDomains` has at most 100 entries |
| URT4 | The production wrangler config sets none of `TEAMS_KEYS_ORIGIN`, `TEAMS_TOKEN_ORIGIN`, `TEAMS_SERVICE_HOST_OVERRIDE`, `ALLOW_LOCALHOST` (extends #20 UR5) |
| URT5 | Every Teams variable and secret named in the wrangler config appears in `.dev.vars.example` and in the provider README's variable table, and vice versa; no secret-like name is in `vars` (extends #2 UR3/UR5) |
| URT6 | The manifest template parses as JSON, has exactly one bot, scopes limited to `team` and `personal`, `isNotificationOnly` true, a placeholder (not a real id) for the bot id, and icon file names that exist; no file outside `worker/` and `providers/*/worker/` contains a secret-shaped string |
| URT7 | The browser-served files import nothing from `worker/` (extends #20 UR6) and the admin page contains no Teams-specific literal |

## 6. End-to-end checks inside real Experience Workspace and a real Teams tenant (manual)

Needs an interactive Adobe login, a Teams tenant, a Cloudflare account and (for the full chain) Request Publish onboarding by the AEM Engineering contact. Never paste real IMS tokens, client secrets or bot tokens into chat, issues or logs; use a dev bot with a throwaway secret.

- **MVT0 (prereq):** #1 Code Sync done; #20 dev worker deployed (relay key, Slack optional); dev bot registered (Developer Portal or `teams app create`) with the messaging endpoint `https://<dev-worker>/teams/messages`; worker variables and the client secret set; app package built from the manifest template with the bot id; uploaded to the tenant (custom app upload enabled); added to a team and channel; test users: author A, approver B (member of that team, personal-scope install), approver C (member of the team, no personal install), outsider D (not in the team). Proves the environment.
- **MVT1 (`ref=local`, real outbound):** `npm start` and the local worker (client secret in `.dev.vars`, `TEAMS_*` variables set, KV local); open `https://da.live/app/jazhou-adobe/ew-extensions/apps/chat-approvals/chat-approvals?ref=local`; accept the trust prompt; the Teams card shows `not_connected`/`no_installation` with manual instructions and the endpoint; paste a channel link into a mapping; **Test message** posts a real card to the channel through the global service URL fallback. DevTools: preflight `204`, `Access-Control-Allow-Origin: http://localhost:3000`; unauthenticated `curl` to the local worker `401`. Proves AC1 (card to a mapped channel), AC6 (local), AC7 (browser sees no credential).
- **MVT2 (branch ref, deployed dev worker, real install events):** push branch `chat-approvals-teams` (simple name); open the same URL with `?ref=chat-approvals-teams`; add the app to the team (and, as B, to personal scope); confirm `installationUpdate` arrives (status turns `connected`, installed-scope count increments); remove the app from the team and see `needs_reconnect`; re-add. Record the real activity shapes (field names only, ids redacted) and whether a notification-only bot still receives installs (R15). Record the real page `Origin`. Proves AC3 (real authenticated inbound), AC6 (branch ref).
- **MVT3 (capture real contracts):** with a temporary dev-only log of **field names and claim names** (never tokens, bodies or ids; never enabled in prod): the real Connector JWT claims (issuer, audience, `serviceUrl` presence, `azp`/`appid` names), the endorsement on the real signing key, `installationUpdate`/`conversationUpdate` shapes, member list entry fields (`email`, `userPrincipalName`, `aadObjectId`), the create-conversation request/response, the `ResourceResponse` id for a channel post, and the update/reply behaviour. Save redacted `captured` fixtures; update `assumed` entries and the authenticator if claims differ. Closes R7, R12.
- **MVT4 (AC1 end to end):** as author A request publish for a page through Request Publish (real onboarding) or replay a synthetic email with `curl` and the relay key; the channel shows the card with path, author, note, approver mentions for B and C (and plain text for D), working Preview, Diff and Inbox links; B also receives a personal-chat card; C (no personal install) is reached through the channel mention only and the status records the per-target code; the normal email also arrives if an upstream is configured.
- **MVT5 (AC2, approve):** as B click **Approve in Inbox**; the Publish Requests Inbox review page opens for that request; Approve & Publish; the card updates (buttons gone, approved status, live link) and the thread receives the approved reply; the page is live. Click the original buttons afterwards: inbox shows "No Pending Request"; no warning dialog appears for the button domains.
- **MVT6 (AC2, reject):** another request; **Reject in Inbox** with a reason; the card updates and the thread shows the reason as plain text.
- **MVT7 (negatives, AC3):** `curl` the deployed `/teams/messages`: no token (`401`), garbage token (`401`), a token self-signed with a fresh RSA key and correct claims (`401`), an expired token (`401`), a correctly signed token from a **different tenant's** activity or modified tenant id (`403`), request with `Origin: https://evil.example` plus a valid token (refused). `curl` `/v1/email` and `/admin/providers` as in #20 MV8. Never use a real production token for these; use the fake-signed tokens produced by the test kit, which the deployed worker must reject.
- **MVT8 (DM path):** B receives DMs; C does not and the failure code is visible in the descriptor; B blocks the bot: the next DM to B yields a recorded `permanent` target error and the channel card still goes out; B unblocks.
- **MVT9 (resend and reminder):** resend a pending request: a reminder appears in the existing thread (channel and B's DM, subject to threading preview behaviour in 1:1 chats, which MVT14 records).
- **MVT10 (secret rotation and expiry):** create a new client secret, `wrangler secret put TEAMS_BOT_APP_PASSWORD`, confirm delivery continues; delete the old secret in Entra, confirm only the old value now fails (`needs_reconnect` after the next delivery); then restore. No code redeploy.
- **MVT11 (privacy check):** search Teams message payloads, Cloudflare logs and KV values for the client secret, a captured bot token and raw approver emails (none).
- **MVT12 (rendering of hostile text, decides the escape strategy):** submit requests whose note, path and approver names contain `[click](https://evil.example)`, `**x**`, backticks, `<at>everyone</at>`, `{{DATE(2020-01-01T00:00:00Z, LONG)}}`, `{{TIME(2020-01-01T00:00:00Z)}}`, a 2,000-character line, bidi controls and emoji; confirm in Teams desktop, web and mobile that everything renders as inert text and no one is mentioned or notified. If backslash escapes are not honoured, switch the escape strategy (decision 14) and rerun.
- **MVT13 (card text versus summary):** confirm the notification preview shows the `summary` and the card body shows no duplicated text; if Teams shows `text` and card both, keep `summary`; if `summary` is ignored, adopt the documented alternative and update CD9.
- **MVT14 (reply and update routes):** record whether `replyChains` works in channels and in 1:1 chats in the sandbox tenant, whether the `;messageid=` fallback is needed, and that the update call replaces a channel card; update the fallback order (Question 9) and DL5/DL6 expectations.
- **MVT15 (uninstall and disconnect):** remove the app from the team: status `needs_reconnect`, later emails still deliver email (and Slack) only, no error returned to Adobe's worker; press **Disconnect** in the admin app and confirm the `teams:` records are gone while Slack is untouched.

## 7. Sandbox accounts and credentials needed

| Need | Why | Notes |
|---|---|---|
| Microsoft 365 tenant with Teams, custom app upload enabled (or an admin who can upload to the org catalog), and 4 to 5 test users (author, approver in team with personal install, approver in team without personal install, outsider) | all MVT | Dev Program sandbox is free only for eligible members (Visual Studio Pro/Enterprise subscribers, ISV Success/partner tiers, Premier or Unified Support) [VERIFIED: FAQ above]; otherwise an Adobe-provided or customer test tenant (Question 2) |
| An account allowed to create the bot registration (Developer Portal or `teams` CLI) and to create/rotate a client secret; for the CLI, Node 24 per the quickstart (dev tool only; Developer Portal UI is the alternative) | MVT0, MVT10 | A Teams-managed registration is manageable only by this account; record the owner |
| Cloudflare account and the dev worker (from #20) | deploy, MVT2 onward | owner decision carried from #20 Question 13 |
| Adobe IMS identities and Request Publish onboarding as in #20 section 7 | MVT1 admin app, MVT4 to MVT9 full chain | without onboarding, MVT4 to MVT9 degrade to synthetic emails replayed with `curl` and the relay key |
| Throwaway relay key and a throwaway bot client secret | secrets | set with `wrangler secret put`; never committed |
| Chrome (plus Teams desktop, web and mobile clients for MVT12) | `ref=local`; rendering | |
| Teams app package icons | MVT0 | [OPEN] Question 13 |

Hermetic automated tiers (sections 1 to 5) need none of these.

## 8. CI additions (no credentials, no Cloudflare login, no Microsoft login)

Extends #1/#2/#20 workflow (same triggers: `push` and `pull_request`, Node 22 with wrangler's floor, `npm ci`):

| Job | Steps |
|---|---|
| `lint` (existing) | ESLint over the provider folder; S3 checks URT1 to URT7 |
| `unit` (existing) | WTR admin page tests incl. WBT1, WBT2 |
| `worker-unit` (from #2/#20) | `npm run test:worker` includes BF, TK, CD, RC, DL, IA, ST, PVT, SCT, UKT |
| `worker-smoke` (from #2/#20) | SMT1 to SMT5 with local fakes; advisory if flaky, per #2 |
| `e2e` (existing) | adds ET1 to ET5 (worker + fake IMS/DA/Slack/Teams servers) |

No Microsoft, Slack or Cloudflare secrets in CI. The manifest package script is exercised in `lint` only as a JSON/structure check (URT6), not by building a signed package.

## 9. Acceptance-criteria traceability (ticket #21)

| # | Acceptance criterion (#21) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Request Publish submissions produce an Adaptive Card to mapped approvers/channel with preview and diff links | CD1, CD2, CD4 to CD7, CD9, CD10 (card contents and safety); RC1 to RC9 (approver resolution); DL1 to DL4, DL10 to DL12 (delivery to channel and DMs, isolation); IN/RL groups from #20 reused through PVT4; ET2; SMT3 | **MVT4** (real submission to a real channel/DM with working links), **MVT1** (real card to a mapped channel from the local worker), MVT3 (real shapes), MVT8, MVT9, MVT12 (rendering) |
| AC2 | Approve / Reject behave exactly as in Slack and update the card | CD3 (link buttons to the inbox, labels, absence rules identical to Slack SL3), CD2 (no `Action.Submit`/`Execute`: no click handling exists, as Slack's link buttons), CD8 (card updated), DL6 to DL9 (update, reply, reminder, consolidated approval, reject reason), PVT1 (same conformance suite as Slack); ET3 | **MVT5** (approve as self through the inbox; card and thread updated; stale button harmless), **MVT6** (reject reason), MVT9. Review: Implementation Decision 12 states the one visual difference (no `positive`/`destructive` styling on Teams) and Question 8 asks the owner to accept it |
| AC3 | Bot Framework auth is validated in the worker | BF1 to BF14 (issuer, audience, signature, `alg`, expiry skew, `serviceUrl` claim, endorsement, tenant, key-set cache and outage, no disable switch, no browser origin); TK1 to TK8 (outbound auth hygiene); IA1 to IA10; SCT1 to SCT5; ET4; SMT1, SMT2 | **MVT7** (forged, expired, wrong-tenant and unsigned requests rejected on the deployed worker), **MVT2** (real authenticated installs accepted), MVT3 (real claim names), MVT10 (credential expiry handling) |
| AC4 | Added inside the existing folder as a new provider; no change to the shell beyond registering | PVT1 to PVT5 (conformance, no core change, namespacing, isolation, own authenticator); URT1, URT2, URT7 (location, no provider names in core/admin, no browser imports); WBT1 (descriptor-driven UI) | Review: `git diff --stat` for the build PR touches only `providers/teams/**`, the one registration line plus wrangler/`.dev.vars.example` declarations in `worker/`, and README rows; no `chat-approvals.*`, `shared/**` or core files; the hand-off note lists gaps G1 to G7 |
| AC5 | Extension README documents this vendor's setup (credentials, site config keys) | URT5 (README variable table equals wrangler config and `.dev.vars.example`), URT6 (manifest template valid), URT1 (README exists) | **README review checklist:** bot registration steps (Teams-managed and Azure-managed), tenant id, app id, client secret (set with `wrangler secret put`, never in git), worker variables, messaging endpoint, package build and upload, adding the app to team and personal scope, copying a channel link, override table, privacy note (decision 20), the statement that **no DA site config is read** (the "config keys" are the worker variables and mapping fields), expiry/rotation, ownership note; reviewer walks it on a clean clone; **MVT0**, **MVT1** |
| AC6 | Works in EW with `ref=local` and with a branch ref | WBT2 and #20 WB6 (origin constants per host; no worker origin from URL); ET1 to ET5 (local loop with real worker and fakes, preflight included); SMT3 | **MVT1** (`ref=local`: admin app plus real outbound card), **MVT2** (branch ref against the deployed dev worker, records the real `Origin`), MVT15 |
| AC7 | Vendor credentials only in the worker (built from the template); the browser never receives them; unauthenticated calls rejected | SCT1 to SCT5 (canaries incl. bot token, unauthenticated matrix, no CORS on the machine route, KV scan, outbound hygiene); BF2, BF13; TK7; ST1 (inert provider is `401`); URT4 to URT7; WBT2; ET4, ET5; SMT1, SMT5 | **MVT7** (unauthenticated calls to the deployed worker), **MVT10** (rotation without redeploy), **MVT11** (no secret in Teams messages, logs or KV), DevTools check in MVT1 and MVT2 |
| AC8 | Core logic covered by unit tests; lint and CI green | Sections 1 to 5 run in the `lint`, `unit`, `worker-unit`, `worker-smoke` and `e2e` jobs on every push and PR | Review: CI green on the build PR; deliberately weaken a rule on a scratch branch (accept an unendorsed key; allow a non-allow-listed service host; drop the tenant check) and confirm BF8, TK4 or BF9 fails |

Every acceptance criterion on #21 maps to at least one automated test and at least one numbered manual or review step above.

## 10. Open questions for the owner

1. **Policy and customer data (R1).** The relay now handles Microsoft tenant ids, approver identities and Teams content. Is a personally hosted Cloudflare account, plus a bot registered under an individual Microsoft 365 account, acceptable under the Adobe outside-activity / data-handling policy? Who signs off before any non-synthetic traffic?
2. **Teams tenant and bot ownership (R2, R3).** Which Microsoft 365 tenant will host the dev bot and test users: a Developer Program sandbox (are you eligible: Visual Studio Pro/Enterprise, partner program, Premier/Unified Support?), an Adobe test tenant, or a customer's? Which account owns the Teams-managed registration, and is a shared/service owner or an Azure-managed registration (needs an Azure subscription) preferable?
3. **Secrets declaration (R16, G6, N8).** Accept per-environment `secrets.required` lists (dev lists Slack and Teams secrets; a Slack-only environment omits Teams) with the Teams provider inert when `TEAMS_BOT_APP_ID` is absent? Or one worker per provider?
4. **Template additions.** Beyond #20's E1 to E7, accept N5 (client secret in a form body field), N6 (async authenticator seeing the parsed activity), N7 (provider-declared target validation in the descriptor) and N8, as part of the same prerequisite template PR?
5. **Approver resolution scope.** Accept roster-only resolution (approvers must be members of a team where the bot is installed, or listed in the override table) for v1, deferring Microsoft Graph lookup (`User.Read.All` admin consent) and proactive install of the bot for approvers (`TeamsAppInstallation.ReadWriteSelfForUser.All`, org-catalog app) to a follow-up?
6. **Single tenant per deployment.** Confirm one customer tenant per worker deployment (tenant validated in code); multi-tenant fan-out is out of scope.
7. **Distribution.** Manual upload of a package to one tenant (sideload or org catalog) is the v1 distribution; Teams Store listing and its validation process are not planned. Agree?
8. **"Exactly as in Slack".** Teams cannot colour-style buttons (no `positive`/`destructive`). Is label-and-order differentiation acceptable as "exactly as in Slack", given identical behaviour (deep links) and outcomes? Or should AC2's wording be interpreted as requiring in-Teams approval (which #20 decision 6 rejected for identity reasons)? Same question as #20 Question 15 (one "Review in Inbox" button instead of two).
9. **Threading fallbacks.** `replyChains` is documented but marked preview; the older `;messageid=` form still works per Microsoft ("existing integrations can continue"). Confirm the fallback order (decision 16) or choose one route after MVT14.
10. **POST retry policy.** Microsoft says 429, 412, 502 and 504 "must be retried". This spec retries message sends only on `429` to avoid duplicate cards (matching #20/#2). A card could be lost on 502/504 (email still arrives). Accept, or add an idempotency approach?
11. **Notification-only bot.** Accept `isNotificationOnly: true` (users cannot message the bot, fewer inbound surfaces) provided MVT2 confirms install events still arrive?
12. **Privacy.** Accept storing hashed approver emails, display names and Entra object ids (24 h index TTL; conversation ids until removal) in KV, and posting author email and truncated, escaped note into Teams by default (same as #20 Question 9)?
13. **App assets.** Who supplies the Teams app icons (colour 192x192 and outline 32x32 are the usual sizes, [ASSUMPTION], not re-read) and the app name/description strings? Placeholder icons are fine for the sandbox but not for sharing.
14. **Sovereign clouds.** Is public cloud only acceptable for v1 (GCC/GCC High/DoD service hosts documented, not enabled)?
15. **Doc terminology.** Microsoft now says "agent"/"Agent Communication Service". Should README text follow Microsoft's new names or the ticket's "bot" wording?
