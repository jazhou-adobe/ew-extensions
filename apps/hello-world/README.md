# Hello world (app)

Fullscreen EW app. Awaits the DA App SDK and renders every key/value of `context` as text, plus a "token present/absent"
indicator (the token itself is never shown). Outside EW it shows "waiting", then "not running inside Experience Workspace".

It also proves the shared backend template (ticket #2): a **Call worker** button sends the SDK token to this extension's worker
(`worker/`, an Adobe App Builder web action) and shows the HMAC signature the worker computes with a server-side secret; a
**Call without token (expect 401)** button makes the same call with no `Authorization` header and shows the `401`. Both are
disabled outside EW.

Files: `hello-world.html` (entry), `hello-world.js` (bootstrap), `hello-world-render.js` (render logic),
`hello-world-worker.js` (worker origin + call logic), `hello-world.css`, `worker/` (backend, see its README), `test/unit`,
`test/e2e`. Design: [SPEC.md](SPEC.md).

## Worker

The page picks its worker from a constant keyed by **its own hostname**, never from the URL (the page sends the user's IMS token
there, so a `?worker=` link must not redirect it): `main--ew-extensions--jazhou-adobe.{aem.live,aem.page,preview.da.live}` ->
Production worker; any other ref on those hosts and `localhost` -> Stage worker; any other host (including the demo site's own)
-> no worker, buttons disabled. Worker URLs are in `hello-world-worker.js`; deploy and verification steps are in
[worker/README.md](worker/README.md).

## Registration

### `apps` sheet row

In `https://da.live/config#/jazhou-adobe/ew-extensions-demo/` (the DA test site), `apps` sheet:

| title | description | image | path | ref |
| --- | --- | --- | --- | --- |
| Hello world | Hello app | | https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world | |

(What the `ref` column does for apps is undocumented; leave it blank.)

## Local dev

`npm start`, then open
`https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world?ref=local` (accept the trust prompt once), or use
`?ref=<branch>`. Standalone: `http://localhost:3000/apps/hello-world/hello-world.html`. See the root README.
