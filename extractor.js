(function(){
    if(window._gameExtractorActive) {
        let old = document.getElementById('ultimate-game-extractor');
        if(old) old.remove();
    }
    window._gameExtractorActive = true;

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
        
        const blockedKeywords = [
            'ads', 'analytics', 'telemetry', 'consent', 'login', 'auth', 
            'pixel', 'googletagmanager', 'google.com/maps', 'docs.google.com', 'apis.google.com',
            'facebook', 'twitter', 'discord', 'telegram'
        ];
        if (blockedKeywords.some(keyword => lower.includes(keyword))) return;
        
        if (!foundItems.some(item => item.url === src)) {
            let score = 0;
            if (lower.includes('game') || lower.includes('play') || lower.includes('index') || lower.includes('embed') || lower.endsWith('.html')) score += 15;
            if (lower.includes('blob:') || lower.includes('cdn') || lower.includes('github.io') || lower.includes('vercel.app') || lower.includes('pages.dev')) score += 8;
            if (lower.includes('v3') || lower.includes('msnfun') || lower.includes('crazygames') || lower.includes('poki') || lower.includes('emulator')) score += 12;
            
            if (type === 'global-var') score += 20; // Emulators/configs are usually direct hits
            if (type === 'iframe') score += 5;
            if (type === 'script-regex') score += 6;
            if (type === 'universal-attr') score += 4;
            if (type === 'link') score += 2;
            
            foundItems.push({ url: src, type: type, score: score });
        }
    }

    // 1. Sniff Global JavaScript variables and Emulator configs (e.g., EmulatorJS)
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

    // 2. Scan script contents for hardcoded or JSON-embedded URLs
    function scanScripts() {
        try {
            document.querySelectorAll('script').forEach(s => {
                let content = s.textContent || s.innerText || '';
                let matches = content.match(/https?:\/\/[^\s"'<>]+?\/(?:game|play|embed|v[0-9]|roms|builds)\/[^\s"'<>]+/gi) || [];
                matches.forEach(m => analyzeAndAdd(m, 'script-regex'));
                
                let jsonMatches = content.match(/["']https?:\/\/[^\s"'<>]+?\.(?:html|json|zip|swf)["']/gi) || [];
                jsonMatches.forEach(m => analyzeAndAdd(m.replace(/["']/g, ''), 'script-regex'));
            });
        } catch(e) {}
    }

    // 3. Deep recursive scanner for DOM, Shadow DOM, and all element attributes
    function deepScan(root) {
        if (!root) return;
        try {
            root.querySelectorAll('iframe').forEach(f => {
                analyzeAndAdd(f.src || f.getAttribute('data-src') || f.getAttribute('data-url') || f.getAttribute('data-embed'), 'iframe');
                try {
                    if (f.contentDocument) deepScan(f.contentDocument);
                } catch(err) {}
            });

            root.querySelectorAll('embed, object').forEach(e => {
                analyzeAndAdd(e.src || e.data, 'media');
            });

            // Universal attribute inspector on every element
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) deepScan(el.shadowRoot);
                
                for (let attr of el.attributes) {
                    let val = attr.value;
                    if (val && (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('/'))) {
                        let lowerVal = val.toLowerCase();
                        if (lowerVal.includes('game') || lowerVal.includes('play') || lowerVal.includes('embed') || lowerVal.endsWith('.html') || lowerVal.endsWith('.json') || lowerVal.endsWith('.zip')) {
                            analyzeAndAdd(val, 'universal-attr');
                        }
                    }
                }
            });

            root.querySelectorAll('a[href]').forEach(a => {
                let href = a.getAttribute('href');
                if (href && (href.includes('game') || href.includes('play') || href.endsWith('.html') || href.includes('github.io') || href.includes('vercel.app'))) {
                    analyzeAndAdd(href, 'link');
                }
            });
        } catch(e) {}
    }

    scanGlobalVariables();
    scanScripts();
    deepScan(document);
    foundItems.sort((a, b) => b.score - a.score);

    // Dashboard UI
    let container = document.createElement('div');
    container.id = 'ultimate-game-extractor';
    container.style.cssText = 'position:fixed;top:15px;left:50%;transform:translateX(-50%);width:94%;max-width:560px;background:linear-gradient(135deg, #0d0d1a, #16162b);color:#fff;padding:22px;border-radius:18px;box-shadow:0 25px 60px rgba(0,0,0,0.9);z-index:999999;font-family:-apple-system,system-ui,sans-serif;box-sizing:border-box;border:1px solid rgba(0,255,204,0.3);';

    let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h3 style="margin:0;font-size:18px;color:#00ffcc;display:flex;align-items:center;gap:8px;">🚀 Universal Game Stealer v3</h3>
            <span style="font-size:11px;background:#0f3460;padding:5px 10px;border-radius:10px;color:#00ffcc;border:1px solid rgba(0,255,204,0.3);">Found: ${foundItems.length}</span>
        </div>
    `;

    if (foundItems.length > 0) {
        html += `<p style="margin:0 0 12px 0;font-size:12px;color:#a0aab2;">Smart-matched game endpoints. Top choice is ready:</p>`;
        html += `<div style="max-height:240px;overflow-y:auto;margin-bottom:16px;padding-right:4px;">`;
        
        foundItems.forEach((item, i) => {
            let badge = i === 0 ? '<span style="background:#e94560;color:#fff;font-size:9px;padding:2px 6px;border-radius:4px;margin-right:6px;font-weight:bold;">BEST MATCH</span>' : '';
            html += `
                <div style="background:rgba(255,255,255,0.04);padding:10px;border-radius:10px;margin-bottom:8px;border:1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:11px;color:#00ffcc;font-weight:600;">${badge}#${i+1} <span style="color:#888;font-weight:normal;">(${item.type})</span></div>
                        <div style="display:flex;gap:5px;">
                            <button class="uge-preview" data-url="${item.url}" style="background:#1f4068;color:#00ffcc;border:none;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">Preview</button>
                            <button class="uge-copy" data-url="${item.url}" style="background:#0f3460;color:#00ffcc;border:none;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">Copy</button>
                            <button class="uge-open" data-url="${item.url}" style="background:#00ffcc;color:#000;border:none;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;">Open</button>
                        </div>
                    </div>
                    <div style="font-size:10px;color:#ccc;word-break:break-all;opacity:0.8;line-height:1.3;">${item.url}</div>
                </div>
            `;
        });
        html += `</div>`;
    } else {
        html += `<div style="background:rgba(255,87,87,0.1);border:1px solid rgba(255,87,87,0.2);padding:14px;border-radius:10px;margin-bottom:15px;font-size:12px;color:#ff8888;">No games detected yet. Interact or start the game on the page first, then hit Rescan.</div>`;
    }

    html += `
        <div style="display:flex;gap:10px;">
            <button id="uge-rescan" style="flex:1;background:#0f3460;color:#fff;border:none;padding:10px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;border:1px solid rgba(0,255,204,0.3);">🔄 Rescan Page</button>
            <button id="uge-close" style="flex:1;background:rgba(255,255,255,0.08);color:#aaa;border:none;padding:10px;border-radius:8px;font-size:13px;cursor:pointer;">Close</button>
        </div>
    `;

    container.innerHTML = html;
    document.body.appendChild(container);

    container.querySelectorAll('.uge-copy').forEach(btn => {
        btn.onclick = function() {
            let u = this.getAttribute('data-url');
            navigator.clipboard.writeText(u).then(() => {
                let orig = this.innerText;
                this.innerText = 'Copied!';
                setTimeout(() => { this.innerText = orig; }, 1500);
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
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.9);z-index:9999999;display:flex;flex-direction:column;';
            overlay.innerHTML = `
                <div style="background:#111;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;">
                    <span style="color:#00ffcc;font-size:12px;font-weight:bold;">🎮 Preview Mode: ${u}</span>
                    <button id="uge-close-preview" style="background:#e94560;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;">Close Preview</button>
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
            fetch('https://raw.githubusercontent.com/AetherIncarnate/game-stealer/main/extractor.js')
                .then(r => r.text()).then(c => eval(c));
        }, 100);
    };

    document.getElementById('uge-close').onclick = function() {
        container.remove();
        window._gameExtractorActive = false;
    };
})();
