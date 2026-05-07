import base64, re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, 'bundle', 'smarta-all-v2.html')
INPUT  = os.path.join(ROOT, 'decoded', 'manager.html')

with open(INPUT, 'r', encoding='utf-8') as f:
    decoded = f.read()

encoded = base64.b64encode(decoded.encode('utf-8')).decode('ascii')

with open(BUNDLE, 'r', encoding='utf-8') as f:
    content = f.read()

pattern = r'("manager"\s*:\s*")[A-Za-z0-9+/=]+(")'
new_content, count = re.subn(pattern, r'\g<1>' + encoded + r'\2', content)

if count == 0:
    print('ERROR: manager key not found in bundle')
else:
    with open(BUNDLE, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f'SUCCESS: manager re-encoded ({len(decoded):,} chars -> {len(encoded):,} base64)')
