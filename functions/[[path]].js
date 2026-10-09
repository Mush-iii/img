// Cloudflare Pages Function - Private Paste Bin (R2 binding version)
//
// Bind an R2 bucket to this Pages project with variable name: PASTES
// Pastes are unlisted: no index, no list endpoint. The random slug is the only access.
// Expiry is enforced lazily on read. For an active sweep, add an R2 lifecycle rule.

const SLUG_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 8;
const SLUG_RE = /^[A-Za-z0-9]{8}$/;
const MAX_BYTES = 1024 * 1024; // 1 MB
const DEFAULT_TTL = "never";
const TTLS = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  never: 0,
};
const FAVICON_B64 = "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";

const BASE_HEADERS = {
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

function randomSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_LENGTH));
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i++) out += SLUG_CHARS[bytes[i] % SLUG_CHARS.length];
  return out;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8" },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...BASE_HEADERS, "content-type": "application/json" },
  });
}

function fmtExpiry(expiresAt) {
  if (!expiresAt) return "never expires";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expiring";
  const m = Math.floor(diff / 60000);
  if (m < 60) return "expires in " + Math.max(m, 1) + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return "expires in " + h + "h";
  return "expires in " + Math.floor(h / 24) + "d";
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

async function getPaste(env, slug) {
  const obj = await env.PASTES.get(slug);
  if (obj === null) return null;
  const expiresAt = Number(obj.customMetadata?.expiresAt) || 0;
  if (expiresAt && Date.now() > expiresAt) {
    await env.PASTES.delete(slug);
    return null;
  }
  return {
    text: await obj.text(),
    size: obj.size,
    createdAt: Number(obj.customMetadata?.createdAt) || null,
    expiresAt,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/favicon.ico" || path === "/favicon.png") {
    const bytes = Uint8Array.from(atob(FAVICON_B64), (c) => c.charCodeAt(0));
    return new Response(bytes, {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
    });
  }

  if (path === "/" && request.method === "GET") return html(HOME_HTML);

  if (path === "/create" && request.method === "POST") return handleCreate(request, env, url);

  if (request.method === "GET") {
    if (path.startsWith("/raw/")) {
      const slug = path.slice(5);
      if (!SLUG_RE.test(slug)) return notFound();
      const paste = await getPaste(env, slug);
      if (!paste) return notFound();
      return new Response(paste.text, {
        headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" },
      });
    }
    const slug = path.slice(1);
    if (SLUG_RE.test(slug)) {
      const paste = await getPaste(env, slug);
      if (!paste) return notFound();
      return html(renderView(slug, paste));
    }
  }

  return notFound();
}

async function handleCreate(request, env, url) {
  if (!env.PASTES) {
    return json({ error: "R2 bucket not bound. Add an R2 binding named PASTES in Pages settings." }, 500);
  }

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BYTES + 1024) return json({ error: "Too large. Max 1 MB" }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return json({ error: "Paste is empty" }, 400);
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: "Too large. Max 1 MB" }, 413);

  const ttlKey = Object.prototype.hasOwnProperty.call(TTLS, body?.ttl) ? body.ttl : DEFAULT_TTL;
  const ttl = TTLS[ttlKey];
  const createdAt = Date.now();
  const expiresAt = ttl ? createdAt + ttl : 0;
  const slug = randomSlug();

  await env.PASTES.put(slug, text, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
    customMetadata: { createdAt: String(createdAt), expiresAt: String(expiresAt) },
  });

  return json({ success: true, key: slug, url: url.origin + "/" + slug, expiresAt: expiresAt || null });
}

function notFound() {
  return html(NOT_FOUND_HTML, 404);
}

const CSS = `
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
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    background: radial-gradient(circle at 20% -10%, rgba(110,110,255,0.08), transparent 40%), var(--bg);
    color: var(--text);
    font-family: "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 28px 24px;
  }
  .wrap { width: 100%; display: flex; flex-direction: column; min-height: calc(100vh - 56px); }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }
  .badge {
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
    text-decoration: none;
  }
  .badge svg { width: 13px; height: 13px; }
  .btns { display: flex; gap: 8px; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 13px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 9px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: border-color .15s, color .15s, background .15s, transform .1s;
  }
  .btn svg { width: 14px; height: 14px; }
  .btn:hover { border-color: var(--accent); color: var(--text); }
  .btn:active { transform: scale(0.97); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.primary:hover { filter: brightness(1.1); }
  .btn:disabled { opacity: .5; cursor: default; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  textarea, pre {
    margin: 0;
    width: 100%;
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
    tab-size: 4;
  }
  textarea {
    display: block;
    flex: 1;
    min-height: 240px;
    padding: 16px 18px;
    background: transparent;
    border: 0;
    outline: none;
    resize: none;
  }
  textarea::placeholder { color: var(--muted-2); }
  pre {
    padding: 16px 18px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    flex: 1;
    overflow: auto;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px 10px 18px;
    border-top: 1px solid var(--border);
    background: var(--panel-2);
  }
  .left { display: flex; align-items: center; gap: 14px; font-size: 11.5px; color: var(--muted-2); }
  select {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 8px;
    height: 34px;
    padding: 0 8px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    cursor: pointer;
  }
  select:focus { border-color: var(--accent); }
  .meta { font-size: 11.5px; color: var(--muted-2); display: flex; gap: 10px; align-items: center; }
  .meta i { width: 3px; height: 3px; border-radius: 50%; background: var(--muted-2); display: inline-block; }
  .msg:not(.show) { display: none; }
  .msg { margin-bottom: 12px; font-size: 12.5px; color: var(--err); opacity: 0; transition: opacity .2s; }
  .msg.show { opacity: 1; }
  .result {
    display: none;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
    background: var(--panel);
    border: 1px solid var(--accent);
    border-radius: 12px;
    padding: 10px 10px 10px 16px;
    animation: rise .18s ease;
  }
  .result.show { display: flex; }
  .result a {
    flex: 1;
    min-width: 0;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result a:hover { color: var(--accent); }
  .result a.btn { flex: none; color: var(--muted); font-weight: 500; }
  .result a.btn:hover { color: var(--text); }
  @keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .topbar.sticky {
    position: sticky;
    top: 0;
    z-index: 5;
    margin: 0 -24px;
    padding: 14px 24px;
    background: rgba(10, 10, 12, 0.88);
    backdrop-filter: blur(8px);
  }
  .center { text-align: center; margin: auto; }
  .center h1 { font-size: 3rem; margin: 0 0 6px; }
  .center p { color: var(--muted); font-size: 14px; margin: 0 0 22px; }
  @media (max-width: 520px) {
    body { padding: 28px 14px; }
    .btn span { display: none; }
    .btn { padding: 0 11px; }
    .topbar.sticky { margin: 0 -14px; padding: 12px 14px; }
  }
`;

