
SHELL := /bin/bash

UUID := $(shell jq -r '.uuid' metadata.json)
VERSION := $(shell jq -r '.version' metadata.json)
PACK_OUT := $(UUID).shell-extension.zip

.PHONY: check pack pack-zip pack-dual production install

# Run all project checks
check:
	./scripts/check-all.sh

# Build both variants and install the matching variant
pack:
	./scripts/pack-dual.sh
	./scripts/install-variant.sh

# Build both ZIP artifacts
pack-zip:
	./scripts/pack-dual.sh
	@echo "Artifacts in dist/"

# Build both variants without installing
pack-dual:
	./scripts/pack-dual.sh

# Complete production validation and build
production: check pack-zip
	@echo "Production build successful"
	@echo "Version: $(VERSION)"
	@echo "Artifacts:"
	@ls -lh dist/*.zip

# Install the matching GNOME Shell variant
install:
	./scripts/install-variant.sh

