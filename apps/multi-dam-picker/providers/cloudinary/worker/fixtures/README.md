# Cloudinary fixtures

Fixtures for the Cloudinary provider tests (`../test/`) and the fake (`../test/support/fake-cloudinary.js`).

| File | Shape | Used for |
| --- | --- | --- |
| `search.json` | `resources/search` answer: `total_count`, `resources[]` limited to the documented `fields` list | search, mapping, types, thumbnails, access control, moderation, folder scope |
| `detail-image.json` | `GET resources/{asset_id}` for an image: `context.custom.alt` and `caption`, `tags`, a `derived` array | alt text, renditions, signing |
| `detail-caption-only.json`, `detail-pdf.json`, `detail-outside-root.json` | detail variants | caption fallback, document link, root scope |

## Provenance (read this before trusting them)

These files were **hand-authored from the Cloudinary documentation** (Admin API overview and search reference, re-read 2026-11-18),
not recorded: the build ran without Cloudinary credentials. Asset ids are MD5 hashes of the public IDs, URLs use the documented
`https://res.cloudinary.com/<cloud>/<resource_type>/<type>/v<version>/<public id>.<ext>` form, and the cloud name is the
non-secret test environment `yifoe45l`. Open questions M1 settles against the real environment: the exact `context` shape in search
results, accepted `fields`, sortable fields, folder mode, and `max_results=500` payload size.

## Recording from the real environment (owner step, about 3 Admin API requests)

```sh
# apps/multi-dam-picker/worker/.env must hold CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (never printed)
node apps/multi-dam-picker/providers/cloudinary/worker/record-fixtures.mjs
```

The script writes `fixtures/recorded/{search,detail,config}.json` and refuses to write anything that contains the key or the
secret. Compare the recorded shapes with the hand-authored ones above and amend them (and the mapper, if Cloudinary differs) before
committing. Never commit a file you have not read.
