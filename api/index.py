"""Vercel serverless entrypoint.

vercel.json rewrites every path here; the FastAPI app serves both the JSON
API and the static dashboard. On Vercel no workshop credentials are set, so
src/config.py selects demo mode automatically.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.main import app  # noqa: E402,F401
