"""Write privasi/index.html (the privacy page). Usage: python3 -I tools/gen/privacy.py"""
import os
import sys

G = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(os.path.dirname(G))
sys.path.insert(0, G)
from parts import page  # noqa: E402

SECTIONS = [
    ('pvShortTitle', ['pvShort1', 'pvShort2']),
    ('pvHowTitle', ['pvHow1', 'pvHow2', 'pvHow3']),
    ('pvStoreTitle', ['pvStore1']),
    ('pvCheckTitle', ['pvCheck1', 'pvCheck2', 'pvCheck3']),
    ('pvLimitsTitle', ['pvLimits1', 'pvLimits2']),
    ('pvOpenTitle', ['pvOpen1']),
]


def section(title, paras):
    body = '\n'.join(f'          <p data-i18n="{k}"></p>' for k in paras)
    return f'''        <section class="card pv-section">
          <h2 data-i18n="{title}"></h2>
{body}
        </section>'''


stored = '''        <section class="card pv-section" aria-labelledby="pvDataTitle">
          <h2 id="pvDataTitle" data-i18n="pvDataTitle"></h2>
          <p data-i18n="pvData1"></p>
          <ul class="pv-list" id="pvStored"></ul>
          <div class="buttons">
            <button type="button" class="primary" id="pvClear" data-i18n="pvClear"></button>
          </div>
          <p class="status" id="status" role="status" aria-live="polite"></p>
        </section>'''

body = '      <div class="pv-page">\n' + '\n'.join(section(t, p) for t, p in SECTIONS[:3]) + '\n' + stored + '\n' + \
    '\n'.join(section(t, p) for t, p in SECTIONS[3:]) + '\n      </div>'
os.makedirs(f'{R}/privasi', exist_ok=True)
open(f'{R}/privasi/index.html', 'w').write(page(
    '../', 'Privasi · DokuJaga', 'Bagaimana DokuJaga menjaga fail anda: semuanya diproses dalam peranti anda, tiada muat naik, tiada akaun, tiada analitik.',
    'privacy.js', 'emerald', 'protect', 'pvTitle', 'pvLead', body))
print('wrote privasi/index.html')
