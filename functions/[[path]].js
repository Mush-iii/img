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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { pathname } = url;

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
<link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Mush-iii/img/main/public/favicon.png">
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
