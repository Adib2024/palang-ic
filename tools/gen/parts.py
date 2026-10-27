"""Shared header/footer/head snippets for the static pages (one-off generator)."""
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; "
       "connect-src 'none'; font-src 'self'; manifest-src 'self'; worker-src 'self'; "
       "object-src 'none'; base-uri 'none'; form-action 'none'")

def head(root, title, desc, script):
    return f'''<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <!-- Privacy guarantee enforced by the browser: this page cannot open any
       network connection, and loads code, styles, fonts and images only
       from this site. -->
  <meta http-equiv="Content-Security-Policy"
        content="{CSP}">
  <meta name="referrer" content="no-referrer">
  <title>{title}</title>
  <meta name="description" content="{desc}">
  <meta name="theme-color" content="#ffffff">
  <link rel="manifest" href="{root}manifest.webmanifest">
  <link rel="icon" href="{root}icons/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="{root}icons/icon-192.png">
  <link rel="preload" href="{root}fonts/inter-regular.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="{root}css/style.css">
  <script src="{root}js/theme.js"></script>
  <script type="module" src="{root}js/{script}"></script>
</head>'''

def header(root, current=''):
    tools_cur = ' aria-current="page"' if current == 'tools' else ''
    return f'''  <header class="site-header">
    <div class="container nav">
      <a class="logo" href="{root}"><img src="{root}icons/icon.svg" alt="" width="30" height="30"><span>DokuJaga</span></a>
      <nav class="nav-links" aria-label="Utama">
        <a href="{root}#tools"{tools_cur} data-i18n="navTools">Alat</a>
        <a href="{root}#privacy" data-i18n="navPrivacy">Privasi</a>
      </nav>
      <div class="top-actions">
        <button type="button" class="theme-toggle" id="themeToggle" aria-pressed="false"
                data-i18n-attr="aria-label:themeToggle,title:themeToggle" aria-label="Tukar tema cerah/gelap">&#9790;</button>
        <div class="lang" role="group" aria-label="Bahasa / Language">
          <button type="button" data-lang="ms" aria-pressed="true">BM</button>
          <button type="button" data-lang="en" aria-pressed="false">EN</button>
        </div>
      </div>
    </div>
  </header>'''

def footer(root):
    return f'''  <footer class="site-footer">
    <div class="container footer-inner">
      <div>
        <a class="logo" href="{root}"><img src="{root}icons/icon.svg" alt="" width="24" height="24"><span>DokuJaga</span></a>
        <p data-i18n="footerTag">Alat dokumen yang jaga privasi anda.</p>
      </div>
      <p data-i18n="footer">Bukan laman rasmi kerajaan. Sumber terbuka (MIT).</p>
    </div>
  </footer>'''

SHIELD = '<svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 14-4-4 1.4-1.4L11 13.2l4.6-4.6L17 10l-6 6Z"/></svg>'

