#!/usr/bin/env bash
# Run every test suite; stop at the first failure.
# Needs: node + playwright (NODE_PATH pointing at it), python3 with pypdf, cryptography,
# python-docx, openpyxl, python-pptx (LibreOffice optional).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-tests/output}"
node tests/crypto-test.mjs
for t in render-test tools-test pdf-tools-test more-tools-test phase1-test phase2a-test phase2b-test phase2c-test phase2d-test workflow-test fonts-test offline-test handoff-test batch-test; do
  echo "::group::$t"
  node "tests/$t.cjs" "$OUT"
  echo "::endgroup::"
done
echo "All suites passed."
