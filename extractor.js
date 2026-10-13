(function(){
    if(window._gameExtractorActive) {
        let old = document.getElementById('apple-liquid-extractor');
        if(old) old.remove();
    }
    window._gameExtractorActive = true;

    // Persistent Settings
    let settings = {
        excludeImages: true,
        onlyHtmlOrGame: false,
        prioritizeCdn: true,
        boostSameDomain: true,
        minScore: 10
    };

    try {
        let saved = localStorage.getItem('age_settings');
        if (saved) settings = Object.assign(settings, JSON.parse(saved));
    } catch(e) {}

    let foundItems = [];
    let currentHost = location.hostname.replace(/^www\./, '');
    let coreDomain = currentHost.split('.')[0] || 'localhost';

    // Vector SF Symbols
    const SFSymbols = {
        gamecontroller: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4"/><path d="M8 10v4"/><circle cx="15" cy="11" r="1" fill="currentColor"/><circle cx="18" cy="13" r="1" fill="currentColor"/></svg>`,
        gear: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        magnifyingglass: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        squareAndArrowDown: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
        arrowTriangle2Circlepath: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`,
        docText: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
        docOnDoc: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
        eye: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
        safari: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
        sparkles: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0l2.5 8.5L23 11l-8.5 2.5L12 22l-2.5-8.5L1 11l8.5-2.5z"/></svg>`
    };

    function resolveUrl(url) {
        if (!url || url === 'about:blank' || url.startsWith('javascript:') || url.startsWith('blob:about')) return null;
        try {
            return new URL(url, document.baseURI).href;
        } catch(e) {
            return url;
        }
    }

    function decodeProxyUrl(raw) {
        if (!raw) return raw;
        try {
            if (raw.includes('%3A%2F%2F') || raw.includes('%2F')) {
                let decoded = decodeURIComponent(raw);
                if (decoded.startsWith('http')) return decoded;
            }
            if (raw.length > 20 && !raw.includes(' ') && !raw.includes('/')) {
                let b64 = atob(raw);
                if (b64.startsWith('http://') || b64.startsWith('https://')) return b64;
            }
        } catch(e) {}
        return raw;
    }

    function analyzeAndAdd(rawSrc, type) {
        // Strip iframe container warnings or wrapper strings if present
        if (typeof rawSrc === 'string' && (rawSrc.includes('iframe') && !rawSrc.startsWith('http'))) {
            return;
        }

        let decodedSrc = decodeProxyUrl(rawSrc);
        let src = resolveUrl(decodedSrc);
        if (!src) return;
        let lower = src.toLowerCase();
        
        if (settings.excludeImages) {
            if (lower.match(/\.(png|jpg|jpeg|svg|webp|gif|ico|css|woff2?)$/i)) return;
        }

        if (settings.onlyHtmlOrGame) {
            if (!lower.includes('game') && !lower.includes('play') && !lower.includes('embed') && !lower.endsWith('.html') && !lower.includes('cdn')) return;
        }

        const blockedKeywords = [
            'ads', 'analytics', 'telemetry', 'consent', 'login', 'auth', 
            'pixel', 'googletagmanager', 'google.com/maps', 'docs.google.com', 'apis.google.com',
            'facebook', 'twitter', 'discord', 'telegram', 'embed-banner', 'banner', 'watermark', 'branding'
        ];
        if (blockedKeywords.some(keyword => lower.includes(keyword))) return;
        
        if (!foundItems.some(item => item.url === src)) {
            let score = 0;

            if (lower.includes('/game/') || lower.includes('/play/') || lower.includes('/embed/') || lower.includes('/v3/') || lower.includes('/g/')) score += 35;
            if (lower.endsWith('.html') || lower.includes('index.html')) score += 25;
            if (lower.includes('game') || lower.includes('play') || lower.includes('wasm') || lower.includes('unity')) score += 15;

            if (settings.boostSameDomain && coreDomain.length > 3) {
                if (lower.includes(coreDomain)) score += 45;
            }

            if (settings.prioritizeCdn && (lower.includes('cdn') || lower.includes('storage') || lower.includes('aws') || lower.includes('cloudflare'))) score += 30;

            if (lower.includes('crazygames') || lower.includes('msnfun') || lower.includes('poki') || lower.includes('itch.io')) score += 40;
            if (lower.includes('blob:') || lower.includes('github.io') || lower.includes('vercel.app') || lower.includes('pages.dev')) score += 25;

            if (type === 'global-var' || type === 'network-intercept') score += 50;
            if (type === 'script-regex') score += 12;
            if (type === 'universal-attr') score += 5;
            if (type === 'link') score += 2;

            if (lower === location.origin + '/' || lower === location.href || lower.endsWith('/index.php')) score -= 50;

            if (score >= settings.minScore) {
                foundItems.push({ url: src, type: type, score: score });
                foundItems.sort((a, b) => b.score - a.score);
                updateUIList();
            }
        }
    }

    function scanGlobalVariables() {
        try {
            const keys = ['gameUrl', 'gGameUrl', 'EJS_gameUrl', 'gameSrc', 'embedUrl', 'iframeUrl', 'uGameUrl', 'gamePath', '__uv$config'];
            keys.forEach(k => {
                if (window[k]) {
                    if (typeof window[k] === 'string') analyzeAndAdd(window[k], 'global-var');
                    else if (typeof window[k] === 'object' && window[k].url) analyzeAndAdd(window[k].url, 'global-var');
                }
            });
            if (window.config && window.config.gameUrl) analyzeAndAdd(window.config.gameUrl, 'global-var');
            if (window.gameConfig && window.gameConfig.url) analyzeAndAdd(window.gameConfig.url, 'global-var');
            if (window.EJS_options && window.EJS_options.gameUrl) analyzeAndAdd(window.EJS_options.gameUrl, 'global-var');
        } catch(e) {}
    }

    function scanScripts() {
        try {
            document.querySelectorAll('script').forEach(s => {
                let content = s.textContent || s.innerText || '';
                let matches = content.match(/https?:\/\/[^\s"'<>]+?\/(?:game|play|embed|v[0-9]|roms|builds|cdn|g)\/[^\s"'<>]+/gi) || [];
                matches.forEach(m => analyzeAndAdd(m, 'script-regex'));
                
                let jsonMatches = content.match(/["']https?:\/\/[^\s"'<>]+?\.(?:html|json|zip|swf|js|wasm)["']/gi) || [];
                jsonMatches.forEach(m => analyzeAndAdd(m.replace(/["']/g, ''), 'script-regex'));
            });
        } catch(e) {}
    }

    function deepScan(root) {
        if (!root) return;
        try {
            // Ignore iframe content inspection warning layers, directly analyze attributes
            root.querySelectorAll('embed, object').forEach(e => {
                analyzeAndAdd(e.src || e.data, 'media');
            });
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) deepScan(el.shadowRoot);
                for (let attr of el.attributes) {
                    let val = attr.value;
                    if (val && (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('/'))) {
                        let lowerVal = val.toLowerCase();
                        if (lowerVal.includes('game') || lowerVal.includes('play') || lowerVal.includes('embed') || lowerVal.includes('cdn') || lowerVal.endsWith('.html') || lowerVal.endsWith('.json') || lowerVal.endsWith('.zip')) {
                            analyzeAndAdd(val, 'universal-attr');
                        }
                    }
                }
            });
            root.querySelectorAll('a[href]').forEach(a => {
                let href = a.getAttribute('href');
                if (href && (href.includes('game') || href.includes('play') || href.endsWith('.html') || href.includes('github.io') || href.includes('vercel.app') || href.includes('cdn'))) {
                    analyzeAndAdd(href, 'link');
                }
            });
        } catch(e) {}
    }

    scanGlobalVariables();
    scanScripts();
    deepScan(document);

    try {
        const observer = new PerformanceObserver((list) => {
            for (let entry of list.getEntries()) {
                if (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest' || entry.initiatorType === 'iframe') {
                    analyzeAndAdd(entry.name, 'network-intercept');
                }
            }
        });
        observer.observe({ entryTypes: ['resource'] });
    } catch(e) {}

    try {
        const domObserver = new MutationObserver((mutations) => {
            let shouldScan = mutations.some(m => m.addedNodes.length > 0);
            if (shouldScan) {
                scanGlobalVariables();
                deepScan(document);
            }
        });
        domObserver.observe(document.body, { childList: true, subtree: true });
    } catch(e) {}

    let pollCount = 0;
    let pollInterval = setInterval(() => {
        scanGlobalVariables();
        deepScan(document);
        pollCount++;
        if (pollCount > 5) clearInterval(pollInterval);
    }, 1000);

    // Liquid Glass UI Container
    let container = document.createElement('div');
    container.id = 'apple-liquid-extractor';
    container.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);width:92%;max-width:560px;background:rgba(255, 255, 255, 0.08);color:#f5f5f7;padding:24px;border-radius:26px;box-shadow:0 30px 80px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 -1px 0 rgba(0, 0, 0, 0.2);z-index:999999;font-family:SF Pro Text,system-ui,-apple-system,sans-serif;box-sizing:border-box;backdrop-filter:blur(50px) saturate(190%);-webkit-backdrop-filter:blur(50px) saturate(190%);border:1px solid rgba(255, 255, 255, 0.18);';

    function renderHTML() {
        return `
            <style>
                #apple-liquid-extractor::-webkit-scrollbar { width: 4px; }
                #apple-liquid-extractor::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.25); border-radius: 4px; }
                .apple-btn { background: rgba(255,255,255,0.1); color: #2997ff; border: 1px solid rgba(255,255,255,0.18); font-family: inherit; font-weight: 400; cursor: pointer; border-radius: 9999px; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); font-size: 12px; padding: 6px 13px; display: inline-flex; align-items: center; gap: 4px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2); }
                .apple-btn:hover { background: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.35); color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255, 255, 255, 0.4); }
                .apple-btn:active { transform: scale(0.96); }
                .apple-btn-primary { background: #0A84FF; color: #ffffff; border: none; font-weight: 500; box-shadow: 0 4px 14px rgba(10, 132, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3); }
                .apple-btn-primary:hover { background: #0071e3; color: #ffffff; box-shadow: 0 6px 18px rgba(10, 132, 255, 0.5); }
                .apple-card { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); padding: 13px 15px; border-radius: 16px; margin-bottom: 8px; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15); }
                .apple-card:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.28); transform: translateY(-1px); }
                .apple-badge { background: rgba(10, 132, 255, 0.25); color: #2997ff; font-size: 10px; padding: 2px 8px; border-radius: 9999px; margin-right: 6px; font-weight: 600; border: 1px solid rgba(10, 132, 255, 0.4); display: inline-flex; align-items: center; gap: 3px; backdrop-filter: blur(10px); }

                /* Liquid Glass Switch */
                .apple-switch { position: relative; display: inline-block; width: 38px; height: 22px; flex-shrink: 0; }
                .apple-switch input { opacity: 0; width: 0; height: 0; }
                .apple-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(255, 255, 255, 0.15); transition: .3s cubic-bezier(0.16, 1, 0.3, 1); border-radius: 22px; border: 1px solid rgba(255,255,255,0.18); backdrop-filter: blur(10px); }
                .apple-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: #ffffff; transition: .3s cubic-bezier(0.16, 1, 0.3, 1); border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
                .apple-switch input:checked + .apple-slider { background-color: #30D158; border-color: #30D158; box-shadow: 0 0 12px rgba(48, 209, 88, 0.4); }
                .apple-switch input:checked + .apple-slider:before { transform: translateX(16px); }
            </style>

            <div id="age-drag-handle" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:12px;cursor:grab;">
                <div style="font-family:SF Pro Display,system-ui,-apple-system,sans-serif;font-size:18px;font-weight:600;letter-spacing:-0.28px;color:#ffffff;display:flex;align-items:center;gap:8px;">
                    <span style="color:#0A84FF;">${SFSymbols.gamecontroller}</span> <span>Game Inspector</span> <span style="font-size:10px;background:rgba(255,255,255,0.12);color:#a1a1a6;padding:2px 8px;border-radius:9999px;font-weight:400;border:1px solid rgba(255,255,255,0.15);">v17 HTML Clean</span>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button id="age-toggle-settings" class="apple-btn" style="padding:4px 11px;font-size:11px;">${SFSymbols.gear} Settings</button>
                    <span id="age-found-count" style="font-size:11px;font-weight:600;color:#a1a1a6;">${foundItems.length} found</span>
                </div>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:12px;">
                <div style="position:relative;flex:1;display:flex;align-items:center;">
                    <span style="position:absolute;left:12px;color:#a1a1a6;display:flex;">${SFSymbols.magnifyingglass}</span>
                    <input type="text" id="age-search" placeholder="Search detected URLs..." style="width:100%;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.15);padding:8px 14px 8px 32px;border-radius:9999px;color:#ffffff;font-size:12px;outline:none;font-family:inherit;backdrop-filter:blur(20px);">
                </div>
                <button id="age-export" class="apple-btn" style="padding:8px 14px;font-size:11px;">${SFSymbols.squareAndArrowDown} Export</button>
            </div>

            <div style="font-size:11px;color:#a1a1a6;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
                <span>Domain: <b style="color:#ffffff;">${coreDomain}</b></span>
                <span style="color:#30D158;display:flex;align-items:center;gap:4px;">● Auto-Scan Active</span>
            </div>

            <div id="age-settings-panel" style="display:none;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.15);padding:15px;border-radius:18px;margin-bottom:12px;font-size:12px;backdrop-filter:blur(30px);">
                <div style="font-weight:600;color:#ffffff;margin-bottom:10px;">Scan Filters</div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#d2d2d7;">Boost Same-Domain Links</span>
                        <label class="apple-switch">
                            <input type="checkbox" id="opt-boost-domain" ${settings.boostSameDomain ? 'checked' : ''}>
                            <span class="apple-slider"></span>
                        </label>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#d2d2d7;">Exclude Image Assets</span>
                        <label class="apple-switch">
                            <input type="checkbox" id="opt-exclude-images" ${settings.excludeImages ? 'checked' : ''}>
                            <span class="apple-slider"></span>
                        </label>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#d2d2d7;">Strict Mode (HTML/Game endpoints only)</span>
                        <label class="apple-switch">
                            <input type="checkbox" id="opt-only-html" ${settings.onlyHtmlOrGame ? 'checked' : ''}>
                            <span class="apple-slider"></span>
                        </label>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#d2d2d7;">Prioritize CDNs & Cloud Storage</span>
                        <label class="apple-switch">
                            <input type="checkbox" id="opt-prioritize-cdn" ${settings.prioritizeCdn ? 'checked' : ''}>
                            <span class="apple-slider"></span>
                        </label>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;color:#a1a1a6;">
                        <span>Minimum Score:</span>
                        <input type="number" id="opt-min-score" value="${settings.minScore}" style="width:48px;background:rgba(0,0,0,0.3);color:#ffffff;border:1px solid rgba(255,255,255,0.2);padding:4px;border-radius:8px;text-align:center;font-size:11px;">
                    </div>
                </div>
                <button id="age-save-settings" class="apple-btn apple-btn-primary" style="width:100%;margin-top:12px;padding:7px;justify-content:center;">Save & Re-inspect</button>
            </div>

            <div id="age-list-container" style="max-height:220px;overflow-y:auto;margin-bottom:12px;padding-right:2px;">
                ${renderListItems(foundItems)}
            </div>

            <div style="display:flex;gap:8px;">
                <button id="age-rescan" class="apple-btn" style="flex:1;padding:9px;font-weight:500;justify-content:center;">${SFSymbols.arrowTriangle2Circlepath} Re-scan Page</button>
                <button id="age-close" class="apple-btn" style="flex:1;padding:9px;color:#a1a1a6;background:transparent;border:none;justify-content:center;">Dismiss</button>
            </div>
        `;
    }

    function renderListItems(items, filter = '') {
        let filtered = items.filter(i => i.url.toLowerCase().includes(filter.toLowerCase()) || i.type.toLowerCase().includes(filter.toLowerCase()));
        if (filtered.length === 0) {
            return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);padding:14px;border-radius:16px;margin-bottom:10px;font-size:12px;color:#a1a1a6;text-align:center;">No game streams detected yet. Interact with the page or wait for assets to stream...</div>`;
        }
        let html = '';
        filtered.forEach((item, i) => {
            let isBest = items.indexOf(item) === 0;
            let badge = isBest ? `<span class="apple-badge">${SFSymbols.sparkles} Top Match</span>` : '';

            html += `
                <div class="apple-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:12px;font-weight:600;color:#ffffff;">${badge}#${i+1} <span style="color:#a1a1a6;font-size:10px;font-weight:400;">(${item.type} • Score: ${item.score})</span></div>
                        <div style="display:flex;gap:4px;">
                            <button class="age-blank apple-btn" data-url="${item.url}" style="padding:3px 8px;font-size:10px;" title="Open in Sandbox">${SFSymbols.safari} Sandbox</button>
                            <button class="age-html apple-btn" data-url="${item.url}" style="padding:3px 8px;font-size:10px;" title="Clean & Convert to Standalone HTML">${SFSymbols.docText} HTML</button>
                            <button class="age-copy apple-btn" data-url="${item.url}" style="padding:3px 8px;font-size:10px;" title="Copy URL">${SFSymbols.docOnDoc}</button>
                            <button class="age-open apple-btn apple-btn-primary" data-url="${item.url}" style="padding:3px 10px;font-size:10px;">Open</button>
                        </div>
                    </div>
                    <div style="font-size:10px;color:#a1a1a6;word-break:break-all;font-family:SF Mono,ui-monospace,monospace;">${item.url}</div>
                </div>
            `;
        });
        return html;
    }

    function updateUIList() {
        let listContainer = document.getElementById('age-list-container');
        let foundCount = document.getElementById('age-found-count');
        let searchInput = document.getElementById('age-search');
        let filter = searchInput ? searchInput.value : '';
        if (listContainer) {
            listContainer.innerHTML = renderListItems(foundItems, filter);
        }
        if (foundCount) {
            let matched = foundItems.filter(i => i.url.toLowerCase().includes(filter.toLowerCase()) || i.type.toLowerCase().includes(filter.toLowerCase()));
            foundCount.innerText = `${matched.length} found`;
        }
    }

    container.innerHTML = renderHTML();
    document.body.appendChild(container);

    // Draggable Panel
    let isDragging = false, offsetLeft = 0, offsetTop = 0;
    const dragHandle = document.getElementById('age-drag-handle');
    
    dragHandle.onmousedown = function(e) {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        isDragging = true;
        dragHandle.style.cursor = 'grabbing';
        offsetLeft = e.clientX - container.offsetLeft;
        offsetTop = e.clientY - container.offsetTop;
    };

    document.onmousemove = function(e) {
        if (!isDragging) return;
        container.style.left = (e.clientX - offsetLeft) + 'px';
        container.style.top = (e.clientY - offsetTop) + 'px';
        container.style.transform = 'none';
    };

    document.onmouseup = function() {
        isDragging = false;
        if(dragHandle) dragHandle.style.cursor = 'grab';
    };

    // Container Interaction Delegation
    container.onclick = async function(e) {
        let target = e.target.closest('button') || e.target;
        
        if (target.id === 'age-toggle-settings') {
            let panel = document.getElementById('age-settings-panel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }

        if (target.id === 'age-save-settings') {
            settings.boostSameDomain = document.getElementById('opt-boost-domain').checked;
            settings.excludeImages = document.getElementById('opt-exclude-images').checked;
            settings.onlyHtmlOrGame = document.getElementById('opt-only-html').checked;
            settings.prioritizeCdn = document.getElementById('opt-prioritize-cdn').checked;
            settings.minScore = parseInt(document.getElementById('opt-min-score').value) || 10;
            
            try { localStorage.setItem('age_settings', JSON.stringify(settings)); } catch(e) {}

            container.innerHTML = renderHTML();
            foundItems = [];
            scanGlobalVariables();
            scanScripts();
            deepScan(document);
            updateUIList();
        }

        if (target.id === 'age-rescan') {
            foundItems = [];
            scanGlobalVariables();
            scanScripts();
            deepScan(document);
            updateUIList();
        }

        if (target.id === 'age-close') {
            clearInterval(pollInterval);
            container.remove();
            window._gameExtractorActive = false;
        }

        if (target.id === 'age-export') {
            let blob = new Blob([JSON.stringify(foundItems, null, 2)], { type: 'application/json' });
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = `${coreDomain}-inspected-games.json`;
            a.click();
        }

        if (target.classList.contains('age-blank')) {
            let u = target.getAttribute('data-url');
            let win = window.open('about:blank', '_blank');
            if (win) {
                win.document.write(`
                    <html style="margin:0;padding:0;width:100%;height:100%;overflow:hidden;">
                        <head><title>Dashboard</title></head>
                        <body style="margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;">
                            <iframe src="${u}" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>
                        </body>
                    </html>
                `);
            }
        }

        // HTML Source Stripper & Cleaner Converter
        if (target.classList.contains('age-html')) {
            let u = target.getAttribute('data-url');
            let origText = target.innerHTML;
            target.innerHTML = 'Cleaning...';
            try {
                let response = await fetch(u, { mode: 'cors' }).catch(() => null);
                let htmlContent = '';
                if (response && response.ok) {
                    htmlContent = await response.text();
                } else {
                    // Fallback to iframe embed wrapper if CORS blocks direct fetch
                    htmlContent = `<!DOCTYPE html><html><head><title>Clean Game View</title><style>body,html{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;}</style></head><body><iframe src="${u}" style="width:100%;height:100%;border:none;" allowfullscreen></iframe></body></html>`;
                }

                // Strip advertising, tracking scripts, banners, and iframe warnings
                htmlContent = htmlContent
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, (match) => {
                        if (match.toLowerCase().includes('game') || match.toLowerCase().includes('canvas') || match.toLowerCase().includes('webpack')) return match;
                        return '';
                    })
                    .replace(/<iframe\b[^>]*src=["']https?:\/\/(?:www\.)?(?:googletagmanager|ads|facebook|twitter|discord|analytics)[^"']*["'][^>]*>.*?<\/iframe>/gi, '')
                    .replace(/<div\b[^>]*(?:class|id)=["'][^"']*(?:banner|ads|cookie|consent|telemetry|watermark)[^"']*["'][^>]*>.*?<\/div>/gi, '');

                let blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
                let url = URL.createObjectURL(blob);
                let a = document.createElement('a');
                a.href = url;
                a.download = `clean-game-${Date.now()}.html`;
                a.click();
                target.innerHTML = 'Done!';
                setTimeout(() => { target.innerHTML = origText; }, 1500);
            } catch(err) {
                target.innerHTML = 'Error';
                setTimeout(() => { target.innerHTML = origText; }, 1500);
            }
        }

        if (target.classList.contains('age-copy')) {
            let u = target.getAttribute('data-url');
            navigator.clipboard.writeText(u).then(() => {
                let orig = target.innerText;
                target.innerText = 'Copied';
                setTimeout(() => { target.innerText = orig; }, 1500);
            });
        }
        if (target.classList.contains('age-open')) {
            window.location.href = target.getAttribute('data-url');
        }
    };

    container.oninput = function(e) {
        if (e.target.id === 'age-search') {
            updateUIList();
        }
    };
})();
