"""Start the small AssessX replica."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))

from server import run  # noqa: E402


if __name__ == "__main__":
    run()
