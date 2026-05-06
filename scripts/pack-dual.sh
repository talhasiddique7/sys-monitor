#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${ROOT_DIR}/dist}"

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "ERROR: required command not found: $1" >&2
        exit 1
    fi
}

need_cmd jq
need_cmd gnome-extensions
need_cmd unzip

UUID="$(jq -r '.uuid' "${ROOT_DIR}/metadata.json")"
mkdir -p "${OUT_DIR}"

pack_variant() {
    local variant="$1"
    local shell_versions_json="$2"
    local extension_src="$3"
    local prefs_src="$4"

    local tmp_dir
    tmp_dir="$(mktemp -d)"

    cp "${ROOT_DIR}/stylesheet.css" "${tmp_dir}/"
    cp -R "${ROOT_DIR}/icons" "${tmp_dir}/"
    cp -R "${ROOT_DIR}/schemas" "${tmp_dir}/"
    cp "${ROOT_DIR}/${extension_src}" "${tmp_dir}/extension.js"
    cp "${ROOT_DIR}/${prefs_src}" "${tmp_dir}/prefs.js"

    jq --argjson versions "${shell_versions_json}" '."shell-version" = $versions' \
        "${ROOT_DIR}/metadata.json" > "${tmp_dir}/metadata.json"

    gnome-extensions pack "${tmp_dir}" --force --out-dir "${tmp_dir}" --extra-source=icons >/dev/null

    local packed_zip="${tmp_dir}/${UUID}.shell-extension.zip"
    local output_zip="${OUT_DIR}/${UUID}-${variant}.shell-extension.zip"

    mv "${packed_zip}" "${output_zip}"
    unzip -t "${output_zip}" >/dev/null
    echo "Created ${output_zip}"
    rm -rf "${tmp_dir}"
}

pack_variant "gnome40-44" '["40","41","42","43","44"]' "extensionLegacy.js" "prefsLegacy.js"
pack_variant "gnome45-50" '["45","46","47","48","49","50"]' "extension.js" "prefs.js"
