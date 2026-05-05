#!/bin/bash

UUID="sysmonitor@talhasiddique7"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Installing $UUID to $EXT_DIR..."

# Create directory
mkdir -p "$EXT_DIR/schemas" "$EXT_DIR/icons"

# Copy files
cp extension.js "$EXT_DIR/"
cp prefs.js "$EXT_DIR/"
cp metadata.json "$EXT_DIR/"
cp stylesheet.css "$EXT_DIR/"
cp icons/*.svg "$EXT_DIR/icons/"
cp schemas/org.gnome.shell.extensions.sysmon.gschema.xml "$EXT_DIR/schemas/"

# Compile schemas
glib-compile-schemas "$EXT_DIR/schemas/"

echo "Installation complete."
echo "Please restart GNOME Shell (Alt+F2 -> r -> Enter on X11, or log out and in on Wayland)."
echo "Then enable the extension with: gnome-extensions enable $UUID"
