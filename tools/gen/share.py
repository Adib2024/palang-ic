import sys, os
sys.path.insert(0, sys.argv[1])
from parts import page, ICONS
from tools import TOOLS
R = sys.argv[2]
cards = ''.join(f'''          <a class="tool tone-{tone}" data-href="{href}" hidden>
            <span class="tool-icon solid" aria-hidden="true">{ICONS[icon]}</span>
            <span class="tool-body">
              <strong data-i18n="{tkey}"></strong>
              <span data-i18n="{dkey}"></span>
            </span>
          </a>
''' for href, cat, tone, icon, tkey, dkey in TOOLS)
cards += f'''          <a class="tool tone-indigo" data-href="aliran-kerja/" hidden>
            <span class="tool-icon solid" aria-hidden="true">{ICONS['flow']}</span>
            <span class="tool-body">
              <strong data-i18n="wfTitle"></strong>
              <span data-i18n="shareWfDesc"></span>
            </span>
          </a>
'''
body = f'''      <section class="card share-files" aria-labelledby="filesTitle">
        <h2 id="filesTitle" class="wf-h"><span data-i18n="shareFiles">Fail anda</span><span class="count" id="fileCount">0</span></h2>
        <ul class="wf-files" id="shareList"></ul>
        <div id="shareEmpty" hidden>
          <p data-i18n="shareEmpty"></p>
          <p class="hint" data-i18n="shareHow"></p>
          <a class="btn primary" href="../" data-i18n="allTools">Semua alat</a>
        </div>
        <button type="button" class="link" id="shareClear" data-i18n="shareClear" hidden>Buang fail ini</button>
      </section>

      <section id="sharePick" aria-labelledby="pickTitle" hidden>
        <h2 id="pickTitle" class="section-title" data-i18n="sharePick">Pilih alat</h2>
        <div class="tool-grid">
{cards}        </div>
      </section>'''
html = page('../', 'Pilih alat · DokuJaga', 'Pilih alat DokuJaga untuk fail yang dikongsi. Fail kekal dalam peranti anda.',
            'share.js', 'indigo', 'flow', 'shareTitle', 'shareLead', body)
os.makedirs(f'{R}/kongsi', exist_ok=True)
open(f'{R}/kongsi/index.html', 'w').write(html)
