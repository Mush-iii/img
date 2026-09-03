// Cloudflare Pages Function - Image Host (R2 binding version)
//
// Bind an R2 bucket to this Pages project with variable name: IMAGES
// (Pages dashboard -> Settings -> Functions -> R2 bucket bindings)
//
// NOTE on expiry: Pages Functions don't support scheduled() cron triggers
// (unlike Workers), so there's no active daily sweep here. Expiry is still
// enforced lazily: checked on every GET, and skipped in /list results. An
// expired-but-never-requested file just sits in the bucket until someone
// hits its URL (or you delete it another way). If you want an active
// sweep, run a small separate cron Worker bound to the same bucket that
// just loops and deletes anything past TTL.

const SLUG_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 6;
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const KEY_PREFIX = "";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

function randomSlug(length = SLUG_LENGTH) {
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    out += SLUG_CHARS[bytes[i] % SLUG_CHARS.length];
  }
  return out;
}

// No existence check: 6-char alphanumeric slug space is 62^6 (~56B), so
// collision odds are negligible. Skipping the pre-upload head() saves a
// full R2 round trip on every upload.
function generateUniqueSlug(ext) {
  const slug = randomSlug();
  return KEY_PREFIX + (ext ? `${slug}.${ext}` : slug);
}

function getExtension(filename, mimeType) {
  const parts = (filename || "").split(".");
  if (parts.length > 1) {
    const ext = parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ext) return ext;
  }
  // Fall back to deriving from mime type (clipboard pastes often have no filename)
  const mimeExt = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
  };
  return mimeExt[mimeType] || "bin";
}

function isExpired(uploadedAt) {
  if (!uploadedAt) return false;
  return Date.now() - Number(uploadedAt) > TTL_MS;
}

