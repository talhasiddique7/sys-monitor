SHELL := /bin/bash
UUID := $(shell jq -r '.uuid' metadata.json)
PACK_OUT := $(UUID).shell-extension.zip

.PHONY: check pack pack-dual
check:
	./scripts/check-all.sh

pack:
	gnome-extensions pack . --force --out-dir . --extra-source=icons
	cp "$(PACK_OUT)" sysmon.shell-extension.zip

pack-dual:
	./scripts/pack-dual.sh
