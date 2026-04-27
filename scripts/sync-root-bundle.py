"""
Copy the encoded app/admin/manager/etc from bundle/smarta-all-v2.html to root smarta-all-v2.html.
Run after any reencode-*.py script.
"""
import re, os

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, 'bundle', 'smarta-all-v2.html')
ROOT_F = os.path.join(ROOT, 'smarta-all-v2.html')

with open(BUNDLE, 'r', encoding='utf-8') as f:
    bundle = f.read()

with open(ROOT_F, 'r', encoding='utf-8') as f:
    root = f.read()

keys = ['app', 'admin', 'manager', 'courier', 'finance', 'test']
updated = 0
for key in keys:
    m = re.search(r'"' + key + r'"\s*:\s*"([A-Za-z0-9+/=]+)"', bundle)
    if not m:
        print(f'  skip {key}: not found in bundle')
        continue
    encoded = m.group(1)
    pattern = r'("' + key + r'"\s*:\s*")[A-Za-z0-9+/=]+(")'
    new_root, count = re.subn(pattern, r'\g<1>' + encoded + r'\2', root)
    if count == 0:
        print(f'  skip {key}: not found in root')
    else:
        root = new_root
        updated += 1
        print(f'  {key}: synced ({len(encoded):,} chars)')

with open(ROOT_F, 'w', encoding='utf-8') as f:
    f.write(root)
print(f'Done — {updated} keys synced to root smarta-all-v2.html')
