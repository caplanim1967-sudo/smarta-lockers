"""
Copy the encoded app/admin/manager/etc from bundle/smarta-all-v2.html
to root smarta-all-v2.html AND index.html.
Run after any reencode-*.py script.
"""
import re, os

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, 'bundle', 'smarta-all-v2.html')

with open(BUNDLE, 'r', encoding='utf-8') as f:
    bundle = f.read()

keys = ['app', 'admin', 'manager', 'courier', 'finance', 'test']

# Build map of key → encoded value from bundle
encoded_map = {}
for key in keys:
    m = re.search(r'"' + key + r'"\s*:\s*"([A-Za-z0-9+/=]+)"', bundle)
    if m:
        encoded_map[key] = m.group(1)
    else:
        print(f'  WARNING: {key} not found in bundle')

# Sync to all root files
targets = [
    os.path.join(ROOT, 'smarta-all-v2.html'),
    os.path.join(ROOT, 'index.html'),
]

for target_path in targets:
    if not os.path.exists(target_path):
        print(f'  skip {os.path.basename(target_path)}: not found')
        continue
    with open(target_path, 'r', encoding='utf-8') as f:
        content = f.read()
    updated = 0
    for key, encoded in encoded_map.items():
        pattern = r'("' + key + r'"\s*:\s*")[A-Za-z0-9+/=]+(")'
        new_content, count = re.subn(pattern, r'\g<1>' + encoded + r'\2', content)
        if count > 0:
            content = new_content
            updated += 1
            print(f'  {os.path.basename(target_path)} ← {key}: {len(encoded):,} chars')
    with open(target_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'  {os.path.basename(target_path)}: {updated} keys synced')

print('Done.')
