# Creating a complete revised userscript file for the user.
from pathlib import Path

script = r'''/* Game Extractor v23
 * For use on sites you own or are authorized to inspect.
 * Scans URLs already exposed to the current page; it does not bypass browser
 * origin restrictions or download/assemble third-party game dependencies.
 */
(() => {
  "use strict";

  const INSTANCE_KEY = "__gameExtractorV23";
  const DEFAULT_SETTINGS = {
    excludeImages: true,
    onlyHtmlOrGame: false,
    prioritizeCdn: true,
    boostSameDomain: true,
    minScore: 10
  };

  // Stop a previous instance completely before starting a new one.
  try {
    window[INSTANCE_KEY]?.cleanup?.();
  } catch (_) {}

  let settings = { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem("age_settings") || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const key of ["excludeImages", "onlyHtmlOrGame", "prioritizeCdn", "boostSameDomain"]) {
        if (typeof saved[key] === "boolean") settings[key] = saved[key];
      }
      if (Number.isFinite(saved.minScore)) {
        settings.minScore = Math.max(0, Math.min(100, Math.trunc(saved.minScore)));
      }
    }
  } catch (_) {}

  const itemsByUrl = new Map();
  const aborter = new AbortController();
  let performanceObserver = null;
  let domObserver = null;
  let pollInterval = null;
  let destroyed = false;
  let container = null;
  let searchValue = "";
  let settingsOpen = false;
  let scanCount = 0;

  const currentHost = location.hostname.toLowerCase().replace(/^www\./, "");
  const coreDomain = currentHost.split(".")[0] || "localhost";

  const icons = {
    game: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4"/><circle cx="15" cy="11" r="1" fill="currentColor"/><circle cx="18" cy="13" r="1" fill="currentColor"/></svg>',
    gear: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    search: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    download: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>'
  };

  function resolveUrl(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    const value = raw.trim();
    if (/^(?:javascript|data|blob|file|about):/i.test(value)) return null;
    try {
      const url = new URL(value, document.baseURI);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      if (url.username || url.password) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function isSameSiteHost(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
    return host === currentHost || host.endsWith("." + currentHost);
  }

  function shouldExclude(url) {
    const lower = url.toLowerCase();
    if (settings.excludeImages &&
        /\.(?:png|jpe?g|svg|webp|gif|ico|avif)(?:$|[?#])/i.test(lower)) return true;

    const blocked = [
      "analytics", "telemetry", "consent", "googletagmanager",
      "google.com/maps", "docs.google.com", "apis.google.com",
      "facebook.com", "twitter.com", "discord.com", "telegram.org",
      "pixel.", "/banner", "watermark", "branding"
    ];
    if (blocked.some(term => lower.includes(term))) return true;

    if (settings.onlyHtmlOrGame &&
        !/(game|play|embed|wasm|unity|cdn|storage|\.html(?:$|[?#]))/i.test(lower)) return true;
    return false;
  }

  function scoreUrl(url, type) {
    const lower = url.toLowerCase();
    let score = 0;
    if (/\/(?:game|play|embed|v\d+|g)\//i.test(lower)) score += 35;
    if (/(?:\.html(?:$|[?#])|index\.html(?:$|[?#]))/i.test(lower)) score += 25;
    if (/(game|play|wasm|unity)/i.test(lower)) score += 15;

    try {
      const parsed = new URL(url);
      if (settings.boostSameDomain && isSameSiteHost(parsed.hostname)) score += 45;
      if (settings.prioritizeCdn && /(cdn|storage|cloudflare|amazonaws\.com)/i.test(parsed.hostname)) score += 30;
    } catch (_) {}

    if (/(crazygames|msnfun|poki|itch\.io)/i.test(lower)) score += 20;
    if (/(github\.io|vercel\.app|pages\.dev)/i.test(lower)) score += 15;
    if (type === "global-var" || type === "network-intercept") score += 50;
    else if (type === "script-regex") score += 12;
    else if (type === "universal-attr" || type === "frame") score += 5;
    else if (type === "link") score += 2;

    if (url === location.origin + "/" || url === location.href || /\/index\.php(?:$|[?#])/i.test(url)) score -= 50;
    return score;
  }

  function analyzeAndAdd(raw, type) {
    if (destroyed) return;
    // Do not try to interpret arbitrary strings as base64. Only URL-like values
    // are accepted, with percent-encoded HTTP URLs decoded once if recognizable.
    let candidate = raw;
    if (typeof candidate === "string" && /%3a%2f%2f/i.test(candidate)) {
      try {
        const decoded = decodeURIComponent(candidate);
        if (/^https?:\/\//i.test(decoded)) candidate = decoded;
      } catch (_) {}
    }
    const url = resolveUrl(candidate);
    if (!url || shouldExclude(url)) return;

    const score = scoreUrl(url, type);
    const existing = itemsByUrl.get(url);
    if (existing) {
      if (score > existing.score) {
        existing.score = score;
        existing.type = type;
        existing.seenAt = Date.now();
        renderList();
      }
      return;
    }
    if (score < settings.minScore) return;
    itemsByUrl.set(url, { url, type, score, seenAt: Date.now() });
    renderList();
  }

  function scanGlobalVariables() {
    const keys = [
      "gameUrl", "gGameUrl", "EJS_gameUrl", "gameSrc", "embedUrl",
      "iframeUrl", "uGameUrl", "gamePath"
    ];
    for (const key of keys) {
      try {
        const value = window[key];
        if (typeof value === "string") analyzeAndAdd(value, "global-var");
        else if (value && typeof value === "object" && typeof value.url === "string") {
          analyzeAndAdd(value.url, "global-var");
        }
      } catch (_) {}
    }
    for (const value of [
      window.config?.gameUrl,
      window.gameConfig?.url,
      window.EJS_options?.gameUrl
    ]) {
      if (typeof value === "string") analyzeAndAdd(value, "global-var");
    }
  }

  function scanScripts(root = document) {
    try {
      root.querySelectorAll?.("script").forEach(script => {
        const content = script.textContent || "";
        const patterns = [
          /https?:\/\/[^\s"'<>`]+?\/(?:game|play|embed|v\d+|roms|builds|cdn|g)\/[^\s"'<>`]*/gi,
          /["'](https?:\/\/[^\s"'<>`]+?\.(?:html|json|wasm|zip)(?:\?[^\s"'<>`]*)?)["']/gi
        ];
        for (const match of content.matchAll(patterns[0])) analyzeAndAdd(match[0], "script-regex");
        for (const match of content.matchAll(patterns[1])) analyzeAndAdd(match[1], "script-regex");
      });
    } catch (_) {}
  }

  function deepScan(root) {
    if (!root || destroyed) return;
    try {
      root.querySelectorAll("iframe[src], frame[src], embed[src], object[data]").forEach(el => {
        analyzeAndAdd(el.getAttribute("src") || el.getAttribute("data"), "frame");
        // Cross-origin frame contents are intentionally not accessed.
      });

      const attrs = [
        "src", "href", "data", "data-src", "data-url",
        "data-game", "data-embed", "content"
      ];
      root.querySelectorAll("*").forEach(el => {
        for (const attr of attrs) {
          const value = el.getAttribute(attr);
          if (!value) continue;
          if (/(game|play|embed|cdn|storage|\.html|\.wasm|github\.io|vercel\.app)/i.test(value)) {
            analyzeAndAdd(value, "universal-attr");
          }
        }
        if (el.shadowRoot) deepScan(el.shadowRoot);
      });

      root.querySelectorAll("a[href]").forEach(a => {
        const href = a.getAttribute("href");
        if (href && /(game|play|embed|\.html|github\.io|vercel\.app|cdn)/i.test(href)) {
          analyzeAndAdd(href, "link");
        }
      });
    } catch (_) {}
  }

  function allItems() {
    return [...itemsByUrl.values()].sort((a, b) => b.score - a.score);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeButton(label, className, action, title) {
    const button = el("button", `age-btn ${className || ""}`, label);
    button.type = "button";
    button.dataset.action = action;
    if (title) button.title = title;
    return button;
  }

  function buildUI() {
    container = el("section", "age-panel");
    container.id = "apple-dark-extractor";
    container.setAttribute("aria-label", "Game Extractor");

    const style = el("style");
    style.textContent = `
      #apple-dark-extractor{position:fixed;top:24px;left:50%;transform:translateX(-50%);width:min(92vw,620px);max-height:85vh;overflow:auto;background:#1e1e20;color:#f5f5f7;padding:20px;border-radius:18px;box-shadow:0 24px 64px #000b;z-index:2147483647;font:13px system-ui,-apple-system,sans-serif;box-sizing:border-box;border:1px solid #38383a}
      #apple-dark-extractor *{box-sizing:border-box}#apple-dark-extractor button,#apple-dark-extractor input{font:inherit}
      #apple-dark-extractor .age-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:14px;border-bottom:1px solid #38383a;padding-bottom:12px;cursor:grab;touch-action:none}
      #apple-dark-extractor .age-title{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:650;color:#fff}
      #apple-dark-extractor .age-muted{color:#8e8e93;font-size:11px}
      #apple-dark-extractor .age-btn{background:#2c2c2e;color:#0a84ff;border:1px solid #3a3a3c;cursor:pointer;border-radius:999px;padding:6px 10px;display:inline-flex;align-items:center;justify-content:center;gap:5px;font-size:11px}
      #apple-dark-extractor .age-btn:hover{background:#3a3a3c;color:#fff}
      #apple-dark-extractor .age-primary{background:#0a84ff;color:#fff;border-color:#0a84ff}
      #apple-dark-extractor .age-toolbar{display:flex;gap:8px;margin-bottom:12px}
      #apple-dark-extractor .age-search{flex:1;min-width:0;background:#2c2c2e;border:1px solid #3a3a3c;padding:9px 12px;border-radius:999px;color:#fff}
      #apple-dark-extractor .age-list{max-height:38vh;overflow:auto;margin:12px 0}
      #apple-dark-extractor .age-card{background:#242426;border:1px solid #38383a;padding:12px;border-radius:12px;margin-bottom:8px}
      #apple-dark-extractor .age-cardtop{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:7px}
      #apple-dark-extractor .age-actions{display:flex;flex-wrap:wrap;gap:4px}
      #apple-dark-extractor .age-url{font:10px ui-monospace,monospace;color:#b0b0b7;overflow-wrap:anywhere}
      #apple-dark-extractor .age-settings{display:none;background:#242426;border:1px solid #3a3a3c;padding:12px;border-radius:12px;margin-bottom:12px}
      #apple-dark-extractor .age-settingrow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0}
      #apple-dark-extractor .age-settingrow input[type=number]{width:65px;background:#2c2c2e;color:#fff;border:1px solid #48484a;border-radius:6px;padding:5px}
      #apple-dark-extractor .age-foot{display:flex;gap:8px}
      #apple-dark-extractor .age-foot button{flex:1}
      #apple-dark-extractor .age-status{color:#30d158;font-size:11px}
      @media(max-width:520px){#apple-dark-extractor{top:8px;width:96vw;padding:14px}.age-cardtop{flex-direction:column}}
    `;
    container.appendChild(style);

    const head = el("div", "age-head");
    head.id = "age-drag-handle";
    const title = el("div", "age-title");
    title.innerHTML = icons.game;
    title.append(el("span", "", "Game Extractor"), el("span", "age-muted", "v23"));
    const headActions = el("div");
    headActions.style.cssText = "display:flex;align-items:center;gap:7px";
    headActions.append(
      makeButton("Settings", "", "settings", "Toggle scan settings"),
      el("span", "age-muted", "0 found")
    );
    headActions.lastChild.id = "age-found-count";
    head.append(title, headActions);
    container.appendChild(head);

    const toolbar = el("div", "age-toolbar");
    const search = el("input", "age-search");
    search.id = "age-search";
    search.type = "search";
    search.placeholder = "Search detected URLs...";
    search.value = searchValue;
    search.setAttribute("aria-label", "Search detected URLs");
    const exportBtn = makeButton("Export JSON", "", "export");
    toolbar.append(search, exportBtn);
    container.appendChild(toolbar);

    const meta = el("div", "age-muted");
    meta.textContent = `Domain: ${coreDomain} · Auto-scan active`;
    container.appendChild(meta);

    const settingsPanel = el("div", "age-settings");
    settingsPanel.id = "age-settings-panel";
    settingsPanel.style.display = settingsOpen ? "block" : "none";
    settingsPanel.appendChild(el("strong", "", "Scan filters"));
    const settingDefs = [
      ["boostSameDomain", "Boost same-site links"],
      ["excludeImages", "Exclude image assets"],
      ["onlyHtmlOrGame", "Strict HTML/game filter"],
      ["prioritizeCdn", "Prioritize CDN / storage"]
    ];
    for (const [key, label] of settingDefs) {
      const row = el("label", "age-settingrow");
      row.appendChild(el("span", "", label));
      const input = el("input");
      input.type = "checkbox";
      input.dataset.setting = key;
      input.checked = settings[key];
      row.appendChild(input);
      settingsPanel.appendChild(row);
    }
    const minRow = el("label", "age-settingrow");
    minRow.appendChild(el("span", "", "Minimum score"));
    const minInput = el("input");
    minInput.type = "number";
    minInput.min = "0";
    minInput.max = "100";
    minInput.value = String(settings.minScore);
    minInput.dataset.setting = "minScore";
    minRow.appendChild(minInput);
    settingsPanel.append(minRow, makeButton("Save & re-inspect", "age-primary", "save-settings"));
    container.appendChild(settingsPanel);

    const list = el("div", "age-list");
    list.id = "age-list-container";
    container.appendChild(list);

    const foot = el("div", "age-foot");
    foot.append(makeButton("Re-scan page", "", "rescan"), makeButton("Dismiss", "", "close"));
    container.appendChild(foot);

    document.body.appendChild(container);
    attachDrag();
    renderList();
  }

  function renderList() {
    if (!container || destroyed) return;
    const list = container.querySelector("#age-list-container");
    const count = container.querySelector("#age-found-count");
    if (!list || !count) return;

    const query = searchValue.toLowerCase();
    const filtered = allItems().filter(item =>
      item.url.toLowerCase().includes(query) || item.type.toLowerCase().includes(query)
    );
    count.textContent = `${filtered.length} found`;
    list.replaceChildren();

    if (!filtered.length) {
      list.appendChild(el("div", "age-card age-muted",
        itemsByUrl.size ? "No results match your search." :
        "No likely game URLs detected yet. Interact with the page, then re-scan."));
      return;
    }

    filtered.forEach((item, index) => {
      const card = el("div", "age-card");
      const top = el("div", "age-cardtop");
      const title = el("div");
      title.style.cssText = "font-weight:600;min-width:0;overflow-wrap:anywhere";
      title.textContent = `${index === 0 ? "★ " : ""}#${index + 1} `;
      const detail = el("span", "age-muted", `(${item.type} · score ${item.score})`);
      title.appendChild(detail);

      const actions = el("div", "age-actions");
      actions.append(
        makeButton("Sandbox", "", "sandbox", "Open URL in an iframe sandbox"),
        makeButton("Launcher HTML", "", "launcher", "Download a launcher HTML file"),
        makeButton("Copy URL", "", "copy", "Copy URL"),
        makeButton("Open", "age-primary", "open", "Navigate to URL")
      );
      actions.querySelectorAll("button").forEach(button => {
        button.dataset.url = item.url;
      });
      top.append(title, actions);
      card.append(top, el("div", "age-url", item.url));
      list.appendChild(card);
    });
  }

  function attachDrag() {
    const handle = container?.querySelector("#age-drag-handle");
    if (!handle) return;
    let drag = null;

    handle.addEventListener("pointerdown", event => {
      if (event.target.closest("button,input")) return;
      if (event.button !== 0) return;
      const rect = container.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      container.style.left = `${rect.left}px`;
      container.style.top = `${rect.top}px`;
      container.style.transform = "none";
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
    }, { signal: aborter.signal });

    handle.addEventListener("pointermove", event => {
      if (!drag) return;
      const left = drag.left + event.clientX - drag.x;
      const top = drag.top + event.clientY - drag.y;
      container.style.left = `${Math.max(0, Math.min(left, innerWidth - container.offsetWidth))}px`;
      container.style.top = `${Math.max(0, Math.min(top, innerHeight - container.offsetHeight))}px`;
    }, { signal: aborter.signal });

    const stop = () => { drag = null; };
    handle.addEventListener("pointerup", stop, { signal: aborter.signal });
    handle.addEventListener("pointercancel", stop, { signal: aborter.signal });
  }

  function rescan() {
    if (destroyed) return;
    scanCount++;
    scanGlobalVariables();
    scanScripts(document);
    deepScan(document);
    renderList();
  }

  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = el("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }

  function makeLauncher(url) {
    // JSON string encoding protects the URL as a JavaScript string. This is a
    // launcher only; the target site's framing policy still applies.
    const srcLiteral = JSON.stringify(url).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Game Launcher</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{width:100%;height:100%;border:0;display:block}</style>
</head><body><iframe id="game" allow="autoplay; fullscreen; gamepad" allowfullscreen></iframe>
<script>document.getElementById("game").src=${srcLiteral};<\/script>
</body></html>`;
  }

  async function handleAction(action, button) {
    const url = button?.dataset.url;
    switch (action) {
      case "settings":
        settingsOpen = !settingsOpen;
        container.querySelector("#age-settings-panel").style.display = settingsOpen ? "block" : "none";
        break;
      case "save-settings": {
        const panel = container.querySelector("#age-settings-panel");
        for (const key of ["boostSameDomain", "excludeImages", "onlyHtmlOrGame", "prioritizeCdn"]) {
          const input = panel.querySelector(`[data-setting="${key}"]`);
          if (input) settings[key] = input.checked;
        }
        const min = Number(panel.querySelector('[data-setting="minScore"]')?.value);
        settings.minScore = Number.isFinite(min) ? Math.max(0, Math.min(100, Math.trunc(min))) : DEFAULT_SETTINGS.minScore;
        try { localStorage.setItem("age_settings", JSON.stringify(settings)); } catch (_) {}
        itemsByUrl.clear();
        rescan();
        break;
      }
      case "rescan":
        rescan();
        break;
      case "close":
        cleanup();
        break;
      case "export": {
        const payload = JSON.stringify(allItems().map(({url, type, score}) => ({url, type, score})), null, 2);
        downloadBlob(new Blob([payload], { type: "application/json;charset=utf-8" }),
          `${coreDomain}-extracted-games.json`);
        break;
      }
      case "copy":
        try {
          await navigator.clipboard.writeText(url);
          button.textContent = "Copied";
        } catch (_) {
          button.textContent = "Copy failed";
        }
        setTimeout(() => { if (button.isConnected) button.textContent = "Copy URL"; }, 1400);
        break;
      case "open":
        if (url) location.href = url;
        break;
      case "sandbox": {
        if (!url) break;
        const win = window.open("about:blank", "_blank", "noopener");
        if (!win) {
          button.textContent = "Popup blocked";
          setTimeout(() => { if (button.isConnected) button.textContent = "Sandbox"; }, 1500);
          break;
        }
        try {
          const doc = win.document;
          doc.title = "Game Sandbox";
          doc.body.replaceChildren();
          doc.documentElement.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#000";
          doc.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#000";
          const frame = doc.createElement("iframe");
          frame.src = url;
          frame.allow = "autoplay; fullscreen; gamepad";
          frame.allowFullscreen = true;
          frame.style.cssText = "width:100%;height:100%;border:0;display:block";
          doc.body.appendChild(frame);
        } catch (_) {
          try { win.location.href = url; } catch (_) {}
        }
        break;
      }
      case "launcher":
        if (url) {
          downloadBlob(new Blob([makeLauncher(url)], { type: "text/html;charset=utf-8" }),
            "game-launcher.html");
          button.textContent = "Downloaded";
          setTimeout(() => { if (button.isConnected) button.textContent = "Launcher HTML"; }, 1400);
        }
        break;
    }
  }

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    if (performanceObserver) performanceObserver.disconnect();
    if (domObserver) domObserver.disconnect();
    if (pollInterval !== null) clearInterval(pollInterval);
    aborter.abort();
    if (container) container.remove();
    try {
      if (window[INSTANCE_KEY]?.cleanup === cleanup) delete window[INSTANCE_KEY];
    } catch (_) {}
  }

  // One delegated listener survives list redraws and settings updates.
  function onClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || !container?.contains(button)) return;
    event.preventDefault();
    handleAction(button.dataset.action, button);
  }

  function onInput(event) {
    if (event.target.id === "age-search") {
      searchValue = event.target.value;
      renderList();
    }
  }

  function onKeydown(event) {
    if (event.key === "Escape") cleanup();
  }

  function start() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", start, { once: true, signal: aborter.signal });
      return;
    }

    buildUI();
    container.addEventListener("click", onClick, { signal: aborter.signal });
    container.addEventListener("input", onInput, { signal: aborter.signal });
    document.addEventListener("keydown", onKeydown, { signal: aborter.signal });

    try {
      performanceObserver = new PerformanceObserver(list => {
        if (destroyed) return;
        for (const entry of list.getEntries()) {
          if (["fetch", "xmlhttprequest", "iframe", "script"].includes(entry.initiatorType)) {
            analyzeAndAdd(entry.name, "network-intercept");
          }
        }
      });
      performanceObserver.observe({ entryTypes: ["resource"] });
    } catch (_) {}

    try {
      domObserver = new MutationObserver(mutations => {
        if (destroyed || !mutations.some(m => m.addedNodes.length)) return;
        scanGlobalVariables();
        deepScan(document);
      });
      domObserver.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}

    rescan();
    pollInterval = setInterval(() => {
      if (destroyed) return;
      scanGlobalVariables();
      deepScan(document);
      if (++scanCount >= 6) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }, 1000);
  }

  window[INSTANCE_KEY] = { cleanup };
  start();
})();
'''
path = Path("/mnt/data/game-extractor-v23.js")
path.write_text(script, encoding="utf-8")
print(f"Created {path} ({len(script.splitlines())} lines, {path.stat().st_size} bytes)")
