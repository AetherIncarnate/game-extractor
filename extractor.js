/*!
 * Game Extractor v3.1 — surface the playable build behind a game page.
 * Owned / authorised sites only. No dependencies.
 * Alt+G toggle · Esc minimise · ↑↓ select · Space Quick Look · / search
 */
(function () {
  'use strict';

  var VERSION = '3.1.0';
  var ROOT_ID = 'gex-root';

  if (window.__gex) {
    try { window.__gex.toggle(); } catch (e) { }
    return;
  }

  var DEFAULTS = {
    excludeAssets: true,
    blockImages: true,
    strict: false,
    boostSameDomain: true,
    boostCdn: true,
    liveCapture: true,
    unwrapProxies: true,
    autoDropImageMime: true,
    minScore: 25
  };

  var settings = loadSettings();
  var stats = { seen: 0, kept: 0, image: 0, noise: 0, auth: 0, low: 0, other: 0 };

  function store() {
    try { localStorage.setItem('gex:settings', JSON.stringify(settings)); } catch (e) { }
  }

  function loadSettings() {
    var out = clone(DEFAULTS);
    var keys = ['gex:settings', 'gex_settings', 'age_settings'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') continue;
        for (var k in DEFAULTS) if (k in parsed) out[k] = parsed[k];
        if ('excludeImages' in parsed) out.blockImages = !!parsed.excludeImages;
        if ('onlyHtmlOrGame' in parsed) out.strict = !!parsed.onlyHtmlOrGame;
        if ('prioritizeCdn' in parsed) out.boostCdn = !!parsed.prioritizeCdn;
      } catch (e) { }
    }
    out.minScore = clamp(parseInt(out.minScore, 10) || 0, -100, 200);
    return out;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(n, a, b) { return n < a ? a : n > b ? b : n; }

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function safeHost() {
    try {
      if (location.hostname) return location.hostname.replace(/^www\./, '');
      var b = new URL(document.baseURI || 'https://page.invalid');
      return b.hostname.replace(/^www\./, '') || 'sandbox';
    } catch (e) { return 'sandbox'; }
  }

  function coreDomain(host) {
    if (!host) return '';
    var parts = host.split('.');
    if (parts.length <= 2) return parts[0];
    var last2 = parts.slice(-2).join('.');
    if (/^(co|com|net|org|gov|edu|ac|io|or|ne)\.[a-z]{2}$/i.test(last2)) return parts.slice(0, -2).join('.');
    if (/(^|\.)(github\.io|vercel\.app|netlify\.app|pages\.dev|workers\.dev|glitch\.me|repl\.co|itch\.io|gitlab\.io)$/i.test('.' + last2)) {
      return parts.slice(0, -1).join('.');
    }
    return parts[parts.length - 2] || parts[0];
  }

  function fmtBytes(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var CURRENT_HOST = safeHost();
  var CORE = coreDomain(CURRENT_HOST);

  /* ---------------- proxy / redirect unwrapping ---------------- */
  var PROXY_PARAMS = ['url', 'u', 'src', 'source', 'target', 'dest', 'destination',
    'proxy', 'proxyurl', 'proxied', 'link', 'q', 'game', 'gameurl', 'embed',
    'embedurl', 'path', 'remote', 'site', 'host', 'data', 'goto'];

  var TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
    'utm_content', 'gclid', 'fbclid', 'msclkid', '_ga'];

  function stripTracking(u) {
    try {
      var url = new URL(u);
      for (var i = 0; i < TRACKING_PARAMS.length; i++) url.searchParams.delete(TRACKING_PARAMS[i]);
      url.hash = '';
      var s = url.toString();
      if (s.length > 1 && s.charAt(s.length - 1) === '/' && url.pathname !== '/') s = s.slice(0, -1);
      return s;
    } catch (e) { return u; }
  }

  function unwrapOnce(value) {
    if (typeof value !== 'string') return null;
    var s = value.trim();
    if (s.length < 4 || s.length > 4096) return null;
    if (/^https?:%2F%2F/i.test(s) || s.indexOf('%3A%2F%2F') > -1) {
      try {
        var dec = decodeURIComponent(s);
        if (/^https?:\/\//i.test(dec)) return dec;
      } catch (e) { }
    }
    var pathProxy = s.match(/\/(?:proxy|p|tunnel|service|fetch|gateway|scramble|uv|wisp|raw|embed)\/(.+)$/i);
    if (pathProxy && pathProxy[1].indexOf('.') > -1) {
      var rest = pathProxy[1];
      try {
        var decoded = decodeURIComponent(rest);
        if (/^https?:\/\//i.test(decoded)) return decoded;
      } catch (e) { }
      if (/^https?:\/\//i.test(rest)) return rest;
      if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#].*)?$/i.test(rest)) return 'https://' + rest;
    }
    if (/^[A-Za-z0-9+/\-_]{24,}={0,2}$/.test(s)) {
      try {
        var b64 = decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
        if (/^https?:\/\//i.test(b64)) return b64;
      } catch (e) { }
    }
    var qi = s.indexOf('?');
    if (qi > -1) {
      try {
        var qs = new URLSearchParams(s.slice(qi + 1));
        for (var i = 0; i < PROXY_PARAMS.length; i++) {
          var v = qs.get(PROXY_PARAMS[i]);
          if (v && (/^https?:\/\//i.test(v) || /^\/\//.test(v) || /^https?:%2F%2F/i.test(v))) return v;
        }
      } catch (e) { }
    }
    return null;
  }

  function unwrap(value) {
    if (!settings.unwrapProxies) return value;
    var out = value, guard = 0, next;
    while (guard++ < 4) {
      next = unwrapOnce(out);
      if (!next || next === out) break;
      out = next;
    }
    return out;
  }

  function resolveUrl(raw, base) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s || s.length > 4096) return null;
    if (/^(javascript:|mailto:|tel:|about:|data:|blob:about|view-source:)/i.test(s)) return null;
    if (/^(chrome|moz-|resource:)/i.test(s)) return null;
    if (s === 'null' || s === 'undefined' || s === '#') return null;
    try { return new URL(s, base || document.baseURI).href; } catch (e) { return null; }
  }

  /* ---------------- image + asset rejection ---------------- */
  // matched against pathname AND query, so `.png?v=2` and `?format=webp` both die
  var IMAGE_EXT = /\.(?:png|apng|jpe?g|jpe|jfif|pjpeg|pjp|webp|avif|avifs|gif|giff|bmp|dib|ico|cur|svgz?|tiff?|tif|heic|heif|avci|avcs|hif|jp2|j2k|jpf|jpx|jxl|wdp|hdp|jxr|psd|psb|ai|eps|tga|icns|raw|arw|cr2|cr3|nef|orf|rw2|dng|pef|srw|x3f|ppm|pgm|pbm|pnm|xcf|hdr|exr)(?:$|[?#&])/i;

  var IMAGE_QUERY = /(?:^|[?&#])(?:format|fm|ext|type|mime|output|out|img|image|thumb|thumbnail|icon|logo|cover|sprite|skin|render)=-?(?:png|jpe?g|jpg|webp|pjpg|gif|svg|svgz|avif|tiff?|heic|heif|bmp|auto)\b/i;

  var IMAGE_PATH_SEG = /(?:^|\/)(?:img|imgs|images?|pictures?|pics?|sprites?|textures?|icons?|artwork|art|thumbnails?|thumbs?|screenshots?|shots?|covers?|logos?|graphics?|gfx|skins?|avatars?|badges?|posters?|banners?|wallpapers?|media-images|asset-images)(?:\/|$)/i;

  var IMAGE_HOST = /(?:^|\.)(?:imgur|imageshack|cloudinary|imgix|fastly\.net|gravatar|placeholder|placehold|picsum|unsplash|shields\.io|badge|svgrepo|iconarchive|flaticon|icons8)\./i;

  var IMAGE_MIME = /^image\//i;

  var ASSET_EXT = /\.(?:css|scss|less|sass|styl|woff2?|ttf|otf|eot|mp4|m4v|webm|mov|avi|mkv|mp3|ogg|oga|wav|m4a|aac|flac|opus|vtt|srt|map|txt|xml|pdf|csv|tsv)(?:$|[?#&])/i;

  function imageVerdict(url, path, search, hintHits, hasGameExt) {
    var file = path + (search || '');
    if (IMAGE_EXT.test(file)) return 'extension';
    if (IMAGE_QUERY.test(search || '')) return 'query';
    if (!hintHits && !hasGameExt && IMAGE_PATH_SEG.test(path)) return 'image path';
    if (!hintHits && !hasGameExt && IMAGE_HOST.test(url.hostname)) return 'image host';
    return null;
  }

  /* ---------------- classification ---------------- */
  var PATH_HINTS = ['game', 'games', 'play', 'player', 'embed', 'iframe', 'rom', 'roms',
    'build', 'builds', 'demo', 'arcade', 'webgl', 'wasm', 'unity', 'unity3d', 'godot',
    'construct', 'gdevelop', 'ruffle', 'swf', 'emulator', 'emulatorjs', 'loader', 'engine',
    'level', 'world', 'release', 'runtime', 'client', 'stage', 'preview', 'v1', 'v2', 'v3', 'v4', 'g'];

  var GAME_EXT = {
    '.html': 30, '.htm': 30, '.xhtml': 30, '.php': 14, '.asp': 12, '.aspx': 12,
    '.unityweb': 34, '.wasm': 26, '.data': 22, '.pck': 24, '.bundle': 20, '.assets': 18,
    '.swf': 30, '.zip': 16, '.7z': 14, '.bin': 8, '.br': 8, '.gz': 8, '.json': 6
  };

  var PLATFORMS = [
    { name: 'CrazyGames', re: /crazygames\.com/i, score: 45 },
    { name: 'GameDistribution', re: /gamedistribution\.com/i, score: 45 },
    { name: 'GamePix', re: /gamepix\.com/i, score: 42 },
    { name: 'itch.io', re: /itch\.io|itch\.zone|hwcdn\.net/i, score: 42 },
    { name: 'Poki', re: /poki\.com|poki-?(?:cdn|game|img)|y8\.com/i, score: 42 },
    { name: 'Famobi', re: /famobi\.com/i, score: 42 },
    { name: 'EmulatorJS', re: /emulatorjs|ejs-?player/i, score: 44 },
    { name: 'HTML5 host', re: /html5games?|gamecdn|gamescdn|gameassets|webglgame/i, score: 30 },
    { name: 'Static host', re: /github\.io|gitlab\.io|vercel\.app|netlify\.app|pages\.dev|workers\.dev|glitch\.me|repl\.co|surge\.sh|firebaseapp\.com|web\.app|cloudfront\.net|amazonaws\.com|r2\.dev/i, score: 26 }
  ];

  var NOISE_RE = /(doubleclick|googlesyndication|googleadservices|adservice|adnxs|adsystem|adsrvr|amazon-adsystem|moatads|pubmatic|criteo|taboola|outbrain|scorecardresearch|quantserve|google-analytics|googletagmanager|\/analytics|telemetry|sentry(?:-cdn)?\.|hotjar|mixpanel|clarity\.ms|segment\.(?:io|com)|newrelic|nr-data|fullstory|logrocket|datadoghq|branch\.io|appsflyer|onesignal|pushwoosh|facebook\.(?:net|com)\/(?:tr|plugins)|connect\.facebook|platform\.(?:twitter|x|linkedin|instagram)\.|disqus|recaptcha|hcaptcha|turnstile|cloudflareinsights|challenges\.cloudflare|cookiebot|onetrust|osano|\/ads?\/|\/adserver\/|\/banners?\/|watermark|branding|\/tracking\/|\/beacon\/)/i;

  var AUTH_RE = /(consent|login|signin|signup|sign-up|register|account\/|auth0|okta|stripe\.com|paypal|checkout|mailchimp|hubspot|intercom|zendesk|crisp\.chat|maps\.google|docs\.google\.com|drive\.google\.com|apis\.google\.com|discord\.com\/api|t\.me\/|whatsapp\.com|youtube\.com\/watch|facebook\.com\/sharer|twitter\.com\/intent|x\.com\/intent|pinterest\.com|reddit\.com\/submit)/i;

  function hostTokens(host) {
    return String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  }

  /**
   * Returns { ok:true, score, tags, reasons } or { ok:false, why }
   * `reasons` drives the Quick Look breakdown.
   */
  function scoreCandidate(absolute, source, originalRaw) {
    var url;
    try { url = new URL(absolute); } catch (e) { return { ok: false, why: 'unparsable' }; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'blob:') {
      return { ok: false, why: 'scheme' };
    }

    var path = url.pathname.toLowerCase();
    var search = url.search.toLowerCase();
    var full = (url.host + path + search).toLowerCase();
    var tokens = path.split(/[^a-z0-9]+/).filter(Boolean);
    var extMatch = path.match(/\.[a-z0-9]{1,9}$/);
    var ext = extMatch ? extMatch[0] : '';
    var hasGameExt = !!(ext && GAME_EXT[ext]);
    var tags = [];
    var reasons = [];
    var score = 8;
    reasons.push({ d: 8, why: 'baseline' });

    // path hints come first: they can rescue a URL from image/asset rejection
    var hintHits = 0;
    for (var i = 0; i < tokens.length && hintHits < 4; i++) {
      if (PATH_HINTS.indexOf(tokens[i]) > -1) hintHits++;
    }
    if (hintHits) {
      var bump = Math.min(hintHits, 2) * 14;
      score += bump;
      tags.push('path');
      reasons.push({ d: bump, why: hintHits + ' path hint' + (hintHits > 1 ? 's' : '') });
    }

    // hard image + asset rejection
    if (settings.blockImages || settings.excludeAssets) {
      var img = settings.blockImages ? imageVerdict(url, path, search, hintHits, hasGameExt) : null;
      if (img) return { ok: false, why: 'image', detail: img };
      if (settings.excludeAssets && ASSET_EXT.test(path + search) && !hasGameExt && !hintHits) {
        return { ok: false, why: 'asset' };
      }
    }

    if (hasGameExt) {
      score += GAME_EXT[ext];
      tags.push('file' + ext);
      reasons.push({ d: GAME_EXT[ext], why: ext + ' game file' });
    }

    for (var p = 0; p < PLATFORMS.length; p++) {
      if (PLATFORMS[p].re.test(full)) {
        score += PLATFORMS[p].score;
        tags.push(PLATFORMS[p].name);
        reasons.push({ d: PLATFORMS[p].score, why: PLATFORMS[p].name + ' host' });
        break;
      }
    }

    var ht = hostTokens(url.hostname);
    if (settings.boostCdn && (ht.indexOf('cdn') > -1 || ht.indexOf('assets') > -1 ||
      ht.indexOf('storage') > -1 || ht.indexOf('static') > -1 || ht.indexOf('files') > -1 ||
      ht.indexOf('media') > -1 ||
      /cloudfront|azureedge|fastly|akamai|cloudflare|storage\.googleapis|blob\.core|s3[.-]|r2\.dev|hwcdn/.test(url.hostname))) {
      score += 20; tags.push('cdn');
      reasons.push({ d: 20, why: 'cdn / object storage' });
    }

    if (settings.boostSameDomain && CORE && CORE.length > 2) {
      if (url.hostname === CURRENT_HOST) {
        score += 22; tags.push('same-host');
        reasons.push({ d: 22, why: 'same host as page' });
      } else if (url.hostname.toLowerCase().indexOf(CORE.toLowerCase()) > -1) {
        score += 16; tags.push('same-domain');
        reasons.push({ d: 16, why: 'same registrable domain' });
      }
    }

    var SRC_WEIGHT = {
      'live-iframe': [46, 'assigned to iframe.src at runtime'],
      'live-fetch': [34, 'seen on a live fetch()'],
      'live-xhr': [34, 'seen on a live XHR'],
      'global': [32, 'exposed in a window global'],
      'iframe': [26, 'present in an iframe'],
      'embed': [24, 'present in an embed/object'],
      'srcdoc': [20, 'found inside a srcdoc frame'],
      'json': [18, 'found in a JSON payload'],
      'network': [16, 'seen in resource timing'],
      'script': [12, 'found in an inline script'],
      'storage': [10, 'found in web storage'],
      'attr': [8, 'found in a DOM attribute'],
      'link': [4, 'found in a hyperlink'],
      'deep': [22, 'confirmed by deep scan'],
      'dom': [6, 'found in inserted markup']
    };
    var w = SRC_WEIGHT[source];
    if (w) {
      score += w[0];
      reasons.push({ d: w[0], why: w[1] });
      if (w[0] >= 22) tags.push('runtime');
      else if (source === 'deep') tags.push('deep');
    }

    if (NOISE_RE.test(full)) {
      tags.push('ad/tracker');
      if (!hasGameExt) return { ok: false, why: 'noise' };
      reasons.push({ d: 0, why: 'matched a tracker pattern but kept (game file)' });
    }
    if (AUTH_RE.test(full)) return { ok: false, why: 'auth' };

    if (url.pathname === '/' || url.pathname === '') {
      score -= 70; tags.push('root');
      reasons.push({ d: -70, why: 'site root' });
    }
    if (absolute === location.href) {
      score -= 40; tags.push('self');
      reasons.push({ d: -40, why: 'the current document' });
    }
    if (!ext && url.pathname.split('/').filter(Boolean).length <= 1) {
      score -= 26; tags.push('nav');
      reasons.push({ d: -26, why: 'shallow navigation path' });
    }
    if ((ext === '.js' || ext === '.mjs') && !hintHits) {
      score -= 60; tags.push('plain-js');
      reasons.push({ d: -60, why: 'plain script bundle' });
    }
    if (ext === '.json' && !hintHits) {
      score -= 45; tags.push('plain-json');
      reasons.push({ d: -45, why: 'unlabelled JSON' });
    }
    if (url.search.length > 400) { score -= 10; reasons.push({ d: -10, why: 'very long query' }); }
    if (url.protocol === 'blob:') {
      score += 10; tags.push('blob');
      reasons.push({ d: 10, why: 'in-memory blob' });
    }
    if (settings.unwrapProxies && originalRaw && unwrap(originalRaw) !== originalRaw) {
      score += 12; tags.push('unwrapped');
      reasons.push({ d: 12, why: 'recovered from a proxy wrapper' });
    }

    if (settings.strict && !hintHits && !hasGameExt && url.protocol !== 'blob:') {
      return { ok: false, why: 'strict' };
    }

    return { ok: true, score: score, tags: tags, reasons: reasons };
  }

  /* ---------------- result store ---------------- */
  var items = [];
  var seen = {};
  var stars = {};
  var order = 0;
  var status = 'idle';
  var MAX_ITEMS = 500;

  try { stars = JSON.parse(localStorage.getItem('gex:stars') || '{}') || {}; } catch (e) { stars = {}; }

  function saveStars() {
    try { localStorage.setItem('gex:stars', JSON.stringify(stars)); } catch (e) { }
  }

  function keyOf(u) {
    try {
      var url = new URL(u);
      var q = url.searchParams;
      ['v', 'ver', 'cb', 'cachebust', 'ts', 't', '_', 'r'].forEach(function (p) { q.delete(p); });
      var qs = q.toString();
      return url.host + url.pathname.replace(/\/+$/, '') + (qs ? '?' + qs : '');
    } catch (e) { return u; }
  }

  function pathKeyOf(u) {
    try { return new URL(u).pathname.replace(/\/+$/, '').toLowerCase(); } catch (e) { return u; }
  }

  function reindex() {
    for (var i = 0; i < items.length; i++) seen[keyOf(items[i].url)] = i;
  }

  function addCandidate(raw, source) {
    if (raw == null) return;
    stats.seen++;
    if (items.length >= MAX_ITEMS && seen[keyOf(String(raw))] === undefined) { stats.other++; return; }

    var unwrapped = unwrap(String(raw));
    var absolute = resolveUrl(unwrapped);
    if (!absolute) { stats.other++; return; }

    var key = keyOf(absolute);
    var at = seen[key];
    if (at !== undefined) {
      var ex = items[at];
      if (ex && ex.source !== source) {
        var better = scoreCandidate(ex.url, source, raw);
        if (better.ok && better.score > ex.score) {
          ex.source = source;
          ex.score = better.score;
          ex.tags = better.tags;
          ex.reasons = better.reasons;
          ex.hits++;
          scheduleRender();
        }
      }
      return;
    }

    var v = scoreCandidate(absolute, source, String(raw));
    if (!v.ok) {
      if (v.why === 'image') stats.image++;
      else if (v.why === 'noise') stats.noise++;
      else if (v.why === 'auth') stats.auth++;
      else stats.other++;
      return;
    }
    if (v.score < settings.minScore) { stats.low++; return; }

    seen[key] = items.length;
    items.push({
      id: ++order,
      url: stripTracking(absolute),
      raw: String(raw).slice(0, 300),
      source: source,
      score: v.score,
      tags: v.tags,
      reasons: v.reasons,
      hits: 1,
      bytes: 0,
      mime: '',
      starred: !!stars[key]
    });
    sortItems();
    reindex();
    stats.kept++;
    scheduleRender();
  }

  function sortItems() {
    items.sort(function (a, b) {
      if (!!b.starred !== !!a.starred) return a.starred ? -1 : 1;
      return b.score - a.score || b.id - a.id;
    });
  }

  function dropItem(url) {
    var out = [];
    for (var i = 0; i < items.length; i++) if (items[i].url !== url) out.push(items[i]);
    items = out;
    seen = {};
    reindex();
    scheduleRender();
  }

  var probing = 0;

  function probeSize(item, done) {
    if (!/^https?:/.test(item.url) || item.probing) { if (done) done(); return; }
    item.probing = true;
    probing++;
    fetch(item.url, { method: 'HEAD', mode: 'cors', redirect: 'follow' }).then(function (r) {
      item.bytes = parseInt(r.headers.get('content-length') || '0', 10) || 0;
      item.mime = r.headers.get('content-type') || '';
      item.ok = r.ok;
      item.probing = false;
      probing--;
      if (settings.autoDropImageMime && IMAGE_MIME.test(item.mime)) {
        stats.image++;
        dropItem(item.url);
      } else {
        scheduleRender();
      }
      if (done) done();
    }).catch(function () {
      item.probing = false;
      probing--;
      item.mime = 'unreachable';
      scheduleRender();
      if (done) done();
    });
  }
  function scanDocument(doc, base, source) {
    var b = base || (doc && doc.baseURI) || document.baseURI;
    var src = source || null;

    var frameSel = [['iframe', 'iframe'], ['frame', 'iframe'], ['embed', 'embed'],
      ['object', 'embed'], ['video', 'media'], ['audio', 'media'], ['source', 'media'], ['track', 'media']];
    for (var f = 0; f < frameSel.length; f++) {
      try {
        var list = doc.querySelectorAll(frameSel[f][0]);
        for (var i = 0; i < list.length; i++) {
          var el = list[i];
          var val = frameSel[f][0] === 'object' ? el.getAttribute('data') : el.getAttribute('src');
          if (val) addCandidate(val, src || frameSel[f][1]);
        }
      } catch (e) { }
    }

    try {
      var sd = doc.querySelectorAll('iframe[srcdoc]');
      for (var s = 0; s < sd.length; s++) {
        var html = sd[s].getAttribute('srcdoc') || '';
        if (html && html.length < 600000) {
          var parsed = new DOMParser().parseFromString(html, 'text/html');
          var bl = parsed.createElement('base');
          bl.setAttribute('href', b);
          (parsed.head || parsed.documentElement).appendChild(bl);
          scanDocument(parsed, b, src || 'srcdoc');
        }
      }
    } catch (e) { }

    try {
      var anchors = doc.querySelectorAll('a[href]');
      for (var a = 0; a < anchors.length; a++) addCandidate(anchors[a].getAttribute('href'), src || 'link');
    } catch (e) { }

    try {
      var res = doc.querySelectorAll('script[src], link[href]');
      for (var r = 0; r < res.length; r++) {
        var node = res[r];
        var href = node.getAttribute('src') || node.getAttribute('href') || '';
        if (!href) continue;
        if (node.tagName === 'LINK') {
          var rel = (node.getAttribute('rel') || '').toLowerCase();
          if (!/preload|prefetch|modulepreload|alternate|import/.test(rel)) continue;
        }
        addCandidate(href, src || 'script');
      }
    } catch (e) { }

    try {
      var INTERESTING = /^(data-(?:src|url|game|iframe|link|href|embed|config|build|path|swf|rom|file)|src|href|data|content|value|flashvars)$/i;
      var all = doc.querySelectorAll('*');
      var cap = Math.min(all.length, 6000);
      for (var n = 0; n < cap; n++) {
        var node2 = all[n];
        if (!node2.attributes) continue;
        for (var j = 0; j < node2.attributes.length; j++) {
          var at = node2.attributes[j];
          if (!INTERESTING.test(at.name)) continue;
          var v = at.value;
          if (!v || v.length < 4 || v.length > 2000) continue;
          if (/^(#|javascript:|mailto:|\{|%7B|\[\{)/i.test(v.trim())) continue;
          addCandidate(v, src || 'attr');
        }
      }
    } catch (e) { }

    collectFromInlineScripts(doc, src);
  }

  function collectFromInlineScripts(doc, src) {
    try {
      var scripts = doc.querySelectorAll('script:not([src])');
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        var text = (s.textContent || '').trim();
        if (!text || text.length > 900000) continue;
        var type = (s.getAttribute('type') || '').toLowerCase();

        if (type.indexOf('json') > -1 || /^\s*[\[{]/.test(text)) {
          try {
            var hits = [];
            walkJson(JSON.parse(text), hits, 0);
            for (var h = 0; h < hits.length; h++) addCandidate(hits[h], src || 'json');
          } catch (e) { }
        }

        var cfgs = text.match(/(?:window\.)?[A-Za-z_$][\w$]{2,40}\s*=\s*\{[\s\S]{0,3000}?\}\s*[;,]/g) || [];
        for (var c = 0; c < cfgs.length && c < 60; c++) {
          var body = cfgs[c].slice(cfgs[c].indexOf('{'));
          try {
            var obj = JSON.parse(body
              .replace(/([{,]\s*)'([^']+?)'\s*:/g, '$1"$2":')
              .replace(/:\s*'([^']*?)'/g, ': "$1"')
              .replace(/,(\s*[}\]])/g, '$1')
              .replace(/\/\*[\s\S]*?\*\//g, ''));
            var hits2 = [];
            walkJson(obj, hits2, 0);
            for (var h2 = 0; h2 < hits2.length; h2++) addCandidate(hits2[h2], src || 'json');
          } catch (e) { }
        }

        var abs = text.match(/https?:\/\/[^\s"'`<>()\\]+/gi) || [];
        for (var x = 0; x < abs.length; x++) addCandidate(abs[x].replace(/[.,;)\]}'"]+$/, ''), src || 'script');

        var rel = text.match(/["'`](\/[A-Za-z0-9_.\-/]{3,120}\.(?:html?|swf|wasm|unityweb|data|pck|zip|json))(?:[?#][^"'`)]*)?["'`)]/gi) || [];
        for (var y = 0; y < rel.length; y++) addCandidate(rel[y].replace(/^["'`(]|["'`)]$/g, ''), src || 'script');
      }
    } catch (e) { }
  }

  function walkJson(node, out, depth) {
    if (depth > 7 || out.length > 300 || !node) return;
    if (typeof node === 'string') {
      if (node.length > 4 && node.length < 2000 &&
        (/^https?:\/\//i.test(node) || /^\/\//.test(node) ||
          /^\/[\w.\-/]+\.(?:html?|swf|wasm|unityweb|data|pck|zip)$/i.test(node))) out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) walkJson(node[i], out, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      var v = node[k];
      if (typeof v === 'string' && /url|src|href|game|embed|build|link|path|target|file/i.test(k)) {
        if (v.length > 4 && v.length < 2000) out.push(v);
      } else {
        walkJson(v, out, depth + 1);
      }
    }
  }

  var GLOBAL_KEYS = ['gameUrl', 'gameURL', 'gGameUrl', 'EJS_gameUrl', 'EJS_core', 'EJS_gameID',
    'EJS_pathtodata', 'EJS_startOnLoaded', 'EJS_options', 'EJS_defaultOptions', 'EJS_Buttons',
    'gameSrc', 'gamePath', 'embedUrl', 'embedURL', 'iframeUrl', 'iframeSrc', 'uGameUrl',
    'gameConfig', 'gameOptions', 'gameSettings', 'arcadeUrl', 'buildUrl', 'bundleUrl',
    'loaderUrl', 'contentUrl', 'playUrl', 'swfUrl', 'romUrl', 'fileUrl', 'gameId',
    '__uv$config', '__scramble$config', '__dynamic$config'];

  function scanGlobals() {
    var checked = 0;
    function tryKey(key) {
      if (checked++ > 700) return;
      var val;
      try { val = window[key]; } catch (e) { return; }
      if (!val) return;
      if (typeof val === 'string') { addCandidate(val, 'global'); return; }
      if (typeof val === 'object') {
        var hits = [];
        try { walkJson(val, hits, 0); } catch (e) { return; }
        for (var i = 0; i < hits.length && i < 40; i++) addCandidate(hits[i], 'global');
      }
    }
    for (var i = 0; i < GLOBAL_KEYS.length; i++) tryKey(GLOBAL_KEYS[i]);
    try {
      var keys = Object.getOwnPropertyNames(window);
      for (var k = 0; k < keys.length; k++) {
        if (/game|embed|iframe|rom|swf|wasm|build|arcade|loader|bundle|unity|godot|ejs/i.test(keys[k])) tryKey(keys[k]);
      }
    } catch (e) { }
  }

  function scanStorage() {
    var stores = [function () { return window.localStorage; }, function () { return window.sessionStorage; }];
    for (var s = 0; s < stores.length; s++) {
      try {
        var box = stores[s]();
        if (!box) continue;
        for (var i = 0; i < box.length && i < 200; i++) {
          var v = String(box.getItem(box.key(i)) || '');
          if (v.length > 4000) continue;
          var m = v.match(/https?:\/\/[^\s"'<>]+|\/[\w.\-]{3,120}\.(?:html?|swf|wasm|unityweb|zip|data|pck)/gi) || [];
          for (var j = 0; j < m.length; j++) addCandidate(m[j], 'storage');
        }
      } catch (e) { }
    }
  }

  function scanMeta() {
    try {
      var nodes = document.querySelectorAll('meta[content], base[href]');
      for (var i = 0; i < nodes.length; i++) {
        var v = nodes[i].getAttribute('content') || nodes[i].getAttribute('href') || '';
        if (v && v.length > 7 && v.length < 2000) addCandidate(v, 'attr');
      }
      var ld = document.querySelectorAll('script[type="application/ld+json"]');
      for (var j = 0; j < ld.length; j++) {
        try {
          var hits = [];
          walkJson(JSON.parse(ld[j].textContent || '{}'), hits, 0);
          for (var h = 0; h < hits.length; h++) addCandidate(hits[h], 'json');
        } catch (e) { }
      }
    } catch (e) { }
  }

  function scanShadow(root, depth) {
    if (depth > 4) return;
    var all;
    try { all = root.querySelectorAll('*'); } catch (e) { return; }
    var cap = Math.min(all.length, 3000);
    for (var i = 0; i < cap; i++) {
      var el = all[i];
      var sr = el.shadowRoot;
      if (!sr) continue;
      scanShadow(sr, depth + 1);
      try {
        var found = sr.querySelectorAll('iframe,embed,object,a[href],script[src]');
        for (var f = 0; f < found.length; f++) {
          var n = found[f];
          addCandidate(n.getAttribute('src') || n.getAttribute('data') || n.getAttribute('href'), 'attr');
        }
      } catch (e) { }
    }
  }

  var lastAutoScan = 0;
  var fullScanTimer = null;

  function scanAll(label) {
    status = 'scanning';
    render();
    var t0 = Date.now();
    try { scanDocument(document, document.baseURI); } catch (e) { }
    try { scanGlobals(); } catch (e) { }
    try { scanStorage(); } catch (e) { }
    try { scanMeta(); } catch (e) { }
    try { scanShadow(document, 0); } catch (e) { }
    status = 'done';
    log('scan "' + (label || 'manual') + '" → ' + items.length + ' kept of ' + fmtNum(stats.seen) +
      ' in ' + (Date.now() - t0) + 'ms');
    scheduleRender();
  }

  function scheduleFullScan() {
    if (fullScanTimer) return;
    var since = Date.now() - lastAutoScan;
    fullScanTimer = setTimeout(function () {
      fullScanTimer = null;
      lastAutoScan = Date.now();
      scanAll('auto');
    }, Math.max(150, 1500 - since));
  }

  /* ---------------- deep scan: fetch + recursively re-scan ---------------- */
  var deepScanning = false;

  function deepScan(count, btn) {
    if (deepScanning) return;
    var targets = filtered().slice(0, count || 6).filter(function (i) { return /^https?:/.test(i.url); });
    if (!targets.length) { toast('Nothing to deep-scan yet'); return; }

    deepScanning = true;
    var before = items.length;
    var label = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = ICONS.dna + 'Scanning 0/' + targets.length;

    var done = 0;
    targets.forEach(function (t) {
      fetchThroughProxy(t.url).then(function (body) {
        if (body && body.length > 80 && /<[a-z!]/i.test(body)) {
          try {
            var doc = new DOMParser().parseFromString(body, 'text/html');
            var bl = doc.createElement('base');
            bl.setAttribute('href', t.url);
            (doc.head || doc.documentElement).appendChild(bl);
            scanDocument(doc, t.url, 'deep');
          } catch (e) { }
        }
      }).catch(function () { }).then(function () {
        done++;
        if (btn) btn.innerHTML = ICONS.dna + 'Scanning ' + done + '/' + targets.length;
        if (done === targets.length) {
          deepScanning = false;
          if (btn) { btn.innerHTML = label; }
          var gained = items.length - before;
          toast(gained > 0 ? 'Deep scan found ' + gained + ' more' : 'Deep scan: nothing new');
          render();
        }
      });
    });
  }
  /* ---------------- live capture ---------------- */
  var restoreHooks = [];

  function installHooks() {
    if (!settings.liveCapture) return;

    try {
      var of = window.fetch;
      if (typeof of === 'function') {
        window.fetch = function (input) {
          try {
            var u = typeof input === 'string' ? input : (input && input.url);
            if (u) addCandidate(u, 'live-fetch');
          } catch (e) { }
          return of.apply(this, arguments);
        };
        restoreHooks.push(function () { window.fetch = of; });
      }
    } catch (e) { }

    try {
      var oo = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { if (url) addCandidate(url, 'live-xhr'); } catch (e) { }
        return oo.apply(this, arguments);
      };
      restoreHooks.push(function () { XMLHttpRequest.prototype.open = oo; });
    } catch (e) { }

    try {
      var desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
      if (desc && desc.set && desc.configurable) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
          configurable: true,
          enumerable: desc.enumerable,
          get: function () { return desc.get.call(this); },
          set: function (v) {
            try { if (v) addCandidate(v, 'live-iframe'); } catch (e) { }
            desc.set.call(this, v);
          }
        });
        restoreHooks.push(function () { Object.defineProperty(HTMLIFrameElement.prototype, 'src', desc); });
      }
    } catch (e) { }

    try {
      var po = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var it = entries[i].initiatorType;
          if (it === 'fetch' || it === 'xmlhttprequest' || it === 'iframe' || it === 'other') {
            addCandidate(entries[i].name, 'network');
          }
        }
      });
      try { po.observe({ type: 'resource', buffered: true }); }
      catch (e1) { po.observe({ entryTypes: ['resource'] }); }
      restoreHooks.push(function () { try { po.disconnect(); } catch (e) { } });
    } catch (e) { }
  }

  function removeHooks() {
    for (var i = 0; i < restoreHooks.length; i++) { try { restoreHooks[i](); } catch (e) { } }
    restoreHooks = [];
  }

  var mo = null;

  function installObserver() {
    if (!('MutationObserver' in window)) return;
    mo = new MutationObserver(function (muts) {
      var nodes = [];
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'attributes') { nodes.push(m.target); continue; }
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n && n.nodeType === 1 && !insidePanel(n)) nodes.push(n);
        }
      }
      if (!nodes.length) return;
      for (var k = 0; k < nodes.length; k++) {
        var el = nodes[k];
        try {
          if (el.matches && el.matches('iframe,embed,object,a[href],script[src]')) {
            addCandidate(el.getAttribute('src') || el.getAttribute('data') || el.getAttribute('href'),
              el.tagName === 'IFRAME' ? 'iframe' : el.tagName === 'A' ? 'link' : 'dom');
          }
          if (el.querySelectorAll) {
            var fr = el.querySelectorAll('iframe,embed,object');
            for (var q = 0; q < fr.length; q++) {
              addCandidate(fr[q].getAttribute('src') || fr[q].getAttribute('data'),
                fr[q].tagName === 'IFRAME' ? 'iframe' : 'embed');
            }
            var an = el.querySelectorAll('a[href]');
            for (var w = 0; w < an.length; w++) addCandidate(an[w].getAttribute('href'), 'link');
          }
        } catch (e) { }
      }
      scheduleFullScan();
    });
    mo.observe(document.documentElement || document, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'data', 'href', 'srcdoc', 'data-url', 'data-src']
    });
  }

  function insidePanel(n) {
    var rootEl = document.getElementById(ROOT_ID);
    return !!(rootEl && (rootEl === n || rootEl.contains(n)));
  }
  /* ---------------- UI ---------------- */
  var state = {
    min: false, query: '', filter: 'all', showAll: false,
    sel: -1, ql: null, density: 'cozy', checking: 0
  };
  var POS_KEY = 'gex:pos';

  var CSS = [
    '@keyframes gexSheet{from{opacity:0;transform:translateX(-50%) translateY(-14px) scale(.975)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}',
    '@keyframes gexPulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(48,209,88,.4)}50%{opacity:.45;box-shadow:0 0 0 4px rgba(48,209,88,0)}}',
    '@keyframes gexSpin{to{transform:rotate(360deg)}}',
    '@keyframes gexIn{from{opacity:0;transform:translate(-50%,5px)}to{opacity:1;transform:translate(-50%,0)}}',
    '#' + ROOT_ID + '{position:fixed;top:16px;left:50%;transform:translateX(-50%);width:min(95vw,700px);z-index:2147483000;',
    'color:#f5f5f7;font:400 13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Inter,system-ui,sans-serif;',
    '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;letter-spacing:-.011em;',
    'font-variant-numeric:tabular-nums;box-sizing:border-box;',
    'background:rgba(28,28,30,.72);backdrop-filter:blur(42px) saturate(190%);-webkit-backdrop-filter:blur(42px) saturate(190%);',
    'border:1px solid rgba(255,255,255,.1);border-radius:18px;',
    'box-shadow:0 1px 0 rgba(255,255,255,.07) inset,0 0 0 .5px rgba(0,0,0,.55),0 24px 70px -14px rgba(0,0,0,.8),0 60px 120px -30px rgba(0,0,0,.6);',
    'animation:gexSheet .42s cubic-bezier(.32,.72,0,1);}',
    '#' + ROOT_ID + '.gex-compact{width:min(95vw,560px)}',
    '#' + ROOT_ID + ' *{box-sizing:border-box;font-family:inherit;margin:0;padding:0;min-width:0}',
    '#' + ROOT_ID + ' button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '#' + ROOT_ID + ' svg{display:block;flex:none}',
    '#' + ROOT_ID + ' ::selection{background:rgba(10,132,255,.4)}',
    '#' + ROOT_ID + ' button:focus-visible,#' + ROOT_ID + ' input:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(10,132,255,.42)}',

    '#gex-min{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:10px 15px 10px 12px;',
    'border-radius:999px;background:rgba(28,28,30,.78);backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%);',
    'border:1px solid rgba(255,255,255,.12);color:#c7c7cc;font:500 12px/1 -apple-system,system-ui,sans-serif;letter-spacing:-.01em;',
    'box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 10px 30px rgba(0,0,0,.55);transition:transform .2s cubic-bezier(.32,.72,0,1),border-color .2s,color .2s}',
    '#gex-min:hover{color:#fff;border-color:rgba(255,255,255,.24);transform:translateY(-1px)}',
    '#gex-min:active{transform:scale(.97)}',
    '#gex-min .dot{width:7px;height:7px;border-radius:50%;background:#30d158;box-shadow:0 0 0 3px rgba(48,209,88,.2)}',
    '#gex-min b{color:#fff;font-weight:600}',

    '.gex-head{display:flex;align-items:center;gap:9px;padding:12px 13px 11px 15px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;',
    'border-bottom:1px solid rgba(255,255,255,.075)}',
    '.gex-head.grabbing{cursor:grabbing}',
    '.gex-grip{color:rgba(255,255,255,.15);display:flex}',
    '.gex-mark{width:27px;height:27px;border-radius:8px;display:grid;place-items:center;color:#fff;flex:none;',
    'background:linear-gradient(155deg,#3aa0ff,#5e5ce6 52%,#bf5af2);',
    'box-shadow:0 1px 1px rgba(255,255,255,.28) inset,0 4px 14px rgba(94,92,230,.42)}',
    '.gex-title{font-size:13.5px;font-weight:600;letter-spacing:-.022em;color:#fff}',
    '.gex-v{font-size:10px;color:rgba(255,255,255,.42);border:1px solid rgba(255,255,255,.1);padding:2px 7px;border-radius:999px;font-weight:500}',
    '.gex-live{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:#30d158;font-weight:500}',
    '.gex-live i{width:6px;height:6px;border-radius:50%;background:#30d158;animation:gexPulse 2s ease-in-out infinite}',
    '.gex-live.paused{color:#ff9f0a}.gex-live.paused i{background:#ff9f0a;animation:none}',

    '.gex-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:6px 11px;border-radius:9px;font-size:11.5px;font-weight:500;',
    'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);color:#e4e4e9;',
    'transition:background .15s,color .15s,transform .12s,border-color .15s;white-space:nowrap;flex:none;letter-spacing:-.005em}',
    '.gex-btn:hover{background:rgba(255,255,255,.14);color:#fff;border-color:rgba(255,255,255,.17)}',
    '.gex-btn:active{transform:scale(.96)}',
    '.gex-btn.ghost{background:transparent;border-color:transparent;color:rgba(255,255,255,.45)}',
    '.gex-btn.ghost:hover{color:#fff;background:rgba(255,255,255,.09)}',
    '.gex-btn.primary{background:linear-gradient(180deg,#34a0ff,#0a7cf0);border-color:rgba(255,255,255,.16);color:#fff;',
    'box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 2px 9px rgba(10,124,240,.4)}',
    '.gex-btn.primary:hover{background:linear-gradient(180deg,#48acff,#1184f7)}',
    '.gex-btn.on{background:rgba(10,132,255,.2);border-color:rgba(10,132,255,.42);color:#84c1ff}',
    '.gex-btn.icon{padding:6px;width:27px;height:27px;border-radius:8px}',
    '.gex-btn[disabled]{opacity:.4;pointer-events:none}',
    '.gex-spin{animation:gexSpin .8s linear infinite}',

    '.gex-tool{padding:11px 13px 0;display:flex;flex-direction:column;gap:9px}',
    '.gex-row{display:flex;gap:7px;align-items:center}',
    '.gex-field{flex:1;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.06);',
    'border:1px solid rgba(255,255,255,.085);border-radius:10px;padding:7px 11px;color:rgba(255,255,255,.4);',
    'transition:border-color .18s,background .18s,box-shadow .18s;min-width:0}',
    '.gex-field:focus-within{border-color:rgba(10,132,255,.6);background:rgba(10,132,255,.1);box-shadow:0 0 0 3px rgba(10,132,255,.16)}',
    '.gex-field input{flex:1;background:none;border:0;outline:none;color:#fff;font-size:12.5px;min-width:0;letter-spacing:-.005em}',
    '.gex-field input::placeholder{color:rgba(255,255,255,.32)}',
    '.gex-field kbd{font:600 9.5px ui-monospace,monospace;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.09);',
    'border-radius:4px;padding:1px 4px;color:rgba(255,255,255,.4)}',

    '.gex-seg{display:flex;gap:1px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.07);padding:2px;border-radius:9px;overflow-x:auto;scrollbar-width:none}',
    '.gex-seg::-webkit-scrollbar{display:none}',
    '.gex-tab{padding:4px 10px;border-radius:7px;font-size:11px;font-weight:500;color:rgba(255,255,255,.45);',
    'transition:all .16s;white-space:nowrap;flex:none;letter-spacing:-.005em}',
    '.gex-tab:hover{color:rgba(255,255,255,.8)}',
    '.gex-tab.on{background:rgba(255,255,255,.13);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.32)}',

    '.gex-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px 8px;font-size:10.5px;',
    'color:rgba(255,255,255,.34);letter-spacing:0}',
    '.gex-meta b{color:rgba(255,255,255,.82);font-weight:600}',
    '.gex-ledger{display:flex;gap:9px;flex-wrap:wrap}',
    '.gex-ledger span{display:inline-flex;align-items:center;gap:4px}',
    '.gex-ledger u{text-decoration:none;color:rgba(255,255,255,.55);font-weight:600}',

    '.gex-body{max-height:min(52vh,420px);overflow-y:auto;overflow-x:hidden;padding:1px 9px 7px 13px;',
    'scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}',
    '.gex-body::-webkit-scrollbar{width:9px}',
    '.gex-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:99px;border:2.5px solid transparent;background-clip:content-box}',
    '.gex-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.3);background-clip:content-box}',

    '.gex-card{position:relative;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.035);border-radius:13px;',
    'padding:10px 12px;margin-bottom:7px;transition:border-color .16s,background .16s,transform .16s}',
    '.gex-card:hover{border-color:rgba(255,255,255,.15);background:rgba(255,255,255,.06)}',
    '.gex-card.sel{border-color:rgba(10,132,255,.55);background:rgba(10,132,255,.1)}',
    '.gex-card.top{border-color:rgba(48,209,88,.34);background:linear-gradient(180deg,rgba(48,209,88,.1),rgba(255,255,255,.035))}',
    '.gex-card.top.sel{border-color:rgba(48,209,88,.6)}',
    '.gex-card.starred{border-left:2px solid rgba(255,214,10,.65)}',
    '.gex-topline{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap}',
    '.gex-rank{font-size:9.5px;font-weight:700;color:rgba(255,255,255,.28);width:15px;flex:none;font-variant-numeric:tabular-nums}',
    '.gex-pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:600;padding:2.5px 7px;border-radius:999px;letter-spacing:.018em}',
    '.gex-pill.best{background:rgba(48,209,88,.17);color:#54d969;border:1px solid rgba(48,209,88,.32)}',
    '.gex-pill.src{background:rgba(10,132,255,.15);color:#84c1ff;border:1px solid rgba(10,132,255,.24);',
    'text-transform:uppercase;letter-spacing:.075em;font-size:8.5px}',
    '.gex-pill.dim{background:rgba(255,255,255,.06);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.075)}',
    '.gex-pill.star{background:rgba(255,214,10,.16);color:#ffd60a;border:1px solid rgba(255,214,10,.3)}',
    '.gex-pill.warn{background:rgba(255,159,10,.14);color:#ffb340;border:1px solid rgba(255,159,10,.28)}',
    '.gex-score{margin-left:auto;font-size:11px;font-weight:700;color:rgba(255,255,255,.4);font-variant-numeric:tabular-nums;',
    'letter-spacing:-.02em}',

    '.gex-url{font:400 10.5px/1.55 ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;color:rgba(255,255,255,.5);',
    'word-break:break-all;cursor:text}',
    '.gex-url b{color:rgba(255,255,255,.92);font-weight:500}',

    '.gex-actions{display:flex;gap:5px;margin-top:9px;flex-wrap:wrap;align-items:center}',
    '.gex-mini{display:inline-flex;align-items:center;gap:4px;padding:4.5px 8.5px;border-radius:8px;font-size:10px;font-weight:500;',
    'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.72);',
    'transition:all .14s;letter-spacing:-.005em}',
    '.gex-mini:hover{background:rgba(255,255,255,.14);color:#fff}',
    '.gex-mini:active{transform:scale(.95)}',
    '.gex-mini.go{background:linear-gradient(180deg,#34a0ff,#0a7cf0);color:#fff;border-color:rgba(255,255,255,.16);',
    'box-shadow:0 1px 6px rgba(10,124,240,.34)}',
    '.gex-mini.go:hover{filter:brightness(1.1)}',
    '.gex-mini.on{background:rgba(10,132,255,.2);border-color:rgba(10,132,255,.42);color:#84c1ff}',
    '.gex-mini.starred{background:rgba(255,214,10,.14);border-color:rgba(255,214,10,.3);color:#ffd60a}',

    '.gex-bar{height:2px;border-radius:2px;background:rgba(255,255,255,.07);margin-top:8px;overflow:hidden}',
    '.gex-bar i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#0a84ff,#5e5ce6);transition:width .4s cubic-bezier(.32,.72,0,1)}',

    // Quick Look drawer
    '.gex-ql{margin-top:9px;border-top:1px solid rgba(255,255,255,.08);padding-top:9px;animation:gexIn .24s cubic-bezier(.32,.72,0,1)}',
    '.gex-ql-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px;margin-bottom:9px}',
    '.gex-kv{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:6px 8px;overflow:hidden}',
    '.gex-kv u{display:block;text-decoration:none;font-size:8.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;',
    'color:rgba(255,255,255,.32);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.gex-kv b{font:500 10.5px ui-monospace,Menlo,monospace;color:rgba(255,255,255,.86);word-break:break-all}',
    '.gex-why{border:1px solid rgba(255,255,255,.06);border-radius:9px;overflow:hidden}',
    '.gex-why-h{padding:6px 9px;font-size:8.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;',
    'color:rgba(255,255,255,.34);background:rgba(255,255,255,.035)}',
    '.gex-why-r{display:flex;align-items:center;gap:8px;padding:4px 9px;font-size:10.5px;color:rgba(255,255,255,.6);',
    'border-top:1px solid rgba(255,255,255,.045)}',
    '.gex-why-r u{text-decoration:none;font:700 10px ui-monospace,monospace;min-width:32px;text-align:right;font-variant-numeric:tabular-nums}',
    '.gex-why-r .pos{color:#54d969}.gex-why-r .neg{color:#ff8a80}.gex-why-r .zero{color:rgba(255,255,255,.3)}',
    '.gex-preview{margin-top:9px;border:1px solid rgba(255,255,255,.09);border-radius:10px;overflow:hidden;background:#000;',
    'position:relative;aspect-ratio:16/9}',
    '.gex-preview iframe{width:100%;height:100%;border:0;display:block}',

    '.gex-mirrors{margin-top:8px;border:1px solid rgba(255,255,255,.07);border-radius:9px;overflow:hidden}',
    '.gex-mirror{display:flex;gap:7px;align-items:center;padding:5px 9px;border-top:1px solid rgba(255,255,255,.045);',
    'font:400 10px ui-monospace,Menlo,monospace;color:rgba(255,255,255,.45)}',
    '.gex-mirror:first-child{border-top:0}',

    '.gex-foot{display:flex;align-items:center;gap:8px;padding:9px 14px;border-top:1px solid rgba(255,255,255,.075);flex-wrap:wrap}',
    '.gex-hint{font-size:10px;color:rgba(255,255,255,.28);display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
    '.gex-hint kbd{font:600 9.5px ui-monospace,monospace;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);',
    'border-radius:4px;padding:1px 4.5px;color:rgba(255,255,255,.5)}',

    '.gex-empty{border:1px dashed rgba(255,255,255,.13);border-radius:13px;padding:24px 18px;text-align:center;',
    'color:rgba(255,255,255,.4);font-size:11.5px;line-height:1.65}',
    '.gex-empty b{display:block;color:rgba(255,255,255,.85);font-weight:600;font-size:12.5px;margin-bottom:4px;letter-spacing:-.015em}',

    '.gex-set{padding:0 13px 12px}',
    '.gex-panel{border:1px solid rgba(255,255,255,.085);background:rgba(255,255,255,.032);border-radius:14px;padding:12px 13px;',
    'animation:gexIn .22s cubic-bezier(.32,.72,0,1)}',
    '.gex-set h4{font-size:9.5px;font-weight:600;letter-spacing:.085em;text-transform:uppercase;color:rgba(255,255,255,.34);margin-bottom:7px}',
    '.gex-opt{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:6px 0}',
    '.gex-opt+.gex-opt{border-top:1px solid rgba(255,255,255,.05)}',
    '.gex-opt .lbl{font-size:12px;color:rgba(255,255,255,.86)}',
    '.gex-opt .sub{display:block;font-size:10px;color:rgba(255,255,255,.36);margin-top:2px;font-weight:400}',
    '.gex-sw{position:relative;width:37px;height:22px;flex:none;border-radius:999px;background:rgba(255,255,255,.14);',
    'border:1px solid rgba(255,255,255,.08);transition:background .22s cubic-bezier(.32,.72,0,1);cursor:pointer}',
    '.gex-sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;',
    'box-shadow:0 1px 3px rgba(0,0,0,.4),0 0 0 .5px rgba(0,0,0,.08);transition:transform .22s cubic-bezier(.32,.72,0,1)}',
    '.gex-sw.on{background:#30d158;border-color:rgba(48,209,88,.5)}',
    '.gex-sw.on i{transform:translateX(15px)}',
    '.gex-num{display:flex;align-items:center;gap:9px}',
    '.gex-num input[type=range]{-webkit-appearance:none;appearance:none;width:112px;height:3px;border-radius:3px;',
    'background:rgba(255,255,255,.18);outline:none}',
    '.gex-num input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;',
    'background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5),0 0 0 .5px rgba(0,0,0,.1);cursor:pointer}',
    '.gex-num input[type=range]::-moz-range-thumb{width:15px;height:15px;border:0;border-radius:50%;background:#fff;cursor:pointer}',
    '.gex-num output{font:600 10.5px ui-monospace,monospace;color:#fff;min-width:22px;text-align:right}',

    '.gex-toast{position:absolute;left:50%;bottom:52px;transform:translateX(-50%);',
    'background:rgba(56,56,58,.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);',
    'color:#fff;font-size:11px;font-weight:500;padding:8px 15px;border-radius:999px;white-space:nowrap;',
    'border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 26px rgba(0,0,0,.5);',
    'pointer-events:none;animation:gexIn .2s cubic-bezier(.32,.72,0,1);z-index:4;letter-spacing:-.005em}',

    '.gex-menu{position:absolute;right:12px;top:44px;z-index:5;min-width:178px;padding:5px;border-radius:12px;',
    'background:rgba(44,44,46,.94);backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%);',
    'border:1px solid rgba(255,255,255,.12);box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 18px 44px rgba(0,0,0,.6);',
    'animation:gexIn .18s cubic-bezier(.32,.72,0,1)}',
    '.gex-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:6.5px 9px;border-radius:8px;',
    'font-size:12px;color:rgba(255,255,255,.86);text-align:left;transition:background .12s}',
    '.gex-menu button:hover{background:rgba(10,132,255,.85);color:#fff}',
    '.gex-menu .sep{height:1px;background:rgba(255,255,255,.08);margin:4px 6px}',
    '.gex-menu .hd{padding:5px 9px 3px;font-size:8.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;',
    'color:rgba(255,255,255,.32)}',

    '.gex-more{width:100%;padding:9px;margin:1px 0 6px;border-radius:10px;background:rgba(255,255,255,.05);',
    'border:1px dashed rgba(255,255,255,.13);color:rgba(255,255,255,.6);font-size:11px;font-weight:500;transition:all .15s}',
    '.gex-more:hover{background:rgba(255,255,255,.1);color:#fff}'
  ].join('\n');

  var ICONS = {
    logo: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M6.5 11.5h3.5M8.25 9.75v3.5"/><circle cx="15.5" cy="10.75" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5V4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6"/></svg>',
    open: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 12 4l9 4.5-9 4.5z"/><path d="M3 8.5v7L12 20l9-4.5v-7"/><path d="M12 13v7"/></svg>',
    code: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l-5 6 5 6M15 6l5 6-5 6"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15.5 15.5 3l5.5 5.5L8.5 21z"/><path d="M7 12l2 2M10.5 8.5l2 2M14 5l2 2"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M12 2.5l2.3 6.8 6.7 2.4-6.7 2.4L12 21l-2.3-6.9L3 11.7l6.7-2.4z"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    dna: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3c0 6 14 6 14 12"/><path d="M19 3c0 6-14 6-14 12"/><path d="M5 21c0-2 14-2 14 0"/><path d="M8 6.5h8M8 17.5h8"/></svg>',
    pulse: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12L16 12h5"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M7.5 10L12 14.5 16.5 10"/><path d="M4 20h16"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3.5"/><path d="M8 7l4-3.5L16 7"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 4.5v5h-5"/><path d="M20.2 14a8.2 8.2 0 1 1-1.3-6.4l1.6-1.7"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5.5l11 6.5-11 6.5z"/></svg>',
    drag: '<svg viewBox="0 0 10 16" width="10" height="14" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>',
    rows: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg>',
    term: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l4 4-4 4"/><path d="M12 16h7"/></svg>'
  };
  var SOURCE_LABEL = {
    'live-iframe': 'runtime', 'live-fetch': 'runtime', 'live-xhr': 'runtime',
    'iframe': 'iframe', 'embed': 'embed', 'media': 'media', 'link': 'link',
    'script': 'script', 'json': 'json', 'attr': 'attr', 'storage': 'storage',
    'network': 'network', 'global': 'global', 'dom': 'dom', 'srcdoc': 'srcdoc', 'deep': 'deep'
  };

  var SWITCHES = [
    ['blockImages', 'Block image files', 'svg png jpg jpeg webp tiff heic avif gif + image paths'],
    ['excludeAssets', 'Block other assets', 'css fonts video audio maps'],
    ['autoDropImageMime', 'Drop by content-type', 'Remove any candidate serving image/*'],
    ['strict', 'Strict mode', 'Only obvious game endpoints'],
    ['boostSameDomain', 'Boost same-domain', "The page's own host wins ties"],
    ['boostCdn', 'Boost CDNs & buckets', 'cdn. / storage / S3 / R2 / CloudFront'],
    ['unwrapProxies', 'Unwrap proxies', 'Decode ?url=, base64, %3A%2F%2F'],
    ['liveCapture', 'Live capture', 'Hook fetch, XHR and iframe.src']
  ];

  function log(msg) { try { console.debug('%c[GameExtractor] ' + msg, 'color:#0a84ff'); } catch (e) { } }

  function toast(msg) {
    var host = document.getElementById(ROOT_ID);
    if (!host) return;
    var old = host.querySelector('.gex-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.className = 'gex-toast';
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1900);
  }

  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  function highlightUrl(u) {
    var safe = esc(u);
    var at = safe.indexOf('//');
    if (at < 0) return safe;
    var slash = safe.indexOf('/', at + 2);
    if (slash < 0) return '<b>' + safe + '</b>';
    return '<b>' + safe.slice(0, slash) + '</b>' + safe.slice(slash);
  }

  function filtered() {
    var q = state.query.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (state.filter === 'starred' && !it.starred) continue;
      if (state.filter !== 'all' && state.filter !== 'starred' && it.source !== state.filter) continue;
      if (q && (it.url + ' ' + it.source + ' ' + it.tags.join(' ')).toLowerCase().indexOf(q) === -1) continue;
      out.push(it);
    }
    return out;
  }

  function mirrorsOf(item) {
    var pk = pathKeyOf(item.url);
    if (!pk || pk === '/') return [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].url !== item.url && pathKeyOf(items[i].url) === pk) out.push(items[i].url);
    }
    return out;
  }

  function reasonRow(r) {
    var cls = r.d > 0 ? 'pos' : r.d < 0 ? 'neg' : 'zero';
    var sign = r.d > 0 ? '+' : '';
    return '<div class="gex-why-r"><u class="' + cls + '">' + sign + r.d + '</u><span>' + esc(r.why) + '</span></div>';
  }

  function quickLookHtml(it) {
    var mirrors = mirrorsOf(it);
    var kvs = '<div class="gex-kv"><u>host</u><b>' + esc(hostOf(it.url) || '—') + '</b></div>' +
      '<div class="gex-kv"><u>type</u><b>' + esc(it.mime || 'unknown') + '</b></div>' +
      '<div class="gex-kv"><u>size</u><b>' + esc(it.bytes ? fmtBytes(it.bytes) : '—') + '</b></div>' +
      '<div class="gex-kv"><u>status</u><b>' + esc(it.ok === true ? 'reachable' : it.ok === false ? 'failed' : 'unchecked') + '</b></div>' +
      '<div class="gex-kv"><u>seen</u><b>' + it.hits + '×</b></div>' +
      '<div class="gex-kv"><u>via</u><b>' + esc(SOURCE_LABEL[it.source] || it.source) + '</b></div>';

    var why = '<div class="gex-why"><div class="gex-why-h">Score breakdown · ' + it.score + '</div>';
    for (var i = 0; i < it.reasons.length; i++) why += reasonRow(it.reasons[i]);
    why += '</div>';

    var mir = mirrors.length
      ? '<div class="gex-mirrors"><div class="gex-why-h">' + mirrors.length + ' mirror' + (mirrors.length > 1 ? 's' : '') + ' · same path</div>' +
        mirrors.slice(0, 4).map(function (m) { return '<div class="gex-mirror"><span style="opacity:.5">↳</span>' + esc(m) + '</div>'; }).join('') +
        '</div>'
      : '';

    return '<div class="gex-ql">' + '<div class="gex-ql-grid">' + kvs + '</div>' + why + mir +
      '<button class="gex-mini" data-act="preview" data-url="' + esc(it.url) + '">' + ICONS.play + 'Load live preview</button>' +
      '<div data-preview></div></div>';
  }

  function rowHtml(it, i) {
    var isSel = state.sel === i;
    var isTop = i === 0;
    var pills = '';
    if (it.starred) pills += '<span class="gex-pill star">' + ICONS.starFill + 'PINNED</span>';
    if (isTop && !it.starred) pills += '<span class="gex-pill best">' + ICONS.spark + 'TOP MATCH</span>';
    pills += '<span class="gex-pill src">' + esc(SOURCE_LABEL[it.source] || it.source) + '</span>';
    for (var t = 0; t < it.tags.length && t < 3; t++) {
      if (it.tags[t] === 'runtime') continue;
      pills += '<span class="gex-pill dim">' + esc(it.tags[t]) + '</span>';
    }
    if (it.mime && IMAGE_MIME.test(it.mime)) pills += '<span class="gex-pill warn">image mime</span>';
    else if (it.bytes) pills += '<span class="gex-pill dim">' + esc(fmtBytes(it.bytes)) + '</span>';
    var mir = mirrorsOf(it).length;
    if (mir) pills += '<span class="gex-pill dim">' + ICONS.dna + '×' + (mir + 1) + ' mirrors</span>';

    var u = esc(it.url);
    return '<div class="gex-card' + (isTop ? ' top' : '') + (isSel ? ' sel' : '') + (it.starred ? ' starred' : '') + '">' +
      '<div class="gex-topline"><span class="gex-rank">' + (i + 1) + '</span>' + pills +
      '<span class="gex-score">' + it.score + '</span></div>' +
      '<div class="gex-url">' + highlightUrl(it.url) + '</div>' +
      '<div class="gex-actions">' +
      '<button class="gex-mini go" data-act="open" data-url="' + u + '">' + ICONS.open + 'Open</button>' +
      '<button class="gex-mini" data-act="sandbox" data-url="' + u + '">' + ICONS.box + 'Sandbox</button>' +
      '<button class="gex-mini' + (isSel ? ' on' : '') + '" data-act="ql" data-url="' + u + '">' + ICONS.eye + 'Inspect</button>' +
      '<button class="gex-mini" data-act="copymenu" data-url="' + u + '">' + ICONS.copy + 'Copy ▾</button>' +
      '<button class="gex-mini" data-act="harvest" data-url="' + u + '">' + ICONS.code + 'Harvest</button>' +
      '<button class="gex-mini" data-act="probe" data-url="' + u + '">' + ICONS.ruler + 'Size</button>' +
      '<button class="gex-mini' + (it.starred ? ' starred' : '') + '" data-act="star" data-url="' + u + '">' +
      (it.starred ? ICONS.starFill : ICONS.star) + '</button>' +
      '<button class="gex-mini" data-act="drop" data-url="' + u + '" title="Dismiss this candidate">' + ICONS.x + '</button>' +
      '</div>' +
      (state.ql === it.url ? quickLookHtml(it) : '') +
      '<div class="gex-bar"><i style="width:' + clamp(it.score, 3, 100) + '%"></i></div>' +
      '</div>';
  }

  function listHtml() {
    var list = filtered();
    if (!list.length) {
      var head = items.length ? (state.query ? 'No matches' : 'Nothing pinned') : 'Listening…';
      var body = items.length
        ? 'Try clearing the filter, or pick another source tab.'
        : 'No playable build detected yet.<br>Click “Play”, scroll, or open a level — captures stream in live from fetch, XHR, iframe.src and DOM mutations.';
      return '<div class="gex-empty"><b>' + head + '</b>' + body + '</div>';
    }
    var cap = state.showAll ? list.length : Math.min(list.length, 25);
    var html = '';
    for (var i = 0; i < cap; i++) html += rowHtml(list[i], i);
    if (cap < list.length) html += '<button class="gex-more" data-act="more">Show ' + (list.length - cap) + ' more…</button>';
    return html;
  }

  function tabsHtml() {
    var counts = {};
    for (var i = 0; i < items.length; i++) counts[items[i].source] = (counts[items[i].source] || 0) + 1;
    var starred = 0;
    for (var s = 0; s < items.length; s++) if (items[s].starred) starred++;
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 4);
    function tab(id, label, n) {
      return '<button class="gex-tab' + (state.filter === id ? ' on' : '') + '" data-act="filter" data-filter="' + id + '">' +
        esc(label) + ' <span style="opacity:.55">' + n + '</span></button>';
    }
    var html = tab('all', 'All', items.length);
    if (starred) html += tab('starred', '★', starred);
    for (var k = 0; k < keys.length; k++) html += tab(keys[k], SOURCE_LABEL[keys[k]] || keys[k], counts[keys[k]]);
    return '<div class="gex-seg">' + html + '</div>';
  }

  function ledgerHtml() {
    var bits = [];
    if (stats.seen) {
      bits.push('<span><u>' + fmtNum(stats.seen) + '</u> seen</span>');
      bits.push('<span><u>' + fmtNum(stats.kept) + '</u> kept</span>');
      if (stats.image) bits.push('<span><u>' + fmtNum(stats.image) + '</u> images</span>');
      if (stats.noise) bits.push('<span><u>' + fmtNum(stats.noise) + '</u> trackers</span>');
      if (stats.auth) bits.push('<span><u>' + fmtNum(stats.auth) + '</u> auth</span>');
      if (stats.low) bits.push('<span><u>' + fmtNum(stats.low) + '</u> low score</span>');
    }
    if (probing) bits.push('<span style="color:#84c1ff"><u>' + probing + '</u> checking</span>');
    return bits.join('');
  }

  function settingsHtml() {
    var rows = '';
    for (var i = 0; i < SWITCHES.length; i++) {
      var s = SWITCHES[i];
      rows += '<div class="gex-opt"><span class="lbl">' + s[1] + '<span class="sub">' + s[2] + '</span></span>' +
        '<div class="gex-sw' + (settings[s[0]] ? ' on' : '') + '" data-act="opt" data-key="' + s[0] +
        '" role="switch" aria-checked="' + !!settings[s[0]] + '" tabindex="0"><i></i></div></div>';
    }
    return '<div class="gex-set"><div class="gex-panel"><h4>Filters</h4>' + rows +
      '<div class="gex-opt"><span class="lbl">Minimum score<span class="sub">Lower = noisier</span></span>' +
      '<div class="gex-num"><input type="range" min="-20" max="90" step="5" value="' + settings.minScore +
      '" data-act="range" aria-label="Minimum score"><output>' + settings.minScore + '</output></div></div>' +
      '<div class="gex-row" style="margin-top:9px">' +
      '<button class="gex-btn" style="flex:1" data-act="rescan">' + ICONS.refresh + 'Re-scan page</button>' +
      '<button class="gex-btn" style="flex:1" data-act="deep">' + ICONS.dna + 'Deep scan top 6</button>' +
      '<button class="gex-btn ghost" data-act="reset">Defaults</button>' +
      '</div>' +
      '<div class="gex-row" style="margin-top:7px">' +
      '<button class="gex-btn" style="flex:1" data-act="health">' + ICONS.pulse + 'Check all sizes</button>' +
      '<button class="gex-btn" data-act="density" title="Toggle density">' + ICONS.rows + state.density + '</button>' +
      '</div></div></div>';
  }

  function shellHtml() {
    return '<div class="gex-head" data-handle>' +
      '<span class="gex-grip">' + ICONS.drag + '</span>' +
      '<span class="gex-mark">' + ICONS.logo + '</span>' +
      '<span class="gex-title">Game Extractor</span>' +
      '<span class="gex-v">v' + VERSION.split('.').slice(0, 2).join('.') + '</span>' +
      '<span class="gex-live"><i></i><span data-status>idle</span></span>' +
      '<span style="margin-left:auto;display:flex;gap:3px;align-items:center">' +
      '<button class="gex-btn ghost icon" data-act="live" title="Pause / resume live capture">' + ICONS.pause + '</button>' +
      '<button class="gex-btn ghost icon" data-act="settings" title="Filters">' + ICONS.gear + '</button>' +
      '<button class="gex-btn ghost icon" data-act="min" title="Minimise (Esc)">' + ICONS.minus + '</button>' +
      '<button class="gex-btn ghost icon" data-act="close" title="Dismiss">' + ICONS.x + '</button>' +
      '</span></div>' +

      '<div class="gex-tool"><div class="gex-row">' +
      '<label class="gex-field">' + ICONS.search +
      '<input type="text" data-query placeholder="Filter by url, source or tag…" spellcheck="false" aria-label="Filter results">' +
      '<kbd>/</kbd></label>' +
      '<button class="gex-btn" data-act="share">' + ICONS.share + 'Export</button>' +
      '<button class="gex-btn" data-act="copyall">' + ICONS.copy + 'Copy all</button>' +
      '</div>' +
      '<div class="gex-row"><div data-tabs style="flex:1">' + tabsHtml() + '</div></div></div>' +

      '<div class="gex-meta"><span>host <b>' + esc(CURRENT_HOST || 'sandbox') + '</b>' +
      '<span class="gex-ledger" data-ledger style="margin-left:10px">' + ledgerHtml() + '</span></span>' +
      '<span><b data-count>' + items.length + '</b> shown · floor <b>' + settings.minScore + '</b></span></div>' +

      '<div class="gex-body" data-body>' + listHtml() + '</div>' +
      '<div data-settings data-open="0"></div>' +
      '<div class="gex-menu" data-menu style="display:none"></div>' +

      '<div class="gex-foot"><span class="gex-hint"><kbd>↑↓</kbd> select <kbd>Space</kbd> inspect <kbd>↵</kbd> open ' +
      '<kbd>⌘C</kbd> copy <kbd>/</kbd> search</span>' +
      '<span style="margin-left:auto;font-size:10px;color:rgba(255,255,255,.28)">authorised sites only</span></div>';
  }

  function render() {
    var host = document.getElementById(ROOT_ID);
    if (!host) return;
    var list = filtered();
    var set = function (sel, val) { var el = host.querySelector(sel); if (el) el.textContent = val; };
    set('[data-count]', String(list.length));
    var body = host.querySelector('[data-body]');
    if (body) body.innerHTML = listHtml();
    var tabs = host.querySelector('[data-tabs]');
    if (tabs) tabs.innerHTML = tabsHtml();
    var led = host.querySelector('[data-ledger]');
    if (led) led.innerHTML = ledgerHtml();
    var st = host.querySelector('[data-status]');
    if (st) {
      var live = settings.liveCapture;
      st.textContent = status === 'scanning' ? 'scanning…' : live ? (items.length ? 'watching' : 'listening') : 'paused';
      var wrap = st.parentNode;
      if (wrap) wrap.className = 'gex-live' + (live ? '' : ' paused');
    }
    var liveBtn = host.querySelector('[data-act="live"]');
    if (liveBtn) liveBtn.innerHTML = settings.liveCapture ? ICONS.pause : ICONS.play;
    host.classList.toggle('gex-compact', state.density === 'compact');
  }
  var bubble = null;

  function buildBubble() {
    bubble = document.createElement('button');
    bubble.id = 'gex-min';
    bubble.type = 'button';
    bubble.title = 'Restore Game Extractor (Alt+G)';
    bubble.addEventListener('click', function (e) { e.preventDefault(); setMinimised(false); });
    document.documentElement.appendChild(bubble);
    bubble.style.display = 'none';
    updateBubble();
  }

  function updateBubble() {
    if (!bubble) return;
    bubble.innerHTML = '<span class="dot"></span>Extractor <b>' + items.length + '</b>';
  }

  function setMinimised(min) {
    state.min = min;
    var host = document.getElementById(ROOT_ID);
    if (host) host.style.display = min ? 'none' : '';
    if (!bubble) buildBubble();
    bubble.style.display = min ? 'flex' : 'none';
    updateBubble();
  }

  function restorePos(host) {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        var w = host.offsetWidth || 700;
        host.style.left = clamp(p.x, -w + 90, Math.max(90, window.innerWidth - 90)) + 'px';
        host.style.top = clamp(p.y, 4, Math.max(4, window.innerHeight - 60)) + 'px';
        host.style.transform = 'none';
        return true;
      }
    } catch (e) { }
    return false;
  }

  function savePos(host) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        x: parseFloat(host.style.left) || host.offsetLeft,
        y: parseFloat(host.style.top) || host.offsetTop
      }));
    } catch (e) { }
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    var style = document.createElement('style');
    style.id = 'gex-style';
    style.textContent = CSS;
    document.documentElement.appendChild(style);

    var host = document.createElement('div');
    host.id = ROOT_ID;
    host.innerHTML = shellHtml();
    document.documentElement.appendChild(host);

    restorePos(host);
    wire(host);
    installObserver();
    installHooks();
    render();
  }

  function wire(host) {
    var handle = host.querySelector('[data-handle]');
    var dragging = false, dx = 0, dy = 0;

    function down(e) {
      if (e.target.closest && e.target.closest('button')) return;
      dragging = true;
      handle.classList.add('grabbing');
      var r = host.getBoundingClientRect();
      dx = (e.clientX || 0) - r.left;
      dy = (e.clientY || 0) - r.top;
      host.style.left = r.left + 'px';
      host.style.top = r.top + 'px';
      host.style.transform = 'none';
      try { if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      var w = host.offsetWidth;
      host.style.left = clamp((e.clientX || 0) - dx, -w + 90, window.innerWidth - 90) + 'px';
      host.style.top = clamp((e.clientY || 0) - dy, 4, window.innerHeight - 44) + 'px';
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('grabbing');
      savePos(host);
    }
    handle.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    host.addEventListener('pointerdown', function () { interactingUntil = Date.now() + 460; });
    host.addEventListener('click', onClick);
    host.addEventListener('input', onInput);
    host.addEventListener('keydown', onFieldKey);
    document.addEventListener('click', closeMenus);
  }

  /* ---------------- clipboard + exports ---------------- */
  function copyText(text, msg) {
    var done = function () { toast(msg || 'Copied'); };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
        return;
      }
    } catch (e) { }
    fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.documentElement.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.documentElement.removeChild(ta);
      if (ok) done(); else toast('Copy blocked');
    } catch (e) { toast('Copy blocked'); }
  }

  function asCurl(u) {
    return "curl -L -o '" + (u.split('/').pop() || 'game') + "' '" + u + "'";
  }

  function asEmbed(u) {
    return '<iframe src="' + u + '" style="width:100%;height:100%;border:0" ' +
      'allow="autoplay; fullscreen; gamepad *" allowfullscreen></iframe>';
  }

  function asMarkdown(list) {
    return list.map(function (i) { return '- [' + hostOf(i.url) + '](' + i.url + ') — ' + i.score + ' · ' + i.source; }).join('\n');
  }

  function asCsv(list) {
    var rows = ['url,source,score,hits,bytes,mime'];
    function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      rows.push([q(it.url), q(it.source), it.score, it.hits, it.bytes || '', q(it.mime || '')].join(','));
    }
    return rows.join('\n');
  }

  function asReport(list) {
    return JSON.stringify({
      generator: 'Game Extractor ' + VERSION,
      host: CURRENT_HOST,
      page: location.href,
      capturedAt: new Date().toISOString(),
      settings: settings,
      stats: stats,
      results: list.map(function (i) {
        return {
          url: i.url, source: i.source, score: i.score, tags: i.tags,
          reasons: i.reasons, hits: i.hits,
          bytes: i.bytes || undefined, mime: i.mime || undefined
        };
      })
    }, null, 2);
  }

  function openUrl(u) {
    var w = null;
    try { w = window.open(u, '_blank'); } catch (e) { }
    try { if (w) w.opener = null; } catch (e) { }
    if (!w) { try { location.href = u; } catch (e) { } }
  }

  function openSandbox(u) {
    var w = null;
    try { w = window.open('about:blank', '_blank'); } catch (e) { }
    if (!w) { toast('Popup blocked — allow popups'); return; }
    try { w.opener = null; } catch (e) { }
    var doc = w.document;
    doc.open();
    doc.write('<!doctype html><html style="height:100%"><head><meta charset="utf-8"><title>Sandbox · ' +
      esc(hostOf(u)) + '</title><style>html,body{margin:0;height:100%;background:#08080a;overflow:hidden}' +
      'iframe{display:block;width:100%;height:100%;border:0}' +
      '#b{position:fixed;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#0a84ff,#bf5af2);z-index:9}' +
      '</style></head><body><div id="b"></div><iframe src="' + esc(u) +
      '" allow="autoplay; fullscreen; gamepad *; xr-spatial-tracking; accelerometer; gyroscope; clipboard-write" ' +
      'allowfullscreen></iframe></body></html>');
    doc.close();
    toast('Sandbox opened');
  }

  var PROXIES = [
    function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
    function (u) { return 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u); },
    function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); },
    function (u) { return 'https://api.allorigins.win/get?url=' + encodeURIComponent(u); }
  ];

  function fetchThroughProxy(u) {
    var attempt = 0;
    function run() {
      if (attempt >= PROXIES.length) return Promise.reject(new Error('no proxy worked'));
      var target = PROXIES[attempt++](u);
      return fetch(target, { redirect: 'follow' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.text();
      }).then(function (body) {
        if (body && body.charAt(0) === '{' && body.indexOf('"contents"') > -1) {
          try {
            var parsed = JSON.parse(body);
            if (parsed && typeof parsed.contents === 'string') return parsed.contents;
          } catch (e) { }
        }
        return body;
      }).catch(function () { return run(); });
    }
    return Promise.race([
      run(),
      new Promise(function (_r, rej) { setTimeout(function () { rej(new Error('timeout')); }, 15000); })
    ]);
  }

  function stripAds(html) {
    return String(html)
      .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:googletagmanager|google-analytics|googlesyndication|doubleclick|adservice|hotjar|mixpanel|sentry|analytics|telemetry|pubmatic|criteo|taboola|onesignal)[^"']*["'][^>]*>\s*<\/script>/gi, '')
      .replace(/<(?:div|aside|section|a|span)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:ad-?banner|advert|ads-?wrap|promo|watermark|cookie|consent|gdpr|newsletter|subscribe|social-?bar|discord-?banner|site-?notice)[^"']*["'][^>]*>[\s\S]{0,4000}?<\/(?:div|aside|section|a|span)>/gi, '')
      .replace(/<[^>]+>\s*(?:hey\s*[!,.]?\s*)?check\s+out[^<]{0,120}<\/(?:a|div|p|span)>/gi, '')
      .replace(/<[^>]+>\s*join\s+(?:our\s+)?(?:the\s+)?discord[^<]{0,80}<\/(?:a|div|p|span)>/gi, '')
      .replace(/<[^>]+>\s*play\s+more\s+free\s+games[^<]{0,80}<\/(?:a|div|p|span)>/gi, '');
  }

  function harvest(u, btn) {
    var label = btn.innerHTML;
    btn.innerHTML = 'Harvesting…';
    fetchThroughProxy(u).then(function (body) {
      if (!body || body.length < 60) throw new Error('empty');
      var html = body;
      if (!/<base\s/i.test(html)) {
        html = /<head[^>]*>/i.test(html)
          ? html.replace(/<head([^>]*)>/i, '<head$1><base href="' + esc(u) + '">')
          : '<base href="' + esc(u) + '">' + html;
      }
      if (!/<meta\s+charset/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
      html = stripAds(html);
      html = html.replace(/<\/head>/i, '<style>html,body{margin:0;min-height:100%}canvas{display:block;max-width:100%}</style></head>');
      download(html, 'game-' + (hostOf(u) || 'build') + '.html', 'text/html;charset=utf-8');
      btn.innerHTML = ICONS.code + 'Saved ✓';
      toast('Standalone HTML saved');
    }).catch(function () {
      var shell = '<!doctype html><html style="height:100%"><head><meta charset="utf-8"><title>' +
        esc(hostOf(u) || 'Game') + '</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}' +
        'iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe src="' + esc(u) +
        '" allow="autoplay; fullscreen; gamepad *" allowfullscreen></iframe></body></html>';
      download(shell, 'game-' + (hostOf(u) || 'build') + '-shell.html', 'text/html;charset=utf-8');
      btn.innerHTML = ICONS.code + 'Shell ✓';
      toast('Source blocked — saved an iframe shell');
    }).then(function () {
      setTimeout(function () { btn.innerHTML = label; }, 1700);
    });
  }

  function download(text, name, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.documentElement.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 4000);
    } catch (e) { toast('Download blocked'); }
  }

  function findItem(url) {
    for (var i = 0; i < items.length; i++) if (items[i].url === url) return items[i];
    return null;
  }

  function showMenu(anchor, entries) {
    var host = document.getElementById(ROOT_ID);
    if (!host) return;
    var menu = host.querySelector('[data-menu]');
    if (!menu) return;
    var html = '';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e === '-') { html += '<div class="sep"></div>'; continue; }
      if (e.hd) { html += '<div class="hd">' + esc(e.hd) + '</div>'; continue; }
      html += '<button data-act="' + e.act + '" data-url="' + esc(e.url || '') + '" data-extra="' + esc(e.extra || '') + '">' +
        (e.icon || '') + esc(e.label) + '</button>';
    }
    menu.innerHTML = html;
    menu.style.display = 'block';
    menu.setAttribute('data-open', '1');
  }

  function closeMenus() {
    var host = document.getElementById(ROOT_ID);
    if (!host) return;
    var menu = host.querySelector('[data-menu]');
    if (menu && menu.getAttribute('data-open') === '1') {
      menu.style.display = 'none';
      menu.setAttribute('data-open', '0');
    }
  }

  function healthCheck() {
    var list = filtered().filter(function (i) { return /^https?:/.test(i.url) && !i.probing; });
    if (!list.length) { toast('Nothing to check'); return; }
    toast('Checking ' + list.length + '…');
    var active = 0, idx = 0;
    function next() {
      while (active < 4 && idx < list.length) {
        active++;
        probeSize(list[idx++], function () { active--; next(); });
      }
    }
    next();
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    e.stopPropagation();
    var act = btn.getAttribute('data-act');
    var url = btn.getAttribute('data-url');
    var extra = btn.getAttribute('data-extra');
    var host = document.getElementById(ROOT_ID);
    if (!host) return;
    var list = filtered();
    var sel = findItem(url);

    if (act === 'close') { teardown(); return; }
    if (act === 'min') { setMinimised(true); return; }

    if (act === 'live') {
      settings.liveCapture = !settings.liveCapture;
      store();
      if (settings.liveCapture) { installHooks(); toast('Live capture on'); }
      else { removeHooks(); toast('Live capture paused'); }
      render();
      return;
    }

    if (act === 'settings') {
      var wrap = host.querySelector('[data-settings]');
      if (!wrap) return;
      var opening = wrap.getAttribute('data-open') !== '1';
      wrap.setAttribute('data-open', opening ? '1' : '0');
      wrap.innerHTML = opening ? settingsHtml() : '';
      return;
    }

    if (act === 'opt') {
      var key = btn.getAttribute('data-key');
      settings[key] = !settings[key];
      btn.classList.toggle('on', settings[key]);
      btn.setAttribute('aria-checked', String(settings[key]));
      store();
      resetResults();
      scanAll('filters');
      return;
    }

    if (act === 'density') {
      state.density = state.density === 'compact' ? 'cozy' : 'compact';
      try { localStorage.setItem('gex:density', state.density); } catch (er) { }
      render();
      return;
    }

    if (act === 'rescan') { resetResults(); scanAll('manual'); toast('Re-scanned'); return; }
    if (act === 'deep') { deepScan(6, btn); return; }
    if (act === 'health') { healthCheck(); return; }

    if (act === 'reset') {
      settings = clone(DEFAULTS);
      store();
      var w2 = host.querySelector('[data-settings]');
      if (w2) w2.innerHTML = settingsHtml();
      resetResults();
      scanAll('reset');
      return;
    }

    if (act === 'filter') {
      state.filter = btn.getAttribute('data-filter') || 'all';
      state.showAll = false;
      state.sel = -1;
      render();
      return;
    }

    if (act === 'more') { state.showAll = true; render(); return; }

    if (act === 'copyall') {
      if (!list.length) { toast('Nothing to copy'); return; }
      copyText(list.map(function (i) { return i.url; }).join('\n'), list.length + ' URLs copied');
      return;
    }

    if (act === 'share') {
      showMenu(btn, [
        { hd: 'Export ' + list.length + ' shown' },
        { act: 'exp-json', label: 'JSON report', icon: ICONS.download },
        { act: 'exp-csv', label: 'CSV spreadsheet', icon: ICONS.download },
        { act: 'exp-md', label: 'Markdown list', icon: ICONS.download },
        { act: 'exp-txt', label: 'Plain URLs (.txt)', icon: ICONS.download },
        '-',
        { hd: 'Clipboard' },
        { act: 'cp-markdown', label: 'Copy as Markdown', icon: ICONS.copy },
        { act: 'cp-embed', label: 'Copy top as <iframe>', icon: ICONS.copy },
        { act: 'cp-curl', label: 'Copy top as cURL', icon: ICONS.term }
      ]);
      return;
    }

    if (act === 'copymenu') {
      showMenu(btn, [
        { hd: 'Copy' },
        { act: 'cp-url', url: url, label: 'URL', icon: ICONS.copy },
        { act: 'cp-embed-one', url: url, label: '<iframe> embed', icon: ICONS.code },
        { act: 'cp-curl-one', url: url, label: 'cURL command', icon: ICONS.term },
        { act: 'cp-md-one', url: url, label: 'Markdown link', icon: ICONS.copy }
      ]);
      return;
    }

    if (act === 'exp-json') { download(asReport(list), (CORE || 'page') + '-report.json', 'application/json'); toast('JSON exported'); return; }
    if (act === 'exp-csv') { download(asCsv(list), (CORE || 'page') + '-results.csv', 'text/csv'); toast('CSV exported'); return; }
    if (act === 'exp-md') { download(asMarkdown(list), (CORE || 'page') + '-results.md', 'text/markdown'); toast('Markdown exported'); return; }
    if (act === 'exp-txt') { download(list.map(function (i) { return i.url; }).join('\n'), (CORE || 'page') + '-urls.txt', 'text/plain'); toast('TXT exported'); return; }
    if (act === 'cp-markdown') { copyText(asMarkdown(list), 'Markdown copied'); return; }
    if (act === 'cp-embed') { if (list.length) copyText(asEmbed(list[0].url), 'Embed snippet copied'); return; }
    if (act === 'cp-curl') { if (list.length) copyText(asCurl(list[0].url), 'cURL copied'); return; }
    if (act === 'cp-url') { copyText(url, 'URL copied'); return; }
    if (act === 'cp-embed-one') { copyText(asEmbed(url), 'Embed snippet copied'); return; }
    if (act === 'cp-curl-one') { copyText(asCurl(url), 'cURL copied'); return; }
    if (act === 'cp-md-one') { copyText('- [' + hostOf(url) + '](' + url + ')', 'Markdown copied'); return; }

    if (act === 'open') { openUrl(url); return; }
    if (act === 'sandbox') { openSandbox(url); return; }
    if (act === 'harvest') { harvest(url, btn); return; }

    if (act === 'ql') {
      state.ql = state.ql === url ? null : url;
      state.sel = list.findIndex(function (i) { return i.url === url; });
      render();
      return;
    }

    if (act === 'preview') {
      var slot = btn.parentNode.querySelector('[data-preview]');
      if (!slot) return;
      slot.innerHTML = '<div class="gex-preview"><iframe src="' + esc(url) +
        '" allow="autoplay; fullscreen; gamepad *" allowfullscreen></iframe></div>';
      btn.style.display = 'none';
      toast('Preview loaded');
      return;
    }

    if (act === 'star') {
      if (!sel) return;
      sel.starred = !sel.starred;
      stars[keyOf(sel.url)] = sel.starred ? 1 : 0;
      if (!sel.starred) delete stars[keyOf(sel.url)];
      saveStars();
      sortItems();
      reindex();
      render();
      toast(sel.starred ? 'Pinned' : 'Unpinned');
      return;
    }

    if (act === 'drop') { dropItem(url); toast('Dismissed'); return; }

    if (act === 'probe') {
      if (!sel) { toast('Not found'); return; }
      btn.innerHTML = ICONS.ruler + '…';
      probeSize(sel);
      return;
    }
  }

  function resetResults() {
    items = [];
    seen = {};
    stats = { seen: 0, kept: 0, image: 0, noise: 0, auth: 0, low: 0, other: 0 };
    state.ql = null;
    state.sel = -1;
    state.showAll = false;
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.hasAttribute && t.hasAttribute('data-query')) {
      state.query = t.value;
      state.sel = -1;
      render();
      return;
    }
    if (t.getAttribute('data-act') === 'range') {
      settings.minScore = clamp(parseInt(t.value, 10) || 0, -20, 90);
      var out = t.parentNode.querySelector('output');
      if (out) out.textContent = String(settings.minScore);
      clearTimeout(onInput._t);
      onInput._t = setTimeout(function () { reevaluate(); store(); }, 240);
    }
  }

  function onFieldKey(e) {
    if (e.key === 'Enter' && e.target.hasAttribute && e.target.hasAttribute('data-query')) {
      var list = filtered();
      if (list.length) openUrl(list[0].url);
    }
    if (e.key === 'Escape') {
      var host = document.getElementById(ROOT_ID);
      var wrap = host && host.querySelector('[data-settings]');
      if (wrap && wrap.getAttribute('data-open') === '1') {
        wrap.setAttribute('data-open', '0');
        wrap.innerHTML = '';
        return;
      }
      if (state.ql) { state.ql = null; render(); return; }
      setMinimised(true);
    }
  }

  function reevaluate() {
    var old = items;
    items = [];
    seen = {};
    for (var i = 0; i < old.length; i++) {
      var v = scoreCandidate(old[i].url, old[i].source, old[i].raw);
      if (!v.ok || v.score < settings.minScore) continue;
      items.push({
        id: old[i].id, url: old[i].url, raw: old[i].raw, source: old[i].source,
        score: v.score, tags: v.tags, reasons: v.reasons, hits: old[i].hits,
        bytes: old[i].bytes, mime: old[i].mime, ok: old[i].ok,
        starred: old[i].starred, probing: old[i].probing
      });
    }
    sortItems();
    reindex();
    render();
  }

  /* ---------------- keyboard ---------------- */
  function onKey(e) {
    var typing = e.target && ((e.target.tagName === 'INPUT') || (e.target.tagName === 'TEXTAREA') ||
      (e.target.isContentEditable));

    if (e.altKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); toggle(); return; }
    if (e.key === 'Escape') {
      var host = document.getElementById(ROOT_ID);
      if (host && !state.min) { setMinimised(true); }
      return;
    }
    if (state.min || typing) return;

    var host = document.getElementById(ROOT_ID);
    if (!host) return;

    var list = filtered();

    if (e.key === '/') {
      e.preventDefault();
      var field = host.querySelector('[data-query]');
      if (field) field.focus();
      return;
    }

    if (!list.length) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var d = e.key === 'ArrowDown' ? 1 : -1;
      state.sel = clamp(state.sel + d, 0, Math.min(list.length, 25) - 1);
      render();
      var card = host.querySelectorAll('.gex-card')[state.sel];
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      var it = list[state.sel > -1 ? state.sel : 0];
      state.ql = state.ql === it.url ? null : it.url;
      state.sel = state.sel > -1 ? state.sel : 0;
      render();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      var pick = list[state.sel > -1 ? state.sel : 0];
      openSandbox(pick.url);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
      var sel = window.getSelection();
      if (sel && String(sel).length) return;
      e.preventDefault();
      var target = list[state.sel > -1 ? state.sel : 0];
      copyText(target.url, 'URL copied');
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.sel < 0) return;
      e.preventDefault();
      dropItem(list[state.sel].url);
      state.sel = -1;
      return;
    }
  }

  /* ---------------- lifecycle ---------------- */
  var renderTimer = null;
  var interactingUntil = 0;

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () {
      renderTimer = null;
      if (Date.now() < interactingUntil) { scheduleRender(); return; }
      render();
      updateBubble();
    }, 120);
  }

  function teardown() {
    try { if (mo) mo.disconnect(); } catch (e) { }
    mo = null;
    removeHooks();
    var host = document.getElementById(ROOT_ID);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    var st = document.getElementById('gex-style');
    if (st && st.parentNode) st.parentNode.removeChild(st);
    if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
    bubble = null;
    window.__gex = null;
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', closeMenus);
  }

  function toggle() {
    var host = document.getElementById(ROOT_ID);
    if (!host) { boot(); return; }
    if (state.min) setMinimised(false); else setMinimised(true);
  }

  window.__gex = {
    version: VERSION,
    toggle: toggle,
    show: function () { setMinimised(false); },
    rescan: function () { scanAll('api'); },
    deep: function () { deepScan(6, null); },
    urls: function () { return items.map(function (i) { return i.url; }); },
    top: function () { return items.length ? items[0].url : null; },
    stats: function () { return { kept: items.length, raw: stats }; },
    settings: settings,
    teardown: teardown
  };

  try { state.density = localStorage.getItem('gex:density') === 'compact' ? 'compact' : 'cozy'; } catch (e) { }

  var started = false;

  function boot() {
    if (started) return;
    started = true;
    mount();
    scanAll('initial');
    [1500, 4000, 10000, 20000].forEach(function (ms) {
      setTimeout(function () { scanAll('late'); }, ms);
    });
  }

  window.addEventListener('keydown', onKey, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    setTimeout(boot, 3000);
  } else {
    boot();
  }
})();
