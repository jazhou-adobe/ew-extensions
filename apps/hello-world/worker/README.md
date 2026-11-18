# hello-world worker

Backend for the hello-world app: one App Builder raw web action `hello-world/api` built on the
[worker template](../../../shared/worker-template/README.md). It proves the template end to end.

| Route | Result |
|---|---|
| `GET /hello/sign?message=<=256 chars>` | `200 {message, algorithm: "HMAC-SHA-256", signature}`; the signature uses the secret `HELLO_SECRET`, which is never returned. Missing/over-long `message` -> `400 bad_request`. |
| `GET /hello/state` | `200 {ok: true}`: writes, reads back and deletes a short-lived value through the store (State when deployed). Diagnostic; not wired to the UI. |

Every request needs `Authorization: Bearer <Adobe IMS token>` (the token the DA App SDK gives the page) and an allowed `Origin`;
without a token the answer is `401`, from a disallowed origin `403`.

## Files

`app.config.yaml` (app root config, package `hello-world`, action `api`), `package.json`, `actions/api/index.js` (entry),
`routes/hello.js`, `.env.example`, `test/` (route tests with the kit, plus the emulator tier).

## Local checks (no login, no network)

```sh
npm run test:worker      # from the repo root; includes this folder's tests
```

## `.env` keys

| Key | Meaning |
|---|---|
| `HELLO_SECRET` | **secret**: HMAC key for `/hello/sign`. Any random string; rotate by editing it and redeploying the action. Required (the pre-deploy guard fails without it). |
| `ALLOWED_LOCAL_ORIGINS` | exact extra origins allowed to call the worker. Stage: `http://localhost:3000` (the fixed `ref=local` origin). **Production: empty.** |
| `AIO_*` | written by `aio app use` (Runtime/Console credentials). Never commit; `.env` and `.aio` are gitignored. |

`.env.example` lists the first two. Non-secret settings (`ORG`, `SITE`, `IMS_ORIGIN`, `ALLOWED_IMS_CLIENT_IDS`, `STATE_REGION`) are
reviewable literals in `app.config.yaml`.

## Build, deploy, verify (owner steps)

Run from this folder, always with `env -u CI`. `.env`/`.aio` are untracked; check `git status` shows neither.

```sh
env -u CI aio where                       # org adobe-demo-apac-195, project "ew extensions"
env -u CI aio app use                     # pick Stage; writes .env/.aio
# edit .env: set HELLO_SECRET=<random> and ALLOWED_LOCAL_ORIGINS=http://localhost:3000 (keep the AIO_* lines)
env -u CI aio app build --no-web-assets   # local bundle check (no deploy); output in dist/ (gitignored)
env -u CI aio app deploy                  # pre-deploy guard runs first
env -u CI aio app get-url                 # worker URL
curl -i "<worker-url>/hello/sign?message=x"                         # expect 401 (liveness + "no token fails")
curl -i -H "Origin: https://evil.example" "<worker-url>/hello/sign?message=x"   # expect 403, no access-control-allow-origin
```

Then, with a real EW token (never commit or paste it; it is a live credential until expiry):

```sh
export WORKER_BASE_URL=<worker-url> WORKER_ENV=stage IMS_TOKEN=<token from DevTools on da.live>
npm run test:worker:deployed              # LV1-LV6
```

Set `ALLOWED_IMS_CLIENT_IDS` in `app.config.yaml` after inspecting the real token's `client_id` claim (spec step W3), redeploy.
Production: `aio app use` -> Production workspace, `.env` with `ALLOWED_LOCAL_ORIGINS=` empty, `aio app deploy`. The hello page's
worker URLs (`apps/hello-world/hello-world-worker.js`) are derived from the observed namespaces `281295-ewextensions-stage`
and `281295-ewextensions`; confirm with `aio app get-url` after the first deploy.
