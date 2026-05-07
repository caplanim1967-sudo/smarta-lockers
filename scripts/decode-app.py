import base64, re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, 'bundle', 'smarta-all-v2.html')
OUTPUT = os.path.join(ROOT, 'decoded', 'app.html')

with open(BUNDLE, 'r', encoding='utf-8') as f:
    content = f.read()

pattern = r'"app"\s*:\s*"([A-Za-z0-9+/=]+)"'
m = re.search(pattern, content)
if m:
    decoded = base64.b64decode(m.group(1)).decode('utf-8')
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(decoded)
    print(f'SUCCESS: decoded/app.html ({len(decoded):,} chars)')
else:
    print('ERROR: app key not found in bundle')
