SHELL := /bin/bash
UUID := $(shell jq -r '.uuid' metadata.json)
PACK_OUT := $(UUID).shell-extension.zip

.PHONY: check pack pack-zip pack-dual production install

check:
	./scripts/check-all.sh

# Pack both supported variants, then install the one matching this GNOME Shell.
pack:
	./scripts/pack-dual.sh
	./scripts/install-variant.sh

# Build both upload artifacts without installing either.
pack-zip:
	./scripts/pack-dual.sh
	@echo "Artifacts in dist/"

pack-dual:
	./scripts/pack-dual.sh

# Full production: syntax, schema, dual pack, zip verify, shexli
production: check

install:
	./scripts/install-variant.sh
