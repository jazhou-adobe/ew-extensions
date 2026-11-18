# Hello plugin (library plugin)

EW editor library plugin. Awaits the DA App SDK, shows a short context summary and two buttons:

- **Insert text**: `actions.sendText(text)`.
- **Insert text and close**: `actions.sendText(text)` then `actions.closeLibrary()`.

Outside EW it shows "waiting", then "not running inside Experience Workspace".

Files: `hello-plugin.html` (entry), `hello-plugin.js` (bootstrap), `hello-plugin-render.js` (render logic),
`hello-plugin.css`, `test/unit`, `test/e2e`.

## Registration

### `library` sheet row

In `https://da.live/config#/jazhou-adobe/ew-extensions/`, `library` tab:

| title | path | format | ref | icon | experience |
| --- | --- | --- | --- | --- | --- |
| Hello plugin | /apps/hello-plugin/hello-plugin.html | | | | inline |

Leave `ref` blank so the plugin shows for `main`, branch refs and `ref=local`. A path starting with `/` resolves to
`http://localhost:3000` when the editor URL has `?ref=local`, else to `https://{branch}--ew-extensions--jazhou-adobe.aem.live`.

## Local dev

`npm start`, open any document in the EW editor with `?ref=local`, open the library, pick **Hello plugin**.
