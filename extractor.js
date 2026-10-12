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
        if (saved) settings = JSON.parse(saved);
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
            if (lower.includes('game') || lower.includes('play')) score += 10;

            if (settings.boostSameDomain && coreDomain.length > 3) {
                if (lower.includes(coreDomain)) score += 45;
            }

            if (settings.prioritizeCdn && (lower.includes('cdn') || lower.includes('storage') || lower.includes('aws') || lower.includes('cloudflare'))) score += 30;

            if (lower.includes('crazygames') || lower.includes('msnfun') || lower.includes('poki') || lower.includes('itch.io')) score += 40;
            if (lower.includes('blob:') || lower.includes('github.io') || lower.includes('vercel.app') || lower.includes('pages.dev')) score += 25;

            if (type === 'global-var') score += 50;
            if (type === 'iframe') score += 20;
            if (type === 'script-regex') score += 12;
            if (type === 'universal-attr') score += 5;
            if (type === 'link') score += 2;

            if (lower === location.origin + '/' || lower === location.href || lower.endsWith('/index.php')) score -= 50;

            if (score >= settings.minScore) {
                foundItems.push({ url: src, type: type, score: score });
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
                
                let jsonMatches = content.match(/["']https?:\/\/[^\s"'<>]+?\.(?:html|json|zip|swf|js)["']/gi) || [];
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

    scanGlobalVariables();
    scanScripts();
    deepScan(document);
    foundItems.sort((a, b) => b.score - a.score);

    // Build Anime Cyber-Neon UI
    let container = document.createElement('div');
    container.id = 'ultimate-game-extractor';
    container.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);width:94%;max-width:580px;background:linear-gradient(135deg, #12081f, #0c0614);color:#fff;padding:22px;border-radius:24px;box-shadow:0 30px 90px rgba(0,0,0,0.9), 0 0 40px rgba(255,0,127,0.25);z-index:999999;font-family:-apple-system,system-ui,sans-serif;box-sizing:border-box;border:1.5px solid rgba(255,0,127,0.45);backdrop-filter:blur(20px);';

    let html = `
        <style>
            #ultimate-game-extractor::-webkit-scrollbar { width: 6px; }
            #ultimate-game-extractor::-webkit-scrollbar-thumb { background: #ff007f; border-radius: 4px; }
            .anime-btn { background:linear-gradient(135deg, #25103a, #1a082b); color:#00f0ff; border:1px solid rgba(0,240,255,0.4); font-family:inherit; font-weight:700; cursor:pointer; border-radius:10px; transition:all 0.2s; }
            .anime-btn:hover { background:linear-gradient(135deg, #ff007f, #b30059); color:#fff; border-color:#ff007f; box-shadow:0 0 15px rgba(255,0,127,0.5); }
            .anime-card { background:rgba(25, 12, 43, 0.6); border:1px solid rgba(255,0,127,0.2); padding:12px; border-radius:14px; margin-bottom:10px; transition:all 0.2s; }
            .anime-card:hover { border-color:#00f0ff; box-shadow:0 0 15px rgba(0,240,255,0.2); }
            @keyframes animeGlow { 0% { opacity: 0.7; } 50% { opacity: 1; text-shadow:0 0 12px #ff007f; } 100% { opacity: 0.7; } }
            .anime-title-glow { animation: animeGlow 2s infinite; }
        </style>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
            <div style="font-size:16px;font-weight:900;letter-spacing:0.5px;display:flex;align-items:center;gap:8px;">
                <span class="anime-title-glow" style="color:#ff007f;">🌸 GAME STEALER</span> <span style="font-size:10px;background:rgba(0,240,255,0.15);color:#00f0ff;padding:2px 8px;border-radius:6px;border:1px solid rgba(0,240,255,0.3);">v6.0 OTARI</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button id="uge-toggle-settings" class="anime-btn" style="padding:5px 10px;font-size:11px;">⚙️ OPTIONS</button>
                <span style="font-size:11px;font-weight:bold;background:#1a082b;padding:5px 10px;border-radius:8px;color:#ff007f;border:1px solid rgba(255,0,127,0.3);">FOUND: ${foundItems.length}</span>
            </div>
        </div>

        <div style="font-size:11px;color:#b1a2c8;margin-bottom:14px;letter-spacing:0.3px;line-height:1.4;">
            ✨ Target Domain: <b style="color:#00f0ff;">${coreDomain}</b> | Engine Status: <span style="color:#00ff66;">Ready ✨</span>
        </div>

        <div id="uge-settings-panel" style="display:none;background:rgba(18, 8, 31, 0.95);border:1px solid rgba(0,240,255,0.3);padding:14px;border-radius:14px;margin-bottom:14px;font-size:11px;">
            <div style="font-weight:900;color:#00f0ff;margin-bottom:10px;letter-spacing:0.5px;text-transform:uppercase;">⚙️ Customization & Filters</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ddd;">
                    <input type="checkbox" id="opt-boost-domain" ${settings.boostSameDomain ? 'checked' : ''} style="accent-color:#ff007f;"> Boost Same-Domain Links (${coreDomain})
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ddd;">
                    <input type="checkbox" id="opt-exclude-images" ${settings.excludeImages ? 'checked' : ''} style="accent-color:#ff007f;"> Exclude Image Files (png, jpg, svg)
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ddd;">
                    <input type="checkbox" id="opt-only-html" ${settings.onlyHtmlOrGame ? 'checked' : ''} style="accent-color:#ff007f;"> Strict Mode (.html / Game / CDN endpoints)
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ddd;">
                    <input type="checkbox" id="opt-prioritize-cdn" ${settings.prioritizeCdn ? 'checked' : ''} style="accent-color:#ff007f;"> Prioritize Cloud CDNs & Storage
                </label>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;color:#aaa;">
                    <span>Minimum Score Threshold:</span>
                    <input type="number" id="opt-min-score" value="${settings.minScore}" style="width:50px;background:#0c0614;color:#00f0ff;border:1px solid rgba(0,240,255,0.3);padding:4px;border-radius:6px;text-align:center;">
                </div>
            </div>
            <button id="uge-save-settings" class="anime-btn" style="width:100%;margin-top:12px;padding:8px;font-weight:900;">Save & Rescan ✨</button>
        </div>
    `;

    if (foundItems.length > 0) {
        html += `<div style="max-height:260px;overflow-y:auto;margin-bottom:14px;padding-right:4px;">`;
        
        foundItems.forEach((item, i) => {
            let isBest = i === 0;
            let badge = isBest ? '<span style="background:linear-gradient(135deg, #ff007f, #ff66cc);color:#fff;font-size:9px;padding:3px 8px;border-radius:6px;margin-right:6px;font-weight:900;box-shadow:0 0 10px rgba(255,0,127,0.5);">💖 BEST MATCH</span>' : '';
            let cardStyle = isBest ? 'border:1.5px solid #ff007f;background:linear-gradient(135deg, rgba(255,0,127,0.1), rgba(25,12,43,0.8));' : '';

            html += `
                <div class="anime-card" style="${cardStyle}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:11px;font-weight:700;color:#fff;">${badge}#${i+1} <span style="color:#b1a2c8;font-size:10px;">(${item.type} | Score: ${item.score})</span></div>
                        <div style="display:flex;gap:4px;">
                            <button class="uge-blank anime-btn" data-url="${item.url}" style="padding:4px 7px;font-size:10px;">BLANK</button>
                            <button class="uge-preview anime-btn" data-url="${item.url}" style="padding:4px 7px;font-size:10px;">VIEW</button>
                            <button class="uge-copy anime-btn" data-url="${item.url}" style="padding:4px 7px;font-size:10px;">COPY</button>
                            <button class="uge-open anime-btn" data-url="${item.url}" style="padding:4px 9px;font-size:10px;background:#00f0ff;color:#000;border:none;box-shadow:0 0 10px rgba(0,240,255,0.4);">OPEN</button>
                        </div>
                    </div>
                    <div style="font-size:10px;color:#d1c4e9;word-break:break-all;font-family:monospace;opacity:0.85;">${item.url}</div>
                </div>
            `;
        });
        html += `</div>`;
    } else {
        html += `<div style="background:rgba(255,0,127,0.08);border:1px solid rgba(255,0,127,0.3);padding:14px;border-radius:14px;margin-bottom:16px;font-size:12px;color:#ff66b2;font-weight:600;text-align:center;">💫 No game streams detected yet. Interact with the game on the page first, then hit Rescan!</div>`;
    }

    html += `
        <div style="display:flex;gap:10px;">
            <button id="uge-rescan" class="anime-btn" style="flex:1;padding:12px;font-size:12px;font-weight:900;">🔄 RESCAN PAGE</button>
            <button id="uge-close" class="anime-btn" style="flex:1;padding:12px;font-size:12px;color:#aaa;background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.1);">CLOSE</button>
        </div>
    `;

    container.innerHTML = html;
    document.body.appendChild(container);

    // Event Listeners
    document.getElementById('uge-toggle-settings').onclick = function() {
        let panel = document.getElementById('uge-settings-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };

    document.getElementById('uge-save-settings').onclick = function() {
        settings.boostSameDomain = document.getElementById('opt-boost-domain').checked;
        settings.excludeImages = document.getElementById('opt-exclude-images').checked;
        settings.onlyHtmlOrGame = document.getElementById('opt-only-html').checked;
        settings.prioritizeCdn = document.getElementById('opt-prioritize-cdn').checked;
        settings.minScore = parseInt(document.getElementById('opt-min-score').value) || 10;
        
        try {
            localStorage.setItem('uge_settings', JSON.stringify(settings));
        } catch(e) {}

        container.remove();
        window._gameExtractorActive = false;
        setTimeout(() => {
            fetch('https://raw.githubusercontent.com/AetherIncarnate/game-stealer/main/extractor.js?v=' + Date.now())
                .then(r => r.text()).then(c => eval(c));
        }, 100);
    };

    container.querySelectorAll('.uge-blank').forEach(btn => {
        btn.onclick = function() {
            let u = this.getAttribute('data-url');
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
        };
    });

    container.querySelectorAll('.uge-copy').forEach(btn => {
        btn.onclick = function() {
            let u = this.getAttribute('data-url');
            navigator.clipboard.writeText(u).then(() => {
                let orig = this.innerText;
                this.innerText = 'COPIED!';
                this.style.background = '#00f0ff';
                this.style.color = '#000';
                setTimeout(() => { 
                    this.innerText = orig; 
                    this.style.background = '';
                    this.style.color = '';
                }, 1500);
            });
        };
    });

    container.querySelectorAll('.uge-open').forEach(btn => {
        btn.onclick = function() {
            window.location.href = this.getAttribute('data-url');
        };
    });

    container.querySelectorAll('.uge-preview').forEach(btn => {
        btn.onclick = function() {
            let u = this.getAttribute('data-url');
            let prevBox = document.getElementById('uge-preview-overlay');
            if(prevBox) prevBox.remove();

            let overlay = document.createElement('div');
            overlay.id = 'uge-preview-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0a0510;z-index:9999999;display:flex;flex-direction:column;';
            overlay.innerHTML = `
                <div style="background:#12081f;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,0,127,0.3);">
                    <span style="color:#00f0ff;font-size:12px;font-weight:900;">🌸 ANIME PREVIEW: ${u}</span>
                    <button id="uge-close-preview" class="anime-btn" style="background:#ff007f;color:#fff;border:none;padding:6px 14px;font-size:11px;">EXIT</button>
                </div>
                <iframe src="${u}" style="flex:1;width:100%;border:none;" allow="autoplay; gamepad; fullscreen; keyboard"></iframe>
            `;
            document.body.appendChild(overlay);

            document.getElementById('uge-close-preview').onclick = function() {
                overlay.remove();
            };
        };
    });

    document.getElementById('uge-rescan').onclick = function() {
        container.remove();
        window._gameExtractorActive = false;
        setTimeout(() => {
            fetch('https://raw.githubusercontent.com/AetherIncarnate/game-stealer/main/extractor.js?v=' + Date.now())
                .then(r => r.text()).then(c => eval(c));
        }, 100);
    };

    document.getElementById('uge-close').onclick = function() {
        container.remove();
        window._gameExtractorActive = false;
    };
})();
