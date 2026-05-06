#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR=""

cleanup() {
    if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
        rm -rf "${TMP_DIR}"
    fi
}
trap cleanup EXIT

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "ERROR: required command not found: $1" >&2
        exit 1
    fi
}

run_step() {
    local label="$1"
    shift
    echo "==> ${label}"
    "$@"
}

run_unit_tests_if_configured() {
    if [[ -f "${ROOT_DIR}/package.json" ]] && command -v npm >/dev/null 2>&1; then
        if jq -e '.scripts.test' "${ROOT_DIR}/package.json" >/dev/null 2>&1; then
            run_step "Unit tests (npm test)" npm --prefix "${ROOT_DIR}" test
            return
        fi
    fi

    if [[ -f "${ROOT_DIR}/pyproject.toml" ]] && command -v pytest >/dev/null 2>&1; then
        run_step "Unit tests (pytest)" pytest "${ROOT_DIR}"
        return
    fi

    echo "==> Unit tests"
    echo "SKIP: no configured unit-test runner found."
}

need_cmd node
need_cmd jq
need_cmd glib-compile-schemas
need_cmd gnome-extensions
need_cmd unzip
need_cmd bash

run_step "Syntax check: extension.js" node --check "${ROOT_DIR}/extension.js"
run_step "Syntax check: extensionLegacy.js" node --check "${ROOT_DIR}/extensionLegacy.js"
run_step "Syntax check: prefs.js" node --check "${ROOT_DIR}/prefs.js"
run_step "Syntax check: prefsLegacy.js" node --check "${ROOT_DIR}/prefsLegacy.js"

run_step "Schema validation" glib-compile-schemas --strict --dry-run "${ROOT_DIR}/schemas"
run_step "Metadata JSON validation" jq empty "${ROOT_DIR}/metadata.json"
run_step "Installer syntax validation" bash -n "${ROOT_DIR}/install.sh"

TMP_DIR="$(mktemp -d)"
PACK_ARGS=(
    "${ROOT_DIR}"
    --force
    --out-dir "${TMP_DIR}"
    --extra-source=icons
)
run_step "Pack extension" gnome-extensions pack "${PACK_ARGS[@]}"

UUID="$(jq -r '.uuid' "${ROOT_DIR}/metadata.json")"
PACK_FILE="${TMP_DIR}/${UUID}.shell-extension.zip"

if [[ ! -f "${PACK_FILE}" ]]; then
    echo "ERROR: expected pack output not found: ${PACK_FILE}" >&2
    exit 1
fi

run_step "Packed zip integrity" unzip -t "${PACK_FILE}"
run_step "Verify packaged icons" unzip -l "${PACK_FILE}" icons/cpu-symbolic.svg icons/download-symbolic.svg icons/ram-symbolic.svg icons/swap-symbolic.svg icons/upload-symbolic.svg >/dev/null
run_unit_tests_if_configured

echo "==> All checks completed."
