# Makefile for ffa-basis-hedging-study.
#
# Every target is one or a few commands that can be pasted into a shell; `make help` prints them.

PYTHON ?= python
PORT ?= 8150
BASE ?= http://localhost:$(PORT)/ffa-basis-hedging-study/
SHOTS ?= screenshots

.DEFAULT_GOAL := help
.PHONY: help all setup data data-offline build fixtures note test lint validate gate serve browser site shots

help:
	@echo "make all          fetch what is missing (cache first, network when empty), rebuild every artifact, the"
	@echo "                  parity cases and the note, then run the gate"
	@echo "make setup        python -m pip install -r requirements-lock.txt && python -m pip install --no-deps -e ."
	@echo "make data         python scripts/refresh.py   (fetch new documents, then rebuild)"
	@echo "make data-offline python scripts/refresh.py --offline   (rebuild from the cache, no network)"
	@echo "make build        python scripts/build.py --reuse   (artifacts from data/cache/panel.json)"
	@echo "make fixtures     python scripts/gen_fixtures.py   (engine parity cases)"
	@echo "make note         python scripts/note.py   (FFA-Basis-Hedging-Study-Research-Note.pdf)"
	@echo "make test         python -m pytest tests"
	@echo "make lint         ruff check src scripts tests && ruff format --check src scripts tests"
	@echo "make validate     node tools/<each>.mjs: validate-engine, validate-artifacts, check-policy, check-paths,"
	@echo "                  check-literals, check-dashes"
	@echo "make gate         everything that must pass before a change lands (offline)"
	@echo "make serve        python scripts/serve.py --port $(PORT)   then open $(BASE)"
	@echo "make browser      node tools/check-site.mjs --base $(BASE)   (server running)"
	@echo "make site         node scripts/readme_shots.mjs --base $(BASE)   (the README's screenshots in assets/)"
	@echo "make shots        node scripts/screenshots.mjs --base $(BASE) --out $(SHOTS)   (every view, width, theme)"

all: data fixtures note gate

setup:
	$(PYTHON) -m pip install -r requirements-lock.txt
	$(PYTHON) -m pip install --no-deps -e .

data:
	$(PYTHON) scripts/refresh.py

data-offline:
	$(PYTHON) scripts/refresh.py --offline

build:
	$(PYTHON) scripts/build.py --reuse

fixtures:
	$(PYTHON) scripts/gen_fixtures.py

note:
	$(PYTHON) scripts/note.py

test:
	$(PYTHON) -m pytest tests

lint:
	ruff check src scripts tests
	ruff format --check src scripts tests

validate:
	node tools/validate-engine.mjs
	node tools/validate-artifacts.mjs
	node tools/check-policy.mjs
	node tools/check-paths.mjs
	node tools/check-literals.mjs
	node tools/check-dashes.mjs

gate:
	$(PYTHON) scripts/gen_fixtures.py --check
	$(PYTHON) -m pytest tests
	ruff check src scripts tests
	ruff format --check src scripts tests
	node tools/validate-engine.mjs
	node tools/validate-artifacts.mjs
	node tools/check-policy.mjs
	node tools/check-paths.mjs
	node tools/check-literals.mjs
	node tools/check-dashes.mjs

serve:
	$(PYTHON) scripts/serve.py --port $(PORT)

browser:
	node tools/check-site.mjs --base $(BASE)

site:
	node scripts/readme_shots.mjs --base $(BASE)

shots:
	node scripts/screenshots.mjs --base $(BASE) --out $(SHOTS)
