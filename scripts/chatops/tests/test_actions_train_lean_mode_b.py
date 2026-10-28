"""Execute Lean boundary tests through the existing required receiver job."""
import subprocess
import sys
import unittest
from pathlib import Path

class LeanDeliveryTests(unittest.TestCase):
    def test_lean_boundaries(self):
        root = Path(__file__).resolve().parents[3]
        subprocess.run([sys.executable, "-I", "-B", str(root / "tools/train/test_train.py")], check=True, cwd=root)

if __name__ == "__main__":
    unittest.main()
