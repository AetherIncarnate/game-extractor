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

    // Extract core domain name
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

    // Decode URI / Base64 / Ultraviolet Proxy Strings
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

    // Build Hacker Terminal UI
    let container = document.createElement('div');
    container.id = 'ultimate-game-extractor';
    container.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);width:94%;max-width:580px;background:#030a05;color:#00ff66;padding:22px;border-radius:12px;box-shadow:0 0 50px rgba(0,255,102,0.25), 0 0 100px rgba(0,0,0,0.95);z-index:999999;font-family:"Courier New", Courier, monospace;box-sizing:border-box;border:1px solid #00ff66;backdrop-filter:blur(20px);';

    let html = `
        <style>
            #ultimate-game-extractor::-webkit-scrollbar { width: 4px; }
            #ultimate-game-extractor::-webkit-scrollbar-thumb { background: #00ff66; }
            .uge-btn { background:#001a0d; color:#00ff66; border:1px solid #00ff66; font-family:"Courier New", Courier, monospace; font-weight:bold; cursor:pointer; text-transform:uppercase; transition:all 0.15s ease-in-out; }
            .uge-btn:hover { background:#00ff66; color:#000; box-shadow:0 0 12px #00ff66; }
            .uge-card { background:#021006; border:1px solid rgba(0,255,102,0.25); padding:10px; border-radius:6px; margin-bottom:8px; position:relative; }
            .uge-card:hover { border-color:#00ff66; box-shadow:0 0 10px rgba(0,255,102,0.2); }
            @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
            .uge-blink { animation: pulse 1.2s infinite; }
        </style>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid #00ff66;padding-bottom:10px;">
            <div style="font-size:15px;font-weight:bold;letter-spacing:1px;display:flex;align-items:center;gap:8px;">
                <span class="uge-blink" style="color:#00ff66;">[SYSTEM_SNIFFER_v5.5]</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button id="uge-toggle-settings" class="uge-btn" style="padding:4px 8px;font-size:10px;">[SYS_CONFIG]</button>
                <span style="font-size:11px;background:#002b15;padding:4px 8px;border-radius:4px;border:1px solid #00ff66;color:#00ff66;">HOSTS: ${foundItems.length}</span>
            </div>
        </div>

        <div style="font-size:10px;color:#00bb44;margin-bottom:12px;letter-spacing:0.5px;line-height:1.2;">
            &gt; STATUS: INFILTRATED ROOT DOMAIN [${coreDomain}]<br>
            &gt; PARSING: SHADOW_DOM / SCRIPT_PAYLOADS / PROXY_WRAPPERS
        </div>

        <div id="uge-settings-panel" style="display:none;background:#011408;border:1px dashed #00ff66;padding:12px;border-radius:6px;margin-bottom:12px;font-size:10px;">
            <div style="font-weight:bold;color:#00ff66;margin-bottom:8px;">&gt; OVERRIDE_PARAMETERS:</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="opt-boost-domain" ${settings.boostSameDomain ? 'checked' : ''} style="accent-color:#00ff66;"> BOOST_SAME_DOMAIN_TARGETS (${coreDomain})
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="opt-exclude-images" ${settings.excludeImages ? 'checked' : ''} style="accent-color:#00ff66;"> PURGE_STATIC_IMAGE_PAYLOADS (png, jpg, svg)
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="opt-only-html" ${settings.onlyHtmlOrGame ? 'checked' : ''} style="accent-color:#00ff66;"> STRICT_EXPLOIT_MODE (.html / CDN / Game Endpoints)
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="opt-prioritize-cdn" ${settings.prioritizeCdn ? 'checked' : ''} style="accent-color:#00ff66;"> PRIORITY_SCORES_FOR_CLOUD_CDNS
                </label>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
                    <span>MINIMUM_SCORE_CUTOFF:</span>
                    <input type="number" id="opt-min-score" value="${settings.minScore}" style="width:45px;background:#001a0d;color:#00ff66;border:1px solid #00ff66;padding:2px;text-align:center;">
                </div>
            </div>
            <button id="uge-save-settings" class="uge-btn" style="width:100%;margin-top:10px;padding:6px;font-size:10px;">&gt; EXECUTE_OVERRIDE_RESCAN</button>
        </div>
    `;

    if (foundItems.length > 0) {
        html += `<div style="max-height:250px;overflow-y:auto;margin-bottom:14px;padding-right:4px;">`;
        
        foundItems.forEach((item, i) => {
            let isBest = i === 0;
            let badge = isBest ? '<span style="background:#00ff66;color:#000;font-size:8px;padding:2px 5px;border-radius:2px;margin-right:6px;font-weight:900;">[PRIMARY_MATCH]</span>' : '';
            let cardStyle = isBest ? 'border:1px solid #00ff66;background:#00220d;box-shadow:0 0 10px rgba(0,255,102,0.3);' : '';

            html += `
                <div class="uge-card" style="${cardStyle}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:10px;font-weight:bold;color:#00ff66;">${badge}#${i+1} [TYPE:${item.type.toUpperCase()}] [RANK:${item.score}]</div>
                        <div style="display:flex;gap:4px;">
                            <button class="uge-blank uge-btn" data-url="${item.url}" style="padding:3px 6px;font-size:9px;">BLANK</button>
                            <button class="uge-preview uge-btn" data-url="${item.url}" style="padding:3px 6px;font-size:9px;">VIEW</button>
                            <button class="uge-copy uge-btn" data-url="${item.url}" style="padding:3px 6px;font-size:9px;">COPY</button>
                            <button class="uge-open uge-btn" data-url="${item.url}" style="padding:3px 8px;font-size:9px;background:#00ff66;color:#000;">HIJACK</button>
                        </div>
                    </div>
                    <div style="font-size:9px;color:#00dd55;word-break:break-all;opacity:0.85;">${item.url}</div>
                </div>
            `;
        });
        html += `</div>`;
    } else {
        html += `<div style="border:1px dashed #ff0055;background:rgba(255,0,85,0.05);padding:12px;border-radius:6px;margin-bottom:14px;font-size:10px;color:#ff0055;text-align:center;">&gt; NO_VALID_TARGETS_DETECTED. INITIATE GAMEPLAY & HIT RESCAN.</div>`;
    }

    html += `
        <div style="display:flex;gap:8px;">
            <button id="uge-rescan" class="uge-btn" style="flex:1;padding:10px;font-size:11px;">&gt; RESCAN_MEMORY</button>
            <button id="uge-close" class="uge-btn" style="flex:1;padding:10px;font-size:11px;border-color:#555;color:#aaa;background:#000;">&gt; DISCONNECT</button>
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
                        <head><title>System Diagnostics</title></head>
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
                this.style.background = '#00ff66';
                this.style.color = '#000';
                setTimeout(() => { 
                    this.innerText = orig; 
                    this.style.background = '#001a0d';
                    this.style.color = '#00ff66';
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
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#000;z-index:9999999;display:flex;flex-direction:column;';
            overlay.innerHTML = `
                <div style="background:#021006;padding:10px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #00ff66;font-family:monospace;">
                    <span style="color:#00ff66;font-size:11px;font-weight:bold;">&gt; STEALTH_PREVIEW: ${u}</span>
                    <button id="uge-close-preview" class="uge-btn" style="background:#ff0055;color:#fff;border:none;padding:5px 12px;font-size:10px;">TERMINATE_PREVIEW</button>
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
