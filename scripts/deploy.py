"""
deploy.py — re-encode page, sync root shell, and push to GitHub Pages

Usage:
  python scripts/deploy.py admin "תיאור השינוי"
  python scripts/deploy.py app   "תיאור השינוי"

Run from: C:\\Users\\bitah\\smarta-lockers\\
"""
import sys, os, subprocess, shutil
# Force UTF-8 on Windows console to avoid cp1255 UnicodeEncodeError
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
BUNDLE  = os.path.join(ROOT, 'bundle', 'smarta-all-v2.html')
ROOT_SHELL = os.path.join(ROOT, 'smarta-all-v2.html')

def run(cmd, cwd=None):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd or ROOT,
                       encoding='utf-8', errors='replace')
    if r.stdout: print(r.stdout.strip())
    if r.stderr: print(r.stderr.strip())
    return r.returncode

if len(sys.argv) < 3:
    print(__doc__)
    sys.exit(1)

page = sys.argv[1]   # admin / app / manager / courier / finance
msg  = sys.argv[2]   # commit message

reencode_script = os.path.join(SCRIPTS, f'reencode-{page}.py')
if not os.path.exists(reencode_script):
    print(f'ERROR: no reencode script for page "{page}"')
    sys.exit(1)

# ── 1. Re-encode the page into bundle ────────────────────────────────────────
print(f'\n[1] Re-encoding {page}...')
run(f'python "{reencode_script}"')

# ── 2. Sync ALL pages from bundle → root smarta-all-v2.html ──────────────────
print(f'\n[2] Syncing root shell from bundle...')
sync_script = os.path.join(SCRIPTS, 'sync-root-bundle.py')
run(f'python "{sync_script}"')

# ── 3. Git commit & push ──────────────────────────────────────────────────────
print(f'\n[3] Git commit & push...')
run(f'git add bundle/smarta-all-v2.html smarta-all-v2.html')
run(f'git commit -m "{page}: {msg}"')
run(f'git push origin main')

print(f'\nDone! https://caplanim1967-sudo.github.io/smarta-lockers/smarta-all-v2.html')
