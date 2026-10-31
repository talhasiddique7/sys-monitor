#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="$(jq -r '.uuid' "$ROOT_DIR/metadata.json")"
VARIANT="${1:-}"

if [[ -z "$VARIANT" ]]; then
    if ! SHELL_VERSION_OUTPUT="$(gnome-shell --version 2>&1)"; then
        echo "ERROR: could not detect the GNOME Shell version." >&2
        echo "Ensure gnome-shell is installed or pass gnome40-44/gnome45-50 explicitly." >&2
        exit 1
    fi

    if [[ "$SHELL_VERSION_OUTPUT" =~ GNOME[[:space:]]Shell[[:space:]]([0-9]+)([.]|$) ]]; then
        SHELL_MAJOR="${BASH_REMATCH[1]}"
    else
        echo "ERROR: could not parse GNOME Shell version: ${SHELL_VERSION_OUTPUT}" >&2
        exit 1
    fi

    case "$SHELL_MAJOR" in
        40|41|42|43|44) VARIANT="gnome40-44" ;;
        45|46|47|48|49|50) VARIANT="gnome45-50" ;;
        *)
            echo "ERROR: GNOME Shell ${SHELL_MAJOR} is not supported (supported versions: 40-50)." >&2
            exit 1
            ;;
    esac
fi

case "$VARIANT" in
    gnome40-44|gnome45-50) ;;
    *)
        echo "ERROR: unknown variant: ${VARIANT} (expected gnome40-44 or gnome45-50)." >&2
        exit 1
        ;;
esac

ZIP="$ROOT_DIR/dist/${UUID}-${VARIANT}.shell-extension.zip"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

for command in glib-compile-schemas unzip; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "ERROR: required command not found: $command" >&2
        exit 1
    fi
done

if [[ ! -f "$ZIP" ]]; then
    echo "ERROR: zip not found: $ZIP" >&2
    echo "Run: make pack-dual" >&2
    exit 1
fi

echo "==> Install variant: $VARIANT"
gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "$EXT_DIR"
rm -rf "$HOME/.local/share/gnome-shell/extension-updates/$UUID" 2>/dev/null || true
mkdir -p "$EXT_DIR"
unzip -q "$ZIP" -d "$EXT_DIR"
glib-compile-schemas "$EXT_DIR/schemas/"
mkdir -p "$HOME/.local/share/glib-2.0/schemas"
cp "$EXT_DIR/schemas/org.gnome.shell.extensions.sysmon.gschema.xml" "$HOME/.local/share/glib-2.0/schemas/"
glib-compile-schemas "$HOME/.local/share/glib-2.0/schemas/"

if ! gnome-extensions enable "$UUID"; then
    echo "ERROR: ${VARIANT} files were installed, but the extension could not be enabled." >&2
    echo "Run 'gnome-extensions enable ${UUID}' from an active GNOME session." >&2
    exit 1
fi
sleep 2

STATE="$(gnome-extensions info "$UUID" | awk -F': ' '/State:/ {print $2}')"
VERSION="$(jq -r '.version' "$EXT_DIR/metadata.json")"
SHELL="$(jq -r '."shell-version" | join(", ")' "$EXT_DIR/metadata.json")"
echo "==> Done: v${VERSION} | GNOME ${SHELL} | state ${STATE}"
