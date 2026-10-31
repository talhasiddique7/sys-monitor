#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <zip-file> <variant-label> [expected-shell-versions-json]" >&2
    exit 1
fi

ZIP="$1"
VARIANT="$2"
EXPECTED_VERSIONS="${3:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

need_cmd() {
    command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing $1" >&2; exit 1; }
}

need_cmd unzip
need_cmd jq
need_cmd glib-compile-schemas

echo "==> Verify zip [$VARIANT]: $(basename "$ZIP")"
unzip -q "$ZIP" -d "$TMP_DIR"

for file in metadata.json extension.js prefs.js stylesheet.css stylesheet-light.css stylesheet-dark.css; do
    [[ -f "$TMP_DIR/$file" ]] || { echo "ERROR: missing $file in $VARIANT zip" >&2; exit 1; }
done

for icon in cpu download gpu ram swap upload; do
    [[ -f "$TMP_DIR/icons/${icon}-symbolic.svg" ]] || {
        echo "ERROR: missing icons/${icon}-symbolic.svg in $VARIANT zip" >&2
        exit 1
    }
done

[[ -f "$TMP_DIR/schemas/org.gnome.shell.extensions.sysmon.gschema.xml" ]] || {
    echo "ERROR: missing gschema in $VARIANT zip" >&2
    exit 1
}

glib-compile-schemas --strict --dry-run "$TMP_DIR/schemas"

if [[ -n "$EXPECTED_VERSIONS" ]]; then
    ACTUAL="$(jq -c '."shell-version"' "$TMP_DIR/metadata.json")"
    if [[ "$ACTUAL" != "$EXPECTED_VERSIONS" ]]; then
        echo "ERROR: shell-version mismatch for $VARIANT" >&2
        echo "  expected: $EXPECTED_VERSIONS" >&2
        echo "  actual:   $ACTUAL" >&2
        exit 1
    fi
fi

if ! cmp -s "$ROOT_DIR/stylesheet.css" "$TMP_DIR/stylesheet.css"; then
    echo "ERROR: stylesheet.css in $VARIANT zip differs from source" >&2
    exit 1
fi

if [[ -d "$ROOT_DIR/venv/bin" ]] && [[ -x "$ROOT_DIR/venv/bin/shexli" ]]; then
    echo "==> shexli [$VARIANT]"
    "$ROOT_DIR/venv/bin/shexli" "$ZIP"
fi

VERSION="$(jq -r '.version' "$TMP_DIR/metadata.json")"
SHELL_RANGE="$(jq -r '."shell-version" | join(", ")' "$TMP_DIR/metadata.json")"
echo "    OK: v${VERSION} | GNOME ${SHELL_RANGE}"
