## Issue

Closes #

## Extension folder(s) touched

`apps/<name>/`

## Test in Experience Workspace

Branch-ref URL (use a branch name without `/`):

- App: `https://da.live/app/jazhou-adobe/ew-extensions/apps/<name>/<name>?ref=<branch>`
- Library plugin: open a document in the EW editor with `?ref=<branch>`

## Checklist

- [ ] `npm run lint`, `npm run check`, `npm test`, `npm run test:e2e` pass
- [ ] Extension README documents its registration row; extensions table in the root README updated
- [ ] No imports from other extension folders; no secrets, no token logging