// ---------- Pages Function entry point ----------
const FAVICON_B64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAWfmNhQlgAABZ+anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFlhqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOmQzOWM0ZGE5LTEwYzAtNDcwOS04NGQ5LTg0OGI3ODJlMzMxMwAAAAOTanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuGp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNoa4mcTE1QR2O7mX05/0M1pQAAAGxjYm9yo2lkYzpmb3JtYXRpaW1hZ2UvcG5namluc3RhbmNlSUR4LHhtcDppaWQ6MWJjYWYyMmQtMWQ5OS00OTU4LWE2MDEtOWM5ZDNiMGViY2Y0bHJlbGF0aW9uc2hpcGhwYXJlbnRPZgAAAeJqdW1iAAAAQWp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuYWN0aW9ucy52MgAAAAAYYzJzaEh0/C3IGeMeZdiMg6n96YIAAAGZY2JvcqJnYWN0aW9uc4KiZmFjdGlvbmtjMnBhLm9wZW5lZGpwYXJhbWV0ZXJzoWtpbmdyZWRpZW50c4GiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIFJSLc9c5XSI1OemyGeK/de7enUZZBJATeAuyTsr12ZqpGZhY3Rpb254HWNvbS5hbnRocm9waWMuY2xhdWRlLnByb3ZpZGVkanBhcmFtZXRlcnOheB9jb20uYW50aHJvcGljLm9yaWdpbi1jb25maWRlbmNlZ3Vua25vd25rZGVzY3JpcHRpb254ZkNsYXVkZSBwcm92aWRlZCB0aGlzIGZpbGUgYXQgdGhlIHJlcXVlc3Qgb2YgYSB1c2VyIGFuZCBtYXkgaGF2ZSBjcmVhdGVkIG9yIG1vZGlmaWVkIHRoZSBmaWxlIGNvbnRlbnRzLm1zb2Z0d2FyZUFnZW50oWRuYW1lZkNsYXVkZXJhbGxBY3Rpb25zSW5jbHVkZWT1AAAAyGp1bWIAAABAanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5oYXNoLmRhdGEAAAAAGGMyc2hDKyhOhoFEgKLpHgR9fjM2AAAAgGNib3KlY2FsZ2ZzaGEyNTZjcGFkTQAAAAAAAAAAAAAAAABkaGFzaFggSrUGIie/VqZcsrDaY/DqoGalbO5EFVtO5kEH9qJmJkpkbmFtZW5qdW1iZiBtYW5pZmVzdGpleGNsdXNpb25zgaJlc3RhcnQYIWZsZW5ndGgZFooAAAI+anVtYgAAACdqdW1kYzJjbAARABCAAACqADibcQNjMnBhLmNsYWltLnYyAAAAAg9jYm9ypWNhbGdmc2hhMjU2aXNpZ25hdHVyZXhNc2VsZiNqdW1iZj0vYzJwYS91cm46YzJwYTpkMzljNGRhOS0xMGMwLTQ3MDktODRkOS04NDhiNzgyZTMzMTMvYzJwYS5zaWduYXR1cmVqaW5zdGFuY2VJRHgseG1wOmlpZDoyMTEwMWYwMi00NmJjLTQ0OTUtYjYzYi1lODI5ZmJkNWExNGVyY3JlYXRlZF9hc3NlcnRpb25zg6JjdXJseC1zZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmluZ3JlZGllbnQudjNkaGFzaFggUlItz1zldIjU56bIZ4r917t6dRlkEkBN4C7JOyvXZmqiY3VybHgqc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5hY3Rpb25zLnYyZGhhc2hYIHDdLNl2JbdJky64Hunf/Vq4R3RSMNw1l3mnYFolehJ2omN1cmx4KXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaGFzaC5kYXRhZGhhc2hYIIDwjSssPkorqEYwA/X0Z7euVF0dndKApLa6TOD3kmD+dGNsYWltX2dlbmVyYXRvcl9pbmZvo2RuYW1lb0FudGhyb3BpYyBGaWxlc2d2ZXJzaW9uZTEuMC4wa3NwZWNWZXJzaW9uZTIuNC4wAAAQOGp1bWIAAAAoanVtZGMyY3MAEQAQgAAAqgA4m3EDYzJwYS5zaWduYXR1cmUAAAAQCGNib3LShFkCEqIBJhghWQIKMIICBjCCAY2gAwIBAgIUQOWgCu7COdC+uIP6BkIFPWdVEwAwCgYIKoZIzj0EAwMwSTEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxLjAsBgNVBAMTJUFudGhyb3BpYyBDb250ZW50IENyZWRlbnRpYWxzIFJvb3QgQ0EwHhcNMjYwODA3MTg0MzU2WhcNMjgwODA2MTk0MzU2WjBEMRcwFQYDVQQKEw5BbnRocm9waWMsIFBCQzEpMCcGA1UEAxMgQW50aHJvcGljIENsYXVkZSBDb250ZW50IFNpZ25pbmcwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASYegpry1AYBRTVNL1CpTlbROnY3dey+UrsF9C3phYrATN3ZHf93Mo8RQN0KOUuOn19P4oWNFWe5n2/She9N7eTo1gwVjAOBgNVHQ8BAf8EBAMCB4AwFQYDVR0lBA4wDAYKKwYBBAGD6F4CATAMBgNVHRMBAf8EAjAAMB8GA1UdIwQYMBaAFM5R4gSBTmRbI/jjxM+aPpzB11zCMAoGCCqGSM49BAMDA2cAMGQCMDFzHRSeAXrSy1WOzkbhPZ6Km2wGTmZ/2gK18k8BQGXyqz88Rdrz6CTX9flAnYNVxgIwcF9c3fVhqmJKpi+UhasNUMko69cyX6STPfta3Q8EjyzDjzoyrol46FP6VFHhvUcJoWNwYWRZDZ4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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"

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/favicon.ico" || pathname === "/favicon.png") {
    const bytes = Uint8Array.from(atob(FAVICON_B64), c => c.charCodeAt(0));
    return new Response(bytes, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      },
    });
  }

  if (pathname === "/" && request.method === "GET") {
    return new Response(PAGE_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (pathname === "/upload" && request.method === "POST") {
    return handleUpload(request, env, url);
  }

  if (pathname === "/list" && request.method === "GET") {
    return handleList(env, url);
  }

  const key = pathname.slice(1);

  if (request.method === "GET") {
    return handleServe(key, env, request, context);
  }

  if (request.method === "DELETE") {
    return handleDelete(key, env);
  }

  return new Response("Not found", { status: 404 });
}

async function handleUpload(request, env, url) {
  if (!env.IMAGES) {
    return jsonResponse({ error: "R2 bucket not bound. Add an R2 binding named IMAGES in Pages settings." }, 500);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonResponse({ error: "Expected multipart/form-data" }, 400);
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return jsonResponse({ error: "No file provided" }, 400);
  }
  if (file.size === 0) {
    return jsonResponse({ error: "Empty file" }, 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return jsonResponse({ error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB` }, 413);
  }

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(mimeType)) {
    return jsonResponse({ error: `File type not allowed: ${mimeType}` }, 415);
  }

  const ext = getExtension(file.name || "", mimeType);
  const key = generateUniqueSlug(ext);

  const uploadedAt = Date.now();

  await env.IMAGES.put(key, file.stream(), {
    httpMetadata: { contentType: mimeType },
    customMetadata: { uploadedAt: String(uploadedAt) },
  });

  return jsonResponse({
    success: true,
    key,
    url: `${url.origin}/${key}`,
    size: file.size,
    type: mimeType,
    uploadedAt,
    expiresAt: uploadedAt + TTL_MS,
  });
}

async function handleList(env, url) {
  if (!env.IMAGES) {
    return jsonResponse({ error: "R2 bucket not bound. Add an R2 binding named IMAGES in Pages settings." }, 500);
  }

  const items = [];
  let cursor;
  do {
    const listing = await env.IMAGES.list({ prefix: KEY_PREFIX, cursor });
    for (const obj of listing.objects) {
      const uploadedAt = Number(obj.customMetadata?.uploadedAt) || null;
      if (isExpired(uploadedAt)) continue; // lazily hide stale entries
      items.push({
        key: obj.key,
        url: `${url.origin}/${obj.key}`,
        size: obj.size,
        uploadedAt,
        expiresAt: uploadedAt ? uploadedAt + TTL_MS : null,
      });
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  items.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  return jsonResponse({ items, ttlMs: TTL_MS });
}

async function handleServe(key, env, request, context) {
  if (!key) return new Response("Not found", { status: 404 });
  if (!env.IMAGES) return new Response("R2 bucket not bound", { status: 500 });

  // Slugs are random + content is immutable, so this is a perfect
  // cache-forever case. Check CF's edge cache before touching R2 at all.
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const object = await env.IMAGES.get(key);
  if (object === null) {
    return new Response("Not found", { status: 404 });
  }

  const uploadedAt = object.customMetadata?.uploadedAt;
  if (isExpired(uploadedAt)) {
    // Lazily purge on access past TTL.
    await env.IMAGES.delete(key);
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  const response = new Response(object.body, { headers });
  // Populate the edge cache in the background without blocking the response.
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleDelete(key, env) {
  // NOTE: no auth on this test version — add a secret-header check
  // before exposing this publicly.
  if (!key) return jsonResponse({ error: "No key provided" }, 400);
  if (!env.IMAGES) return jsonResponse({ error: "R2 bucket not bound" }, 500);

  const existing = await env.IMAGES.head(key);
  if (existing === null) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  await env.IMAGES.delete(key);
  return jsonResponse({ success: true, deleted: key });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>img</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  :root {
    --bg: #0a0a0c;
    --panel: #131316;
    --panel-2: #1a1a1f;
    --border: #232329;
    --text: #ececef;
    --muted: #86868f;
    --muted-2: #55555e;
    --accent: #6e6eff;
    --accent-soft: rgba(110, 110, 255, 0.12);
    --err: #ff6363;
    --ok: #4ade80;
    --radius: 14px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(circle at 20% -10%, rgba(110,110,255,0.08), transparent 40%),
      var(--bg);
    color: var(--text);
    font-family: "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 48px 20px;
  }
  .wrap { width: 100%; max-width: 640px; }

  .head { margin-bottom: 18px; display: flex; justify-content: center; }
  .head .ttl-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: #b3b3ff;
    font-size: 11.5px;
    font-weight: 600;
  }
  .head .ttl-badge svg { width: 13px; height: 13px; }

  .drop {
    border: 1.5px dashed var(--border);
    border-radius: var(--radius);
    padding: 28px 20px;
    text-align: center;
    color: var(--muted);
    font-size: 13.5px;
    cursor: pointer;
    transition: border-color .15s, background .15s, transform .1s;
    background: var(--panel);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .drop:active { transform: scale(0.995); }
  .drop.drag {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }
  .drop svg { width: 17px; height: 17px; color: var(--muted); flex-shrink: 0; }
  .drop.drag svg { color: var(--accent); }
  .drop b { color: var(--text); font-weight: 600; }
  input[type=file] { display: none; }

  .queue { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    animation: rise .18s ease;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .item .thumb {
    width: 38px;
    height: 38px;
    object-fit: cover;
    border-radius: 8px;
    background: var(--panel-2);
    flex-shrink: 0;
    border: 1px solid var(--border);
  }
  .item .info { flex: 1; min-width: 0; }
  .item .name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item .status {
    font-size: 11.5px;
    color: var(--muted);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item .status.err { color: var(--err); }
  .item .status a {
    color: var(--muted);
    text-decoration: none;
  }
  .item .status a:hover { color: var(--accent); text-decoration: underline; }
  .item .expiry {
    font-size: 10.5px;
    color: var(--muted-2);
  }
  .item .actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .item button {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color .15s, color .15s, background .15s;
  }
  .item button svg { width: 14px; height: 14px; }
  .item button:hover { border-color: var(--accent); color: var(--text); }
  .item button.danger:hover { border-color: var(--err); color: var(--err); }
  .item button:disabled { opacity: .5; cursor: default; }

  .bar {
    height: 3px;
    background: var(--panel-2);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 6px;
  }
  .bar .fill {
    height: 100%;
    width: 0%;
    background: var(--accent);
    transition: width .15s;
  }

  .msg {
    margin-top: 14px;
    font-size: 12.5px;
    color: var(--err);
    opacity: 0;
    transition: opacity .2s;
  }
  .msg.show { opacity: 1; }

</style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div class="ttl-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
        images auto-delete 1 week after upload
      </div>
    </div>

    <div class="drop" id="drop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>
      <span id="dropLabel">Click to browse, drag a file, or paste from clipboard</span>
      <input type="file" id="fileInput" accept="image/*" multiple>
    </div>

    <div class="queue" id="queue"></div>
    <div class="msg" id="msg"></div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);
  const drop = $('drop');
  const fileInput = $('fileInput');
  const queue = $('queue');
  const msgBox = $('msg');

  const icons = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>',
  };

  function showMsg(text) {
    msgBox.textContent = text;
    msgBox.classList.add('show');
    setTimeout(() => msgBox.classList.remove('show'), 3500);
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function fmtAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function fmtExpiry(expiresAt) {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return 'expiring…';
    const h = Math.floor(diff / 3600000);
    if (h < 1) return 'expires in <1h';
    if (h < 24) return 'expires in ' + h + 'h';
    return 'expires in ' + Math.floor(h / 24) + 'd';
  }

  drop.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(evt =>
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach(evt =>
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
    })
  );
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      handleFiles(files);
    }
  });

  function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) { showMsg('No image files found.'); return; }
    files.forEach(uploadFile);
  }

  function buildRow({ name, thumbSrc }) {
    const row = document.createElement('div');
    row.className = 'item';

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    if (thumbSrc) thumb.src = thumbSrc;
    row.appendChild(thumb);

    const info = document.createElement('div');
    info.className = 'info';
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = name;
    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = 'Uploading…';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    bar.appendChild(fill);
    info.appendChild(nameEl);
    info.appendChild(status);
    info.appendChild(bar);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';
    row.appendChild(actions);

    return { row, thumb, info, status, bar, fill, actions };
  }

  function finalizeRow(parts, data) {
    const { bar, actions } = parts;
    bar.remove();
    parts.status.remove();

    const copyBtn = document.createElement('button');
    copyBtn.innerHTML = icons.copy;
    copyBtn.title = 'Copy link';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(data.url);
      copyBtn.innerHTML = icons.check;
      setTimeout(() => copyBtn.innerHTML = icons.copy, 1200);
    };
    actions.appendChild(copyBtn);

    const openBtn = document.createElement('button');
    openBtn.innerHTML = icons.open;
    openBtn.title = 'Open in new tab';
    openBtn.onclick = () => window.open(data.url, '_blank');
    actions.appendChild(openBtn);
  }

  function uploadFile(file) {
    const parts = buildRow({ name: file.name || 'pasted-image', thumbSrc: URL.createObjectURL(file) });
    queue.prepend(parts.row);

    const fd = new FormData();
    fd.append('file', file, file.name || 'pasted-image.png');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        parts.fill.style.width = Math.round((e.loaded / e.total) * 100) + '%';
      }
    });

    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }

      if (xhr.status >= 200 && xhr.status < 300 && data?.success) {
        finalizeRow(parts, data);
      } else {
        parts.bar.remove();
        parts.status.classList.add('err');
        parts.status.textContent = data?.error || 'Upload failed';
      }
    };

    xhr.onerror = () => {
      parts.bar.remove();
      parts.status.classList.add('err');
      parts.status.textContent = 'Network error';
    };

    xhr.send(fd);
  }

  // Note: intentionally not loading past uploads on page load — this is
  // a shared public host, so the list only ever shows this session's uploads.
</script>
</body>
</html>`;
