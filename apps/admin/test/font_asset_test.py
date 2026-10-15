"""Offline asset regression; does not substitute for Next builds or browser QA.
Run from repository root: python3 -B apps/admin/test/font_asset_test.py
"""
import gzip
import hashlib
from pathlib import Path
import struct
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[3]
BASE = 'a221f76665c045b73acc9269a9248fcb5aaa8800'


class AdminFont(unittest.TestCase):
    def test_exact_original_decoded_bytes_and_variable_truetype(self):
        original = subprocess.check_output([
            'git', 'show', f'{BASE}:apps/admin/public/fonts/Onest.woff2'], cwd=ROOT)
        font = (ROOT / 'apps/admin/public/fonts/Onest.ttf').read_bytes()
        self.assertEqual(len(original), 71117)
        self.assertEqual(hashlib.sha256(original).hexdigest(),
                         'c2475a4eb6479e2d5f5a0c1929ed29839ac9e61169e5aa5660299b8b77144275')
        self.assertEqual(font, gzip.decompress(original))
        self.assertEqual(len(font), 124376)
        self.assertEqual(font[:4], b'\x00\x01\x00\x00')
        count = struct.unpack_from('>H', font, 4)[0]
        tables = {}
        for i in range(count):
            tag, _, offset, length = struct.unpack_from('>4sIII', font, 12 + i * 16)
            self.assertLessEqual(offset + length, len(font))
            tables[tag] = offset
        fvar = tables[b'fvar']
        axes_offset, _, axis_count, axis_size = struct.unpack_from('>4H', font, fvar + 4)
        axes = {}
        for i in range(axis_count):
            tag, low, default, high = struct.unpack_from('>4siii', font, fvar + axes_offset + i * axis_size)
            axes[tag] = tuple(v / 65536 for v in (low, default, high))
        self.assertEqual(axes[b'wght'], (100, 400, 900))

    def test_local_font_reference_and_removed_malformed_asset(self):
        layout = (ROOT / 'apps/admin/src/app/layout.tsx').read_text()
        self.assertIn('from "next/font/local"', layout)
        self.assertIn('src: "../../public/fonts/Onest.ttf"', layout)
        self.assertIn('weight: "100 900"', layout)
        self.assertIn('className={onest.className}', layout)
        self.assertFalse((ROOT / 'apps/admin/public/fonts/Onest.woff2').exists())
        for source in (ROOT / 'apps/admin/src').rglob('*'):
            if source.is_file():
                self.assertNotIn('Onest.woff2', source.read_text())


if __name__ == '__main__':
    unittest.main()
