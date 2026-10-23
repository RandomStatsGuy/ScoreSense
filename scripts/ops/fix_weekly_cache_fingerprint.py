#!/usr/bin/env python3
"""Deprecated compatibility entry point: read-only fingerprint and source audit."""
from scripts.ops.artifact_fingerprint_audit import main


if __name__ == "__main__":
    raise SystemExit(main(kinds=("weekly",)))
