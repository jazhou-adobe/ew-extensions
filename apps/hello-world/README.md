# Hello world (app)

Fullscreen EW app. Awaits the DA App SDK and renders every key/value of `context` as text, plus a "token present/absent"
indicator (the token itself is never shown). Outside EW it shows "waiting", then "not running inside Experience Workspace".

Files: `hello-world.html` (entry), `hello-world.js` (bootstrap), `hello-world-render.js` (render logic), `hello-world.css`,
`test/unit`, `test/e2e`. Design: [SPEC.md](SPEC.md).

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