ICONS = {
 'palang': '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 13.5 11 7M6.5 16.5 14 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16.5" cy="13" r="1.6" fill="currentColor"/></svg>',
 'img2pdf': '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m4.5 11.5 3-3.2 2.2 2.2 1.3-1.2 1.5 1.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 8h2.5L21 11.5V20a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 17.5h5m-1.7-1.7 1.7 1.7-1.7 1.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 'palangpdf': '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m7.5 15.5 6-6m-3.5 8.5 6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
 'organize': '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="3" width="7.5" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="8.25" y="14.5" width="7.5" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6.75 12v1.25h10.5V12M12 13.25v1.25" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
 'compress': '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 7.5v4m-2-2 2 2 2-2M12 18v-4m-2 2 2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 'lock': '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
 'gift': '<svg viewBox="0 0 24 24"><path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9ZM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3.8C6 4.5 7.5 7 12 7Zm0 0s1.5-4 4-3.2C18 4.5 16.5 7 12 7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
 'plane': '<svg viewBox="0 0 24 24"><path d="M10.5 21 12 17.5l1.5 3.5M12 3c.8 0 1.5.7 1.5 1.5V9l7 4.5v2L13.5 13v4.5h-3V13l-7 2.5v-2l7-4.5V4.5C10.5 3.7 11.2 3 12 3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
 'upload': '<svg aria-hidden="true" viewBox="0 0 24 24" width="44" height="44"><path d="M12 15.5V4m-4.5 4.5L12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

ICONS.update({
 'pdfimg': '<svg viewBox="0 0 24 24"><path d="M5 3h6l3 3v5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 11.5V6.8M5 3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><rect x="11" y="12" width="10" height="9" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m12.5 19.5 2.5-3 1.8 1.8 1.2-1.1 1.5 2.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
 'imgsmall': '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14 4v6h6M10 20v-6H4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m14 10 5.5-5.5M10 14l-5.5 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
 'sign': '<svg viewBox="0 0 24 24"><path d="M3 17.5c2.5-.5 3.5-6 5.5-6 1.6 0 .4 5 2 5 1.3 0 2-2.6 3.2-2.6.9 0 .9 1.6 2.1 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 21h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m15.5 4.5 4 4L12 16l-4.5.5L8 12Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
 'scan': '<svg viewBox="0 0 24 24"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.5 7h9v10h-9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 12h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
})

def hero(tone, icon, tkey, title, lkey):
    return f'''  <section class="hero tool-hero tone-{tone}">
    <div class="container">
      <p class="crumbs"><a href="../" data-i18n="allTools">Semua alat</a> /</p>
      <span class="tool-icon" aria-hidden="true">{ICONS[icon]}</span>
      <h1 data-i18n="{tkey}">{title}</h1>
      <p class="lead" data-i18n="{lkey}"></p>
    </div>
  </section>'''

PRIVACY = f'''      <section class="privacy">
        {SHIELD}
        <strong data-i18n="privacyFiles">Fail anda diproses dalam peranti anda sahaja. Tiada apa-apa dimuat naik.</strong>
      </section>'''

def dropzone(accept, multiple, drop_key, choose_key, camera=False):
    m = ' multiple' if multiple else ''
    cam = '''
              <label class="btn lg camera-only">
                <input type="file" id="pickCamera" accept="image/*" capture="environment">
                <span data-i18n="i2pCamera">Ambil gambar</span>
              </label>''' if camera else ''
    return f'''          <div class="dropzone" id="dropzone">
            {ICONS['upload']}
            <p><strong data-i18n="{drop_key}"></strong></p>
            <p class="drop-or" data-i18n="i2pOr">atau</p>
            <div class="drop-buttons">
              <label class="btn primary lg">
                <input type="file" id="pickFiles" accept="{accept}"{m}>
                <span data-i18n="{choose_key}"></span>
              </label>{cam}
            </div>
          </div>'''

def page(root, title, desc, script, tone, icon, tkey, lkey, body):
    return head(root, title, desc, script) + f'''
<body>
{header(root)}

{hero(tone, icon, tkey, title.split(' · ')[0], lkey)}

  <main class="page">
    <div class="container stack">
{PRIVACY}

{body}
    </div>
  </main>

{footer(root)}
</body>
</html>
'''

ICONS.update({
 'merge': '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13" y="3" width="8" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 13v2.5a2 2 0 0 0 2 2h1.5M17 13v2.5a2 2 0 0 1-2 2h-1.5M12 17.5V21m-2-2 2 2 2-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 'split': '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 10.5V13M12 13l-5 3.5M12 13l5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="2.5" y="15.5" width="8" height="6" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="15.5" width="8" height="6" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
 'rotate': '<svg viewBox="0 0 24 24"><path d="M7 5h7l4 4v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 9a8 8 0 0 1 4.5-5.5M3 9V5m0 4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m9.5 15 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
 'watermark': '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9.5c1.8 2.2 2.8 3.6 2.8 4.9a2.8 2.8 0 0 1-5.6 0c0-1.3 1-2.7 2.8-4.9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
 'pagenum': '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 8h6M8 11h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10.5 15.5 12 14.5V19m-1.5 0h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 'crop': '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
})

ICONS.update({
 'edit': '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 8h5M8 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m18.5 12.5 2 2-6.5 6.5H12v-2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
 'redact': '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><rect x="7.5" y="9" width="9" height="3" rx=".6" fill="currentColor"/><rect x="7.5" y="14" width="6" height="3" rx=".6" fill="currentColor"/></svg>',
 'form': '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6" y="8" width="12" height="3" rx=".8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 15.5 8 17l2.5-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 15.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
})

ICONS.update({
 'unlock': '<svg viewBox="0 0 24 24"><rect x="4" y="10.5" width="16" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 10.5V7a4 4 0 0 1 7.6-1.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor"/></svg>',
 'protect': '<svg viewBox="0 0 24 24"><path d="M12 2.5 4.5 5.5v6c0 4.7 3.2 8.6 7.5 9.9 4.3-1.3 7.5-5.2 7.5-9.9v-6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><rect x="9" y="11" width="6" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.2 11V9.6a1.8 1.8 0 0 1 3.6 0V11" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
})


def sign_panel():
    """Signature maker + date + text + 'all pages' controls (js: sig-maker.js, placer.js)."""
    return '''          <fieldset class="segmented small">
            <legend class="sr-title" data-i18n="sigYours">Tandatangan anda</legend>
            <label><input type="radio" name="sigTab" value="draw" checked><span data-i18n="sigDraw">Lukis</span></label>
            <label><input type="radio" name="sigTab" value="type"><span data-i18n="sigType">Taip</span></label>
            <label><input type="radio" name="sigTab" value="image"><span data-i18n="sigImage">Gambar</span></label>
          </fieldset>

          <div data-tab="draw">
            <canvas class="sig-pad" id="pad" width="900" height="360"></canvas>
            <div class="pad-tools">
              <fieldset class="ink">
                <legend class="sr-title" data-i18n="sigPen">Warna dakwat</legend>
                <label class="ink-black"><input type="radio" name="ink" value="#111111" checked><span data-i18n-attr="aria-label:black,title:black" aria-label="Hitam"></span></label>
                <label class="ink-blue"><input type="radio" name="ink" value="#1d3a8a"><span data-i18n-attr="aria-label:blue,title:blue" aria-label="Biru"></span></label>
              </fieldset>
              <button type="button" class="link" id="padClear" data-i18n="sigClear">Kosongkan</button>
            </div>
          </div>

          <div data-tab="type" hidden>
            <label class="field">
              <span class="sr-title" data-i18n="sigNamePh">Nama</span>
              <input type="text" id="typedName" maxlength="60" autocomplete="name" data-i18n-attr="placeholder:sigNamePh" placeholder="Nama penuh anda">
            </label>
            <label class="field">
              <span data-i18n="sigStyle">Gaya</span>
              <select id="sigFont"></select>
            </label>
            <canvas class="sig-pad preview" id="typedPreview" width="900" height="300"></canvas>
          </div>

          <div data-tab="image" hidden>
            <label class="btn">
              <input type="file" id="sigFile" accept="image/*">
              <span data-i18n="sigUpload">Pilih gambar tandatangan</span>
            </label>
            <label class="check">
              <input type="checkbox" id="removeBg" checked>
              <span data-i18n="sigRemoveBg">Buang latar putih</span>
            </label>
            <canvas class="sig-pad preview" id="imagePreview" width="900" height="360"></canvas>
          </div>

          <div class="buttons stack">
            <button type="button" class="primary" id="addSig" data-i18n="sigAdd">Letak tandatangan</button>
          </div>

          <div class="sign-text">
            <label class="field">
              <span data-i18n="fontTextLabel">Font teks &amp; tarikh</span>
              <select id="textFont"></select>
            </label>
            <div class="field-row">
              <label class="field">
                <span data-i18n="sigDate">Tarikh</span>
                <input type="date" id="dateValue">
              </label>
              <button type="button" class="btn" id="addDate" data-i18n="wfPlaceDate">Letak tarikh</button>
            </div>
            <div class="field-row">
              <label class="field">
                <span data-i18n="wfTextLabel">Teks</span>
                <input type="text" id="extraText" maxlength="80" autocomplete="off" data-i18n-attr="placeholder:sigTextPh" placeholder="cth. nama, No. IC, jawatan">
              </label>
              <button type="button" class="btn" id="addText" data-i18n="sigAddText">Letak teks</button>
            </div>
            <label class="check">
              <input type="checkbox" id="allPages">
              <span data-i18n="sigAllPages">Letak pada semua muka surat</span>
            </label>
          </div>
          <p class="hint" data-i18n="sigHint"></p>
'''

ICONS.update({
 'flow': '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="14" y="15" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 9v3.5a2 2 0 0 0 2 2H14m-2.5-2.5L14 14.5 11.5 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 5h2.5M17.5 8h2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
})

ADV_LINK = '<a class="adv-link" href="{root}aliran-kerja/" data-i18n-attr="title:navAdvanced" title="Mod Lanjutan">' + ICONS['flow'] + '<span data-i18n="navAdvanced">Mod Lanjutan</span></a>'
_header_orig = header
def header(root, current=''):
    """Header with the 'Mod Lanjutan' (workflows) button."""
    h = _header_orig(root, current)
    link = ADV_LINK.replace('{root}', root)
    if current == 'workflow':
        link = link.replace('class="adv-link"', 'class="adv-link" aria-current="page"')
    return h.replace('      <div class="top-actions">\n', '      <div class="top-actions">\n        ' + link + '\n', 1)

ICONS.update({
 'compare': '<svg viewBox="0 0 24 24"><rect x="2.5" y="3" width="8" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="6" width="8" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 7.5h3.5M5 10.5h3.5M16 10.5h3.5M16 13.5h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 13.5h3.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".55"/><path d="M16 16.5h3.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".55"/></svg>',
 'ocr': '<svg viewBox="0 0 24 24"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.5 15.5 10 8.5l2.5 7M8.4 13h3.2M14.5 8.5v7h1.8a1.8 1.8 0 0 0 0-3.6H14.5h1.5a1.7 1.7 0 0 0 0-3.4h-1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
})

def _doc_icon(letter_path):
    return ('<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'
            '<path d="M14 3v4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' + letter_path + '</svg>')
ICONS.update({
 'word': _doc_icon('<path d="M8 11l1.3 6 1.7-4.5 1.7 4.5 1.3-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
 'excel': _doc_icon('<path d="M8.5 11l5 6m0-6-5 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
 'ppt': _doc_icon('<path d="M9.5 17.5V11h2.3a2 2 0 0 1 0 4H9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
})

ICONS.update({
 'meta': '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 8h4M8 11h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m14.5 15.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
})

ICONS.update({
 'passport': '<svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 18.5c.8-2.6 2.5-3.8 4.5-3.8s3.7 1.2 4.5 3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
})

ICONS.update({
 'flatten': '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 11h8M8 14.5h8M8 18h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 6.5h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
})
