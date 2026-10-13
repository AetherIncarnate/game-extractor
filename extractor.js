/*!
 * ============================================================================
 *  GAME EXTRACTOR  —  v3.0 "Sleek"
 *  Pull the real playable build out of a web page.
 * ----------------------------------------------------------------------------
 *  Use only on sites you own or are explicitly authorised to test.
 *  Zero dependencies, vanilla JS. Works as a userscript, a bookmarklet, or
 *  pasted straight into DevTools.
 *
 *  Re-run the snippet to minimise / restore · Alt+G toggles · Esc minimises.
 * ============================================================================
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. Singleton guard
   * ------------------------------------------------------------------ */
  var VERSION = '3.0.0';
  var ROOT_ID = 'gex-root';

  if (window.__gex) {
    try { window.__gex.toggle(); } catch (e) { /* noop */ }
    return;
  }

  /* ------------------------------------------------------------------ *
   * 1. Settings (persisted, with legacy migration)
   * ------------------------------------------------------------------ */
  var DEFAULTS = {
    excludeAssets: true,    // drop images / fonts / css / video
    strict: false,          // only obvious game endpoints
    boostSameDomain: true,  // the page's own host is usually the game host
    boostCdn: true,         // favour cdn. / storage / cloud buckets
    liveCapture: true,      // hook fetch / XHR / iframe.src
    unwrapProxies: true,    // decode ?url= / base64 / %-encoded wrappers
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
      } catch (e) { /* corrupt json */ }
    }
    out.minScore = clamp(parseInt(out.minScore, 10) || 0, -100, 200);
    return out;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(n, a, b) { return n < a ? a : n > b ? b : n; }

  /* ------------------------------------------------------------------ *
   * 2. Tiny utils
   * ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ *
   * 3. URL normalisation + proxy unwrapping
   * ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ *
   * 4. Classification
   * ------------------------------------------------------------------ */
  var PATH_HINTS = ['game', 'games', 'play', 'player', 'embed', 'iframe', 'rom', 'roms',
    'build', 'builds', 'demo', 'arcade', 'webgl', 'wasm', 'unity', 'godot', 'construct',
    'gdevelop', 'ruffle', 'swf', 'emulator', 'emulatorjs', 'loader', 'engine', 'level',
    'world', 'release', 'v1', 'v2', 'v3', 'g'];

  var ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svgz?|ico|cur|css|scss|less|woff2?|ttf|otf|eot|mp4|webm|mp3|ogg|wav|m4a|aac|mov|vtt|srt|map)(?:[?#]|$)/i;

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

  function scoreCandidate(absolute, source, originalRaw) {
    var url;
    try { url = new URL(absolute); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'blob:') return null;

    var path = url.pathname.toLowerCase();
    var full = (url.host + url.pathname + url.search).toLowerCase();
    var tokens = path.split(/[^a-z0-9]+/).filter(Boolean);
    var extMatch = path.match(/\.[a-z0-9]{1,9}$/);
    var ext = extMatch ? extMatch[0] : '';
    var tags = [];
    var score = 8;

    if (NOISE_RE.test(full)) {
      tags.push('ad/tracker');
      if (!/^\.(html?|swf|wasm|unityweb|data|pck)$/.test(ext)) return null;
    }
    if (NOISE_RE_SOFT.test(full)) return null;
    if (settings.excludeAssets && ASSET_EXT.test(path)) return null;

    var hintHits = 0;
    for (var i = 0; i < tokens.length && hintHits < 3; i++) {
      if (PATH_HINTS.indexOf(tokens[i]) > -1) hintHits++;
    }
    if (hintHits) { score += Math.min(hintHits, 2) * 14; tags.push('path'); }

    if (ext && GAME_EXT[ext]) { score += GAME_EXT[ext]; tags.push('file' + ext); }

    for (var p = 0; p < PLATFORMS.length; p++) {
      if (PLATFORMS[p].re.test(full)) { score += PLATFORMS[p].score; tags.push(PLATFORMS[p].name); break; }
    }

    var ht = hostTokens(url.hostname);
    if (settings.boostCdn && (ht.indexOf('cdn') > -1 || ht.indexOf('assets') > -1 ||
      ht.indexOf('storage') > -1 || ht.indexOf('static') > -1 || ht.indexOf('files') > -1 ||
      ht.indexOf('media') > -1 ||
      /cloudfront|azureedge|fastly|akamai|cloudflare|storage\.googleapis|blob\.core|s3[.-]|r2\.dev|hwcdn/.test(url.hostname))) {
      score += 20; tags.push('cdn');
    }

    if (settings.boostSameDomain && CORE && CORE.length > 2) {
      if (url.hostname === CURRENT_HOST) { score += 22; tags.push('same-host'); }
      else if (url.hostname.toLowerCase().indexOf(CORE.toLowerCase()) > -1) { score += 16; tags.push('same-domain'); }
    }

    switch (source) {
      case 'live-iframe': score += 46; tags.push('runtime'); break;
      case 'live-fetch': case 'live-xhr': score += 34; tags.push('runtime'); break;
      case 'global': score += 32; tags.push('global'); break;
      case 'iframe': score += 26; tags.push('iframe'); break;
      case 'embed': case 'object': score += 24; tags.push('plugin'); break;
      case 'srcdoc': score += 20; tags.push('srcdoc'); break;
      case 'json': score += 18; tags.push('json'); break;
      case 'network': score += 16; tags.push('network'); break;
      case 'script': score += 12; tags.push('script'); break;
      case 'storage': score += 10; tags.push('storage'); break;
      case 'attr': score += 8; tags.push('attr'); break;
      case 'link': score += 4; tags.push('link'); break;
      default: break;
    }

    if (url.pathname === '/' || url.pathname === '') { score -= 70; tags.push('root'); }
    if (absolute === location.href) { score -= 40; tags.push('self'); }
    if (!ext && url.pathname.split('/').filter(Boolean).length <= 1) { score -= 26; tags.push('nav'); }
    if ((ext === '.js' || ext === '.mjs') && !hintHits) { score -= 60; tags.push('plain-js'); }
    if (ext === '.json' && !hintHits) { score -= 45; tags.push('plain-json'); }
    if (url.search.length > 400) { score -= 10; }
    if (url.protocol === 'blob:') { score += 10; tags.push('blob'); }
    if (settings.unwrapProxies && originalRaw && unwrap(originalRaw) !== originalRaw) { score += 12; tags.push('unwrapped'); }

    if (settings.strict) {
      var useful = hintHits > 0 || !!GAME_EXT[ext] || url.protocol === 'blob:';
      if (!useful) return null;
    }

    return { score: score, tags: tags };
  }

  /* ------------------------------------------------------------------ *
   * 5. Result store & UI initialization
   * ------------------------------------------------------------------ */
  var items = [];
  var seen = {};
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
          ex.source = source; ex.score = better.score; ex.tags = better.tags; ex.hits++;
          dirty = true;
        }
      }
      return;
    }

    var verdict = scoreCandidate(absolute, source, String(raw));
    if (!verdict || verdict.score < settings.minScore) return;

    seen[key] = items.length;
    items.push({
      id: ++order,
      url: stripTracking(absolute),
      raw: String(raw).slice(0, 300),
      source: source,
      score: verdict.score,
      tags: verdict.tags,
      hits: 1,
      bytes: 0
    });
    items.sort(function (a, b) { return b.score - a.score || b.id - a.id; });
    reindex();
    dirty = true;
    scheduleRender();
  }

  function reindex() {
    for (var i = 0; i < items.length; i++) seen[keyOf(items[i].url)] = i;
  }

  function scanAll(label) {
    status = 'scanning';
    var t0 = Date.now();
    try { scanDocument(document, document.baseURI); } catch (e) { }
    status = 'done';
    scheduleRender();
  }

  function scheduleFullScan() {
    scanAll('auto');
  }

  function scanDocument(doc, base) {
    try {
      var list = doc.querySelectorAll('iframe, frame, embed, object');
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var val = el.tagName === 'OBJECT' ? el.getAttribute('data') : el.getAttribute('src');
        if (val) addCandidate(val, 'iframe');
      }
    } catch (e) { /* noop */ }
  }

  function instH() {}
  function instO() {}
  function scheduleRender() {}

  scanAll('init');
})();
