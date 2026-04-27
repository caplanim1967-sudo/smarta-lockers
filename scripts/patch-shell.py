"""
Patches smarta-all-v2.html (bundle + root) to add:
 1. Community-banner CSS
 2. Community-banner HTML (between topbar and first frame-wrap)
 3. activateCommunity / clearCommunityContext JS functions
Run once; idempotent (checks for existing patch).
"""
import re, os, sys

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES  = [
    os.path.join(ROOT, 'bundle', 'smarta-all-v2.html'),
    os.path.join(ROOT, 'smarta-all-v2.html'),
]

# ── 1. CSS to inject into existing <style> block ──────────────────────────────
BANNER_CSS = (
    '.comm-banner{display:none;background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(139,92,246,0.12));'
    'border-bottom:2px solid rgba(139,92,246,0.35);padding:7px 16px;align-items:center;gap:12px;'
    'font-size:13px;color:#e8ecff;flex-wrap:wrap;}'
    '.comm-banner-name{font-weight:700;color:#a78bfa;}'
    '.comm-banner-btn{background:rgba(139,92,246,0.18);border:1px solid rgba(139,92,246,0.4);'
    'color:#e8ecff;font-size:12px;border-radius:6px;padding:4px 12px;cursor:pointer;'
    'font-family:Arial,sans-serif;margin-right:auto;}'
    '.comm-banner-btn:hover{background:rgba(239,68,68,0.25);border-color:rgba(239,68,68,0.5);}'
)

# ── 2. Banner HTML (inserted between </div> topbar and first frame-wrap) ──────
BANNER_HTML = (
    '<div class="comm-banner" id="comm-banner">'
    '<span>📌 ישוב פעיל:&nbsp;</span>'
    '<strong class="comm-banner-name" id="comm-banner-name"></strong>'
    '<button class="comm-banner-btn" onclick="clearCommunityContext()">✕ חזור לניהול Smarta</button>'
    '</div>'
)

# ── 3. JS functions (appended after showTab definition) ───────────────────────
SHELL_JS = (
    'var _adminSavedTokens={};'
    'function activateCommunity(id,name,token){'
      'var userJson=JSON.stringify({name:"מנהל סמרטה — "+name,role:"community_manager",'
        'community_id:id,community_name:name,impersonated_by:"smarta_admin"});'
      '["app","manager","courier","finance"].forEach(function(k){'
        '_adminSavedTokens[k+"_token"]=sessionStorage.getItem(k+"_token");'
        '_adminSavedTokens[k+"_user"]=sessionStorage.getItem(k+"_user");'
        'sessionStorage.setItem(k+"_token",token);'
        'sessionStorage.setItem(k+"_user",userJson);'
        'loaded[k]=false;'
      '});'
      'var b=document.getElementById("comm-banner");'
      'var n=document.getElementById("comm-banner-name");'
      'if(b)b.style.display="flex";'
      'if(n)n.textContent=name;'
    '}'
    'function clearCommunityContext(){'
      '["app","manager","courier","finance"].forEach(function(k){'
        'var t=_adminSavedTokens[k+"_token"];'
        'var u=_adminSavedTokens[k+"_user"];'
        'if(t)sessionStorage.setItem(k+"_token",t);'
        'if(u)sessionStorage.setItem(k+"_user",u);'
        'loaded[k]=false;'
      '});'
      'var b=document.getElementById("comm-banner");'
      'if(b)b.style.display="none";'
      'showTab("admin");'
    '}'
)

PATCH_MARKER = 'activateCommunity'

for fpath in FILES:
    label = os.path.basename(os.path.dirname(fpath)) + '/' + os.path.basename(fpath)
    with open(fpath, 'r', encoding='utf-8') as f:
        html = f.read()

    if PATCH_MARKER in html:
        print(f'  {label}: already patched — skip')
        continue

    changed = False

    # 1. Inject CSS before </style>
    if BANNER_CSS[:30] not in html:
        html = html.replace('</style>', BANNER_CSS + '</style>', 1)
        changed = True

    # 2. Insert banner HTML between </div> (topbar close) and first <div class="frame-wrap"
    target = '</div><div class="frame-wrap"'
    if BANNER_HTML[:20] not in html:
        html = html.replace(target, '</div>' + BANNER_HTML + '<div class="frame-wrap"', 1)
        changed = True

    # 3. Append JS functions after showTab definition (after the closing brace of showTab)
    # showTab ends with: iframe.src=URL.createObjectURL(blob)}}
    # We find the end of the showTab function and append there
    show_tab_end = "iframe.src=URL.createObjectURL(blob)}}"
    if show_tab_end in html and SHELL_JS[:20] not in html:
        html = html.replace(show_tab_end, show_tab_end + SHELL_JS, 1)
        changed = True

    if changed:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'  {label}: patched OK')
    else:
        print(f'  {label}: nothing changed')

print('Done.')
