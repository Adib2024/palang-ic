"""Generate FAKE IC-like sample photos for testing. Not a real MyKad.

The front sample is saved sideways with EXIF orientation 6, like a phone
photo, so the test also exercises the orientation fix.
Run: python3 tests/make-samples.py  (needs Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / 'fixtures'
W, H = 1712, 1080


def font(size, bold=False):
    name = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    try:
        return ImageFont.truetype(name, size)
    except OSError:
        return ImageFont.load_default()


def card(side):
    im = Image.new('RGB', (W, H), '#d9d4c7')  # "table" background
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([90, 70, W - 90, H - 70], radius=50, fill='#e8eef7', outline='#9aa7bd', width=4)
    d.text((140, 110), 'SAMPLE CARD - NOT A REAL IC', font=font(46, True), fill='#2b3a55')
    if side == 'front':
        d.rectangle([140, 260, 520, 740], fill='#c7cfdc')
        d.ellipse([235, 310, 425, 500], fill='#8796ad')        # head
        d.rounded_rectangle([200, 520, 460, 740], radius=60, fill='#8796ad')  # shoulders
        d.text((600, 280), '000000-00-0000', font=font(84, True), fill='#111')
        d.text((600, 470), 'CONTOH NAMA BIN CONTOH', font=font(52, True), fill='#111')
        d.text((600, 560), 'NO 1, JALAN CONTOH', font=font(42), fill='#222')
        d.text((600, 615), '00000 BANDAR CONTOH', font=font(42), fill='#222')
        d.text((600, 760), 'WARGANEGARA  LELAKI', font=font(40), fill='#222')
    else:
        d.rectangle([140, 300, W - 140, 420], fill='#bfc8d6')
        d.text((170, 330), '000000-00-0000-00-00', font=font(56, True), fill='#111')
        d.rectangle([140, 520, 560, 900], outline='#4a5568', width=4)
        d.text((170, 690), 'CHIP', font=font(48, True), fill='#4a5568')
        d.text((640, 560), 'SPECIMEN ONLY', font=font(64, True), fill='#2b3a55')
    return im


OUT.mkdir(exist_ok=True)
front = card('front').rotate(90, expand=True)  # stored sideways...
exif = Image.Exif()
exif[0x0112] = 6                               # ...display rotated 90° CW
front.save(OUT / 'sample-front-exif6.jpg', 'JPEG', quality=85, exif=exif.tobytes())
card('back').save(OUT / 'sample-back.jpg', 'JPEG', quality=85)
print('wrote', *sorted(p.name for p in OUT.iterdir()))
