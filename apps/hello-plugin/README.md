# Hello plugin (library plugin)

EW editor library plugin. Awaits the DA App SDK, shows a short context summary and two buttons:

- **Insert text**: `actions.sendText(text)`.
- **Insert text and close**: `actions.sendText(text)` then `actions.closeLibrary()`.

Outside EW it shows "waiting", then "not running inside Experience Workspace".

Files: `hello-plugin.html` (entry), `hello-plugin.js` (bootstrap), `hello-plugin-render.js` (render logic),
`hello-plugin.css`, `test/unit`, `test/e2e`.

## Registration

### `library` sheet row

In `https://da.live/config#/jazhou-adobe/ew-extensions-demo/` (the DA test site), `library` tab:

| title | path | format | ref | icon | experience |
| --- | --- | --- | --- | --- | --- |
| Hello plugin | https://main--ew-extensions--jazhou-adobe.aem.live/apps/hello-plugin/hello-plugin.html | | | | inline |
| Hello plugin (local) | http://localhost:3000/apps/hello-plugin/hello-plugin.html | | | | inline |

The code lives in this repo, not the demo site's repo, so paths are absolute. Use the `(local)` row with `npm start`;
for a branch, replace `main--` with `{branch}--`.

## Local dev

`npm start`, open any document in the EW editor with `?ref=local`, open the library, pick **Hello plugin**.
