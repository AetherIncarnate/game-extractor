(function(){
    if(window._gameExtractorActive) {
        let old = document.getElementById('apple-game-extractor');
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
            if (type === 'iframe') score += 20;
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
            root.querySelectorAll('iframe').forEach(f => {
                analyzeAndAdd(f.src || f.getAttribute('data-src') || f.getAttribute('data-url') || f.getAttribute('data-embed'), 'iframe');
                try { if (f.contentDocument) deepScan(f.contentDocument); } catch(err) {}
            });
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

    // Initial scan execution
    scanGlobalVariables();
    scanScripts();
    deepScan(document);

    // Proactive Auto-Discovery: Network Interceptor
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

    // Proactive Auto-Discovery: DOM Mutation Observer for asynchronous content
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

    // Build Apple HIG UI Container
    let container = document.createElement('div');
    container.id = 'apple-game-extractor';
    container.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);width:92%;max-width:540px;background:#f5f5f7;color:#1d1d1f;padding:24px;border-radius:18px;box-shadow:0 20px 40px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.2);z-index:999999;font-family:SF Pro Text,system-ui,-apple-system,sans-serif;box-sizing:border-box;border:1px solid #e0e0e0;backdrop-filter:blur(20px);';

    function renderHTML() {
        return `
            <style>
                #apple-game-extractor::-webkit-scrollbar { width: 4px; }
                #apple-game-extractor::-webkit-scrollbar-thumb { background: #d2d2d7; border-radius: 4px; }
                .apple-btn { background: #ffffff; color: #0066cc; border: 1px solid #e0e0e0; font-family: inherit; font-weight: 400; cursor: pointer; border-radius: 9999px; transition: all 0.15s ease; font-size: 13px; padding: 6px 14px; }
                .apple-btn:hover { background: #fafafc; border-color: #0066cc; }
                .apple-btn:active { transform: scale(0.95); }
                .apple-btn-primary { background: #0066cc; color: #ffffff; border: none; font-weight: 500; }
                .apple-btn-primary:hover { background: #0071e3; color: #ffffff; }
                .apple-card { background: #ffffff; border: 1px solid #e0e0e0; padding: 14px; border-radius: 11px; margin-bottom: 10px; transition: all 0.15s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
                .apple-card:hover { border-color: #b0b0b0; }
                .apple-badge { background: rgba(0,102,204,0.1); color: #0066cc; font-size: 11px; padding: 2px 8px; border-radius: 9999px; margin-right: 6px; font-weight: 600; }
            </style>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid #e0e0e0;padding-bottom:12px;">
                <div style="font-family:SF Pro Display,system-ui,-apple-system,sans-serif;font-size:18px;font-weight:600;letter-spacing:-0.28px;color:#1d1d1f;display:flex;align-items:center;gap:8px;">
                    <span>Game Inspector</span> <span style="font-size:11px;background:#e0e0e0;color:#7a7a7a;padding:2px 8px;border-radius:9999px;font-weight:400;">macOS Edition</span>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button id="age-toggle-settings" class="apple-btn" style="padding:5px 12px;font-size:12px;">Settings</button>
                    <span id="age-found-count" style="font-size:12px;font-weight:600;color:#7a7a7a;">${foundItems.length} found</span>
                </div>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:12px;">
                <input type="text" id="age-search" placeholder="Filter detected URLs..." style="flex:1;background:#ffffff;border:1px solid #e0e0e0;padding:9px 14px;border-radius:9999px;color:#1d1d1f;font-size:13px;outline:none;font-family:inherit;">
                <button id="age-export" class="apple-btn" style="padding:9px 14px;font-size:12px;">Export</button>
            </div>

            <div style="font-size:12px;color:#7a7a7a;margin-bottom:14px;display:flex;justify-content:space-between;">
                <span>Target: <b style="color:#1d1d1f;">${coreDomain}</b></span>
                <span style="color:#0066cc;">● Auto-Scanning Active</span>
            </div>

            <div id="age-settings-panel" style="display:none;background:#ffffff;border:1px solid #e0e0e0;padding:16px;border-radius:11px;margin-bottom:14px;font-size:13px;">
                <div style="font-weight:600;color:#1d1d1f;margin-bottom:10px;">Preferences</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#333333;">
                        <input type="checkbox" id="opt-boost-domain" ${settings.boostSameDomain ? 'checked' : ''} style="accent-color:#0066cc;"> Boost Same-Domain Links
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#333333;">
                        <input type="checkbox" id="opt-exclude-images" ${settings.excludeImages ? 'checked' : ''} style="accent-color:#0066cc;"> Exclude Image Assets
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#333333;">
                        <input type="checkbox" id="opt-only-html" ${settings.onlyHtmlOrGame ? 'checked' : ''} style="accent-color:#0066cc;"> Strict Mode (HTML/Game endpoints only)
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#333333;">
                        <input type="checkbox" id="opt-prioritize-cdn" ${settings.prioritizeCdn ? 'checked' : ''} style="accent-color:#0066cc;"> Prioritize CDNs & Cloud Storage
                    </label>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;color:#7a7a7a;">
                        <span>Minimum Score:</span>
                        <input type="number" id="opt-min-score" value="${settings.minScore}" style="width:50px;background:#f5f5f7;color:#1d1d1f;border:1px solid #e0e0e0;padding:4px;border-radius:6px;text-align:center;font-size:12px;">
                    </div>
                </div>
                <button id="age-save-settings" class="apple-btn apple-btn-primary" style="width:100%;margin-top:12px;padding:8px;">Save & Re-inspect</button>
            </div>

            <div id="age-list-container" style="max-height:240px;overflow-y:auto;margin-bottom:14px;padding-right:4px;">
                ${renderListItems(foundItems)}
            </div>

            <div style="display:flex;gap:8px;">
                <button id="age-rescan" class="apple-btn" style="flex:1;padding:10px;font-weight:500;">Re-scan Page</button>
                <button id="age-close" class="apple-btn" style="flex:1;padding:10px;color:#7a7a7a;background:transparent;border:none;">Dismiss</button>
            </div>
        `;
    }

    function renderListItems(items, filter = '') {
        let filtered = items.filter(i => i.url.toLowerCase().includes(filter.toLowerCase()) || i.type.toLowerCase().includes(filter.toLowerCase()));
        if (filtered.length === 0) {
            return `<div style="background:#ffffff;border:1px solid #e0e0e0;padding:16px;border-radius:11px;margin-bottom:10px;font-size:13px;color:#7a7a7a;text-align:center;">No game streams detected yet. Interact with the page or wait for assets to stream...</div>`;
        }
        let html = '';
        filtered.forEach((item, i) => {
            let isBest = items.indexOf(item) === 0;
            let badge = isBest ? `<span class="apple-badge">Top Match</span>` : '';

            html += `
                <div class="apple-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:13px;font-weight:600;color:#1d1d1f;">${badge}#${i+1} <span style="color:#7a7a7a;font-size:11px;font-weight:400;">(${item.type} • Score: ${item.score})</span></div>
                        <div style="display:flex;gap:6px;">
                            <button class="age-blank apple-btn" data-url="${item.url}" style="padding:3px 10px;font-size:11px;">Sandbox</button>
                            <button class="age-preview apple-btn" data-url="${item.url}" style="padding:3px 10px;font-size:11px;">Preview</button>
                            <button class="age-copy apple-btn" data-url="${item.url}" style="padding:3px 10px;font-size:11px;">Copy</button>
                            <button class="age-open apple-btn apple-btn-primary" data-url="${item.url}" style="padding:3px 12px;font-size:11px;">Open</button>
                        </div>
                    </div>
                    <div style="font-size:11px;color:#7a7a7a;word-break:break-all;font-family:SF Mono,ui-monospace,monospace;">${item.url}</div>
                </div>
            `;
        });
        return html;
    }

    function updateUIList() {
        let listContainer = document.getElementById('age-list-container');
        let foundCount = document.getElementById('age-found-count');
        let searchInput = document.getElementById('age-search');
        if (listContainer) {
            let filter = searchInput ? searchInput.value : '';
            listContainer.innerHTML = renderListItems(foundItems, filter);
        }
        if (foundCount) {
            foundCount.innerText = `${foundItems.length} found`;
        }
    }

    container.innerHTML = renderHTML();
    document.body.appendChild(container);

    // Event Handling
    container.onclick = function(e) {
        let target = e.target;
        
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
        if (target.classList.contains('age-preview')) {
            let u = target.getAttribute('data-url');
            let prevBox = document.getElementById('age-preview-overlay');
            if(prevBox) prevBox.remove();

            let overlay = document.createElement('div');
            overlay.id = 'age-preview-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#ffffff;z-index:9999999;display:flex;flex-direction:column;';
            overlay.innerHTML = `
                <div style="background:#f5f5f7;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e0e0e0;font-family:SF Pro Text,system-ui,sans-serif;">
                    <span style="color:#1d1d1f;font-size:13px;font-weight:500;">Preview: ${u}</span>
                    <button id="age-close-preview" class="apple-btn apple-btn-primary" style="padding:6px 16px;">Close Preview</button>
                </div>
                <iframe src="${u}" style="flex:1;width:100%;border:none;" allow="autoplay; gamepad; fullscreen; keyboard"></iframe>
            `;
            document.body.appendChild(overlay);

            document.getElementById('age-close-preview').onclick = function() {
                overlay.remove();
            };
        }
    };

    container.oninput = function(e) {
        if (e.target.id === 'age-search') {
            updateUIList();
        }
    };
})();
