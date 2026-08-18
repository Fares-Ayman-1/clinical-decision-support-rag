"""Shared pytest configuration.

Puts `backend/` on sys.path so `import app...` resolves. Previously every
invocation needed `PYTHONPATH=backend` set by hand, which meant the bare
`pytest tests/` command printed in EVALUATION.md §5 did not actually work
from a clean shell. A documented command that fails is worse than no
documented command, and the fix belongs here rather than in each caller.
"""

from __future__ import annotations

import pathlib
import sys

BACKEND = pathlib.Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
