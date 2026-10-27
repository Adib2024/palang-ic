import sys
sys.path.insert(0, sys.argv[2])  # usage: home.py OUT.html GEN_DIR
from tools import TOOLS
from parts import head, header, footer, ICONS, SHIELD
root = ''
def tool(href, tone, icon, tkey, dkey, soon=False):
    tag = 'div' if soon else 'a'
    attrs = f'class="tool tone-{tone} soon" aria-disabled="true"' if soon else f'class="tool tone-{tone}" href="{href}"'
    extra = '<em class="badge" data-i18n="soon">Akan datang</em>' if soon else '<span class="go"><span data-i18n="openTool">Buka alat</span> →</span>'
    return f'''        <{tag} {attrs}>
          <span class="tool-icon" aria-hidden="true">{ICONS[icon]}</span>
          <span class="tool-body">
            <strong data-i18n="{tkey}"></strong>
            <span data-i18n="{dkey}"></span>
          </span>
          {extra}
        </{tag}>'''

# Highlighted on the dashboard: a "Popular" badge; the first is a wide hero card.
POPULAR = ['palang/', 'gabung-pdf/', 'tandatangan-pdf/']
HERO = 'palang/'

def tool2(href, cat, tone, icon, tkey, dkey):
    cls = f'tool tone-{tone}' + (' popular' if href in POPULAR else '') + (' hero-tool' if href == HERO else '')
    badge = '\n            <em class="pop-badge" data-i18n="popular">Popular</em>' if href in POPULAR else ''
    cta = '\n            <span class="go"><span data-i18n="heroStart">Mula sekarang</span> →</span>' if href == HERO else ''
    return f'''          <a class="{cls}" href="{href}" data-cat="{cat}">{badge}
            <span class="tool-icon solid" aria-hidden="true">{ICONS[icon]}</span>
            <span class="tool-body">
              <strong data-i18n="{tkey}"></strong>
              <span data-i18n="{dkey}"></span>
            </span>{cta}
          </a>
'''

html = head(root, 'DokuJaga — Alat dokumen yang jaga privasi',
  'Alat dokumen percuma yang jaga privasi: palang IC, gambar ke PDF dan lain-lain. Semua diproses dalam peranti anda — tiada apa-apa dimuat naik.',
  'home.js') + f'''
<body>
{header(root, 'tools')}

  <section class="hero">
    <div class="container">
      <h1><span data-i18n="heroTitleA">Semua alat dokumen anda.</span> <span class="grad" data-i18n="heroTitleB">Tanpa muat naik.</span></h1>
      <p class="lead" data-i18n="heroLead"></p>
      <div class="pills">
        <span class="pill">{SHIELD}<span data-i18n="pillLocal">100% dalam peranti</span></span>
        <span class="pill">{SHIELD}<span data-i18n="pillFree">Percuma, tanpa daftar</span></span>
        <span class="pill">{SHIELD}<span data-i18n="pillOffline">Boleh guna luar talian</span></span>
      </div>
    </div>
  </section>

  <main class="page">
    <div class="container stack">
      <section id="tools" aria-labelledby="toolsTitle">
        <h2 id="toolsTitle" class="section-title" data-i18n="toolsHeading">Pilih alat</h2>
        <p class="section-sub" data-i18n="toolsSub"></p>
        <div class="tool-search" role="search">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input type="search" id="toolSearch" autocomplete="off" enterkeyhint="search"
                 data-i18n-attr="placeholder:searchTools,aria-label:searchToolsLabel" placeholder="Cari alat…" aria-label="Cari alat">
          <kbd aria-hidden="true">/</kbd>
        </div>
        <div class="recent" id="recent" hidden></div>
        <div class="cat-chips" role="toolbar" aria-label="Kategori">
          <button type="button" class="chip" data-cat="all" aria-pressed="true" data-i18n="catAll">Semua</button>
          <button type="button" class="chip" data-cat="organize" aria-pressed="false" data-i18n="catOrganize">Susun</button>
          <button type="button" class="chip" data-cat="optimize" aria-pressed="false" data-i18n="catOptimize">Optimum</button>
          <button type="button" class="chip" data-cat="convert" aria-pressed="false" data-i18n="catConvert">Tukar</button>
          <button type="button" class="chip" data-cat="edit" aria-pressed="false" data-i18n="catEdit">Edit</button>
          <button type="button" class="chip" data-cat="security" aria-pressed="false" data-i18n="catSecurity">Keselamatan</button>
        </div>
        <p class="no-tools" id="noTools" role="status" hidden></p>
        <div class="tool-grid">
{''.join(tool2(*t) for t in TOOLS)}        </div>
      </section>

      <section id="privacy" class="card why" aria-labelledby="privacyTitle">
        <h2 id="privacyTitle" class="section-title" data-i18n="privacyHeading">Privasi bukan sekadar janji</h2>
        <p class="section-sub" data-i18n="privacySub"></p>
        <ul class="features">
          <li class="feature tone-emerald"><span class="tool-icon" aria-hidden="true">{ICONS['lock']}</span><strong data-i18n="why1Title"></strong><span data-i18n="why1"></span></li>
          <li class="feature tone-indigo"><span class="tool-icon" aria-hidden="true">{ICONS['gift']}</span><strong data-i18n="why2Title"></strong><span data-i18n="why2"></span></li>
          <li class="feature tone-sky"><span class="tool-icon" aria-hidden="true">{ICONS['plane']}</span><strong data-i18n="why3Title"></strong><span data-i18n="why3"></span></li>
        </ul>
        <p class="pv-more"><a href="privasi/" data-i18n="pvMore">Baca dasar privasi penuh →</a></p>
        <details class="verify">
          <summary data-i18n="verifyTitle">Cara semak sendiri</summary>
          <ul>
            <li data-i18n="how1"></li>
            <li data-i18n="how2"></li>
            <li data-i18n="how3"></li>
            <li data-i18n="how4"></li>
          </ul>
        </details>
      </section>
    </div>
  </main>

{footer(root)}
</body>
</html>
'''
open(sys.argv[1], 'w').write(html)
