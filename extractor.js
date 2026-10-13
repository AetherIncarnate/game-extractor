(function(){
    if(window._gameExtractorActive) {
        let old = document.getElementById('ultimate-game-extractor');
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
        let saved = localStorage.getItem('uge_settings');
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

    // Network Request Interception
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

    scanGlobalVariables();
    scanScripts();
    deepScan(document);

    // Build UI Container
    let container = document.createElement('div');
    container.id = 'ultimate-game-extractor';
    container.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);width:94%;max-width:580px;background:#090a0f;color:#e1e7ec;padding:22px;border-radius:20px;box-shadow:0 30px 90px rgba(0,0,0,0.95), 0 0 30px rgba(0,240,255,0.15);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-sizing:border-box;border:1px solid rgba(0,240,255,0.3);backdrop-filter:blur(16px);';

    function renderHTML() {
        return `
            <style>
                #ultimate-game-extractor::-webkit-scrollbar { width: 5px; }
                #ultimate-game-extractor::-webkit-scrollbar-thumb { background: #00f0ff; border-radius: 4px; }
                .onyx-btn { background: #12151e; color: #00f0ff; border: 1px solid rgba(0,240,255,0.3); font-family: inherit; font-weight: 700; cursor: pointer; border-radius: 8px; transition: all 0.2s ease; }
                .onyx-btn:hover { background: #00f0ff; color: #090a0f; border-color: #00f0ff; box-shadow: 0 0 12px rgba(0,240,255,0.5); }
                .onyx-card { background: rgba(18, 21, 30, 0.7); border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 12px; margin-bottom: 10px; transition: all 0.2s ease; }
                .onyx-card:hover { border-color: #00f0ff; box-shadow: 0 0 15px rgba(0,240,255,0.15); }
                .onyx-badge { background: #00f0ff; color: #090a0f; font-size: 9px; padding: 3px 7px; border-radius: 5px; margin-right: 6px; font-weight: 900; box-shadow: 0 0 8px rgba(0,240,255,0.4); }
            </style>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:12px;">
                <div style="font-size:15px;font-weight:900;letter-spacing:0.5px;display:flex;align-items:center;gap:8px;">
                    <span style="color:#00f0ff;">⚡ GAME EXTRACTOR</span> <span style="font-size:10px;background:rgba(0,240,255,0.1);color:#00f0ff;padding:2px 8px;border-radius:5px;border:1px solid rgba(0,240,255,0.25);">v9.0 ONYX</span>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button id="uge-toggle-settings" class="onyx-btn" style="padding:5px 10px;font-size:11px;">⚙️ OPTIONS</button>
                    <span id="uge-found-count" style="font-size:11px;font-weight:bold;background:#12151e;padding:5px 10px;border-radius:6px;color:#00f0ff;border:1px solid rgba(0,240,255,0.2);">FOUND: ${foundItems.length}</span>
                </div>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:12px;">
                <input type="text" id="uge-search" placeholder="🔍 Search extracted URLs..." style="flex:1;background:#12151e;border:1px solid rgba(0,240,255,0.25);padding:8px 12px;border-radius:8px;color:#fff;font-size:11px;outline:none;">
                <button id="uge-export" class="onyx-btn" style="padding:8px 12px;font-size:11px;">📥 EXPORT</button>
            </div>

            <div style="font-size:11px;color:#9aa7b2;margin-bottom:14px;letter-spacing:0.3px;">
                🎯 Domain: <b style="color:#00f0ff;">${coreDomain}</b> | Live Interceptor: <span style="color:#00ff66;">Active</span>
            </div>

            <div id="uge-settings-panel" style="display:none;background:#0d0f17;border:1px solid rgba(0,240,255,0.3);padding:14px;border-radius:12px;margin-bottom:14px;font-size:11px;">
                <div style="font-weight:900;color:#00f0ff;margin-bottom:10px;letter-spacing:0.5px;text-transform:uppercase;">⚙️ Scan Controls & Filters</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ccc;">
                        <input type="checkbox" id="opt-boost-domain" ${settings.boostSameDomain ? 'checked' : ''} style="accent-color:#00f0ff;"> Boost Same-Domain Links
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ccc;">
                        <input type="checkbox" id="opt-exclude-images" ${settings.excludeImages ? 'checked' : ''} style="accent-color:#00f0ff;"> Exclude Image Files
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ccc;">
                        <input type="checkbox" id="opt-only-html" ${settings.onlyHtmlOrGame ? 'checked' : ''} style="accent-color:#00f0ff;"> Strict Mode (.html / game endpoints)
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ccc;">
                        <input type="checkbox" id="opt-prioritize-cdn" ${settings.prioritizeCdn ? 'checked' : ''} style="accent-color:#00f0ff;"> Prioritize Cloud CDNs
                    </label>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;color:#888;">
                        <span>Minimum Score Threshold:</span>
                        <input type="number" id="opt-min-score" value="${settings.minScore}" style="width:50px;background:#12151e;color:#00f0ff;border:1px solid rgba(0,240,255,0.3);padding:4px;border-radius:6px;text-align:center;">
                    </div>
                </div>
                <button id="uge-save-settings" class="onyx-btn" style="width:100%;margin-top:12px;padding:8px;font-weight:900;">Save & Rescan ✨</button>
            </div>

            <div id="uge-list-container" style="max-height:240px;overflow-y:auto;margin-bottom:14px;padding-right:4px;">
                ${renderListItems(foundItems)}
            </div>

            <div style="display:flex;gap:10px;">
                <button id="uge-rescan" class="onyx-btn" style="flex:1;padding:12px;font-size:12px;font-weight:900;">🔄 RESCAN PAGE</button>
                <button id="uge-close" class="onyx-btn" style="flex:1;padding:12px;font-size:12px;color:#888;background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.08);">CLOSE</button>
            </div>
        `;
    }

    function renderListItems(items, filter = '') {
        let filtered = items.filter(i => i.url.toLowerCase().includes(filter.toLowerCase()) || i.type.toLowerCase().includes(filter.toLowerCase()));
        if (filtered.length === 0) {
            return `<div style="background:rgba(0,240,255,0.05);border:1px solid rgba(0,240,255,0.2);padding:14px;border-radius:12px;margin-bottom:16px;font-size:12px;color:#00f0ff;font-weight:600;text-align:center;">⚡ No matching streams detected yet. Interact with the game on the page first!</div>`;
        }
        let html = '';
        filtered.forEach((item, i) => {
            let isBest = items.indexOf(item) === 0;
            let badge = isBest ? `<span class="onyx-badge">TOP MATCH</span>` : '';
            let cardStyle = isBest ? `border:1px solid #00f0ff;background:rgba(0,240,255,0.08);` : '';

            html += `
                <div class="onyx-card" style="${cardStyle}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:11px;font-weight:700;color:#fff;">${badge}#${i+1} <span style="color:#7f8c98;font-size:10px;">(${item.type} | Score: ${item.score})</span></div>
                        <div style="display:flex;gap:4px;">
                            <button class="uge-blank onyx-btn" data-url="${item.url}" style="padding:4px 7px;font-size:10px;">BLANK</button>
                            <button class="uge-preview onyx-btn" data-url="${item.url}" style="padding:4px 7px;font-size:10px;">VIEW</button>
                            <button class="uge-copy onyx-btn" data-url="${item.url}" style="padding:4px 7px;font-size:10px;">COPY</button>
                            <button class="uge-open onyx-btn" data-url="${item.url}" style="padding:4px 9px;font-size:10px;background:#00f0ff;color:#090a0f;border:none;font-weight:bold;">OPEN</button>
                        </div>
                    </div>
                    <div style="font-size:10px;color:#b2c0cc;word-break:break-all;font-family:monospace;">${item.url}</div>
                </div>
            `;
        });
        return html;
    }

    function updateUIList() {
        let listContainer = document.getElementById('uge-list-container');
        let foundCount = document.getElementById('uge-found-count');
        let searchInput = document.getElementById('uge-search');
        if (listContainer) {
            let filter = searchInput ? searchInput.value : '';
            listContainer.innerHTML = renderListItems(foundItems, filter);
        }
        if (foundCount) {
            foundCount.innerText = `FOUND: ${foundItems.length}`;
        }
    }

    container.innerHTML = renderHTML();
    document.body.appendChild(container);

    // Event Handling
    container.onclick = function(e) {
        let target = e.target;
        
        if (target.id === 'uge-toggle-settings') {
            let panel = document.getElementById('uge-settings-panel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }

        if (target.id === 'uge-save-settings') {
            settings.boostSameDomain = document.getElementById('opt-boost-domain').checked;
            settings.excludeImages = document.getElementById('opt-exclude-images').checked;
            settings.onlyHtmlOrGame = document.getElementById('opt-only-html').checked;
            settings.prioritizeCdn = document.getElementById('opt-prioritize-cdn').checked;
            settings.minScore = parseInt(document.getElementById('opt-min-score').value) || 10;
            
            try { localStorage.setItem('uge_settings', JSON.stringify(settings)); } catch(e) {}

            container.innerHTML = renderHTML();
            scanGlobalVariables();
            scanScripts();
            deepScan(document);
        }

        if (target.id === 'uge-rescan') {
            foundItems = [];
            scanGlobalVariables();
            scanScripts();
            deepScan(document);
            updateUIList();
        }

        if (target.id === 'uge-close') {
            container.remove();
            window._gameExtractorActive = false;
        }

        if (target.id === 'uge-export') {
            let blob = new Blob([JSON.stringify(foundItems, null, 2)], { type: 'application/json' });
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = `${coreDomain}-extracted-games.json`;
            a.click();
        }

        // Action Buttons
        if (target.classList.contains('uge-blank')) {
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
        if (target.classList.contains('uge-copy')) {
            let u = target.getAttribute('data-url');
            navigator.clipboard.writeText(u).then(() => {
                let orig = target.innerText;
                target.innerText = 'COPIED!';
                setTimeout(() => { target.innerText = orig; }, 1500);
            });
        }
        if (target.classList.contains('uge-open')) {
            window.location.href = target.getAttribute('data-url');
        }
        if (target.classList.contains('uge-preview')) {
            let u = target.getAttribute('data-url');
            let prevBox = document.getElementById('uge-preview-overlay');
            if(prevBox) prevBox.remove();

            let overlay = document.createElement('div');
            overlay.id = 'uge-preview-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#000;z-index:9999999;display:flex;flex-direction:column;';
            overlay.innerHTML = `
                <div style="background:#090a0f;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(0,240,255,0.3);">
                    <span style="color:#00f0ff;font-size:12px;font-weight:900;">PREVIEW: ${u}</span>
                    <button id="uge-close-preview" class="onyx-btn" style="background:#00f0ff;color:#090a0f;border:none;padding:6px 14px;font-size:11px;font-weight:bold;">EXIT</button>
                </div>
                <iframe src="${u}" style="flex:1;width:100%;border:none;" allow="autoplay; gamepad; fullscreen; keyboard"></iframe>
            `;
            document.body.appendChild(overlay);

            document.getElementById('uge-close-preview').onclick = function() {
                overlay.remove();
            };
        }
    };

    container.oninput = function(e) {
        if (e.target.id === 'uge-search') {
            updateUIList();
        }
    };
})();
