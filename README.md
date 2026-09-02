# image-host-pages

Cloudflare Pages version of the image host, using R2's **S3-compatible API**
(SigV4-signed requests) instead of an R2 binding. Everything lives in
`functions/[[path]].js` — one Pages Function catch-all route.

## 1. Create an R2 API token

Cloudflare dashboard → R2 → **Manage R2 API Tokens** → Create API Token.
Give it Object Read & Write, scoped to the `images` bucket. You'll get:

- Access Key ID
- Secret Access Key
- Your endpoint host (you already have it): `c6dd4991bfb2a097e83965899dae9023.r2.cloudflarestorage.com`

## 2. Deploy

Either drag-and-drop this folder into a new Pages project in the dashboard
(**Workers & Pages → Create → Pages → Upload assets**), or via Wrangler:

```bash
npx wrangler pages deploy . --project-name=image-host
```

No build step — it's plain JS, no npm deps.

## 3. Set environment variables

In the Pages project → Settings → Environment variables (set for both
Production and Preview):

| Variable                | Value                                                              |
|--------------------------|---------------------------------------------------------------------|
| `R2_ACCESS_KEY_ID`       | from the API token                                                 |
| `R2_SECRET_ACCESS_KEY`   | from the API token                                                 |
| `R2_BUCKET`              | `images`                                                            |
| `R2_ENDPOINT_HOST`       | optional — only if it's not `c6dd4991bfb2a097e83965899dae9023.r2.cloudflarestorage.com` |

Redeploy (or retrigger) after setting them so the Function picks them up.

## Behavior differences vs. the original Worker

- **No cron sweep.** Pages Functions don't support `scheduled()` triggers.
  Expiry is still enforced lazily (checked on GET/HEAD/DELETE), so expired
  files 404 and get purged on first access — they just won't be
  proactively swept if nobody ever requests them again. If you want an
  active sweep, run a small separate cron Worker that DELETEs expired
  keys, or hit a scheduled external cron against this bucket.
- **`/list` does one HEAD request per object** to recover the `uploadedAt`
  custom metadata, since `ListObjectsV2` doesn't return it. The frontend
  doesn't call `/list` (same as the original), so this only matters if you
  use the API directly with lots of objects.
- Everything else (upload, serve, delete, TTL, allowed types, size limit,
  UI) is unchanged.