const ICONS = `
  const icons = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>',
  };
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
      return ok;
    }
  }
`;

const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const RAW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

const HOME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>paste</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="left">
        <select id="ttl" title="Expiry">
          <option value="1h">1 hour</option>
          <option value="1d">1 day</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
          <option value="never" selected>Never</option>
        </select>
        <span id="count">0 chars</span>
      </div>
      <button class="btn primary" id="create">Create</button>
    </div>

    <div class="result" id="result">
      <a id="link" target="_blank" rel="noopener"></a>
      <button class="btn" id="copyLink" title="Copy link"></button>
      <a class="btn" id="openLink" target="_blank" rel="noopener" title="Open"></a>
    </div>
    <div class="msg" id="msg"></div>

    <div class="panel">
      <textarea id="text" placeholder="Paste or type here…" spellcheck="false" autofocus></textarea>
    </div>
  </div>

<script>
  ${ICONS}
  const $ = (id) => document.getElementById(id);
  const text = $('text'), btn = $('create'), ttl = $('ttl'), count = $('count');
  const result = $('result'), link = $('link'), copyLink = $('copyLink'), openLink = $('openLink'), msgBox = $('msg');
  copyLink.innerHTML = icons.copy;
  openLink.innerHTML = icons.open;

  function showMsg(t) {
    msgBox.textContent = t;
    msgBox.classList.add('show');
    setTimeout(() => msgBox.classList.remove('show'), 3500);
  }

  text.addEventListener('input', () => {
    count.textContent = text.value.length.toLocaleString() + ' chars';
  });

  text.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); create(); }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const s = text.selectionStart, en = text.selectionEnd;
      text.value = text.value.slice(0, s) + '\\t' + text.value.slice(en);
      text.selectionStart = text.selectionEnd = s + 1;
    }
  });

  btn.addEventListener('click', create);

  async function create() {
    if (!text.value.trim()) { showMsg('Nothing to paste.'); return; }
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const res = await fetch('/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.value, ttl: ttl.value }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        link.textContent = data.url;
        link.href = data.url;
        openLink.href = data.url;
        result.classList.add('show');
        copyText(data.url);
        copyLink.innerHTML = icons.check;
        setTimeout(() => copyLink.innerHTML = icons.copy, 1200);
      } else {
        showMsg(data?.error || 'Failed to create paste');
      }
    } catch {
      showMsg('Network error');
    }
    btn.disabled = false;
    btn.textContent = 'Create';
  }

  copyLink.addEventListener('click', async () => {
    if (await copyText(link.href)) {
      copyLink.innerHTML = icons.check;
      setTimeout(() => copyLink.innerHTML = icons.copy, 1200);
    }
  });
</script>
</body>
</html>`;

function renderView(slug, paste) {
  const lines = paste.text.split("\n").length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>paste · ${slug}</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar sticky">
      <div class="meta">
        <span>${lines.toLocaleString("en-US")} ${lines === 1 ? "line" : "lines"}</span><i></i>
        <span>${fmtSize(paste.size)}</span><i></i>
        <span>${fmtExpiry(paste.expiresAt)}</span>
      </div>
      <div class="btns">
        <button class="btn primary" id="copy">${COPY_SVG}<span>Copy</span></button>
        <a class="btn" href="/raw/${slug}">${RAW_SVG}<span>Raw</span></a>
        <a class="btn" href="/">${PLUS_SVG}<span>New</span></a>
      </div>
    </div>
    <div class="panel"><pre id="content">
${esc(paste.text)}</pre></div>
  </div>

<script>
  ${ICONS}
  const copyBtn = document.getElementById('copy');
  const label = copyBtn.querySelector('span');
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(document.getElementById('content').textContent);
    const prev = copyBtn.innerHTML;
    copyBtn.innerHTML = icons.check + '<span>' + (ok ? 'Copied' : 'Failed') + '</span>';
    setTimeout(() => copyBtn.innerHTML = prev, 1400);
  });
</script>
</body>
</html>`;
}

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>not found</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>${CSS}</style>
</head>
<body>
  <div class="center">
    <h1>404</h1>
    <p>This paste doesn't exist or has expired.</p>
    <a class="btn primary" href="/">New paste</a>
  </div>
</body>
</html>`;
