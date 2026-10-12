(function(){
    if(window._gameExtractorActive) {
        let old = document.getElementById('ultimate-game-extractor');
        if(old) old.remove();
    }
    window._gameExtractorActive = true;

    let settings = {
        excludeImages: true,
        onlyHtmlOrGame: false,
        prioritizeCdn: true,
        minScore: 10
    };

    try {
        let saved = localStorage.getItem('uge_settings');
        if (saved) settings = JSON.parse(saved);
    } catch(e) {}

    let foundItems = [];

    function resolveUrl(url) {
        if (!url || url === 'about:blank' || url.startsWith('javascript:') || url.startsWith('blob:about')) return null;
        try {
            return new URL(url, document.baseURI).href;
        } catch(e) {
            return url;
        }
    }

    function analyzeAndAdd(rawSrc, type) {
        let src = resolveUrl(rawSrc);
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

            if (lower.includes('/game/') || lower.includes('/play/') || lower.includes('/embed/') || lower.includes('/v3/')) score += 35;
            if (lower.endsWith('.html') || lower.includes('index.html')) score += 25;
            if (lower.includes('game') || lower.includes('play')) score += 10;

            if (settings.prioritizeCdn && (lower.includes('cdn') || lower.includes('storage') || lower.includes('aws') || lower.includes('cloudflare'))) score += 30;

            if (lower.includes('crazygames') || lower.includes('msnfun') || lower.includes('poki') || lower.includes('itch.io')) score += 40;
            if (lower.includes('blob:') || lower.includes('github.io') || lower.includes('vercel.app') || lower.includes('pages.dev')) score += 25;

            if (type === 'global-var') score += 50;
            if (type === 'iframe') score += 15;
            if (type === 'script-regex') score += 10;
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
            const keys = ['gameUrl', 'gGameUrl', 'EJS_gameUrl', 'gameSrc', 'embedUrl', 'iframeUrl', 'uGameUrl', 'gamePath'];
            keys.forEach(k => {
                if (window[k]) analyzeAndAdd(window[k], 'global-var');
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
                let matches = content.match(/https?:\/\/[^\s"'<>]+?\/(?:game|play|embed|v[0-9]|roms|builds|cdn)\/[^\s"'<>]+/gi) || [];
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

    let container = document.createElement('div');
    container.id = 'ultimate-game-extractor';
    container.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);width:94%;max-width:540px;background:#09090e;color:#fff;padding:22px;border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,0.95), 0 0 30px rgba(0,255,204,0.15);z-index:999999;font-family:-apple-system,system-ui,sans-serif;box-sizing:border-box;border:1px solid rgba(0,255,204,0.4);backdrop-filter:blur(16px);';

    let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:12px;">
            <h3 style="margin:0;font-size:18px;font-weight:900;color:#00ffcc;letter-spacing:0.5px;display:flex;align-items:center;gap:8px;text-shadow:0 0 10px rgba(0,255,204,0.4);">⚡ GAME STEALER <span style="font-size:10px;background:rgba(0,255,204,0.1);color:#00ffcc;border:1px solid rgba(0,255,204,0.3);padding:2px 6px;border-radius:6px;">v4.1</span></h3>
            <div style="display:flex;gap:6px;">
                <button id="uge-toggle-settings" style="background:#13131f;color:#00ffcc;border:1px solid rgba(0,255,204,0.3);padding:5px 10px;border-radius:8px;font-size:11px;font-weight:bold;cursor:pointer;">⚙️ OPTIONS</button>
                <span style="font-size:11px;font-weight:bold;background:#13131f;padding:5px 10px;border-radius:8px;color:#00ffcc;border:1px solid rgba(0,255,204,0.2);">FOUND: ${foundItems.length}</span>
            </div>
        </div>

        <div id="uge-settings-panel" style="display:none;background:#12121c;border:1px solid rgba(0,255,204,0.2);padding:14px;border-radius:12px;margin-bottom:14px;font-size:11px;">
            <div style="font-weight:bold;color:#00ffcc;margin-bottom:8px;letter-spacing:0.5px;text-transform:uppercase;">Extraction Tweaks & Filters</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ddd;">
                    <input type="checkbox" id="opt-exclude-images" ${settings.excludeImages ? 'checked' : ''} style="accent-color:#00ffcc;"> Exclude Image Files (png, jpg, svg, etc.)
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ddd;">
                    <input type="checkbox" id="opt-only-html" ${settings.onlyHtmlOrGame ? 'checked' : ''} style="accent-color:#00ffcc;"> Strict Mode (Only .html / Game / CDN endpoints)
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ddd;">
                    <input type="checkbox" id="opt-prioritize-cdn" ${settings.prioritizeCdn ? 'checked' : ''} style="accent-color:#00ffcc;"> Heavy Boost for CDN & Storage Links
                </label>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;color:#aaa;">
                    <span>Minimum Score Threshold:</span>
                    <input type="number" id="opt-min-score" value="${settings.minScore}" style="width:50px;background:#09090e;color:#fff;border:1px solid #333;padding:4px;border-radius:4px;text-align:center;">
                </div>
            </div>
            <button id="uge-save-settings" style="width:100%;background:#00ffcc;color:#000;border:none;margin-top:10px;padding:8px;border-radius:6px;font-weight:bold;cursor:pointer;">Save & Rescan</button>
        </div>
    `;

    if (foundItems.length > 0) {
        html += `<p style="margin:0 0 10px 0;font-size:11px;font-weight:600;color:#7a889b;letter-spacing:0.5px;text-transform:uppercase;">Target Acquired & Ranked:</p>`;
        html += `<div style="max-height:240px;overflow-y:auto;margin-bottom:14px;padding-right:4px;scrollbar-width:thin;scrollbar-color:#00ffcc #12121c;">`;
        
        foundItems.forEach((item, i) => {
            let badge = i === 0 ? '<span style="background:linear-gradient(135deg, #ff0055, #ff5500);color:#fff;font-size:9px;padding:3px 8px;border-radius:6px;margin-right:6px;font-weight:900;letter-spacing:0.5px;box-shadow:0 0 10px rgba(255,0,85,0.5);">🔥 BEST MATCH</span>' : '';
            let borderStyle = i === 0 ? 'border:1px solid rgba(255,0,85,0.4);background:linear-gradient(135deg, rgba(255,0,85,0.05), rgba(18,18,28,0.6));' : 'border:1px solid rgba(255,255,255,0.06);background:#12121c;';
            
            html += `
                <div style="${borderStyle}padding:12px;border-radius:12px;margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:11px;color:#fff;font-weight:700;">${badge}#${i+1} <span style="color:#566275;font-weight:500;font-size:10px;">(${item.type} | Score: ${item.score})</span></div>
                        <div style="display:flex;gap:6px;">
                            <button class="uge-preview" data-url="${item.url}" style="background:#1a1a2e;color:#00ffcc;border:1px solid rgba(0,255,204,0.3);padding:5px 10px;border-radius:7px;font-size:11px;cursor:pointer;font-weight:700;">PREVIEW</button>
                            <button class="uge-copy" data-url="${item.url}" style="background:#1a1a2e;color:#fff;border:1px solid rgba(255,255,255,0.1);padding:5px 10px;border-radius:7px;font-size:11px;cursor:pointer;font-weight:700;">COPY</button>
                            <button class="uge-open" data-url="${item.url}" style="background:#00ffcc;color:#000;border:none;padding:5px 12px;border-radius:7px;font-size:11px;font-weight:900;cursor:pointer;box-shadow:0 0 12px rgba(0,255,204,0.4);">OPEN</button>
                        </div>
                    </div>
                    <div style="font-size:10px;color:#8a99ad;word-break:break-all;font-family:monospace;opacity:0.85;line-height:1.3;">${item.url}</div>
                </div>
            `;
        });
        html += `</div>`;
    } else {
        html += `<div style="background:rgba(255,0,85,0.08);border:1px solid rgba(255,0,85,0.2);padding:14px;border-radius:12px;margin-bottom:16px;font-size:12px;color:#ff6b8b;font-weight:600;text-align:center;">⚠️ No streams met the threshold. Try tweaking options or hitting RESCAN.</div>`;
    }

    html += `
        <div style="display:flex;gap:10px;">
            <button id="uge-rescan" style="flex:1;background:#13131f;color:#00ffcc;border:1px solid rgba(0,255,204,0.3);padding:12px;border-radius:10px;font-size:12px;font-weight:900;cursor:pointer;letter-spacing:0.5px;">🔄 RESCAN</button>
            <button id="uge-close" style="flex:1;background:rgba(255,255,255,0.05);color:#8a99ad;border:1px solid rgba(255,255,255,0.08);padding:12px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.5px;">CLOSE</button>
        </div>
    `;

    container.innerHTML = html;
    document.body.appendChild(container);

    document.getElementById('uge-toggle-settings').onclick = function() {
        let panel = document.getElementById('uge-settings-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };

    document.getElementById('uge-save-settings').onclick = function() {
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

    container.querySelectorAll('.uge-copy').forEach(btn => {
        btn.onclick = function() {
            let u = this.getAttribute('data-url');
            navigator.clipboard.writeText(u).then(() => {
                let orig = this.innerText;
                this.innerText = 'COPIED!';
                this.style.background = '#00ffcc';
                this.style.color = '#000';
                setTimeout(() => { 
                    this.innerText = orig; 
                    this.style.background = '#1a1a2e';
                    this.style.color = '#fff';
                }, 1500);
            });
        };
    });

    container.querySelectorAll('.uge-open').forEach(btn => {
        btn.onclick = function() {
            window.location.href = this.getAttribute('data
