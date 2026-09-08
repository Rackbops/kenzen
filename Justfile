# Kenzen -- pnpm workspace: packages/server, packages/web, packages/contract.
#
# Requires: Node 24 (.nvmrc) and corepack (ships with Node) for pnpm.

set shell := ["bash", "-euo", "pipefail", "-c"]

# List available recipes
default:
    @just --list

# Install workspace dependencies
install:
    corepack enable
    pnpm install --frozen-lockfile

# Run all checks (lint + typecheck + test) -- the same gate as CI
check: lint typecheck test

# Lint, read-only
lint:
    biome check .

# Auto-fix what Biome can fix
fix:
    biome check --write .

# Type-check every package
typecheck:
    pnpm -r typecheck

# Run tests in every package
test:
    pnpm -r test

# Remove build artifacts, caches, and installed deps
clean:
    rm -rf node_modules
    find packages -mindepth 1 -maxdepth 1 -type d -exec rm -rf {}/node_modules {}/dist \;

# Reinstall from a clean slate
fresh: clean install
