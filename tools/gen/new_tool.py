"""Write the page for a new tool from the shared parts (header, hero, privacy
note, dropzone, footer, strict CSP). Edit the page by hand afterwards.

Usage (from the repo root):
  python3 -I tools/gen/new_tool.py spec.json
spec.json:
  {"slug": "buang-metadata", "title": "Buang Metadata PDF · DokuJaga",
   "desc": "<meta description>", "script": "metadata.js",
   "tone": "indigo", "icon": "protect", "tkey": "toolMetaTitle", "lkey": "metaLead",
   "accept": "application/pdf,.pdf", "multiple": true, "camera": false,
   "dropKey": "pdfDropBig", "chooseKey": "pdfChoose",
   "layout": "two" | "narrow",
   "options": "<html for the settings panel>",
   "content": "<optional html after the file card, e.g. a preview>",
   "primary": ["savePdf", "pdfSave"], "share": ["sharePdf", "pdfShare"],
   "anotherKey": "cmpAnother"}
"""
import json
import os
import sys

G = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(os.path.dirname(G))
sys.path.insert(0, G)
from parts import page, dropzone  # noqa: E402

spec = json.load(open(sys.argv[1]))
file_label = spec.get('anotherKey', 'cmpAnother')
file_card = f'''          <div class="file-card after-load">
            <div class="file-info">
              <h2 id="docTitle" class="file-name"></h2>
              <p class="file-meta" id="docMeta"></p>
              <button type="button" class="link" id="another" data-i18n="{file_label}"></button>
            </div>
          </div>'''
pid, pkey = spec['primary']
buttons = f'''            <div class="buttons">
              <button type="button" class="primary" id="{pid}" data-i18n="{pkey}"></button>'''
if spec.get('share'):
    sid, skey = spec['share']
    buttons += f'''
              <button type="button" id="{sid}" data-i18n="{skey}"></button>'''
buttons += '''
            </div>
            <p class="status" id="status" role="status" aria-live="polite"></p>'''
drop = dropzone(spec['accept'], spec.get('multiple', False), spec['dropKey'], spec['chooseKey'], spec.get('camera', False))
tone = spec['tone']
if spec.get('layout') == 'narrow':
    body = f'''      <div class="tool-layout narrow tone-{tone} is-empty" id="toolLayout">
        <section class="card" aria-labelledby="docTitle">
{drop}
{file_card}
          <div class="after-load">
{spec.get('options', '')}
{buttons}
          </div>
        </section>
      </div>'''
else:
    body = f'''      <div class="tool-layout tone-{tone} is-empty" id="toolLayout">
        <section class="card" aria-labelledby="docTitle">
{drop}
{file_card}
{spec.get('content', '')}
        </section>
        <aside class="card options" aria-labelledby="optTitle">
          <h2 id="optTitle" data-i18n="i2pOptions">Tetapan</h2>
{spec.get('options', '')}
{buttons}
        </aside>
      </div>'''
os.makedirs(f"{R}/{spec['slug']}", exist_ok=True)
html = page('../', spec['title'], spec['desc'], spec['script'], tone, spec['icon'], spec['tkey'], spec['lkey'], body)
open(f"{R}/{spec['slug']}/index.html", 'w').write(html)
print('wrote', spec['slug'] + '/index.html')
