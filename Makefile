# novig-v3-kit: `make setup` once, then `make dev`.
.PHONY: setup dev start test test-rust test-ts build demo-build bot quickstart sync-spec fonts clean

setup: fonts
	cd ts && pnpm install
	cd rust && cargo build -p console-server -p novig-mm

fonts:
	./scripts/fetch-fonts.sh

# Console with hot reload: Rust server on :8787, Vite on :5173 (open http://localhost:5173)
dev:
	@trap 'kill 0' INT TERM; \
	(cd rust && cargo run -q -p console-server) & \
	(cd ts/apps/console && pnpm -s dev) & \
	wait

# One process: builds the UI and serves everything from http://127.0.0.1:8787
start: build
	cd rust && cargo run -q --release -p console-server

build:
	cd ts/apps/console && pnpm -s build

# Static hosted demo (no Rust server, no licensed fonts) into ts/apps/console/dist
demo-build:
	cd ts/apps/console && rm -rf dist && VITE_DEMO=1 pnpm -s build && cp vercel.json dist/

test: test-rust test-ts

test-rust:
	cd rust && cargo test --workspace

test-ts:
	cd ts/packages/novig-v3 && pnpm -s test && pnpm -s typecheck
	cd ts/apps/console && pnpm -s typecheck

# Paper-trade the built-in mock exchange from the terminal
bot:
	cd rust && cargo run -q -p novig-mm -- --mock

# Novig's 5-call quickstart on QA (needs NOVIG_KEY_ID + NOVIG_PEM)
quickstart:
	set -a; [ -f .env ] && . ./.env; set +a; cargo run -q --manifest-path rust/Cargo.toml -p novig-v3 --example quickstart

sync-spec:
	./scripts/sync-spec.sh

clean:
	cd rust && cargo clean
	rm -rf ts/apps/console/dist
