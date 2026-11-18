# Dropbox fixtures: provenance

There are **no recorded Dropbox responses yet**. The fake Dropbox in `test/support/fake-dropbox.js` builds every
response in code, from the shapes in Dropbox's published API reference (read 2026-11-18):

- OAuth: `https://docs.dropboxapi.com/dropbox-api/docs/get-started/authorization.md`
- `files/search_v2`, `files/search/continue_v2`, `files/list_folder`, `files/get_metadata`, `files/get_thumbnail_batch`
- `sharing/list_shared_links`, `sharing/create_shared_link_with_settings`
- `users/get_current_account`, `auth/token/revoke`

Shapes that the reference does not settle are listed below. They are **unverified assumptions** until someone records
them against a real Dropbox app (manual step MD3 of the spec):

| Assumption | Where it matters |
| --- | --- |
| `search_v2` accepts the options used here (`file_status`, `file_categories`, `order_by`, `path`, `max_results: 100`) | `search.js` |
| A no-argument RPC (`get_current_account`, `token/revoke`) takes no body and no `Content-Type` | `auth.js` |
| `id:` ids use letters, digits, `_` and `-` only | `ASSET_ID` in `mapping.js` |
| `get_thumbnail_batch` entries come back in request order, `.tag` `success`/`failure` | `thumbnails.js` |
| A revoked refresh token answers `400` with `error: "invalid_grant..."` | `auth.js` |
| `media_info` is `{".tag":"metadata","metadata":{".tag":"photo","dimensions":{...}}}` once processed | `mapping.js` |
| `link_permissions.effective_audience` / `resolved_visibility` tags `public`, `team`, `password` | `links.js` |

## Recording procedure

1. Connect a real Dropbox account through the picker (README, "Dropbox-side setup" and "Test it").
2. Call the endpoint through the deployed worker or with a short-lived access token, save the response body here as
   `<endpoint>.json`, and **remove personal data** (names, e-mail, account and file ids, link keys) before committing.
3. Add a test that replays the fixture through the fake and update this table (assumption -> verified, with the date).
