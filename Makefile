.DEFAULT_GOAL := help

AWS_REGION ?= us-east-1
AWS_PROJECT_TAG ?= zig-zag
AWS_RDS_ID ?= zig-zag-postgres
AWS_POWER_ENV := AWS_REGION=$(AWS_REGION) AWS_PROJECT_TAG=$(AWS_PROJECT_TAG) AWS_RDS_ID=$(AWS_RDS_ID)

.PHONY: help aws-start aws-stop aws-status aws-seed-secrets check-gh rollback_deploy finish_deploy

help: ## Lista los comandos disponibles
	@echo "Targets disponibles:"
	@grep -E '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

## --- AWS producción (apagada por defecto para desarrollo) ---
## Detener conserva RDS y EBS. AWS reinicia RDS automáticamente después de 7
## días parada — no hay apagado automático, conviene chequear aws-status de
## vez en cuando si no se usa seguido.

aws-start: ## Enciende RDS y luego el backend
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh start

aws-stop: ## Detiene backend y RDS sin borrar sus datos
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh stop

aws-status: ## Muestra el estado y tipo de las EC2 y del RDS
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh status

aws-seed-secrets: ## Copia los secretos de .env a SSM SecureString sin mostrarlos
	@AWS_REGION=$(AWS_REGION) node scripts/aws-seed-parameters.mjs .env

## --- Control del canary de backend (blue/green) ---
## Corren vía GitHub Actions (workflow_dispatch), no con credenciales AWS
## locales — así no dependen de tener el profile de AWS bien seteado acá,
## solo de estar logueado con `gh`.

check-gh: ## Verifica que gh esté instalado y logueado, lo resuelve si no
	@command -v gh >/dev/null 2>&1 || { \
		echo "gh no está instalado, instalando con Homebrew..."; \
		command -v brew >/dev/null 2>&1 || { echo "Instalá Homebrew primero: https://brew.sh" >&2; exit 1; }; \
		brew install gh; \
	}
	@gh auth status >/dev/null 2>&1 || { \
		echo "gh no está autenticado, iniciando login..."; \
		gh auth login; \
	}

rollback_deploy: check-gh ## Vuelve el backend al slot anterior (rollback instantáneo)
	@gh workflow run backend-canary-control.yml -f action=rollback
	@echo "Disparado. Seguilo en: gh run watch, o https://github.com/jiseruk/zig-zag/actions"

finish_deploy: check-gh ## Salta el rollout en curso directo al 100%, sin esperar los escalones
	@gh workflow run backend-canary-control.yml -f action=promote
	@echo "Disparado. Seguilo en: gh run watch, o https://github.com/jiseruk/zig-zag/actions"
