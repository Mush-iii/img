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
const FAVICON_B64 = "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5AB+hHpzOG4b/0uALv9dkEH/Wow+/1qNPv9ajT7/Wo0+/1mMPf9dkUD/XpNB/1mLPf9LdTT/RW0w/0x3Nf9UhDr/X5VB/1qNPv9ZjT3/ZJ5E/2qnSf9jnET/WIk8/0NxLP8+aCf/PWkm/z9wJf8xXhf/Tn00/2uoSf9OjSz/NW0W/zRjGv9EbS3/b5Rb/0lsOf80UiT/MUwi/2yFXv+CnHP/UHQ9/z90Iv8hZAD/ZH5WrQDf398A39/fAN/f3wDe394A/fj/AIeDiS4rYA//V5A4/012Nf9elEH/Wo0+/1qNPv9ajT7/Wo0+/1yQP/9Whjv/Tno2/057Nv9QfTf/UH43/12RQP9jm0T/XZU9/0iGJv9QijH/QWsq/xYxBv8jMBz/e395/97e3//e29//zczO/8bHxv+zsbP/PWkl/y5lEP9UcUX/jZiH/7W3tf/w7fL/npih/wAAAP8AAAD/AAAA/ygfLf/Uytn/8On1/7Ozs/9qilj/NFof3gC2tbYAtrW2ALW1tQDAv8AAtau6AEtrOeZVljH/T3k3/0x3NP9glUL/Wo0+/1qNPv9ajT7/Wo0+/1+UQf9LdjT/RWwv/1eFPf9Zjzz/RIEj/zZvFv8xZxX/O2cj/26MXv+IlIL/KyUt/xAHFf8AAAD/AAAA/2JeY///////////////////////foh3/62wq//47f3////////////m5Of/Pj0+/2FgYf8AAAD/ExMT/wAAAP8WFhb/////////////////nZqevQCamZoAmpmaAJmYmACtpLIAXmZabz55Hv9km0b/UoA4/1SEOv9ckUD/Wo0+/1qNPv9ajT7/Wo0+/1uPP/9ZjD3/UH43/0BuJ/8+UzL/lZiT/7S+rv+rs6f/ysjM///9//87Mz//t7W3/7y7vP8TExP/R0dH/wAAAP9KSkv////////////b093/59/r//////////////////////8qKir/Ghoa/2RkZP9GRUb//////0VFRf8AAAD/q6qr////////////k5OTpwC1tbUAtbW1AL+/vwCrobEAS2047VeVNf9Ziz7/XJA//1yQP/9ZjD3/Wo0+/1qNPv9ajT7/Wo0+/1mMPv9bjz//YJZC/1iPOv9NeTT/fpFz/8/H1f///////////5ucm/8AAAD/amlq/z09Pf+8vLz//////ygo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enp6AAAAAEAAAABAAAAAMQAADmsAACqcAAAVTwAAFGQAAABPAAAARQcWLmVqOV5DwFJ9Nv9jlDD/Zpwx/2CVNv9Vhjj/Tno2/0x3NP9LdjT/TXg1/055Nf9NeTX/UX84/1B+N/9PfDb/U4I5/1SDOv9Ugzr/UoE5/1B+N/9Rfzj/TXk2/1KBOf9ckij/S24i/1hZVlKFe4sFlYubAG1qbgA8PD0Aenh6AGVlZQCUk5MAs7S1AEdISQB1dXUAfn5+AHp6egB6enoAenp6AAAAAEAAAABAAAAAMQAADmsAACqcAAAUUQAAE14AABFHAAAMTQAADpUAAAWBAAAGTx8TKk5qLUxFq0RpPeBZhjD/aJ4x/2ukNP9mnTj/XJA7/1WFOv9PfDb/T3w2/0t2NP9HcTL/TXk1/056Nf9OejX/Tno1/097Nv9Zizn/YZUx/1WBJv8wU0DWFSFcTRoRHgBhYF4An56gAGNiZAA+PT8Aenh6AGVlZQCUk5MAs7S1AEdISQB1dXUAfn5+AHp6egB6enoAenp6AAAAAEAAAABAAAAAMQAADmsAACqcAAAUUQAAE14AABBIAAANSQAAHIYAAB98AAARXgAADnUAAAJ2AAADZQACHnczFjBZbyhDQ6Q9YTrcUn43/1+SNf9pozv/aaRB/2ehRf9moEb/ZJ1F/2afQf9qpED/aaE5/2CTMv9SgDb/NFU7thAiTVYADqIAAAuGAAAAAAA/PjgAqqmrAGNiZAA+PT8Aenh6AGVlZQCUk5MAs7S1AEdISQB1dXUAfn5+AHp6egB6enoAenp6AAAAAEAAAABAAAAAMQAADmsAACqcAAAUUQAAE14AABBIAAANSQAAHIYAAB57AAATWAAAG2kAABtvAAAWagAAHqUAAAeIAAABeAAAEIAKBBVOOBEiPmEfO0l4LlBDiDlbM5c+YCucPmArmzdaPZIqSkWFHjhNdQ8oUF8AEUcwAABZAAAIcAAAJaMAABp2AAAAAABJSEMApqWnAGNiZAA+PT8Aenh6AGVlZQCUk5MAs7S1AEdISQB1dXUAfn5+AHp6egB6enoAenp6AAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAEAAP//eXTKKTT80mQAAAAASUVORK5CYII=";

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
