/*!
 * Game Extractor v3.3 — surface the playable build behind a game page.
 * Owned / authorised sites only. No dependencies.
 */
(function () {
  'use strict';

  var VERSION = '3.3.0';
  var ROOT_ID = 'gex-root';

  if (window.__gex) {
    try { window.__gex.toggle(); } catch (e) { /* noop */ }
    return;
  }

  var DEFAULTS = {
    excludeAssets: true,
    strictImages: true,
    strict: false,
    boostSameDomain: true,
    boostCdn: true,
    liveCapture: true,
    unwrapProxies: true,
    compact: false,
    autoProbe: false,
    deepFind: true,
    sort: 'score',
    minScore: 25
  };

  var settings = loadSettings();

  function store() {
    try { localStorage.setItem('gex:settings', JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  function loadSettings() {
    var out = clone(DEFAULTS);
    var keys = ['gex:settings', 'gex_settings', 'age_settings'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (var k in DEFAULTS) if (k in parsed) out[k] = parsed[k];
          if ('excludeImages' in parsed) out.excludeAssets = !!parsed.excludeImages;
          if ('onlyHtmlOrGame' in parsed) out.strict = !!parsed.onlyHtmlOrGame;
          if ('prioritizeCdn' in parsed) out.boostCdn = !!parsed.prioritizeCdn;
        }
      } catch (e) { }
    }
    out.minScore = clamp(parseInt(out.minScore, 10) || 0, -100, 200);
    if (['score', 'newest', 'host'].indexOf(out.sort) === -1) out.sort = 'score';
    out.excludeAssets = !!out.excludeAssets;
    out.strictImages = out.excludeAssets ? !!out.strictImages : false;
    return out;
  }

  var favs = {};
  try {
    var savedFavs = JSON.parse(localStorage.getItem('gex:favs') || '[]');
    for (var fi = 0; fi < savedFavs.length && fi < 300; fi++) favs[savedFavs[fi]] = 1;
  } catch (e) { }
  function saveFavs() {
    try { localStorage.setItem('gex:favs', JSON.stringify(Object.keys(favs).slice(0, 300))); } catch (e) { }
  }
  function isFav(u) { return !!favs[u]; }
  function toggleFav(u) { if (favs[u]) delete favs[u]; else favs[u] = 1; saveFavs(); }

  var stats = { seen: 0, kept: 0, imgBlocked: 0, staticBlocked: 0, t0: Date.now() };

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
    return (n / 1048576).toFixed(1) + ' MB';
  }

  var CURRENT_HOST = safeHost();
  var CORE = coreDomain(CURRENT_HOST);

  // proxy / redirect unwrapping
  var PROXY_PARAMS = ['url', 'u', 'src', 'source', 'target', 'dest', 'destination',
    'proxy', 'proxyurl', 'proxied', 'link', 'q', 'game', 'gameurl', 'embed',
    'embedurl', 'path', 'remote', 'site', 'host', 'data', 'ref', 'goto'];

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
      } catch (e) { /* not encoded */ }
    }
    var pathProxy = s.match(/\/(?:proxy|p|tunnel|service|fetch|gateway|scramble|uv|wisp|raw|embed)\/(.+)$/i);
    if (pathProxy && pathProxy[1].indexOf('.') > -1) {
      var rest = pathProxy[1];
      try {
        var decoded = decodeURIComponent(rest);
        if (/^https?:\/\//i.test(decoded)) return decoded;
      } catch (e) { /* not fully encoded */ }
      if (/^https?:\/\//i.test(rest)) return rest;
      // bare-host form: /proxy/cdn.site.com/game/index.html
      if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#].*)?$/i.test(rest)) return 'https://' + rest;
    }
    if (/^[A-Za-z0-9+/\-_]{24,}={0,2}$/.test(s)) {
      try {
        var norm = s.replace(/-/g, '+').replace(/_/g, '/');
        var b64 = decodeURIComponent(escape(atob(norm)));
        if (/^https?:\/\//i.test(b64)) return b64;
      } catch (e) { /* not base64 */ }
    }
    var qi = s.indexOf('?');
    if (qi > -1) {
      try {
        var qs = new URLSearchParams(s.slice(qi + 1));
        for (var i = 0; i < PROXY_PARAMS.length; i++) {
          var v = qs.get(PROXY_PARAMS[i]);
          if (v && (/^https?:\/\//i.test(v) || /^\/\//.test(v) || /^https?:%2F%2F/i.test(v))) return v;
        }
      } catch (e) { /* bad query */ }
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
    var lower = s.toLowerCase();
    if (/^(javascript:|mailto:|tel:|about:|data:|blob:about|chrome|moz-|view-source:)/.test(lower)) return null;
    if (s === 'null' || s === 'undefined' || s === '#') return null;
    try {
      return new URL(s, base || document.baseURI).href;
    } catch (e) { return null; }
  }

  // classification: path hints, weights, platforms, noise tables
  var PATH_HINTS = ['game', 'games', 'play', 'player', 'embed', 'iframe', 'rom', 'roms',
    'build', 'builds', 'demo', 'arcade', 'webgl', 'wasm', 'unity', 'godot', 'construct',
    'gdevelop', 'ruffle', 'swf', 'emulator', 'emulatorjs', 'loader', 'engine', 'level',
    'world', 'release', 'v1', 'v2', 'v3', 'g'];

  var IMAGE_EXT = /\.(png|jpe?g|jpe|jfif|gif|webp|avif|bmp|dib|svgz?|ico|cur|tiff?|heic|heif|heics|psd|dng|arw|cr2|orf)(\?|#|$)/i;
  var STATIC_EXT = /\.(css|scss|less|woff2?|ttf|otf|eot|mp4|webm|m4a|aac|mov|vtt|srt|map)(\?|#|$)/i;
  var AUDIO_EXT = /\.(mp3|ogg|oga|wav|flac|opus)(\?|#|$)/i;
  var ASSET_EXT = /\.(png|jpe?g|jpe|jfif|gif|webp|avif|bmp|svgz?|ico|cur|tiff?|heic|heif|css|scss|less|woff2?|ttf|otf|eot|mp4|webm|mp3|ogg|wav|m4a|aac|mov|vtt|srt|map)(\?|#|$)/i;
  var IMAGE_HINT_RE = /(^|\/)(thumbs?|thumbnail|sprite|avatars?|icons?|logos?|banners?|covers?|artwork|posters?|wallpapers?|screenshots?|gallery|emojis?|stickers?|og-image|favicons?)([\/.?_-]|$)/i;
  var IMAGE_PARAM_RE = /[?&](format|fm|filetype|ext|output|type)=(png|jpe?g|webp|gif|avif|svg|tiff?|heic|heif|ico|bmp)/i;
  var IMAGE_PROXY_RE = /(^|\.)(images\.weserv\.nl|wsrv\.nl|imageproxy|imgix\.net|cloudinary\.com|imgur\.com|i\.imgur|cdn\.discordapp|twimg\.com|pinimg\.com)/i;

  function isImageUrl(url, path, search, full) {
    var hay = path + (search || '');
    if (IMAGE_EXT.test(hay)) return 'ext';
    if (IMAGE_PARAM_RE.test(search || '')) return 'param';
    if (IMAGE_PROXY_RE.test(url.hostname || '')) {
      if (!/\.(html?|wasm|unityweb|data|pck|swf|zip)(\?|#|$)/i.test(hay)) return 'proxy';
    }
    if (/\/_next\/image\?/.test(path + (search || ''))) return 'next-image';
    return null;
  }

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
    { name: 'HTML5 host', re: /html5games?|gamecdn|gamescdn|gameassets|webglgame|arcade/i, score: 30 },
    { name: 'Static host', re: /github\.io|gitlab\.io|vercel\.app|netlify\.app|pages\.dev|workers\.dev|glitch\.me|repl\.co|surge\.sh|firebaseapp\.com|web\.app|blob\.core|cloudfront\.net|amazonaws\.com|r2\.dev/i, score: 26 }
  ];

  var NOISE_RE = /(doubleclick|googlesyndication|googleadservices|adservice|adnxs|adsystem|adsrvr|amazon-adsystem|moatads|pubmatic|criteo|taboola|outbrain|scorecardresearch|quantserve|google-analytics|googletagmanager|\/analytics|telemetry|sentry(?:-cdn)?\.|hotjar|mixpanel|clarity\.ms|segment\.(?:io|com)|newrelic|nr-data|fullstory|logrocket|datadog|branch\.io|appsflyer|onesignal|pushwoosh|facebook\.(?:net|com)\/(?:tr|plugins)|connect\.facebook|platform\.(?:twitter|x|linkedin|instagram)\.|disqus|recaptcha|hcaptcha|turnstile|cloudflareinsights|challenges\.cloudflare|cookiebot|onetrust|osano|gdpr|\/ads?\/|\/adserver\/|\/banners?\/|watermark|branding|\/tracking\/|\/beacon\/)/i;

  var NOISE_RE_SOFT = /(consent|login|signin|signup|sign-up|account\/|auth0|okta|stripe\.com|paypal|checkout|mailchimp|hubspot|intercom|zendesk|crisp\.chat|maps\.google|docs\.google\.com|drive\.google\.com|apis\.google\.com|discord\.com\/api|t\.me\/|whatsapp\.com|youtube\.com\/watch|facebook\.com\/sharer|twitter\.com\/intent|x\.com\/intent|pinterest\.com|reddit\.com\/submit)/i;

  function hostTokens(host) {
    return String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  }

  function techOf(full, ext, tags) {
    var f = String(full || '').toLowerCase();
    if (/unity|unityweb|\.wasm|\.data|\.framework\.js/.test(f) || ext === '.unityweb' || ext === '.wasm') return 'Unity';
    if (/godot|\.pck/.test(f)) return 'Godot';
    if (/construct|\.c3p|c2runtime/.test(f)) return 'Construct';
    if (/gdevelop|gdjs/.test(f)) return 'GDevelop';
    if (/ruffle|\.swf/.test(f)) return 'Flash';
    if (/emulatorjs|ejs|libretro|rom/.test(f)) return 'Emulator';
    if (/phaser|pixi|three\.|babylon|playcanvas/.test(f)) return 'WebGL';
    return null;
  }

  function scoreCandidate(absolute, source, originalRaw) {
    var url;
    try { url = new URL(absolute); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'blob:') return null;

    var path = url.pathname.toLowerCase();
    var search = (url.search || '').toLowerCase();
    var full = (url.host + url.pathname + url.search).toLowerCase();
    var tokens = path.split(/[^a-z0-9]+/).filter(Boolean);
    var extMatch = path.match(/\.[a-z0-9]{1,9}$/);
    var ext = extMatch ? extMatch[0] : '';
    var tags = [];
    var parts = [];
    var score = 8;
    parts.push(['base', 8]);

    if (settings.excludeAssets) {
      var imgWhy = isImageUrl(url, path, url.search, full);
      if (imgWhy) { stats.imgBlocked++; return null; }
      if (STATIC_EXT.test(path + url.search) || AUDIO_EXT.test(path + url.search)) { stats.staticBlocked++; return null; }
      if (settings.strictImages && !ext) {
        if (IMAGE_HINT_RE.test(url.pathname) && full.indexOf('game') === -1 && full.indexOf('play') === -1) {
          stats.imgBlocked++; return null;
        }
      }
      if (settings.strictImages && IMAGE_HINT_RE.test(url.pathname) && GAME_EXT[ext]) {
        stats.imgBlocked++; return null;
      }
    }

    if (NOISE_RE.test(full)) {
      tags.push('ad/tracker');
      if (!/^\.(html?|swf|wasm|unityweb|data|pck)$/.test(ext)) return null;
    }
    if (NOISE_RE_SOFT.test(full)) return null;

    // path hints
    var hintHits = 0;
    for (var hi = 0; hi < tokens.length && hintHits < 3; hi++) {
      if (PATH_HINTS.indexOf(tokens[hi]) > -1) hintHits++;
    }
    if (hintHits) {
      var hg = Math.min(hintHits, 2) * 14;
      score += hg; tags.push('path'); parts.push(['path ×' + hintHits, hg]);
    }

    if (ext && GAME_EXT[ext]) { score += GAME_EXT[ext]; tags.push('file' + ext); parts.push(['file ' + ext, GAME_EXT[ext]]); }

    for (var p = 0; p < PLATFORMS.length; p++) {
      if (PLATFORMS[p].re.test(full)) { score += PLATFORMS[p].score; tags.push(PLATFORMS[p].name); parts.push([PLATFORMS[p].name, PLATFORMS[p].score]); break; }
    }

    var ht = hostTokens(url.hostname);
    if (settings.boostCdn && (ht.indexOf('cdn') > -1 || ht.indexOf('assets') > -1 ||
      ht.indexOf('storage') > -1 || ht.indexOf('static') > -1 || ht.indexOf('files') > -1 ||
      ht.indexOf('media') > -1 ||
      /cloudfront|azureedge|fastly|akamai|cloudflare|storage\.googleapis|blob\.core|s3[.-]|r2\.dev|hwcdn/.test(url.hostname))) {
      score += 20; tags.push('cdn'); parts.push(['cdn / storage', 20]);
    }

    if (settings.boostSameDomain && CORE && CORE.length > 2) {
      if (url.hostname === CURRENT_HOST) { score += 22; tags.push('same-host'); parts.push(['same host', 22]); }
      else if (url.hostname.toLowerCase().indexOf(CORE.toLowerCase()) > -1) { score += 16; tags.push('same-domain'); parts.push(['same domain', 16]); }
    }

    var tech = techOf(full, ext, tags);
    if (tech) { score += 10; tags.push(tech); parts.push([tech + ' engine', 10]); }

    var evW = { 'live-iframe': 46, 'live-fetch': 34, 'live-xhr': 34, 'global': 32, 'iframe': 26, 'embed': 24, 'object': 24, 'srcdoc': 20, 'finder': 20, 'json': 18, 'network': 16, 'script': 12, 'storage': 10, 'attr': 8, 'link': 4 };
    if (evW[source]) { score += evW[source]; tags.push(source.indexOf('live-') === 0 ? 'runtime' : source); parts.push(['via ' + source, evW[source]]); }

    // find-by-name: weigh every piece of evidence the finder gathered
    if (state.findName && state.findVariants && state.findVariants.length) {
      var named = false;

      // the URL itself carries the name
      for (var fv = 0; fv < state.findVariants.length; fv++) {
        if (full.indexOf(state.findVariants[fv]) > -1) { named = true; break; }
      }
      if (!named && state.findSquash.length >= 5 && squash(url.pathname + url.search).indexOf(state.findSquash) > -1) named = true;
      if (named) { score += 34; tags.push('named'); parts.push(['name in url', 34]); }

      // the filename *is* the name
      var fileBase = (url.pathname.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
      if (fileBase && state.findSquash && squash(fileBase) === state.findSquash) {
        score += 26; if (!named) { named = true; tags.push('named'); }
        parts.push(['filename is name', 26]);
      }

      // a parent directory is the name — /games/neon-drift/v3/index.html
      if (!named) {
        var segsP = url.pathname.toLowerCase().split('/').filter(Boolean);
        for (var sp = 0; sp < segsP.length; sp++) {
          if (state.findSquash && squash(segsP[sp]) === state.findSquash) {
            score += 30; named = true; tags.push('named'); parts.push(['folder is name', 30]);
            break;
          }
        }
      }

      // the finder read it out of real source code near the name
      var fh = state.findHits[keyOf(absolute)];
      if (fh && fh.bonus) {
        score += fh.bonus;
        if (!named) { named = true; tags.push('named'); }
        parts.push([(fh.why[0] || 'in source'), fh.bonus]);
      }
    }

    if (url.pathname === '/' || url.pathname === '') { score -= 70; tags.push('root'); parts.push(['site root', -70]); }
    if (absolute === location.href) { score -= 40; tags.push('self'); parts.push(['current page', -40]); }
    if (!ext && url.pathname.split('/').filter(Boolean).length <= 1) { score -= 26; tags.push('nav'); parts.push(['nav link', -26]); }
    if ((ext === '.js' || ext === '.mjs') && !hintHits) { score -= 60; tags.push('plain-js'); parts.push(['plain bundle', -60]); }
    if (ext === '.json' && !hintHits) { score -= 45; tags.push('plain-json'); parts.push(['plain json', -45]); }
    if (url.search.length > 400) { score -= 10; parts.push(['long query', -10]); }
    if (url.protocol === 'blob:') { score += 10; tags.push('blob'); parts.push(['blob', 10]); }
    if (settings.unwrapProxies && originalRaw && unwrap(originalRaw) !== originalRaw) { score += 12; tags.push('unwrapped'); parts.push(['unwrapped proxy', 12]); }

    if (settings.strict) {
      var useful = hintHits > 0 || !!GAME_EXT[ext] || url.protocol === 'blob:' || !!tech;
      if (!useful) return null;
    }

    return { score: score, tags: tags, parts: parts, tech: tech, ext: ext };
  }
  var items = [];   // sorted + deduped
  var seen = {};    // normalised url -> index
  var order = 0;
  var dirty = false;
  var status = 'idle';
  var MAX_ITEMS = 400;

  function keyOf(u) {
    try {
      var url = new URL(u);
      var q = url.searchParams;
      ['v', 'ver', 'cb', 'cachebust', 'ts', 't', '_', 'r'].forEach(function (p) { q.delete(p); });
      var qs = q.toString();
      return url.host + url.pathname.replace(/\/+$/, '') + (qs ? '?' + qs : '');
    } catch (e) { return u; }
  }

  function addCandidate(raw, source) {
    if (raw == null) return;
    if (items.length >= MAX_ITEMS && seen[keyOf(String(raw))] === undefined) return;
    // plain prose ("Sonic Mania") is a label, not a path — don't let the URL
    // parser turn it into /games/Sonic%20Mania
    var rawTrim = String(raw).trim();
    if (/\s/.test(rawTrim) && !/^(https?:)?\/\//i.test(rawTrim)) return;
    var unwrapped = unwrap(String(raw));
    var absolute = resolveUrl(unwrapped);
    if (!absolute) return;
    var key = keyOf(absolute);
    var at = seen[key];

    if (at !== undefined) {
      var ex = items[at];
      if (ex && ex.source !== source) {
        var better = scoreCandidate(ex.url, source, raw);
        if (better && better.score > ex.score) {
          ex.source = source; ex.score = better.score; ex.tags = better.tags;
          ex.parts = better.parts; ex.tech = better.tech; ex.ext = better.ext; ex.hits++;
          dirty = true; scheduleRender();
        } else if (ex) { ex.hits++; }
      } else if (ex) { ex.hits++; }
      return;
    }

    stats.seen++;
    var verdict = scoreCandidate(absolute, source, String(raw));
    if (!verdict) { stats.kept = items.length; return; }
    if (verdict.score < settings.minScore) return;

    seen[key] = items.length;
    items.push({
      id: ++order,
      url: stripTracking(absolute),
      raw: String(raw).slice(0, 300),
      source: source,
      score: verdict.score,
      tags: verdict.tags,
      parts: verdict.parts,
      tech: verdict.tech,
      ext: verdict.ext,
      hits: 1,
      bytes: 0
    });
    stats.kept = items.length;
    items.sort(function (a, b) { return b.score - a.score || b.id - a.id; });
    reindex();
    dirty = true;
    scheduleRender();
  }

  function reindex() {
    for (var i = 0; i < items.length; i++) seen[keyOf(items[i].url)] = i;
  }

  function probeSize(item) {
    if (!/^https?:/.test(item.url) || item.probing) return;
    item.probing = true;
    fetch(item.url, { method: 'HEAD', mode: 'cors', redirect: 'follow' }).then(function (r) {
      item.bytes = parseInt(r.headers.get('content-length') || '0', 10) || 0;
      item.mime = r.headers.get('content-type') || '';
      item.ok = r.ok;
      item.probing = false;
      dirty = true; scheduleRender();
    }).catch(function () { item.probing = false; item.mime = 'unreachable'; });
  }

  function scanDocument(doc, base) {
    var b = base || (doc && doc.baseURI) || document.baseURI;

    // frames, plugins, media
    var frameSel = [['iframe', 'iframe'], ['frame', 'iframe'], ['embed', 'embed'],
      ['object', 'embed'], ['video', 'media'], ['audio', 'media'], ['source', 'media'], ['track', 'media']];
    for (var f = 0; f < frameSel.length; f++) {
      try {
        var list = doc.querySelectorAll(frameSel[f][0]);
        for (var i = 0; i < list.length; i++) {
          var el = list[i];
          var val = frameSel[f][0] === 'object' ? el.getAttribute('data') : el.getAttribute('src');
          if (val) addCandidate(val, frameSel[f][1]);
        }
      } catch (e) { /* keep going */ }
    }

    // srcdoc iframes are whole nested pages — parse them properly
    try {
      var sd = doc.querySelectorAll('iframe[srcdoc]');
      for (var s = 0; s < sd.length; s++) {
        var html = sd[s].getAttribute('srcdoc') || '';
        if (html && html.length < 600000) {
          var parsed = new DOMParser().parseFromString(html, 'text/html');
          var bl = parsed.createElement('base');
          bl.setAttribute('href', b);
          (parsed.head || parsed.documentElement).appendChild(bl);
          scanDocument(parsed, b);
        }
      }
    } catch (e) { /* noop */ }

    try {
      var anchors = doc.querySelectorAll('a[href]');
      for (var a = 0; a < anchors.length; a++) addCandidate(anchors[a].getAttribute('href'), 'link');
    } catch (e) { /* noop */ }

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
        addCandidate(href, 'script');
      }
    } catch (e) { /* noop */ }

    // lazy-load + config attributes anywhere in the tree
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
          addCandidate(v, 'attr');
        }
      }
    } catch (e) { /* noop */ }

    collectFromInlineScripts(doc);
  }

  // nested documents (srcdoc) mean new markup — queue a throttled full sweep
  function markSweep() { scheduleFullScan(); }

  function collectFromInlineScripts(doc) {
    try {
      var scripts = doc.querySelectorAll('script:not([src])');
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        var text = (s.textContent || '').trim();
        if (!text || text.length > 900000) continue;
        var type = (s.getAttribute('type') || '').toLowerCase();
        var looksJson = type.indexOf('json') > -1 || /^\s*[\[{]/.test(text);

        if (looksJson) {
          try {
            var hits = [];
            walkJson(JSON.parse(text), hits, 0);
            for (var h = 0; h < hits.length; h++) addCandidate(hits[h], 'json');
          } catch (e) { /* not real json */ }
        }

        // inline `var X = {...}` config objects (very common on portals)
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
            for (var h2 = 0; h2 < hits2.length; h2++) addCandidate(hits2[h2], 'json');
          } catch (e) { /* best effort */ }
        }

        // absolute urls
        var abs = text.match(/https?:\/\/[^\s"'`<>()\\]+/gi) || [];
        for (var x = 0; x < abs.length; x++) addCandidate(abs[x].replace(/[.,;)\]}'"]+$/, ''), 'script');

        // root-relative game payloads
        var rel = text.match(/["'`(](\/[A-Za-z0-9_.\-/]{3,120}\.(?:html?|swf|wasm|unityweb|data|pck|zip|json))(?:[?#][^"'`)]*)?["'`)]/gi) || [];
        for (var y = 0; y < rel.length; y++) addCandidate(rel[y].replace(/^["'`(]|["'`)]$/g, ''), 'script');
      }
    } catch (e) { /* noop */ }
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
    } catch (e) { /* noop */ }
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
      } catch (e) { /* blocked */ }
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
        } catch (e) { /* noop */ }
      }
    } catch (e) { /* noop */ }
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
      } catch (e) { /* noop */ }
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
    log('scan "' + (label || 'manual') + '" → ' + items.length + ' hits in ' + (Date.now() - t0) + 'ms');
    if (settings.autoProbe) {
      var top = items.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
      for (var pi = 0; pi < top.length; pi++) if (!top[pi].bytes && !top[pi].probing) probeSize(top[pi]);
    }
    scheduleRender();
  }

  function scheduleFullScan() {
    if (fullScanTimer) return;
    // busy pages (i.e. games) mutate constantly — sweep at most every 1.5s
    var since = Date.now() - lastAutoScan;
    fullScanTimer = setTimeout(function () {
      fullScanTimer = null;
      lastAutoScan = Date.now();
      scanAll('auto');
    }, Math.max(150, 1500 - since));
  }

  // live capture — every hook here is undone on teardown
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
    } catch (e) { /* frozen */ }

    try {
      var oo = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { if (url) addCandidate(url, 'live-xhr'); } catch (e) { }
        return oo.apply(this, arguments);
      };
      restoreHooks.push(function () { XMLHttpRequest.prototype.open = oo; });
    } catch (e) { /* frozen */ }

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
    } catch (e) { /* frozen */ }

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
    } catch (e) { /* unsupported */ }
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
          if (el.getAttribute && el.getAttribute('srcdoc')) markSweep(); // nested page → full sweep
          if (el.querySelectorAll) {
            var fr = el.querySelectorAll('iframe,embed,object');
            for (var q = 0; q < fr.length; q++) {
              addCandidate(fr[q].getAttribute('src') || fr[q].getAttribute('data'),
                fr[q].tagName === 'IFRAME' ? 'iframe' : 'embed');
            }
            var an = el.querySelectorAll('a[href]');
            for (var w = 0; w < an.length; w++) addCandidate(an[w].getAttribute('href'), 'link');
          }
        } catch (e) { /* detached */ }
      }
      scheduleFullScan();
    });
    mo.observe(document.documentElement || document, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'data', 'href', 'srcdoc', 'data-url', 'data-src', 'data-srcdoc']
    });
  }

  function insidePanel(n) {
    var rootEl = document.getElementById(ROOT_ID);
    return !!(rootEl && (rootEl === n || rootEl.contains(n)));
  }

  var state = {
    min: false, query: '', filter: 'all', showAll: false, favOnly: false,
    expanded: 0, theater: null,
    findOpen: false, findInput: '', findName: '', findVariants: [], findSquash: '',
    findHits: {}, findMsg: null, findProgress: null
  };
  var POS_KEY = 'gex:pos';

  var CSS = [
    '#' + ROOT_ID + '{position:fixed;top:20px;left:50%;transform:translateX(-50%);width:min(94vw,700px);z-index:2147483000;color:#f5f5f7;',
    'font:400 13px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",Inter,system-ui,sans-serif;',
    '-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;letter-spacing:-.015em;box-sizing:border-box;',
    'background:linear-gradient(180deg,rgba(38,38,42,.82),rgba(22,22,25,.86));backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);',
    'border:.5px solid rgba(255,255,255,.14);border-radius:24px;overflow:hidden;',
    'box-shadow:0 48px 120px -16px rgba(0,0,0,.8),0 12px 32px rgba(0,0,0,.45),0 0 0 .5px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.1),inset 0 -1px 0 rgba(0,0,0,.25);',
    'animation:gexPop .38s cubic-bezier(.2,.9,.25,1.05);}',
    '@keyframes gexPop{from{opacity:0;transform:translateX(-50%) translateY(-14px) scale(.97)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}',
    '@keyframes gexRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
    ':where(#' + ROOT_ID + ') :where(*){box-sizing:border-box;font-family:inherit;margin:0;padding:0;}',
    ':where(#' + ROOT_ID + ') :where(button){font:inherit;color:inherit;background:none;border:0;cursor:pointer;}',
    ':where(#' + ROOT_ID + ') :where(svg){display:block;flex:none;}',
    '#' + ROOT_ID + ' .gex-head{padding:18px 18px 14px 20px;gap:12px;}',
    '#' + ROOT_ID + ' .gex-tool{padding:0 18px 12px;gap:10px;}',
    '#' + ROOT_ID + ' .gex-row{gap:10px;}',
    '#' + ROOT_ID + ' .gex-field{padding:10px 14px;border-radius:14px;}',
    '#' + ROOT_ID + ' .gex-field input{font-size:13px;}',
    '#' + ROOT_ID + ' .gex-seg{border-radius:12px;padding:3px;}',
    '#' + ROOT_ID + ' .gex-seg button{padding:6px 12px;border-radius:9px;font-size:11.5px;}',
    '#' + ROOT_ID + ' .gex-tabs{padding:3px;border-radius:12px;gap:4px;}',
    '#' + ROOT_ID + ' .gex-tab{padding:6px 11px;border-radius:9px;font-size:11.5px;}',
    '#' + ROOT_ID + ' .gex-btn{padding:8px 10px;border-radius:11px;}',
    '#' + ROOT_ID + ' .gex-iconbtn{width:32px;height:32px;border-radius:11px;}',
    '#' + ROOT_ID + ' .gex-meta{padding:2px 20px 12px;font-size:11px;}',
    '#' + ROOT_ID + ' .gex-body{padding:0 18px 10px;max-height:min(52vh,440px);}',
    '#' + ROOT_ID + ' .gex-card{padding:14px 16px 12px;border-radius:18px;margin-bottom:10px;}',
    '#' + ROOT_ID + ' .gex-host{margin-bottom:8px;}',
    '#' + ROOT_ID + ' .gex-topline{gap:7px;margin-bottom:8px;}',
    '#' + ROOT_ID + ' .gex-pill{padding:3px 9px;font-size:9.5px;}',
    '#' + ROOT_ID + ' .gex-url{font-size:11px;margin-bottom:2px;}',
    '#' + ROOT_ID + ' .gex-actions{gap:7px;margin-top:11px;}',
    '#' + ROOT_ID + ' .gex-mini{padding:6px 11px;border-radius:10px;font-size:11px;gap:5px;}',
    '#' + ROOT_ID + ' .gex-bar{margin-top:12px;}',
    '#' + ROOT_ID + ' .gex-foot{padding:12px 20px;}',
    '#' + ROOT_ID + ' .gex-hint{gap:5px;font-size:10.5px;}',
    '#' + ROOT_ID + ' .gex-hint kbd{padding:2px 6px;border-radius:5px;}',
    '#' + ROOT_ID + ' .gex-set{padding:2px 18px 14px;}',
    '#' + ROOT_ID + ' .gex-panel{padding:14px 16px;border-radius:16px;}',
    '#' + ROOT_ID + ' .gex-opt{padding:7px 0;}',
    '#' + ROOT_ID + ' .gex-empty{padding:28px 18px;border-radius:16px;}',
    '#' + ROOT_ID + ' .gex-detail{margin-top:10px;padding-top:10px;}',
    '#' + ROOT_ID + ' .gex-v{padding:2px 8px;}',
    '#' + ROOT_ID + ' .gex-more{padding:10px;}',
    '#gex-min{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:9px 14px 9px 11px;',
    'border-radius:999px;background:rgba(23,23,26,.9);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);',
    'border:1px solid rgba(255,255,255,.1);color:#a9a9b0;font:500 12px/1 -apple-system,system-ui,sans-serif;',
    'box-shadow:0 12px 32px rgba(0,0,0,.5);}#gex-min:hover{color:#fff;border-color:rgba(255,255,255,.22);}',
    '#gex-min .dot{width:7px;height:7px;border-radius:50%;background:#30d158;box-shadow:0 0 0 3px rgba(48,209,88,.22);}',
    '.gex-head{display:flex;align-items:center;gap:9px;padding:12px 12px 11px 14px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;}',
    '.gex-head.grabbing{cursor:grabbing;}',
    '.gex-grip{color:rgba(255,255,255,.16);display:flex;}',
    '.gex-mark{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#fff;flex:none;',
    'background:linear-gradient(150deg,#0a84ff,#5e5ce6 55%,#bf5af2);box-shadow:0 4px 12px rgba(10,132,255,.35),inset 0 1px 0 rgba(255,255,255,.25);}',
    '.gex-title{font-size:13px;font-weight:600;letter-spacing:-.02em;color:#fff;}',
    '.gex-v{font-size:10px;color:#8e8e93;border:1px solid rgba(255,255,255,.09);padding:2px 7px;border-radius:999px;font-weight:500;}',
    '.gex-live{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:#30d158;font-weight:500;}',
    '.gex-live i{width:6px;height:6px;border-radius:50%;background:#30d158;animation:gexPulse 1.9s ease-in-out infinite;}',
    '@keyframes gexPulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(48,209,88,.45)}50%{opacity:.5;box-shadow:0 0 0 4px rgba(48,209,88,0)}}',
    '.gex-tool{padding:0 14px 11px;display:flex;flex-direction:column;gap:8px;}',
    '.gex-row{display:flex;gap:7px;align-items:center;}',
    '.gex-field{flex:1;display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08);',
    'border-radius:10px;padding:7px 11px;color:#8e8e93;transition:border-color .15s,background .15s;min-width:0;}',
    '.gex-field:focus-within{border-color:rgba(10,132,255,.55);background:rgba(10,132,255,.09);}',
    '.gex-field input{flex:1;background:none;border:0;outline:none;color:#fff;font-size:12px;min-width:0;}',
    '.gex-field input::placeholder{color:rgba(142,142,147,.7);}',
    '.gex-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 11px;border-radius:10px;font-size:11.5px;font-weight:500;',
    'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#d3d3d8;transition:all .14s ease;white-space:nowrap;flex:none;}',
    '.gex-btn:hover{background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.16);}',
    '.gex-btn:active{transform:scale(.97);}',
    '.gex-btn.ghost{background:transparent;border-color:transparent;color:#8e8e93;}',
    '.gex-btn.ghost:hover{color:#fff;background:rgba(255,255,255,.07);}',
    '.gex-tabs{display:flex;gap:2px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);padding:2px;border-radius:9px;overflow-x:auto;}',
    '.gex-tab{padding:4px 9px;border-radius:7px;font-size:10.5px;font-weight:500;color:#8e8e93;transition:all .13s;white-space:nowrap;flex:none;}',
    '.gex-tab:hover{color:#d3d3d8;}',
    '.gex-tab.on{background:rgba(255,255,255,.11);color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);}',
    '.gex-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 16px 9px;font-size:10.5px;color:#7c7c81;}',
    '.gex-meta b{color:#d3d3d8;font-weight:600;}',
    '.gex-body{max-height:min(46vh,380px);overflow:auto;padding:0 10px 6px 14px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent;}',
    '.gex-body::-webkit-scrollbar{width:8px;}',
    '.gex-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px;border:2px solid transparent;background-clip:content-box;}',
    '.gex-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28);background-clip:content-box;}',
    '.gex-card{border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.032);border-radius:13px;padding:9px 11px;margin-bottom:7px;',
    'transition:border-color .14s,background .14s;}',
    '.gex-card:hover{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.055);}',
    '.gex-card.top{border-color:rgba(48,209,88,.34);background:linear-gradient(180deg,rgba(48,209,88,.09),rgba(255,255,255,.03));}',
    '.gex-topline{display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap;}',
    '.gex-rank{font-size:9.5px;font-weight:700;color:#63636a;width:14px;flex:none;}',
    '.gex-pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:600;padding:2px 7px;border-radius:999px;letter-spacing:.02em;}',
    '.gex-pill.best{background:rgba(48,209,88,.16);color:#4cd964;border:1px solid rgba(48,209,88,.3);}',
    '.gex-pill.src{background:rgba(10,132,255,.13);color:#7cb8ff;border:1px solid rgba(10,132,255,.22);text-transform:uppercase;letter-spacing:.07em;}',
    '.gex-pill.dim{background:rgba(255,255,255,.055);color:#8e8e93;border:1px solid rgba(255,255,255,.07);}',
    '.gex-url{font:400 10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#a9a9b0;word-break:break-all;cursor:text;}',
    '.gex-url b{color:#ececf1;font-weight:500;}',
    '.gex-actions{display:flex;gap:5px;margin-top:8px;flex-wrap:wrap;}',
    '.gex-mini{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;font-size:10px;font-weight:500;',
    'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);color:#b9b9c0;transition:all .13s;}',
    '.gex-mini:hover{background:rgba(255,255,255,.11);color:#fff;}',
    '.gex-mini.go{background:linear-gradient(180deg,#2c95ff,#0a73e8);color:#fff;border-color:rgba(255,255,255,.14);}',
    '.gex-mini.go:hover{filter:brightness(1.12);color:#fff;}',
    '.gex-bar{height:2px;border-radius:2px;background:rgba(255,255,255,.07);margin-top:7px;overflow:hidden;}',
    '.gex-bar i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#0a84ff,#5e5ce6);}',
    '.gex-foot{display:flex;align-items:center;gap:8px;padding:9px 14px;border-top:1px solid rgba(255,255,255,.07);flex-wrap:wrap;}',
    '.gex-hint{font-size:10px;color:#6a6a70;display:flex;align-items:center;gap:3px;flex-wrap:wrap;}',
    '.gex-hint kbd{font:600 9.5px ui-monospace,monospace;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:1px 4px;color:#a9a9b0;}',
    '.gex-empty{border:1px dashed rgba(255,255,255,.12);border-radius:13px;padding:20px 16px;text-align:center;color:#7c7c81;font-size:11.5px;line-height:1.6;}',
    '.gex-empty b{display:block;color:#d3d3d8;font-weight:600;font-size:12px;margin-bottom:3px;}',
    '.gex-set{padding:2px 14px 12px;}',
    '.gex-panel{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.028);border-radius:14px;padding:11px 13px;}',
    '.gex-set h4{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8e8e93;margin-bottom:6px;}',
    '.gex-opt{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;}',
    '.gex-opt .lbl{font-size:12px;color:#d8d8de;}',
    '.gex-opt .sub{display:block;font-size:10px;color:#7c7c81;margin-top:1px;font-weight:400;}',
    '.gex-sw{position:relative;width:36px;height:21px;flex:none;border-radius:99px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.08);transition:background .2s;cursor:pointer;}',
    '.gex-sw i{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s cubic-bezier(.3,1.4,.5,1);}',
    '.gex-sw.on{background:#30d158;border-color:rgba(48,209,88,.5);}',
    '.gex-sw.on i{transform:translateX(15px);}',
    '.gex-num{display:flex;align-items:center;gap:8px;}',
    '.gex-num input[type=range]{-webkit-appearance:none;appearance:none;width:104px;height:3px;border-radius:3px;background:rgba(255,255,255,.16);outline:none;}',
    '.gex-num input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:pointer;}',
    '.gex-num input[type=range]::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:#fff;cursor:pointer;}',
    '.gex-num output{font:600 10.5px ui-monospace,monospace;color:#fff;min-width:20px;text-align:right;}',
    '.gex-toast{position:absolute;left:50%;bottom:50px;transform:translateX(-50%);background:rgba(48,209,88,.95);color:#04120a;',
    'font-size:11px;font-weight:600;padding:7px 13px;border-radius:999px;box-shadow:0 8px 22px rgba(0,0,0,.4);pointer-events:none;animation:gexIn .2s ease;z-index:3;white-space:nowrap;}',
    '@keyframes gexIn{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}',
    '.gex-more{width:100%;padding:8px;margin:1px 0 6px;border-radius:10px;background:rgba(255,255,255,.05);border:1px dashed rgba(255,255,255,.12);color:#a9a9b0;font-size:11px;}',
    '.gex-more:hover{background:rgba(255,255,255,.09);color:#fff;}',
    '.gex-named{background:rgba(48,209,88,.14)!important;color:#7ee39a!important;border-color:rgba(48,209,88,.32)!important;}',
    '.gex-iconbtn.gex-find{background:rgba(48,209,88,.14);border-color:rgba(48,209,88,.35);color:#7ee39a;}',
    '.gex-findbar{display:flex;align-items:center;gap:9px;background:rgba(48,209,88,.07);border:1px solid rgba(48,209,88,.24);border-radius:14px;padding:9px 12px;color:#7ee39a;}',
    '.gex-findlabel{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5fba78;flex:none;}',
    '.gex-findq{font-size:11.5px;font-weight:600;color:#e8f5ec;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none;}',
    '.gex-findbar input{flex:1;min-width:60px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:7px 11px;color:#fff;font-size:12px;outline:none;transition:border-color .15s;}',
    '.gex-findbar input:focus{border-color:rgba(48,209,88,.55);background:rgba(48,209,88,.08);}',
    '.gex-findbar input::placeholder{color:rgba(142,142,147,.6);}',
    '.gex-findok{font-size:10.5px;color:#4cd964;font-weight:600;white-space:nowrap;flex:none;}',
    '.gex-findmiss{font-size:10.5px;color:#ffb340;white-space:nowrap;flex:none;}',
    '.gex-findscan{font-size:10px;color:#8cc2ff;white-space:nowrap;flex:none;display:flex;align-items:center;gap:6px;}',
    '.gex-findscan i{display:block;width:52px;height:3px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;}',
    '.gex-findscan i b{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#0a84ff,#5e5ce6);transition:width .2s;}',
    '.gex-log{margin-top:12px;border-top:1px solid rgba(255,255,255,.07);padding-top:9px;}',
    '.gex-log .t{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#6a6a70;margin-bottom:4px;}',
    '.gex-log .l{font:10px/1.75 ui-monospace,Menlo,monospace;color:#7c7c81;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.gex-lights{display:flex;gap:7px;align-items:center;flex:none;}',
    '.gex-light{width:11px;height:11px;border-radius:50%;position:relative;display:grid;place-items:center;box-shadow:inset 0 0 2px rgba(0,0,0,.25);}',
    '.gex-light.r{background:#ff5f57;}.gex-light.y{background:#febc2e;}.gex-light.g{background:#28c840;}',
    '.gex-light svg{opacity:0;transition:opacity .12s;}',
    '.gex-lights:hover svg{opacity:.75;}',
    '.gex-card{animation:gexRise .3s ease both;}',
    '.gex-card:nth-child(2){animation-delay:.03s;}.gex-card:nth-child(3){animation-delay:.06s;}.gex-card:nth-child(4){animation-delay:.09s;}',
    '.gex-card:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(0,0,0,.35);}',
    '.gex-fav{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;color:#63636a;transition:all .15s;flex:none;}',
    '.gex-fav:hover{background:rgba(255,255,255,.1);color:#ffd60a;}',
    '.gex-fav.on{color:#ffd60a;}',
    '.gex-host{display:flex;align-items:center;gap:7px;margin-bottom:5px;}',
    '.gex-host img{width:16px;height:16px;border-radius:4px;flex:none;background:rgba(255,255,255,.1);}',
    '.gex-host span{font-size:11px;font-weight:600;letter-spacing:-.01em;color:#e8e8ed;}',
    '.gex-host em{font-style:normal;font-size:9.5px;color:#63636a;}',
    '.gex-tech{background:rgba(191,90,242,.14)!important;color:#d9a7ff!important;border-color:rgba(191,90,242,.3)!important;}',
    '.gex-detail{margin-top:8px;border-top:1px solid rgba(255,255,255,.07);padding-top:8px;}',
    '.gex-kv{display:flex;justify-content:space-between;gap:10px;font-size:10px;padding:2.5px 0;color:#8e8e93;}',
    '.gex-kv b{color:#d3d3d8;font-weight:500;font-family:ui-monospace,Menlo,monospace;word-break:break-all;text-align:right;max-width:70%;}',
    '.gex-parts{margin:6px 0 2px;}',
    '.gex-part{display:flex;align-items:center;gap:8px;font-size:10px;color:#8e8e93;padding:1.5px 0;}',
    '.gex-part i{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;position:relative;display:block;}',
    '.gex-part i b{position:absolute;top:0;bottom:0;left:0;border-radius:3px;display:block;}',
    '.gex-seg{display:flex;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:2px;gap:1px;flex:none;}',
    '.gex-seg button{padding:4px 9px;border-radius:7px;font-size:10.5px;font-weight:500;color:#8e8e93;}',
    '.gex-seg button.on{background:rgba(255,255,255,.14);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);}',
    '.gex-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#b9b9c0;flex:none;}',
    '.gex-iconbtn:hover{background:rgba(255,255,255,.12);color:#fff;}',
    '.gex-iconbtn.on{background:rgba(255,214,10,.16);border-color:rgba(255,214,10,.35);color:#ffd60a;}',
    '#gex-theater{position:fixed;inset:0;z-index:2147483001;background:rgba(5,5,8,.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);display:flex;flex-direction:column;animation:gexFade .25s ease;}',
    '@keyframes gexFade{from{opacity:0}to{opacity:1}}',
    '#gex-theater .bar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08);color:#fff;font:500 12.5px/1.4 -apple-system,system-ui,sans-serif;}',
    '#gex-theater iframe{flex:1;width:100%;border:0;background:#000;}',
    '#' + ROOT_ID + '.compact .gex-card{padding:7px 10px;}',
    '#' + ROOT_ID + '.compact .gex-bar{display:none;}',
    '#' + ROOT_ID + '.compact .gex-url{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#' + ROOT_ID + '.compact .gex-actions{margin-top:6px;}'
  ].join('\n');

  var ICONS = {
    logo: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M6.5 11.5h3.5M8.25 9.75v3.5"/><circle cx="15.5" cy="10.75" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M7.5 10L12 14.5 16.5 10"/><path d="M4 20h16"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 4.5v5h-5"/><path d="M20.2 14a8.2 8.2 0 1 1-1.3-6.4l1.6-1.7"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5V4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6"/></svg>',
    open: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 12 4l9 4.5-9 4.5z"/><path d="M3 8.5v7L12 20l9-4.5v-7"/><path d="M12 13v7"/></svg>',
    code: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l-5 6 5 6M15 6l5 6-5 6"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15.5 15.5 3l5.5 5.5L8.5 21z"/><path d="M7 12l2 2M10.5 8.5l2 2M14 5l2 2"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M12 2.5l2.3 6.8 6.7 2.4-6.7 2.4L12 21l-2.3-6.9L3 11.7l6.7-2.4z"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="#7d5a00" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="#7d2e1f" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="#0f5c22" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    drag: '<svg viewBox="0 0 10 16" width="10" height="14" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    target: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>'
  };

  var SOURCE_LABEL = {
    'live-iframe': 'runtime', 'live-fetch': 'runtime', 'live-xhr': 'runtime',
    'iframe': 'iframe', 'embed': 'embed', 'media': 'media', 'link': 'link',
    'script': 'script', 'json': 'json', 'attr': 'attr', 'storage': 'storage',
    'network': 'network', 'global': 'global', 'dom': 'dom', 'srcdoc': 'srcdoc'
  };

  var SWITCHES = [
    ['excludeAssets', 'Block images & static files', 'png · jpg · svg · webp · tiff · heic · fonts · css · video'],
    ['strictImages', 'Strict image guard', 'Also drop image paths & proxies without extensions'],
    ['strict', 'Strict mode', 'Only obvious game endpoints'],
    ['boostSameDomain', 'Boost same-domain', "The page's own host wins ties"],
    ['boostCdn', 'Boost CDNs & buckets', 'cdn. / storage / S3 / R2 / CloudFront'],
    ['unwrapProxies', 'Unwrap proxies', 'Decode ?url=, base64, %3A%2F%2F'],
    ['liveCapture', 'Live capture', 'Hook fetch, XHR and iframe.src'],
    ['compact', 'Compact rows', 'Denser list, single-line URLs'],
    ['autoProbe', 'Auto-probe sizes', 'HEAD-check the top 3 after each scan'],
    ['deepFind', 'Deep source crawl', 'Find downloads & reads external .js / .json']
  ];

  var logLines = [];
  function log(msg) {
    logLines.unshift(new Date().toLocaleTimeString() + '  ' + msg);
    if (logLines.length > 30) logLines.length = 30;
    try { console.debug('%c[GameExtractor] ' + msg, 'color:#0a84ff'); } catch (e) { }
  }

  function toast(msg) {
    var host = document.getElementById(ROOT_ID);
    if (!host) return;
    var old = host.querySelector('.gex-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.className = 'gex-toast';
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1800);
  }

  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  function highlightUrl(u) {
    var safe = esc(String(u).replace(/^https?:\/\//, ''));
    var slash = safe.indexOf('/');
    if (slash < 0) return '<b>' + safe + '</b>';
    return '<b>' + safe.slice(0, slash) + '</b>' + safe.slice(slash);
  }

  function faviconFor(host) {
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=32';
  }

  function namedMatch(it) {
    if (!state.findName) return false;
    if (it.tags && it.tags.indexOf('named') > -1) return true;
    if (state.findHits[keyOf(it.url)]) return true;
    var u = it.url.toLowerCase();
    for (var i = 0; i < state.findVariants.length; i++) {
      if (state.findVariants[i].length > 3 && u.indexOf(state.findVariants[i]) > -1) return true;
    }
    return false;
  }

  function namedCount() {
    var n = 0;
    for (var i = 0; i < items.length; i++) if (namedMatch(items[i])) n++;
    return n;
  }

  function filtered() {
    var q = state.query.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (state.favOnly && !isFav(it.url)) continue;
      if (state.filter === 'name') { if (!state.findName || !namedMatch(it)) continue; }
      else if (state.filter !== 'all' && it.source !== state.filter) continue;
      if (q && (it.url + ' ' + it.source + ' ' + (it.tech || '') + ' ' + it.tags.join(' ')).toLowerCase().indexOf(q) === -1) continue;
      out.push(it);
    }
    if (settings.sort === 'newest') out.sort(function (a, b) { return b.id - a.id; });
    else if (settings.sort === 'host') out.sort(function (a, b) {
      var ha = hostOf(a.url), hb = hostOf(b.url);
      return ha < hb ? -1 : ha > hb ? 1 : b.score - a.score;
    });
    else out.sort(function (a, b) { return b.score - a.score || b.id - a.id; });
    return out;
  }

  function squash(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  function nameVariants(name) {
    var n = String(name || '').toLowerCase().trim();
    if (!n) return [];
    var out = [];
    function add(v) { if (v && v.length >= 3 && out.indexOf(v) === -1) out.push(v); }
    add(n);
    var slug = n.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    add(slug);
    add(slug.replace(/-/g, '_'));
    add(slug.replace(/-/g, ''));
    add(slug.replace(/-/g, '+'));
    add(slug.replace(/-/g, '%20'));
    add(slug.replace(/-/g, '.'));
    var words = n.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length > 1) {
      var camel = words[0];
      for (var c = 1; c < words.length; c++) camel += words[c].charAt(0).toUpperCase() + words[c].slice(1);
      add(camel.toLowerCase());
      var longest = words.slice().sort(function (a, b) { return b.length - a.length; })[0];
      if (longest && longest.length >= 6) add(longest);
    }
    return out;
  }

  // does this blob of text mention the game? exact variants first, then a
  // punctuation-insensitive pass for short strings (urls, attrs, lines)
  function matchesName(hay) {
    if (!hay) return false;
    var h = String(hay).toLowerCase();
    for (var i = 0; i < state.findVariants.length; i++) {
      if (h.indexOf(state.findVariants[i]) > -1) return true;
    }
    if (state.findSquash && state.findSquash.length >= 5 && h.length < 4000) {
      if (squash(h).indexOf(state.findSquash) > -1) return true;
    }
    return false;
  }

  // what the page itself claims the game is called
  function deriveName() {
    try {
      var t = (document.title || '').trim();
      if (t) {
        var segs = t.split(/\s*[|·•—–]\s+|\s+-\s+|\s+–\s+/).filter(Boolean);
        var pick = segs[0] || t;
        if (CORE && CORE.length > 2 && segs.length > 1) {
          var noBrand = segs.filter(function (s) { return s.toLowerCase().indexOf(CORE.toLowerCase()) === -1; });
          if (noBrand.length) pick = noBrand[0];
        }
        pick = pick
          .replace(/^(play|watch|run|download)\s+/i, '')
          .replace(/\s+(game|games|portal|arcade|web|online|free|unblocked)\s*$/i, '')
          .trim();
        if (pick && pick.length > 2) return pick.slice(0, 80);
      }
    } catch (e) { }
    try {
      var h = document.querySelector('h1, h2');
      if (h && h.textContent && h.textContent.trim().length > 2) return h.textContent.trim().slice(0, 80);
    } catch (e) { }
    try {
      var og = document.querySelector('meta[property="og:title"]');
      if (og && og.getAttribute('content')) return og.getAttribute('content').trim().slice(0, 80);
    } catch (e) { }
    try {
      var sp = location.pathname.split('/').filter(Boolean);
      for (var i = sp.length - 1; i >= 0; i--) {
        var s = sp[i].replace(/\.(html?|php|asp|aspx|jsp)$/i, '');
        if (!/^(game|games|play|embed|iframe|player|index|view|load|show|page|roms?|v\d+)$/i.test(s) && s.length > 2) {
          return s.replace(/[-_+]/g, ' ').trim();
        }
      }
    } catch (e) { }
    return CURRENT_HOST || '';
  }

  // ---- evidence ledger ---------------------------------------------------
  var WHY_WEIGHT = { 'in url': 34, 'same record': 30, 'filename': 30, 'config value': 26, 'same line': 24, 'near name': 14, 'sibling': 12 };

  function noteFind(raw, baseUrl, label, why) {
    if (raw == null) return false;
    var s = String(raw).trim();
    if (!s || s.length < 4 || s.length > 2000) return false;
    if (/^(data:|javascript:|mailto:|tel:|#)/i.test(s)) return false;
    // must actually look like a url or a path — not a title, label or sentence
    if (/\s/.test(s)) return false;
    if (!/^(https?:)?\/\//i.test(s) && s.indexOf('/') === -1 && !/\.[a-z0-9]{2,9}($|[?#])/i.test(s)) return false;
    var abs = resolveUrl(unwrap(s), baseUrl || document.baseURI);
    if (!abs) return false;
    // the file we're reading is not the game it describes
    if (baseUrl && keyOf(abs) === keyOf(baseUrl)) return false;
    // a bare .js/.css sitting near the name is the carrier, not the build —
    // only accept it when a config points at it or its filename is the name
    if (/\.(m?js|css)(\?|#|$)/i.test(abs) && why !== 'config value' && why !== 'same record') {
      var bn = (abs.split(/[?#]/)[0].split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
      if (!state.findSquash || squash(bn).indexOf(state.findSquash) === -1) return false;
    }
    var k = keyOf(abs);
    var rec = state.findHits[k];
    if (!rec) { rec = state.findHits[k] = { bonus: 0, why: [], url: abs }; }
    var w = WHY_WEIGHT[why] || 10;
    // strongest single reason, plus a small bonus for corroboration
    rec.bonus = Math.max(rec.bonus, w) + Math.min(8, rec.why.length * 2);
    var tagline = label + ' · ' + why;
    if (rec.why.indexOf(tagline) === -1) rec.why.push(tagline);
    addCandidate(abs, 'finder');
    return true;
  }

  var URL_RE = /https?:\/\/[^\s"'`<>()\\]{6,400}/gi;
  var PATH_RE = /["'`]((?:\.{0,2}\/)?[A-Za-z0-9_\-./%]{4,220}\.(?:html?|js|mjs|json|swf|wasm|unityweb|data|pck|zip|br|gz|bin|assets|bundle))(?:[?#][^"'`]{0,200})?["'`]/gi;

  function harvestWindow(win, baseUrl, label, why) {
    var n = 0, m, guard = 0;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(win)) !== null && guard++ < 60) {
      if (noteFind(m[0].replace(/[.,;)\]}'"]+$/, ''), baseUrl, label, why)) n++;
    }
    guard = 0;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(win)) !== null && guard++ < 60) {
      if (noteFind(m[1], baseUrl, label, why)) n++;
    }
    return n;
  }

  // the smallest {...} record containing pos — keeps "neon-drift" from
  // claiming the build URL that belongs to the entry next to it
  function recordSlice(text, pos) {
    var LIM = 1400, depth = 0, start = -1, end = -1, i;

    // if the name is a KEY ("neon-drift": { ... }), its own value-object is
    // the record — walking outward would swallow every sibling entry
    var look = text.slice(pos, pos + 60);
    var kv = look.match(/^[^"'`]{0,40}?["'`]?\s*[:=]\s*\{/);
    if (kv) {
      var brace = pos + kv[0].length - 1;
      var d2 = 0;
      for (i = brace; i < text.length && i - brace < LIM; i++) {
        var ch = text.charAt(i);
        if (ch === '{') d2++;
        else if (ch === '}') { d2--; if (d2 === 0) return text.slice(brace, i + 1); }
      }
    }

    for (i = pos; i >= 0 && pos - i < LIM; i--) {
      var c = text.charAt(i);
      if (c === '}') depth++;
      else if (c === '{') { if (depth === 0) { start = i; break; } depth--; }
    }
    if (start < 0) return null;
    depth = 0;
    for (i = pos; i < text.length && i - pos < LIM; i++) {
      var d = text.charAt(i);
      if (d === '{') depth++;
      else if (d === '}') { if (depth === 0) { end = i; break; } depth--; }
    }
    if (end < 0) return null;
    var slice = text.slice(start, end + 1);
    return slice.length > 8 && slice.length <= LIM ? slice : null;
  }

  // read the actual code: every place the name appears, grab the URLs around it
  function searchText(text, baseUrl, label) {
    if (!text || text.length < 4) return 0;
    var lower = text.toLowerCase();
    var pos = [];
    for (var v = 0; v < state.findVariants.length; v++) {
      var needle = state.findVariants[v];
      var from = 0, at, guard = 0;
      while ((at = lower.indexOf(needle, from)) > -1 && guard++ < 300) {
        pos.push(at);
        from = at + needle.length;
      }
    }
    if (!pos.length) return 0;
    pos.sort(function (a, b) { return a - b; });
    var found = 0, last = -99999;
    for (var p = 0; p < pos.length && p < 150; p++) {
      if (pos[p] - last < 120) continue;          // same neighbourhood, skip
      last = pos[p];
      var tight = 0;

      // 1. the enclosing record — highest confidence, never bleeds into siblings
      var rec = recordSlice(text, pos[p]);
      if (rec) tight += harvestWindow(rec, baseUrl, label, 'same record');

      // 2. the same line / statement
      var lineStart = text.lastIndexOf('\n', pos[p]);
      var lineEnd = text.indexOf('\n', pos[p]);
      if (lineStart < 0) lineStart = 0;
      if (lineEnd < 0) lineEnd = text.length;
      if (lineEnd - lineStart < 600) {
        tight += harvestWindow(text.slice(lineStart, lineEnd), baseUrl, label, 'same line');
      }

      // 3. only if nothing precise turned up, widen — and stop at record walls
      if (!tight) {
        var from = Math.max(0, pos[p] - 800), to = Math.min(text.length, pos[p] + 800);
        var back = text.lastIndexOf('},', pos[p]);
        if (back > from) from = back + 1;
        var fwd = text.indexOf('},', pos[p]);
        if (fwd > -1 && fwd < to) to = fwd;
        found += harvestWindow(text.slice(from, to), baseUrl, label, 'near name');
      }
      found += tight;
    }
    // whole-object pass: JSON that mentions the name hands over every url inside
    var t = text.trim();
    if (t.length < 600000 && /^[\[{]/.test(t)) {
      try {
        var obj = JSON.parse(t);
        var hits = [];
        walkJson(obj, hits, 0);
        for (var h = 0; h < hits.length; h++) if (noteFind(hits[h], baseUrl, label, 'config value')) found++;
      } catch (e) { }
    }
    return found;
  }

  function finderScanDom(doc, base) {
    var els;
    try { els = doc.querySelectorAll('*'); } catch (e) { return; }
    var cap = Math.min(els.length, 4000);
    for (var i = 0; i < cap; i++) {
      var el = els[i];
      if (!el.attributes || !el.attributes.length) continue;
      var blob = '';
      for (var a = 0; a < el.attributes.length && a < 24; a++) {
        blob += el.attributes[a].name + '=' + String(el.attributes[a].value).slice(0, 300) + ' ';
      }
      var txt = '';
      try { if (!el.children || !el.children.length) txt = (el.textContent || '').slice(0, 200); } catch (e) { }
      if (!matchesName(blob) && !matchesName(txt)) continue;
      for (var b = 0; b < el.attributes.length && b < 24; b++) {
        var v = el.attributes[b].value;
        if (v && v.length > 3 && !/^[{[]/.test(v.trim())) noteFind(v, base, 'dom', 'config value');
      }
      try {
        var anc = el.closest ? el.closest('a[href]') : null;
        if (anc) noteFind(anc.getAttribute('href'), base, 'dom', 'sibling');
      } catch (e) { }
    }
  }

  function finderScanGlobals() {
    var keys;
    try { keys = Object.getOwnPropertyNames(window); } catch (e) { return; }
    for (var i = 0; i < keys.length && i < 1200; i++) {
      var k = keys[i];
      if (/^(webkit|chrome|on[a-z]|document$|location$|history$|navigator$|external$|frames$|parent$|top$|self$|window$)/.test(k)) continue;
      var val;
      try { val = window[k]; } catch (e) { continue; }
      if (!val) continue;
      if (typeof val === 'string') {
        if (matchesName(k) || matchesName(val)) noteFind(val, null, 'global', 'config value');
        continue;
      }
      if (typeof val !== 'object') continue;
      var s;
      try { s = JSON.stringify(val); } catch (e) { continue; }
      if (!s || s.length > 500000) continue;
      if (!matchesName(k) && s.toLowerCase().indexOf(state.findVariants[0]) === -1 && !matchesName(s.slice(0, 3000))) {
        var anyV = false;
        for (var q = 0; q < state.findVariants.length; q++) if (s.toLowerCase().indexOf(state.findVariants[q]) > -1) { anyV = true; break; }
        if (!anyV) continue;
      }
      var hits = [];
      try { walkJson(val, hits, 0); } catch (e) { continue; }
      for (var h = 0; h < hits.length && h < 120; h++) noteFind(hits[h], null, 'global', 'config value');
    }
  }

  function finderScanStorage() {
    var boxes = [];
    try { boxes.push(['localStorage', window.localStorage]); } catch (e) { }
    try { boxes.push(['sessionStorage', window.sessionStorage]); } catch (e) { }
    for (var b = 0; b < boxes.length; b++) {
      var box = boxes[b][1];
      if (!box) continue;
      try {
        for (var i = 0; i < box.length && i < 250; i++) {
          var key = box.key(i);
          var val = String(box.getItem(key) || '');
          if (val.length > 200000) continue;
          if (!matchesName(key) && !matchesName(val)) continue;
          searchText(val, null, boxes[b][0]);
          harvestWindow(val.slice(0, 20000), null, boxes[b][0], 'config value');
        }
      } catch (e) { }
    }
  }

  function finderScanCss() {
    try {
      for (var i = 0; i < document.styleSheets.length && i < 40; i++) {
        var sheet = document.styleSheets[i], rules = null;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (var j = 0; j < rules.length && j < 4000; j++) {
          var t = rules[j].cssText || '';
          if (t.length > 6000 || !matchesName(t)) continue;
          var m = t.match(/url\((["']?)([^"')]+)\1\)/gi) || [];
          for (var k = 0; k < m.length; k++) {
            noteFind(m[k].replace(/^url\(["']?/i, '').replace(/["']?\)$/, ''), sheet.href, 'css', 'near name');
          }
        }
      }
    } catch (e) { }
  }

  function finderScanFrames() {
    var fr;
    try { fr = document.querySelectorAll('iframe,frame'); } catch (e) { return; }
    for (var i = 0; i < fr.length && i < 12; i++) {
      var d = null;
      try { d = fr[i].contentDocument; } catch (e) { d = null; }
      var base = fr[i].getAttribute('src') || document.baseURI;
      if (d) {
        try {
          finderScanDom(d, base);
          var sc = d.querySelectorAll('script:not([src])');
          for (var j = 0; j < sc.length && j < 80; j++) searchText(sc[j].textContent || '', base, 'frame');
        } catch (e) { }
      }
      var sd = fr[i].getAttribute('srcdoc');
      if (sd && sd.length < 600000 && matchesName(sd)) {
        try {
          var parsed = new DOMParser().parseFromString(sd, 'text/html');
          finderScanDom(parsed, base);
          var s2 = parsed.querySelectorAll('script:not([src])');
          for (var n = 0; n < s2.length && n < 60; n++) searchText(s2[n].textContent || '', base, 'srcdoc');
        } catch (e) { }
      }
    }
  }

  // ---- external sources: fetch the real file and read it -----------------
  var SRC_LIMIT = 60;

  function collectSourceRefs() {
    var refs = [], seenSrc = {};
    function push(u, label) {
      if (!u) return;
      var abs = resolveUrl(u);
      if (!abs || !/^https?:/.test(abs) || seenSrc[abs]) return;
      if (IMAGE_EXT.test(abs) || STATIC_EXT.test(abs)) return;
      seenSrc[abs] = 1;
      refs.push({ url: abs, label: label });
    }
    try {
      var s = document.querySelectorAll('script[src]');
      for (var i = 0; i < s.length; i++) push(s[i].getAttribute('src'), 'script');
    } catch (e) { }
    try {
      var l = document.querySelectorAll('link[rel="preload"][as="script"],link[rel="modulepreload"],link[rel="preload"][as="fetch"]');
      for (var j = 0; j < l.length; j++) push(l[j].getAttribute('href'), 'preload');
    } catch (e) { }
    try {
      var entries = performance.getEntriesByType('resource');
      for (var k = 0; k < entries.length; k++) {
        var e2 = entries[k];
        if (/\.(js|mjs|json|txt|map)(\?|$)/i.test(e2.name) || e2.initiatorType === 'fetch' || e2.initiatorType === 'xmlhttprequest') {
          push(e2.name, e2.initiatorType === 'script' ? 'script' : 'runtime');
        }
      }
    } catch (e) { }
    // same-origin first: those always succeed and are usually the real config
    refs.sort(function (a, b) {
      var sa = a.url.indexOf(location.origin) === 0 ? 0 : 1;
      var sb = b.url.indexOf(location.origin) === 0 ? 0 : 1;
      return sa - sb;
    });
    return refs.slice(0, SRC_LIMIT);
  }

  function fetchSource(ref, allowProxy) {
    return fetch(ref.url, { credentials: 'omit', redirect: 'follow' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.text();
    }).catch(function (err) {
      if (!allowProxy) throw err;
      return fetchThroughProxy(ref.url);
    });
  }

  function crawlSources(refs, onText, onDone) {
    if (!refs.length) { onDone(); return; }
    var idx = 0, active = 0, done = 0, proxied = 0;
    var CONC = 5, PROXY_BUDGET = 10;
    function step() {
      while (active < CONC && idx < refs.length) {
        var ref = refs[idx++];
        active++;
        (function (r) {
          var sameOrigin = r.url.indexOf(location.origin) === 0;
          var allowProxy = !sameOrigin && proxied < PROXY_BUDGET;
          if (allowProxy) proxied++;
          fetchSource(r, allowProxy)
            .then(function (txt) { try { onText(r, txt); } catch (e) { } })
            .catch(function () { })
            .then(function () {
              active--; done++;
              state.findProgress = { done: done, total: refs.length };
              if (done % 2 === 0 || done === refs.length) renderFindBar();
              if (done === refs.length) onDone(); else step();
            });
        })(ref);
      }
    }
    step();
  }

  function runFinder(name) {
    var nm = String(name || '').trim();
    if (!nm) { toast('Type a game name first'); return; }

    state.findName = nm;
    state.findVariants = nameVariants(nm);
    state.findSquash = squash(nm);
    state.findHits = {};
    state.findMsg = null;
    state.findProgress = null;
    if (!state.findVariants.length) { toast('Name is too short'); return; }

    var t0 = Date.now();

    // pass 1 — everything already in the page, synchronously
    try {
      var inline = document.querySelectorAll('script:not([src])');
      for (var i = 0; i < inline.length && i < 400; i++) {
        searchText(inline[i].textContent || '', document.baseURI, 'inline');
      }
    } catch (e) { }
    try { finderScanDom(document, document.baseURI); } catch (e) { }
    try { finderScanGlobals(); } catch (e) { }
    try { finderScanStorage(); } catch (e) { }
    try { finderScanCss(); } catch (e) { }
    try { finderScanFrames(); } catch (e) { }
    try { searchText(document.documentElement.innerHTML.slice(0, 400000), document.baseURI, 'html'); } catch (e) { }

    reevaluate();
    state.findMsg = { ok: namedCount() > 0, n: namedCount(), phase: 'page' };
    render();

    if (!settings.deepFind) {
      finish();
      return;
    }

    // pass 2 — fetch every external script/json and read the real code
    var refs = collectSourceRefs();
    state.findProgress = { done: 0, total: refs.length };
    renderFindBar();
    crawlSources(refs, function (ref, text) {
      if (!text) return;
      searchText(text, ref.url, ref.label === 'runtime' ? 'fetched' : 'source');
    }, function () {
      state.findProgress = null;
      reevaluate();
      finish();
    });

    function finish() {
      var n = namedCount();
      state.findMsg = { ok: n > 0, n: n, phase: 'done' };
      log('find "' + nm + '" → ' + n + ' named, ' + Object.keys(state.findHits).length +
        ' evidence in ' + (Date.now() - t0) + 'ms');
      render();
      toast(n ? n + ' match' + (n === 1 ? '' : 'es') + ' for “' + nm + '”' : 'Nothing matched “' + nm + '”');
    }
  }
  function detailHtml(it) {
    var parts = it.parts || [];
    var max = 1;
    for (var i = 0; i < parts.length; i++) max = Math.max(max, Math.abs(parts[i][1]));
    var rows = '';
    for (var j = 0; j < parts.length; j++) {
      var v = parts[j][1];
      var w = Math.round(Math.abs(v) / max * 100);
      var col = v >= 0 ? 'linear-gradient(90deg,#30d158,#0a84ff)' : 'linear-gradient(90deg,#ff9f0a,#ff453a)';
      rows += '<div class="gex-part"><span style="width:118px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(parts[j][0]) + '</span><i><b style="width:' + w + '%;background:' + col + '"></b></i>' +
        '<span style="width:34px;text-align:right;font-family:ui-monospace,monospace;color:#d3d3d8">' + (v > 0 ? '+' + v : v) + '</span></div>';
    }
    return '<div class="gex-detail">' +
      '<div class="gex-kv"><span>host</span><b>' + esc(hostOf(it.url)) + '</b></div>' +
      '<div class="gex-kv"><span>extension</span><b>' + esc(it.ext || '(none)') + '</b></div>' +
      '<div class="gex-kv"><span>engine</span><b>' + esc(it.tech || 'unknown') + '</b></div>' +
      '<div class="gex-kv"><span>seen</span><b>' + it.hits + '× · ' + esc(it.source) + '</b></div>' +
      (it.mime ? '<div class="gex-kv"><span>server says</span><b>' + esc(it.mime) + (it.bytes ? ' · ' + esc(fmtBytes(it.bytes)) : '') + '</b></div>' : '') +
      (it.raw && it.raw !== it.url ? '<div class="gex-kv"><span>found as</span><b>' + esc(it.raw.slice(0, 120)) + '</b></div>' : '') +
      '<div class="gex-parts">' + rows + '</div>' +
      '<div class="gex-actions">' +
      '<button class="gex-mini" data-act="copy-md" data-url="' + esc(it.url) + '">' + ICONS.copy + 'Markdown</button>' +
      '<button class="gex-mini" data-act="copy-curl" data-url="' + esc(it.url) + '">' + ICONS.code + 'curl</button>' +
      '<button class="gex-mini" data-act="copy-embed" data-url="' + esc(it.url) + '">' + ICONS.box + 'Embed</button>' +
      '</div></div>';
  }

  function rowHtml(it, i) {
    var best = i === 0 && settings.sort === 'score';
    var pills = '';
    if (best) pills += '<span class="gex-pill best">' + ICONS.spark + 'TOP MATCH</span>';
    pills += '<span class="gex-pill src">' + esc(SOURCE_LABEL[it.source] || it.source) + '</span>';
    if (it.tags.indexOf('named') > -1 || it.tags.indexOf('name') > -1) pills += '<span class="gex-pill dim gex-named">' + ICONS.target + 'named</span>';
    if (it.tech) pills += '<span class="gex-pill dim gex-tech">' + esc(it.tech) + '</span>';
    var shown = 0;
    for (var t = 0; t < it.tags.length && shown < 2; t++) {
      if (it.tags[t] === it.tech || it.tags[t] === 'name' || it.tags[t] === 'named') continue;
      pills += '<span class="gex-pill dim">' + esc(it.tags[t]) + '</span>';
      shown++;
    }
    if (it.bytes) pills += '<span class="gex-pill dim">' + esc(fmtBytes(it.bytes)) + '</span>';
    var u = it.url;
    var h = hostOf(u);
    var fav = isFav(u);
    var open = state.expanded === it.id;
    return '<div class="gex-card' + (best ? ' top' : '') + '">' +
      '<div class="gex-host"><img src="' + faviconFor(h) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
      '<span>' + esc(h || 'local file') + '</span><em>' + esc(it.ext || (it.tech || 'page')) + ' · ' + it.hits + '×</em>' +
      '<button class="gex-fav' + (fav ? ' on' : '') + '" data-act="fav" data-url="' + esc(u) + '" title="Pin to favorites">' + (fav ? ICONS.starOn : ICONS.star) + '</button></div>' +
      '<div class="gex-topline"><span class="gex-rank">' + (i + 1) + '</span>' + pills +
      '<span style="margin-left:auto;font:600 10px ui-monospace,SFMono-Regular,monospace;color:#8e8e93;background:rgba(255,255,255,.06);padding:1px 7px;border-radius:99px">' + it.score + '</span></div>' +
      '<div class="gex-url">' + highlightUrl(u) + '</div>' +
      '<div class="gex-actions">' +
      '<button class="gex-mini go" data-act="theater" data-url="' + esc(u) + '" title="Distraction-free fullscreen player">' + ICONS.play + 'Play</button>' +
      '<button class="gex-mini" data-act="open" data-url="' + esc(u) + '">' + ICONS.open + 'Open</button>' +
      '<button class="gex-mini" data-act="sandbox" data-url="' + esc(u) + '">' + ICONS.box + 'Sandbox</button>' +
      '<button class="gex-mini" data-act="copy" data-url="' + esc(u) + '">' + ICONS.copy + 'Copy</button>' +
      '<button class="gex-mini" data-act="harvest" data-url="' + esc(u) + '">' + ICONS.code + 'Harvest</button>' +
      '<button class="gex-mini" data-act="details" data-id="' + it.id + '">' + ICONS.info + (open ? 'Hide' : 'Why?') + '</button>' +
      '</div>' +
      (open ? detailHtml(it) : '') +
      '<div class="gex-bar"><i style="width:' + clamp(it.score, 3, 100) + '%"></i></div>' +
      '</div>';
  }

  function listHtml() {
    var list = filtered();
    if (!list.length) {
      if (!items.length) {
        return '<div class="gex-empty"><div style="font-size:26px;margin-bottom:6px">🎮</div><b>Listening for the game…</b>' +
          'Click Play on the page, scroll, or open a level.<br>Captures stream in live from fetch, XHR, iframe.src and DOM mutations.<br>' +
          '<span style="font-size:10.5px;color:#63636a">images · fonts · trackers auto-ignored (' + stats.imgBlocked + ' images, ' + stats.staticBlocked + ' static blocked so far)</span></div>';
      }
      if (state.favOnly) return '<div class="gex-empty"><b>No pinned builds</b>Tap the ☆ on any card to pin it here.</div>';
      return '<div class="gex-empty"><b>Filter active</b>Nothing matches — clear the search or pick another source.</div>';
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
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 5);
    var html = tab('all', 'All', items.length);
    if (state.findName) html += tab('name', 'named', namedCount());
    for (var k = 0; k < keys.length; k++) if (keys[k] !== 'finder') html += tab(keys[k], SOURCE_LABEL[keys[k]] || keys[k], counts[keys[k]]);
    function tab(id, label, n) {
      return '<button class="gex-tab' + (state.filter === id ? ' on' : '') + '" data-act="filter" data-filter="' + id + '">' +
        esc(label) + ' ' + n + '</button>';
    }
    return '<div class="gex-tabs">' + html + '</div>';
  }

  function findRowHtml() {
    if (!state.findOpen && !state.findName) return '';
    var derived = deriveName();
    var msg = '';
    if (state.findProgress) {
      var p = state.findProgress;
      var pct = p.total ? Math.round(p.done / p.total * 100) : 0;
      msg = '<span class="gex-findscan">reading sources ' + p.done + '/' + p.total +
        '<i><b style="width:' + pct + '%"></b></i></span>';
    } else if (state.findMsg) {
      msg = state.findMsg.ok
        ? '<span class="gex-findok">✓ ' + state.findMsg.n + ' match' + (state.findMsg.n === 1 ? '' : 'es') + '</span>'
        : '<span class="gex-findmiss">nothing matched — try the exact slug</span>';
    }
    return '<div class="gex-findbar">' + ICONS.target +
      '<span class="gex-findlabel">find</span>' +
      (state.findName ? '<span class="gex-findq">' + esc(state.findName) + '</span>' : '') +
      '<input type="text" data-finder value="' + esc(state.findInput) + '" placeholder="' + (derived ? 'e.g. ' + esc(derived) : 'game name') + '" spellcheck="false" aria-label="Game name">' +
      '<button class="gex-mini go" data-act="find-go" title="Read every source for this name">Find</button>' +
      msg +
      (state.findName ? '<button class="gex-mini" data-act="find-clear" title="Clear name filter">Clear</button>' : '') +
      '</div>';
  }

  // progress ticks shouldn't rebuild the whole panel
  function renderFindBar() {
    var host = document.getElementById(ROOT_ID);
    if (!host) return;
    var a = document.activeElement;
    if (a && a.hasAttribute && a.hasAttribute('data-finder')) {
      var only = host.querySelector('.gex-findscan');
      if (only && state.findProgress) {
        var p = state.findProgress;
        var pct = p.total ? Math.round(p.done / p.total * 100) : 0;
        only.innerHTML = 'reading sources ' + p.done + '/' + p.total + '<i><b style="width:' + pct + '%"></b></i>';
      }
      return;
    }
    var bar = host.querySelector('[data-find]');
    if (bar) bar.innerHTML = findRowHtml();
  }

  function settingsHtml() {
    var rows = '';
    for (var i = 0; i < SWITCHES.length; i++) {
      var s = SWITCHES[i];
      rows += '<div class="gex-opt"><span class="lbl">' + s[1] + '<span class="sub">' + s[2] + '</span></span>' +
        '<div class="gex-sw' + (settings[s[0]] ? ' on' : '') + '" data-act="opt" data-key="' + s[0] + '" role="switch" aria-checked="' +
        !!settings[s[0]] + '"><i></i></div></div>';
    }
    return '<div class="gex-set"><div class="gex-panel"><h4>Filters</h4>' + rows +
      '<div class="gex-opt"><span class="lbl">Minimum score<span class="sub">Lower = noisier</span></span>' +
      '<div class="gex-num"><input type="range" min="-20" max="90" step="5" value="' + settings.minScore +
      '" data-act="range" aria-label="Minimum score"><output>' + settings.minScore + '</output></div></div>' +
      '<div class="gex-row" style="margin-top:8px">' +
      '<button class="gex-btn" style="flex:1;justify-content:center" data-act="rescan">' + ICONS.refresh + 'Re-scan now</button>' +
      '<button class="gex-btn ghost" data-act="reset">Defaults</button>' +
      '</div>' +
      '<div class="gex-log"><div class="t">Activity</div>' +
      (logLines.length
        ? logLines.slice(0, 6).map(function (l) { return '<div class="l">' + esc(l) + '</div>'; }).join('')
        : '<div class="l" style="color:#55555c">quiet so far</div>') +
      '</div></div></div>';
  }

  function sortSeg() {
    function b(id, label) {
      return '<button data-act="sort" data-sort="' + id + '" class="' + (settings.sort === id ? 'on' : '') + '">' + label + '</button>';
    }
    return '<div class="gex-seg" role="tablist" aria-label="Sort">' + b('score', 'Top') + b('newest', 'New') + b('host', 'Host') + '</div>';
  }

  function shellHtml() {
    return '<div class="gex-head" data-handle>' +
      '<span class="gex-lights"><span class="gex-light r" data-act="close" title="Dismiss">' + ICONS.x + '</span>' +
      '<span class="gex-light y" data-act="min" title="Minimise (Esc)">' + ICONS.minus + '</span>' +
      '<span class="gex-light g" data-act="theater-top" title="Play top match fullscreen">' + ICONS.plus + '</span></span>' +
      '<span class="gex-mark">' + ICONS.logo + '</span>' +
      '<span><span class="gex-title">Game Extractor</span> <span class="gex-v">v' + VERSION.split('.').slice(0, 2).join('.') + '</span></span>' +
      '<span class="gex-live"><i></i><span data-status>idle</span></span>' +
      '<span style="margin-left:auto;display:flex;gap:6px;align-items:center">' +
      '<button class="gex-iconbtn' + (state.favOnly ? ' on' : '') + '" data-act="favonly" title="Pinned only">' + (state.favOnly ? ICONS.starOn : ICONS.star) + '</button>' +
      '<button class="gex-iconbtn' + (state.findName ? ' on gex-find' : '') + '" data-act="find" title="Find a build by name (Alt+F)">' + ICONS.target + '</button>' +
      '<button class="gex-iconbtn" data-act="settings" title="Filters">' + ICONS.gear + '</button>' +
      '</span></div>' +
      '<div class="gex-tool">' +
      '<div data-find>' + findRowHtml() + '</div>' +
      '<div class="gex-row">' +
      '<label class="gex-field">' + ICONS.search +
      '<input type="text" data-query placeholder="Filter by host, engine, source…  ( / )" spellcheck="false" aria-label="Filter results" value="' + esc(state.query) + '"></label>' +
      sortSeg() +
      '</div>' +
      '<div class="gex-row"><div data-tabs style="flex:1;min-width:0">' + tabsHtml() + '</div>' +
      '<button class="gex-btn" data-act="copyall" title="Copy every visible URL">' + ICONS.copy + '</button>' +
      '<button class="gex-btn" data-act="gallery" title="Save every candidate as a standalone HTML gallery">' + ICONS.grid + '</button>' +
      '<button class="gex-btn" data-act="export" title="Export JSON report">' + ICONS.download + '</button></div>' +
      '</div>' +
      '<div class="gex-meta"><span>host <b>' + esc(CURRENT_HOST || 'sandbox') + '</b></span>' +
      '<span><b data-count>' + filtered().length + '</b> shown · <b>' + items.length + '</b> kept · <b>' + stats.imgBlocked + '</b> images blocked</span></div>' +
      '<div class="gex-body" data-body>' + listHtml() + '</div>' +
      '<div data-settings data-open="0"></div>' +
      '<div class="gex-foot"><span class="gex-hint"><kbd>Alt</kbd><kbd>G</kbd> toggle <span style="width:10px"></span><kbd>Alt</kbd><kbd>F</kbd> find <span style="width:10px"></span><kbd>⇧↵</kbd> theater</span>' +
      '<span style="margin-left:auto;font-size:10px;color:#6a6a70">authorised sites only</span></div>';
  }

  function render() {
    var host = document.getElementById(ROOT_ID);
    if (!host) return;
    host.classList.toggle('compact', !!settings.compact);
    var list = filtered();
    var meta = host.querySelector('.gex-meta span:last-child');
    if (meta) meta.innerHTML = '<b>' + list.length + '</b> shown · <b>' + items.length + '</b> kept · <b>' + stats.imgBlocked + '</b> images blocked';
    var body = host.querySelector('[data-body]');
    var active = document.activeElement;
    var skipFinder = !!(active && active.hasAttribute && active.hasAttribute('data-finder') && active === host.querySelector('[data-finder]'));
    var qVal = null;
    if (active && active.hasAttribute && active.hasAttribute('data-query')) qVal = { v: active.value, s: active.selectionStart };
    if (body) body.innerHTML = listHtml();
    var fbar = host.querySelector('[data-find]');
    if (fbar && !skipFinder) fbar.innerHTML = findRowHtml();
    var tabs = host.querySelector('[data-tabs]');
    if (tabs) tabs.innerHTML = tabsHtml();
    var seg = host.querySelector('.gex-seg');
    if (seg) seg.innerHTML = sortSeg().replace(/^<div[^>]*>|<\/div>$/g, '');
    var st = host.querySelector('[data-status]');
    if (st) st.textContent = status === 'scanning' ? 'scanning…' : (items.length ? 'watching' : 'idle');
    if (qVal) {
      var inp = host.querySelector('[data-query]');
      if (inp && document.activeElement !== inp) { inp.value = qVal.v; inp.focus(); try { inp.setSelectionRange(qVal.s, qVal.s); } catch (e) { } }
    }
  }

  var bubble = null;

  function buildBubble() {
    bubble = document.createElement('button');
    bubble.id = 'gex-min';
    bubble.type = 'button';
    bubble.innerHTML = '<span class="dot"></span>Extractor <b style="color:#fff">' + items.length + '</b>';
    bubble.title = 'Restore Game Extractor (Alt+G)';
    bubble.addEventListener('click', function (e) { e.preventDefault(); setMinimised(false); });
    document.documentElement.appendChild(bubble);
    bubble.style.display = 'none';
  }

  function setMinimised(min) {
    state.min = min;
    var host = document.getElementById(ROOT_ID);
    if (host) host.style.display = min ? 'none' : '';
    if (!bubble) buildBubble();
    bubble.style.display = min ? 'flex' : 'none';
    if (min) bubble.innerHTML = '<span class="dot"></span>Extractor <b style="color:#fff">' + items.length + '</b>';
  }

  function restorePos(host) {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        var w = host.offsetWidth || 660;
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
      if (e.target.closest && (e.target.closest('button') || e.target.closest('[data-act]'))) return;
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

    // don't yank a row out of the DOM mid-click
    host.addEventListener('pointerdown', function () { interactingUntil = Date.now() + 420; });

    host.addEventListener('click', onClick);
    host.addEventListener('input', onInput);
    host.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.getAttribute) {
        if (e.target.hasAttribute('data-finder')) {
          e.preventDefault();
          runFinder(e.target.value || deriveName());
          return;
        }
        if (e.target.hasAttribute('data-query')) {
          var top = filtered();
          if (!top.length) return;
          if (e.shiftKey) openTheater(top[0].url);
          else openUrl(top[0].url);
        }
      }
    });
  }
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
      if (ok) done(); else toast('Copy blocked by browser');
    } catch (e) { toast('Copy blocked by browser'); }
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
    doc.write('<!doctype html><html style="height:100%"><head><meta charset="utf-8"><title>Sandbox · ' + esc(hostOf(u)) + '</title>' +
      '<style>html,body{margin:0;height:100%;background:#08080a;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}' +
      '#b{position:fixed;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#0a84ff,#bf5af2);z-index:9}</style></head><body>' +
      '<div id="b"></div><iframe src="' + esc(u) +
      '" allow="autoplay; fullscreen; gamepad *; xr-spatial-tracking; accelerometer; gyroscope; clipboard-write" allowfullscreen></iframe>' +
      '</body></html>');
    doc.close();
    toast('Sandbox opened');
  }

  function openTheater(u) {
    closeTheater(true);
    state.theater = u;
    var ov = document.createElement('div');
    ov.id = 'gex-theater';
    ov.innerHTML = '<div class="bar"><button class="gex-iconbtn" data-gexback title="Back (Esc)">' + ICONS.back + '</button>' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>' + esc(hostOf(u)) + '</b> <span style="opacity:.55">' + esc(u.slice(0, 90)) + '</span></span>' +
      '<span style="margin-left:auto;display:flex;gap:8px">' +
      '<button class="gex-iconbtn" data-gexopen title="Open in new tab">' + ICONS.open + '</button>' +
      '<button class="gex-iconbtn" data-gexcopy title="Copy URL">' + ICONS.copy + '</button>' +
      '<button class="gex-iconbtn" data-gexclose title="Close">' + ICONS.x + '</button></span></div>' +
      '<iframe src="' + esc(u) + '" allow="autoplay; fullscreen; gamepad *; xr-spatial-tracking; accelerometer; gyroscope; clipboard-write; encrypted-media" allowfullscreen allowtransparency="true"></iframe>';
    ov.addEventListener('click', function (e) {
      var t = e.target;
      var b = t.closest ? t.closest('[data-gexback],[data-gexclose],[data-gexopen],[data-gexcopy]') : null;
      if (t === ov) { closeTheater(); return; }
      if (!b) return;
      if (b.hasAttribute('data-gexback') || b.hasAttribute('data-gexclose')) closeTheater();
      else if (b.hasAttribute('data-gexopen')) openUrl(u);
      else if (b.hasAttribute('data-gexcopy')) copyText(u, 'URL copied');
    });
    document.documentElement.appendChild(ov);
    var host = document.getElementById(ROOT_ID);
    if (host) host.style.display = 'none';
    if (bubble) bubble.style.display = 'none';
  }

  function closeTheater(silent) {
    var ov = document.getElementById('gex-theater');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    if (!state) return;
    state.theater = null;
    if (silent) return;
    var host = document.getElementById(ROOT_ID);
    if (host && !state.min) host.style.display = '';
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
      new Promise(function (_res, rej) { setTimeout(function () { rej(new Error('timeout')); }, 15000); })
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
      var shell = '<!doctype html><html style="height:100%"><head><meta charset="utf-8"><title>' + esc(hostOf(u) || 'Game') +
        '</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}' +
        '</style></head><body><iframe src="' + esc(u) +
        '" allow="autoplay; fullscreen; gamepad *" allowfullscreen></iframe></body></html>';
      download(shell, 'game-' + (hostOf(u) || 'build') + '-shell.html', 'text/html;charset=utf-8');
      btn.innerHTML = ICONS.code + 'Shell ✓';
      toast('Source blocked — saved an iframe shell');
    }).then(function () {
      setTimeout(function () { btn.innerHTML = label; }, 1600);
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

  function exportGallery() {
    var list = filtered();
    if (!list.length) { toast('Nothing to export'); return; }
    var cards = list.map(function (it, i) {
      return '<div class="c"><div class="top"><img src="https://www.google.com/s2/favicons?domain=' +
        encodeURIComponent(hostOf(it.url)) + '&sz=64" onerror="this.remove()">' +
        '<span class="h"><b>' + (i + 1) + '. ' + esc(hostOf(it.url)) + '</b><small>' +
        esc(it.tech || SOURCE_LABEL[it.source] || it.source) + ' · score ' + it.score + '</small></span></div>' +
        '<div class="u">' + esc(it.url) + '</div>' +
        '<div class="a"><a class="o" href="' + esc(it.url) + '" target="_blank" rel="noopener">Open</a>' +
        '<button class="e" data-u="' + esc(it.url) + '">Embed code</button>' +
        '<button class="s" data-u="' + esc(it.url) + '">Sandbox</button></div></div>';
    }).join('');
    var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Game gallery · ' + esc(hostOf(location.href || '')) + '</title>' +
      '<style>*{box-sizing:border-box}body{margin:0;background:#0b0b10;color:#f5f5f7;font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;padding:36px 20px}' +
      '.w{max-width:1100px;margin:0 auto}h1{font-size:22px;letter-spacing:-.02em;margin:0}p.m{color:#8e8e93;font-size:12px;margin-top:6px}' +
      '.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:22px}' +
      '.c{background:#15151b;border:1px solid #262630;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:9px}' +
      '.top{display:flex;align-items:center;gap:10px}.top img{width:26px;height:26px;border-radius:7px}.h{display:flex;flex-direction:column;min-width:0}' +
      '.h b{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.h small{color:#7c7c81;font-size:11px}' +
      '.u{font:11px/1.5 ui-monospace,Menlo,monospace;color:#a9a9b0;word-break:break-all}' +
      '.a{display:flex;gap:8px;margin-top:auto;flex-wrap:wrap}.o{background:linear-gradient(180deg,#2c95ff,#0a73e8);color:#fff;text-decoration:none;font-size:12px;font-weight:600;padding:7px 13px;border-radius:9px}' +
      '.e,.s{background:#22222b;border:1px solid #2e2e3a;color:#c9c9d4;font-size:12px;padding:7px 11px;border-radius:9px;cursor:pointer}' +
      '.e:hover,.s:hover{background:#2a2a34}#tip{position:fixed;left:16px;bottom:16px;background:#30d158;color:#04120f;font-weight:600;font-size:12px;padding:8px 14px;border-radius:99px;display:none;z-index:9}</style></head>' +
      '<body><div class="w"><h1>Extracted games · ' + esc(CURRENT_HOST || 'page') + '</h1>' +
      '<p class="m">Generated ' + new Date().toLocaleString() + ' · ' + list.length + ' candidates · Game Extractor v' + VERSION + '</p>' +
      '<div class="g">' + cards + '</div></div><div id="tip"></div>' +
      '<script>function cpy(t){try{navigator.clipboard.writeText(t).then(function(){},function(){fb()})}catch(e){fb()}function fb(){var ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove()}' +
      'var p=document.getElementById("tip");p.textContent="Copied to clipboard";p.style.display="block";setTimeout(function(){p.style.display="none"},1300)}' +
      'document.querySelectorAll(".e").forEach(function(b){b.addEventListener("click",function(){cpy(\'<iframe src="\'+b.dataset.u+\'" style="width:100%;height:100%;border:0" allow="autoplay; fullscreen; gamepad *" allowfullscreen><\\/iframe>\')})})' +
      'document.querySelectorAll(".s").forEach(function(b){b.addEventListener("click",function(){window.open(b.dataset.u,"_blank")})})<\/script></body></html>';
    download(html, 'game-gallery-' + (CORE || 'page') + '.html', 'text/html;charset=utf-8');
    toast('HTML gallery saved');
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var url = btn.getAttribute('data-url');
    var host = document.getElementById(ROOT_ID);
    if (!host) return;

    if (act === 'close') { teardown(); return; }
    if (act === 'min') { setMinimised(true); return; }

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
      btn.classList.toggle('on', !!settings[key]);
      btn.setAttribute('aria-checked', String(!!settings[key]));
      store();
      if (key === 'compact' || key === 'autoProbe') { render(); return; }
      items = []; seen = {}; state.expanded = 0;
      stats.seen = 0; stats.imgBlocked = 0; stats.staticBlocked = 0;
      scanAll('filters');
      return;
    }

    if (act === 'rescan') {
      items = []; seen = {}; state.expanded = 0;
      stats.seen = 0; stats.imgBlocked = 0; stats.staticBlocked = 0;
      scanAll('manual'); toast('Re-scanned'); return;
    }

    if (act === 'reset') {
      settings = clone(DEFAULTS); store();
      var wrap2 = host.querySelector('[data-settings]');
      if (wrap2) wrap2.innerHTML = settingsHtml();
      items = []; seen = {}; state.expanded = 0; state.favOnly = false;
      stats.seen = 0; stats.imgBlocked = 0; stats.staticBlocked = 0;
      scanAll('reset');
      return;
    }

    if (act === 'filter') {
      state.filter = btn.getAttribute('data-filter') || 'all';
      state.showAll = false;
      render();
      return;
    }

    if (act === 'more') { state.showAll = true; render(); return; }

    if (act === 'copyall') {
      var list = filtered();
      if (!list.length) { toast('Nothing to copy'); return; }
      copyText(list.map(function (i) { return i.url; }).join('\n'), list.length + ' URLs copied');
      return;
    }

    if (act === 'export') {
      if (!items.length) { toast('Nothing to export'); return; }
      download(JSON.stringify({
        generator: 'Game Extractor ' + VERSION,
        host: CURRENT_HOST,
        page: location.href,
        capturedAt: new Date().toISOString(),
        settings: settings,
        stats: { candidates: items.length, imagesBlocked: stats.imgBlocked, staticBlocked: stats.staticBlocked },
        results: items.map(function (i) {
          return { url: i.url, host: hostOf(i.url), source: i.source, score: i.score, tech: i.tech || null, ext: i.ext || null, tags: i.tags, breakdown: i.parts || [], hits: i.hits, bytes: i.bytes || undefined, mime: i.mime || undefined, favorite: isFav(i.url) };
        })
      }, null, 2), (CORE || 'page') + '-extracted.json', 'application/json');
      toast('JSON exported');
      return;
    }

    if (act === 'open') { openUrl(url); return; }
    if (act === 'sandbox') { openSandbox(url); return; }
    if (act === 'harvest') { harvest(url, btn); return; }
    if (act === 'theater') { openTheater(url); return; }
    if (act === 'theater-top') {
      var top = filtered();
      if (top.length) openTheater(top[0].url); else toast('Nothing to play yet');
      return;
    }

    if (act === 'fav') { toggleFav(url); render(); return; }
    if (act === 'favonly') { state.favOnly = !state.favOnly; state.showAll = false; render(); return; }

    if (act === 'find') {
      state.findOpen = !state.findOpen;
      render();
      var fi = host.querySelector('[data-finder]');
      if (state.findOpen && fi) fi.focus();
      return;
    }
    if (act === 'find-go') {
      var finput = host.querySelector('[data-finder]');
      runFinder((finput ? finput.value : state.findInput) || deriveName());
      return;
    }
    if (act === 'find-clear') {
      state.findName = ''; state.findVariants = []; state.findSquash = '';
      state.findHits = {}; state.findMsg = null; state.findInput = ''; state.findProgress = null;
      if (state.filter === 'name') state.filter = 'all';
      reevaluate(); render();
      return;
    }
    if (act === 'gallery') { exportGallery(); return; }
    if (act === 'sort') {
      settings.sort = btn.getAttribute('data-sort') || 'score';
      state.showAll = false; store(); render(); return;
    }
    if (act === 'details') {
      var id = parseInt(btn.getAttribute('data-id'), 10);
      state.expanded = state.expanded === id ? 0 : id;
      render(); return;
    }

    if (act === 'copy') {
      copyText(url, 'URL copied');
      var orig = btn.innerHTML;
      btn.innerHTML = ICONS.copy + 'Copied';
      setTimeout(function () { btn.innerHTML = orig; }, 1200);
      return;
    }
    if (act === 'copy-md') { copyText('[' + hostOf(url) + '](' + url + ')', 'Markdown copied'); return; }
    if (act === 'copy-curl') { copyText('curl -L ' + JSON.stringify(url) + ' -o game.html', 'curl copied'); return; }
    if (act === 'copy-embed') {
      copyText('<iframe src="' + url + '" style="width:100%;height:100%;border:0" allow="autoplay; fullscreen; gamepad *" allowfullscreen></iframe>', 'Embed copied');
      return;
    }

    if (act === 'probe') {
      var found = null;
      for (var i = 0; i < items.length; i++) if (items[i].url === url) found = items[i];
      if (!found) { toast('Not found'); return; }
      probeSize(found);
      toast('Probing size…');
      return;
    }
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.hasAttribute('data-finder')) {
      // store the draft only — re-rendering here would jump the caret
      state.findInput = t.value;
      return;
    }
    if (t.hasAttribute('data-query')) {
      state.query = t.value;
      render();
      return;
    }
    if (t.getAttribute('data-act') === 'range') {
      settings.minScore = clamp(parseInt(t.value, 10) || 0, -20, 90);
      var out = t.parentNode.querySelector('output');
      if (out) out.textContent = String(settings.minScore);
      clearTimeout(onInput._t);
      onInput._t = setTimeout(function () { reevaluate(); store(); }, 260);
    }
  }

  function reevaluate() {
    var old = items;
    items = []; seen = {};
    for (var i = 0; i < old.length; i++) {
      var v = scoreCandidate(old[i].url, old[i].source, old[i].raw);
      if (!v || v.score < settings.minScore) continue;
      items.push({
        id: old[i].id, url: old[i].url, raw: old[i].raw, source: old[i].source,
        score: v.score, tags: v.tags, parts: v.parts, tech: v.tech, ext: v.ext,
        hits: old[i].hits, bytes: old[i].bytes, fav: isFav(old[i].url),
        mime: old[i].mime, probing: old[i].probing
      });
    }
    items.sort(function (a, b) { return b.score - a.score || b.id - a.id; });
    reindex();
    dirty = true;
    scheduleRender();
  }

  var renderTimer = null;
  var interactingUntil = 0;

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () {
      renderTimer = null;
      if (Date.now() < interactingUntil) { scheduleRender(); return; }
      render();
      if (bubble && state.min) bubble.innerHTML = '<span class="dot"></span>Extractor <b style="color:#fff">' + items.length + '</b>';
    }, 120);
  }

  function teardown() {
    try { if (mo) mo.disconnect(); } catch (e) { }
    mo = null;
    try { closeTheater(true); } catch (e) { }
    for (var i = 0; i < restoreHooks.length; i++) { try { restoreHooks[i](); } catch (e) { } }
    restoreHooks = [];
    var host = document.getElementById(ROOT_ID);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    var st = document.getElementById('gex-style');
    if (st && st.parentNode) st.parentNode.removeChild(st);
    if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
    bubble = null;
    window.__gex = null;
    window.removeEventListener('keydown', onKey, true);
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
    urls: function () { return items.map(function (i) { return i.url; }); },
    find: function (name) {
      state.findOpen = true;
      state.findInput = name || '';
      render();
      if (name) runFinder(name);
    },
    named: function () { return items.filter(function (i) { return namedMatch(i); }).map(function (i) { return i.url; }); },
    favorites: function () { return Object.keys(favs); },
    theater: function (u) { openTheater(u || (filtered()[0] && filtered()[0].url)); },
    settings: settings,
    teardown: teardown
  };

  function onKey(e) {
    if (e.altKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); toggle(); return; }
    if (e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      var root = document.getElementById(ROOT_ID);
      if (root && !state.min) {
        state.findOpen = true;
        render();
        var fi = root.querySelector('[data-finder]');
        if (fi) fi.focus();
      }
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      var root2 = document.getElementById(ROOT_ID);
      if (root2 && !state.min) {
        e.preventDefault();
        var q = root2.querySelector('[data-query]');
        if (q) q.focus();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (document.getElementById('gex-theater')) { closeTheater(); return; }
      if (!state.min && document.getElementById(ROOT_ID)) setMinimised(true);
    }
  }

  var started = false;

  function boot() {
    if (started) return;
    started = true;
    mount();
    scanAll('initial');
    [1500, 4000, 10000, 20000].forEach(function (ms) { setTimeout(function () { scanAll('late'); }, ms); });
  }

  window.addEventListener('keydown', onKey, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    setTimeout(boot, 3000);
  } else {
    boot();
  }
})();
