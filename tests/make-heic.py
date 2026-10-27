"""Make tests/fixtures/sample.heic (a small HEIC still image, like an iPhone
photo) for the HEIC test: ffmpeg/libx265 encodes one HEVC frame, then this
script wraps it in the HEIF boxes (ftyp, meta, mdat).
Usage: python3 tests/make-heic.py   (needs ffmpeg with libx265)"""
import os
import struct
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures', 'sample.heic')
W, H = 320, 240


def box(kind, payload):
    return struct.pack('>I4s', 8 + len(payload), kind) + payload


def full(kind, version, flags, payload):
    return box(kind, struct.pack('>I', (version << 24) | flags) + payload)


def nals(stream):
    """Split an Annex-B stream into NAL units."""
    out, i, start = [], 0, None
    while i < len(stream) - 3:
        if stream[i:i + 3] == b'\x00\x00\x01':
            if start is not None:
                out.append(stream[start:i].rstrip(b'\x00'))
            i += 3
            start = i
        else:
            i += 1
    if start is not None:
        out.append(stream[start:])
    return out


def hvcc(vps, sps, pps):
    # Header fields for Main profile, level 3.0; decoders read the real values
    # from the parameter sets below.
    hdr = bytes([1, 0x01]) + struct.pack('>I', 0x60000000) + bytes([0x90, 0, 0, 0, 0, 0]) + bytes([90])
    hdr += struct.pack('>H', 0xF000) + bytes([0xFC, 0xFD, 0xF8, 0xF8]) + struct.pack('>H', 0) + bytes([0x0F])
    arrays = b''
    for kind, unit in ((32, vps), (33, sps), (34, pps)):
        arrays += bytes([0x80 | kind]) + struct.pack('>HH', 1, len(unit)) + unit
    return box(b'hvcC', hdr + bytes([3]) + arrays)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        hevc = os.path.join(tmp, 'f.hevc')
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=size={W}x{H}:rate=1',
            '-frames:v', '1', '-pix_fmt', 'yuv420p', '-c:v', 'libx265', '-x265-params', 'keyint=1:log-level=error',
            '-f', 'hevc', hevc,
        ], check=True)
        units = nals(open(hevc, 'rb').read())
    kinds = {(u[0] >> 1) & 0x3F: u for u in units}
    vps, sps, pps = kinds[32], kinds[33], kinds[34]
    slices = [u for u in units if ((u[0] >> 1) & 0x3F) < 32]
    data = b''.join(struct.pack('>I', len(u)) + u for u in slices)

    ftyp = box(b'ftyp', b'heic' + struct.pack('>I', 0) + b'mif1heic')
    hdlr = full(b'hdlr', 0, 0, struct.pack('>I', 0) + b'pict' + b'\x00' * 12 + b'\x00')
    pitm = full(b'pitm', 0, 0, struct.pack('>H', 1))
    infe = full(b'infe', 2, 0, struct.pack('>HH', 1, 0) + b'hvc1' + b'\x00')
    iinf = full(b'iinf', 0, 0, struct.pack('>H', 1) + infe)
    ispe = full(b'ispe', 0, 0, struct.pack('>II', W, H))
    ipco = box(b'ipco', hvcc(vps, sps, pps) + ispe)
    ipma = full(b'ipma', 0, 0, struct.pack('>IHB', 1, 1, 2) + bytes([0x81, 0x02]))
    iprp = box(b'iprp', ipco + ipma)

    def meta(offset):
        iloc = full(b'iloc', 0, 0, bytes([0x44, 0x00]) + struct.pack('>HHHHII', 1, 1, 0, 1, offset, len(data)))
        return full(b'meta', 0, 0, hdlr + pitm + iloc + iinf + iprp)

    head = ftyp + meta(0)
    offset = len(head) + 8  # mdat header
    out = ftyp + meta(offset) + box(b'mdat', data)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'wb').write(out)
    print('wrote', OUT, len(out), 'bytes')


if __name__ == '__main__':
    main()
