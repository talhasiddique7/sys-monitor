SHELL := /bin/bash
UUID := $(shell jq -r '.uuid' metadata.json)
PACK_OUT := $(UUID).shell-extension.zip

.PHONY: check pack
check:
	./scripts/check-all.sh

pack:
	gnome-extensions pack . --force --out-dir . --extra-source=icons
	cp "$(PACK_OUT)" sysmon.shell-extension.zip
