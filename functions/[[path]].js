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
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const KEY_PREFIX = "";
const PERM_PREFIX = "i/"; // permanent images live under this prefix; the cleanup worker skips it
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ADMIN_PIN = "6969";
const ADMIN_COOKIE = "admin_auth";
const ADMIN_SALT = "img-host-admin-v1"; // static salt, keeps auth stateless (no KV/session store needed)
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
function generateUniqueSlug(ext, prefix = KEY_PREFIX) {
  const slug = randomSlug();
  return prefix + (ext ? `${slug}.${ext}` : slug);
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

function isExpired(key, uploadedAt) {
  if (key && key.startsWith(PERM_PREFIX)) return false; // permanent, never expires
  if (!uploadedAt) return false;
  return Date.now() - Number(uploadedAt) > TTL_MS;
}

// ---------- Admin auth (stateless: cookie holds a hash of PIN+salt) ----------
async function adminToken() {
  const data = new TextEncoder().encode(ADMIN_SALT + ":" + ADMIN_PIN);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function isAdmin(request) {
  const cookie = getCookie(request, ADMIN_COOKIE);
  if (!cookie) return false;
  const token = await adminToken();
  return cookie === token;
}

// ---------- Pages Function entry point ----------
const FAVICON_B64 = "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"
  
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
    return handleUpload(request, env, url, false, context);
  }

  if (pathname === "/list" && request.method === "GET") {
    return handleList(env, url);
  }

  if (pathname === "/admin" && request.method === "GET") {
    const authed = await isAdmin(request);
    return new Response(renderAdminPage(authed), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (pathname === "/admin/login" && request.method === "POST") {
    return handleAdminLogin(request);
  }

  if (pathname === "/admin/logout" && request.method === "POST") {
    return handleAdminLogout();
  }

  if (pathname === "/admin/upload" && request.method === "POST") {
    if (!(await isAdmin(request))) return jsonResponse({ error: "Unauthorized" }, 401);
    return handleUpload(request, env, url, true, context);
  }

  if (pathname === "/admin/list" && request.method === "GET") {
    if (!(await isAdmin(request))) return jsonResponse({ error: "Unauthorized" }, 401);
    return handleAdminList(env, url);
  }

  const key = pathname.slice(1);

  if (request.method === "GET") {
    return handleServe(key, env, request, context);
  }

  if (request.method === "DELETE") {
    return handleDelete(key, env, request);
  }

  return new Response("Not found", { status: 404 });
}

async function handleUpload(request, env, url, permanent = false, context) {
  if (!env.IMAGES) {
    return jsonResponse({ error: "R2 bucket not bound. Add an R2 binding named IMAGES in Pages settings." }, 500);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonResponse({ error: "Expected multipart/form-data" }, 400);
  }

  // Fix 2: reject oversized uploads before buffering the body via formData().
  // content-length includes multipart boundary/header overhead, so it's an
  // upper bound on the file size, not exact - but it's enough to fail fast
  // on anything way over the limit without receiving/parsing the whole body.
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > MAX_FILE_SIZE) {
    return jsonResponse({ error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB` }, 413);
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
  const key = generateUniqueSlug(ext, permanent ? PERM_PREFIX : KEY_PREFIX);

  const uploadedAt = Date.now();

  // Fix 1: don't block the response on the R2 write finishing. Kick off the
  // put and let it complete in the background via waitUntil, and return the
  // URL immediately. Tradeoff: if the URL is requested in the first instant
  // after upload, before the write lands, handleServe will 404 on it.
  const putPromise = env.IMAGES.put(key, file.stream(), {
    httpMetadata: { contentType: mimeType },
    customMetadata: { uploadedAt: String(uploadedAt), permanent: permanent ? "true" : "false" },
  });
  if (context?.waitUntil) {
    context.waitUntil(putPromise);
  } else {
    // No context available (shouldn't happen given call sites) - fall back
    // to awaiting so the upload still completes correctly.
    await putPromise;
  }

  return jsonResponse({
    success: true,
    key,
    url: `${url.origin}/${key}`,
    size: file.size,
    type: mimeType,
    uploadedAt,
    permanent,
    expiresAt: permanent ? null : uploadedAt + TTL_MS,
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
      if (obj.key.startsWith(PERM_PREFIX)) continue; // permanent images live in the admin gallery
      const uploadedAt = Number(obj.customMetadata?.uploadedAt) || null;
      if (isExpired(obj.key, uploadedAt)) continue; // lazily hide stale entries
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

async function handleAdminList(env, url) {
  if (!env.IMAGES) {
    return jsonResponse({ error: "R2 bucket not bound. Add an R2 binding named IMAGES in Pages settings." }, 500);
  }

  const items = [];
  let cursor;
  do {
    const listing = await env.IMAGES.list({ prefix: PERM_PREFIX, cursor });
    for (const obj of listing.objects) {
      const uploadedAt = Number(obj.customMetadata?.uploadedAt) || null;
      items.push({
        key: obj.key,
        url: `${url.origin}/${obj.key}`,
        size: obj.size,
        uploadedAt,
      });
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  items.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  return jsonResponse({ items });
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
  if (isExpired(key, uploadedAt)) {
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

async function handleDelete(key, env, request) {
  if (!key) return jsonResponse({ error: "No key provided" }, 400);
  if (!env.IMAGES) return jsonResponse({ error: "R2 bucket not bound" }, 500);

  // Permanent images require the admin PIN — anyone can still delete their
  // own session's regular (expiring) uploads, matching the existing behavior.
  if (key.startsWith(PERM_PREFIX) && !(await isAdmin(request))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const existing = await env.IMAGES.head(key);
  if (existing === null) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  await env.IMAGES.delete(key);
  return jsonResponse({ success: true, deleted: key });
}

async function handleAdminLogin(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const pin = String(body?.pin ?? "");
  if (pin !== ADMIN_PIN) {
    return jsonResponse({ error: "Incorrect PIN" }, 401);
  }

  const token = await adminToken();
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "content-type": "application/json",
      "Set-Cookie": `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
    },
  });
}

function handleAdminLogout() {
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "content-type": "application/json",
      "Set-Cookie": `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    },
  });
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
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 500;
  }
  .head .ttl-badge svg { width: 13px; height: 13px; }

  .drop-wrap {
    position: relative;
    width: 96px;
    height: 96px;
    margin: 12px auto 28px;
  }
  .drop {
    position: relative;
    z-index: 2;
    border-radius: 14px;
    width: 96px;
    height: 96px;
    padding: 0;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--border);
    transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s ease, border-color .2s;
  }
  .drop-wrap:hover .drop {
    transform: translate(10px, -10px);
    box-shadow: 0 18px 34px rgba(0,0,0,0.45);
    border-color: var(--border);
  }
  .drop:active { transform: scale(0.97); }
  .drop.drag { border-color: var(--accent); background: var(--accent-soft); }
  .drop span { display: none; }
  .drop svg {
    width: 1.5rem;
    height: 1.5rem;
    color: var(--muted);
    flex-shrink: 0;
    pointer-events: none;
    transition: color .2s;
  }
  .drop.drag svg { color: var(--accent); }
  .drop-outline {
    position: absolute;
    z-index: 1;
    inset: 0;
    border-radius: 14px;
    border: 1.5px dashed var(--accent);
    background: transparent;
    opacity: 0;
    transition: opacity .3s ease;
  }
  .drop-wrap:hover .drop-outline { opacity: 0.8; }
  input[type=file] {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    pointer-events: none;
  }

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

  .foot { margin-top: 22px; text-align: center; }
  .foot a {
    color: var(--muted-2);
    font-size: 11.5px;
    text-decoration: none;
  }
  .foot a:hover { color: var(--muted); text-decoration: underline; }

</style>
</head>
<body>
  <div class="wrap">
    <div class="head">
    </div>

    <div class="drop-wrap">
      <div class="drop" id="drop">
        <input type="file" id="fileInput" accept="image/*" multiple>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"></path><path d="M7 9l5 -5l5 5"></path><path d="M12 4l0 12"></path></svg>
        <span id="dropLabel">Click to browse, drag a file, or paste from clipboard</span>
      </div>
      <div class="drop-outline"></div>
    </div>

    <div class="queue" id="queue"></div>
    <div class="msg" id="msg"></div>


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
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
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

function renderAdminPage(authed) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>img · admin</title>
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
  a { color: inherit; }

  /* ---- pin screen ---- */
  .pin-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
  }
  .pin-title { font-size: 1.1rem; font-weight: 700; color: var(--text); }
  .pin-fields { display: flex; gap: 10px; }
  .pin-fields input {
    height: 3em;
    width: 2.6em;
    outline: none;
    text-align: center;
    font-family: inherit;
    font-size: 1.6rem;
    color: var(--text);
    border-radius: 10px;
    border: 1.5px solid var(--border);
    background-color: var(--panel);
    transition: border-color .15s, transform .15s;
  }
  .pin-fields input:focus {
    border-color: var(--accent);
    transform: scale(1.05);
  }
  .pin-fields input.err {
    border-color: var(--err);
    animation: shake .25s;
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
  }
  .pin-msg { font-size: 12.5px; color: var(--err); opacity: 0; transition: opacity .2s; height: 1em; }
  .pin-msg.show { opacity: 1; }

  /* ---- dashboard ---- */
  .wrap { width: 100%; max-width: 720px; display: none; }
  .wrap.show { display: block; }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
  }
  .topbar h1 { font-size: 1.1rem; margin: 0; }
  .topbar button {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 7px 12px;
    border-radius: 8px;
    font-size: 12.5px;
    cursor: pointer;
  }
  .topbar button:hover { color: var(--text); border-color: var(--accent); }

  .drop-wrap {
    position: relative;
    width: 96px;
    height: 96px;
    margin: 12px auto 28px;
  }
  .drop {
    position: relative;
    z-index: 2;
    border-radius: 14px;
    width: 96px;
    height: 96px;
    padding: 0;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--border);
    transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s ease, border-color .2s;
  }
  .drop-wrap:hover .drop {
    transform: translate(10px, -10px);
    box-shadow: 0 18px 34px rgba(0,0,0,0.45);
    border-color: var(--border);
  }
  .drop:active { transform: scale(0.97); }
  .drop.drag { border-color: var(--accent); background: var(--accent-soft); }
  .drop span { display: none; }
  .drop svg {
    width: 1.5rem;
    height: 1.5rem;
    color: var(--muted);
    flex-shrink: 0;
    pointer-events: none;
    transition: color .2s;
  }
  .drop.drag svg { color: var(--accent); }
  .drop-outline {
    position: absolute;
    z-index: 1;
    inset: 0;
    border-radius: 14px;
    border: 1.5px dashed var(--accent);
    background: transparent;
    opacity: 0;
    transition: opacity .3s ease;
  }
  .drop-wrap:hover .drop-outline { opacity: 0.8; }
  input[type=file] {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    pointer-events: none;
  }

  .msg { margin-top: 14px; font-size: 12.5px; color: var(--err); opacity: 0; transition: opacity .2s; }
  .msg.show { opacity: 1; }

  .gallery {
    margin-top: 22px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 12px;
  }
  .card {
    position: relative;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    animation: rise .18s ease;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .card img {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    display: block;
    background: var(--panel-2);
  }
  .card .bar2 {
    position: absolute;
    inset: auto 0 0 0;
    height: 3px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .card .bar2 .fill2 { height: 100%; width: 0%; background: var(--accent); transition: width .15s; }
  .card .cactions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity .15s;
  }
  .card:hover .cactions { opacity: 1; }
  .card button {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10,10,12,0.75);
    backdrop-filter: blur(2px);
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 7px;
    cursor: pointer;
  }
  .card button svg { width: 13px; height: 13px; }
  .card button:hover { color: var(--text); border-color: var(--accent); }
  .card button.danger:hover { color: var(--err); border-color: var(--err); }
  .empty { color: var(--muted-2); font-size: 13px; text-align: center; margin-top: 30px; }
</style>
</head>
<body>

  <div class="pin-wrap" id="pinWrap">
    <div class="pin-title">Enter admin PIN</div>
    <div class="pin-fields" id="pinFields">
      <input maxlength="1" type="tel" inputmode="numeric" pattern="[0-9]*">
      <input maxlength="1" type="tel" inputmode="numeric" pattern="[0-9]*">
      <input maxlength="1" type="tel" inputmode="numeric" pattern="[0-9]*">
      <input maxlength="1" type="tel" inputmode="numeric" pattern="[0-9]*">
    </div>
    <div class="pin-msg" id="pinMsg">Incorrect PIN</div>
  </div>

  <div class="wrap" id="dash">
    <div class="topbar">
      <h1>Permanent images</h1>
      <button id="logoutBtn">Log out</button>
    </div>
    <div class="drop-wrap">
      <div class="drop" id="drop">
        <input type="file" id="fileInput" accept="image/*" multiple>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"></path><path d="M7 9l5 -5l5 5"></path><path d="M12 4l0 12"></path></svg>
        <span>Click to browse, drag files, or paste from clipboard</span>
      </div>
      <div class="drop-outline"></div>
    </div>
    <div class="msg" id="msg"></div>
    <div class="gallery" id="gallery"></div>
    <div class="empty" id="empty" style="display:none;">No permanent images yet.</div>
  </div>

<script>
  const AUTHED = ${authed ? "true" : "false"};
  const $ = (id) => document.getElementById(id);

  const icons = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  };

  // ---------------- PIN screen ----------------
  const pinWrap = $('pinWrap');
  const pinFields = $('pinFields');
  const pinInputs = [...pinFields.querySelectorAll('input')];
  const pinMsg = $('pinMsg');
  const dash = $('dash');

  function showDash() {
    pinWrap.style.display = 'none';
    dash.classList.add('show');
    loadGallery();
  }

  if (AUTHED) {
    showDash();
  } else {
    pinInputs[0].focus();
  }

  function clearPin(showError) {
    pinInputs.forEach(i => { i.value = ''; if (showError) i.classList.add('err'); });
    pinInputs[0].focus();
    if (showError) {
      pinMsg.classList.add('show');
      setTimeout(() => {
        pinInputs.forEach(i => i.classList.remove('err'));
        pinMsg.classList.remove('show');
      }, 900);
    }
  }

  async function submitPin() {
    const pin = pinInputs.map(i => i.value).join('');
    try {
      const res = await fetch('/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        showDash();
      } else {
        clearPin(true);
      }
    } catch {
      clearPin(true);
    }
  }

  pinInputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9]/g, '');
      if (input.value && idx < pinInputs.length - 1) {
        pinInputs[idx + 1].focus();
      }
      if (pinInputs.every(i => i.value)) {
        submitPin();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        pinInputs[idx - 1].focus();
      }
    });
  });

  $('logoutBtn').addEventListener('click', async () => {
    await fetch('/admin/logout', { method: 'POST' });
    location.reload();
  });

  // ---------------- Dashboard ----------------
  const drop = $('drop');
  const fileInput = $('fileInput');
  const msgBox = $('msg');
  const gallery = $('gallery');
  const emptyEl = $('empty');

  function showMsg(text) {
    msgBox.textContent = text;
    msgBox.classList.add('show');
    setTimeout(() => msgBox.classList.remove('show'), 3500);
  }

  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach(evt =>
    drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove('drag'); })
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
    if (files.length) { e.preventDefault(); handleFiles(files); }
  });

  function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) { showMsg('No image files found.'); return; }
    files.forEach(uploadFile);
  }

  function buildCard(thumbSrc) {
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    if (thumbSrc) img.src = thumbSrc;
    card.appendChild(img);
    const bar2 = document.createElement('div');
    bar2.className = 'bar2';
    const fill2 = document.createElement('div');
    fill2.className = 'fill2';
    bar2.appendChild(fill2);
    card.appendChild(bar2);
    return { card, img, fill2, bar2 };
  }

  function attachCardActions(card, data) {
    const actions = document.createElement('div');
    actions.className = 'cactions';

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
    openBtn.title = 'Open';
    openBtn.onclick = () => window.open(data.url, '_blank');
    actions.appendChild(openBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.innerHTML = icons.trash;
    delBtn.title = 'Delete permanently';
    delBtn.onclick = async () => {
      delBtn.disabled = true;
      try {
        const res = await fetch('/' + data.key, { method: 'DELETE' });
        if (res.ok) {
          card.remove();
          if (!gallery.children.length) emptyEl.style.display = 'block';
        } else {
          delBtn.disabled = false;
          showMsg('Failed to delete.');
        }
      } catch {
        delBtn.disabled = false;
        showMsg('Network error while deleting.');
      }
    };
    actions.appendChild(delBtn);

    card.appendChild(actions);
  }

  function uploadFile(file) {
    const { card, img, fill2, bar2 } = buildCard(URL.createObjectURL(file));
    gallery.prepend(card);
    emptyEl.style.display = 'none';

    const fd = new FormData();
    fd.append('file', file, file.name || 'pasted-image.png');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/admin/upload');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        fill2.style.width = Math.round((e.loaded / e.total) * 100) + '%';
      }
    });

    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      bar2.remove();
      if (xhr.status >= 200 && xhr.status < 300 && data?.success) {
        attachCardActions(card, data);
      } else {
        card.remove();
        showMsg(data?.error || 'Upload failed');
      }
    };
    xhr.onerror = () => {
      bar2.remove();
      card.remove();
      showMsg('Network error');
    };
    xhr.send(fd);
  }

  async function loadGallery() {
    try {
      const res = await fetch('/admin/list');
      if (!res.ok) return;
      const data = await res.json();
      gallery.innerHTML = '';
      if (!data.items?.length) {
        emptyEl.style.display = 'block';
        return;
      }
      emptyEl.style.display = 'none';
      for (const item of data.items) {
        const { card } = buildCard(item.url);
        card.querySelector('.bar2')?.remove();
        gallery.appendChild(card);
        attachCardActions(card, item);
      }
    } catch {
      showMsg('Failed to load gallery.');
    }
  }
</script>
</body>
</html>`;
}
