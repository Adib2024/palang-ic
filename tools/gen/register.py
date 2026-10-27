"""Register new tools: dashboard card (tools.py → index.html), share page
(kongsi/), service-worker cache list and the deploy copy list.

Usage (from the repo root):
  python3 -I tools/gen/register.py '[["slug/", "cat", "tone", "icon", "toolXTitle", "toolXDesc", "afterSlug/"]]' '["x.js"]'
cat: organize | optimize | convert | edit | security
tone: indigo | amber | rose | emerald | sky | violet | teal | orange
icon: a key of ICONS in parts.py
"""
import json
import os
import re
import subprocess
import sys

G = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(os.path.dirname(G))
new = json.loads(sys.argv[1])
js = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
sys.path.insert(0, G)
from tools import TOOLS  # noqa: E402

TOOLS = [tuple(t) for t in TOOLS]
for href, cat, tone, icon, tkey, dkey, after in new:
    if any(t[0] == href for t in TOOLS):
        continue
    i = next((k for k, t in enumerate(TOOLS) if t[0] == after), len(TOOLS) - 1) + 1
    TOOLS.insert(i, (href, cat, tone, icon, tkey, dkey))
open(G + '/tools.py', 'w').write('TOOLS = ' + repr(TOOLS) + '\n')
subprocess.run(['python3', '-I', G + '/home.py', R + '/index.html', G], check=True)
subprocess.run(['python3', '-I', G + '/share.py', G, R], check=True)

# Service worker: new cache version, pages and scripts.
p = R + '/sw.js'
s = open(p).read()
v = int(re.search(r"dokujaga-v(\d+)", s).group(1))
s = s.replace(f"dokujaga-v{v}", f"dokujaga-v{v + 1}")
for href, *_ in new:
    d = href.rstrip('/')
    if f"'{d}/'" not in s:
        s = s.replace("const ASSETS = [\n", f"const ASSETS = [\n  '{d}/',\n  '{d}/index.html',\n", 1)
for f in js:
    if f"'js/{f}'" not in s:
        s = s.replace("  'js/i18n.js',\n", f"  'js/i18n.js',\n  'js/{f}',\n", 1)
open(p, 'w').write(s)

# Deploy: copy the new folders into the site.
p = R + '/.github/workflows/deploy.yml'
s = open(p).read()
for href, *_ in new:
    d = href.rstrip('/')
    if f" {d} " not in s and f" {d} _site" not in s:
        s = s.replace(" _site/\n", f" {d} _site/\n", 1)
open(p, 'w').write(s)
print('registered', [n[0] for n in new], '- remember js/tool-catalog.js and i18n strings')
