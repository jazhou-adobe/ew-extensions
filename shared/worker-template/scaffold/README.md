# __EXT__ worker

Backend for the `__EXT__` extension: one Adobe App Builder raw web action (`__EXT__/api`) built on the shared worker template
([`shared/worker-template/README.md`](__SHARED__/README.md)). Routes are in `routes/`; vendor-specific modules belong in
`apps/__EXT__/providers/<vendor>/worker/` and are registered from `routes/index.js`.

```sh
cp .env.example .env     # then fill in the secrets; .env and .aio are untracked
npm run test:worker      # from the repo root
env -u CI aio app deploy # from this folder; see the template README for Stage vs Production
```
