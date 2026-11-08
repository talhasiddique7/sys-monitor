#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="$(jq -r '."gettext-domain" // .uuid' "${ROOT_DIR}/metadata.json")"

if ! command -v msgfmt >/dev/null 2>&1; then
    echo "ERROR: required command not found: msgfmt (install gettext)" >&2
    exit 1
fi

shopt -s nullglob
PO_FILES=("${ROOT_DIR}"/po/*.po)
if [[ ${#PO_FILES[@]} -eq 0 ]]; then
    echo "ERROR: no .po files found in ${ROOT_DIR}/po" >&2
    exit 1
fi

rm -rf "${ROOT_DIR}/locale"
for po in "${PO_FILES[@]}"; do
    lang="$(basename "${po}" .po)"
    mkdir -p "${ROOT_DIR}/locale/${lang}/LC_MESSAGES"
    msgfmt --check --statistics -o "${ROOT_DIR}/locale/${lang}/LC_MESSAGES/${DOMAIN}.mo" "${po}"
done

echo "==> Compiled locale: ${ROOT_DIR}/locale (domain ${DOMAIN})"
