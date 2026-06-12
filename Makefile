# Ergonomic targets for the day-to-day. Run `make` with no args to see
# this help.

.PHONY: help up down restart logs verify-gateway ps build-agent ask chat draft save-spec actions index-docs kb-search kb-list kb-delete

help: ## Show this help.
	@awk 'BEGIN{FS=":.*## "; printf "Targets:\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Start all services in the background.
	docker compose up -d

down: ## Stop and remove containers.
	docker compose down

restart: ## Restart all services (picks up config file changes).
	docker compose restart

logs: ## Tail gateway logs (Ctrl-C to detach).
	docker compose logs -f --tail=200 gateway

ps: ## Show running services.
	docker compose ps

build-agent: ## Rebuild the agent container (only needed when pyproject.toml changes).
	docker compose build agent

ask: ## Ask the engineering agent (read-only). Usage: make ask Q="find our V2 FCC cert"
	@if [ -z "$(Q)" ]; then echo 'usage: make ask Q="your question"'; exit 1; fi
	docker compose run --rm agent ask "$(Q)"

chat: ## Interactive chat with the engineering agent (keeps context across turns).
	docker compose run --rm agent chat

draft: ## Draft from a template into drafts/. Usage: make draft TEMPLATE="SOW" PURPOSE="..." [SURFACE=console|slack]
	@if [ -z "$(TEMPLATE)" ] || [ -z "$(PURPOSE)" ]; then echo 'usage: make draft TEMPLATE="SOW" PURPOSE="what it is for"'; exit 1; fi
	@mkdir -p logs
	docker compose run --rm -e ORRERY_APPROVAL_SURFACE=$(or $(SURFACE),) agent draft --template "$(TEMPLATE)" --purpose "$(PURPOSE)"

save-spec: ## Download a file URL into drafts/ (human-invoked). Usage: make save-spec URL="https://..." [NAME="part.pdf"]
	@if [ -z "$(URL)" ]; then echo 'usage: make save-spec URL="https://..." [NAME="file.pdf"]'; exit 1; fi
	@mkdir -p logs
	docker compose run --rm -T agent save-spec --url "$(URL)" $(if $(NAME),--name "$(NAME)",)

actions: ## Tail the actions audit log.
	@tail -f logs/actions.jsonl 2>/dev/null || echo "(no actions logged yet)"

index-docs: ## (Re)index docs/ into the Qdrant docs collection.
	docker compose run --rm agent index-docs

kb-search: ## Manual KB search. Usage: make kb-search QUERY="..." [COLLECTION=docs|learnings]
	@if [ -z "$(QUERY)" ]; then echo 'usage: make kb-search QUERY="..." [COLLECTION=docs]'; exit 1; fi
	docker compose run --rm agent kb-search "$(QUERY)" --collection $(or $(COLLECTION),learnings)

kb-list: ## List KB points. Usage: make kb-list [STATUS=provisional] [COLLECTION=docs|learnings]
	docker compose run --rm agent kb-list \
	    --collection $(or $(COLLECTION),learnings) \
	    $(if $(STATUS),--status $(STATUS),)

kb-delete: ## Delete a KB point. Usage: make kb-delete ID=<uuid> [COLLECTION=docs|learnings]
	@if [ -z "$(ID)" ]; then echo 'usage: make kb-delete ID=<uuid> [COLLECTION=learnings]'; exit 1; fi
	docker compose run --rm agent kb-delete $(ID) --collection $(or $(COLLECTION),learnings)

verify-gateway: ## Smoke test — routes a real Claude call through LiteLLM.
	@echo "── Health check ────────────────────────────────────────"
	@curl -fsS http://localhost:4000/health/liveliness && echo " ok"
	@echo
	@echo "── Chat completion via claude-haiku ────────────────────"
	@curl -sS http://localhost:4000/v1/chat/completions \
	    -H "Content-Type: application/json" \
	    -d '{"model":"claude-haiku","messages":[{"role":"user","content":"Reply with exactly the word: pong"}],"max_tokens":10}' \
	    | python3 -c 'import sys,json; r=json.load(sys.stdin); c=r.get("choices",[{}])[0].get("message",{}).get("content","<no content>"); print("model reply:", repr(c)); print("usage:", r.get("usage",{}))'
