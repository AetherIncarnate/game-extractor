(function(){
    // Remove existing modal if already running
    if(window._gameExtractorActive) {
        let old = document.getElementById('ultimate-game-extractor');
        if(old) old.remove();
    }
    window._gameExtractorActive = true;

    let foundItems = [];

    // Helper to resolve relative paths into absolute URLs
    function resolveUrl(url) {
        if (!url || url === 'about:blank' || url.startsWith('javascript:')) return null;
        try {
            return new URL(url, document.baseURI).href;
        } catch(e) {
            return url;
        }
    }

    // Helper to evaluate, score, and push candidate URLs
    function analyzeAndAdd(rawSrc, type) {
        let src = resolveUrl(rawSrc);
        if (!src) return;
        let lower = src.toLowerCase();
        
        // Comprehensive filter for tracking, ads, and platform wrappers
        const blockedKeywords = [
            'ads', 'analytics', 'telemetry', 'consent', 'login', 'auth', 
            'pixel', 'googletagmanager', 'google.com/maps', 'docs.google.com'
        ];
        if (blockedKeywords.some(keyword => lower.includes(keyword))) return;
        
        // Avoid duplicate entries
        if (!foundItems.some(item => item.url === src)) {
            let score = 0;
            
            // Heuristic scoring based on game indicators
            if (lower.includes('game') || lower.includes('play') || lower.includes('index') || lower.includes('embed') || lower.endsWith('.html')) score += 15;
            if (lower.includes('blob:') || lower.includes('cdn') || lower.includes('github.io') || lower.includes('vercel.app') || lower.includes('pages.dev')) score += 8;
            if (lower.includes('v3') || lower.includes('msnfun') || lower.includes('crazygames')) score += 10;
            
            if (type === 'iframe') score += 5;
            if (type === 'data-attr') score += 4;
            if (type === 'link') score += 2;
            
            foundItems.push({ url: src, type: type, score: score });
        }
    }

    // Deep recursive scanner supporting Shadow DOM and all nested nodes
    function deepScan(root) {
        if (!root) return;
        try {
            // 1. Standard frame elements
            root.querySelectorAll('iframe').forEach(f => {
                analyzeAndAdd(f.src || f.getAttribute('data-src') || f.getAttribute('data-url'), 'iframe');
            });

            // 2. Embed and object elements
            root.querySelectorAll('embed, object').forEach(e => {
                analyzeAndAdd(e.src || e.data, 'media');
            });

            // 3. Custom data attributes used by unblocked game sites & Google Sites
            const attributes = ['data-src', 'data-url', 'data-game', 'data-href', 'data-link', 'data-embed', 'data-iframe'];
            attributes.forEach(attr => {
                root.querySelectorAll(`[${attr}]`).forEach(el => {
                    analyzeAndAdd(el.getAttribute(attr), 'data-attr');
                });
            });

            // 4. Anchor links pointing to game subfolders or assets
            root.querySelectorAll('a[href]').forEach(a => {
                let href = a.getAttribute('href');
                if (href && (href.includes('game') || href.includes('play') || href.endsWith('.html') || href.includes('github.io') || href.includes('vercel.app'))) {
                    analyzeAndAdd(href, 'link');
                }
            });

            // 5. Recursively traverse through open Shadow DOMs
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) {
                    deepScan(el.shadowRoot);
                }
            });
        } catch(e) {
            console.error('Scan error:', e);
        }
    }

    // Execute scan and sort by top score
    deepScan(document);
    foundItems.sort((a, b) => b.score - a.score);

    // Build interactive Glassmorphism Dashboard UI
    let container = document.createElement('div');
    container.id = 'ultimate-game-extractor';
    container.style.cssText = 'position:fixed;top:15px;left:50%;transform:translateX(-50%);width:92%;max-width:540px;background:linear-gradient(135deg, #12121f, #1b1b2f);color:#fff;padding:22px;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,0.85);z-index:999999;font-family:-apple-system,system-ui,sans-serif;box-sizing:border-box;border:1px solid rgba(255,255,255,0.18);';

    let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h3 style="margin:0;font-size:18px;color:#00ffcc;display:flex;align-items:center;gap:8px;">🚀 Ultimate Game Extractor</h3>
            <span style="font-size:11px;background:#0f3460;padding:5px 10px;border-radius:10px;color:#00ffcc;border:1px solid rgba(0,255,204,0.25);">Found: ${foundItems.length}</span>
        </div>
    `;

    if (foundItems.length > 0) {
        html += `<p style="margin:0 0 12px 0;font-size:12px;color:#a0aab2;">Smart-ranked by match likelihood. Best option is pinned at the top:</p>`;
        html += `<div style="max-height:260px;overflow-y:auto;margin-bottom:16px;padding-right:4px;">`;
        
        foundItems.forEach((item, i) => {
            let badge = i === 0 ? '<span style="background:#e94560;color:#fff;font-size:9px;padding:2px 6px;border-radius:4px;margin-right:6px;font-weight:bold;">BEST MATCH</span>' : '';
            html += `
                <div style="background:rgba(255,255,255,0.04);padding:10px;border-radius:10px;margin-bottom:8px;border:1px solid rgba(255,255,255,0.07);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:11px;color:#00ffcc;font-weight:600;">${badge}#${i+1} <span style="color:#888;font-weight:normal;">(${item.type})</span></div>
                        <div style="display:flex;gap:6px;">
                            <button class="uge-copy" data-url="${item.url}" style="background:#0f3460;color:#00ffcc;border:none;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">Copy</button>
                            <button class="uge-open" data-url="${item.url}" style="background:#00ffcc;color:#000;border:none;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;">Open</button>
                        </div>
                    </div>
                    <div style="font-size:10px;color:#ccc;word-break:break-all;opacity:0.8;line-height:1.3;">${item.url}</div>
                </div>
            `;
        });
        html += `</div>`;
    } else {
        html += `<div style="background:rgba(255,87,87,0.1);border:1px solid rgba(255,87,87,0.2);padding:14px;border-radius:10px;margin-bottom:15px;font-size:12px;color:#ff8888;">No games found. Make sure the game canvas or frame is fully loaded on the screen, then try scanning again.</div>`;
    }

    html += `
        <div style="display:flex;gap:10px;">
            <button id="uge-rescan" style="flex:1;background:#0f3460;color:#fff;border:none;padding:10px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;border:1px solid rgba(0,255,204,0.3);">🔄 Rescan Page</button>
            <button id="uge-close" style="flex:1;background:rgba(255,255,255,0.08);color:#aaa;border:none;padding:10px;border-radius:8px;font-size:13px;cursor:pointer;">Close</button>
        </div>
    `;

    container.innerHTML = html;
    document.body.appendChild(container);

    // Event handling for UI buttons
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

    document.getElementById('uge-rescan').onclick = function() {
        container.remove();
        window._gameExtractorActive = false;
        // Re-trigger execution
        setTimeout(() => {
            let script = document.createElement('script');
            script.src = document.currentScript ? document.currentScript.src : '';
            location.reload();
        }, 100);
    };

    document.getElementById('uge-close').onclick = function() {
        container.remove();
        window._gameExtractorActive = false;
    };
})();
