.DEFAULT_GOAL := help

AWS_REGION ?= us-east-1
AWS_PROJECT_TAG ?= zig-zag
AWS_RDS_ID ?= zig-zag-postgres
AWS_POWER_ENV := AWS_REGION=$(AWS_REGION) AWS_PROJECT_TAG=$(AWS_PROJECT_TAG) AWS_RDS_ID=$(AWS_RDS_ID)

.PHONY: help aws-start aws-stop aws-status aws-seed-secrets

help: ## Lista los comandos disponibles
	@echo "Targets disponibles:"
	@grep -E '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

## --- AWS producción (apagada por defecto para desarrollo) ---
## Detener conserva RDS y EBS. AWS reinicia RDS automáticamente después de 7
## días parada — no hay apagado automático, conviene chequear aws-status de
## vez en cuando si no se usa seguido.

aws-start: ## Enciende RDS, luego Chroma y finalmente el backend
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh start

aws-stop: ## Detiene backend, Chroma y RDS sin borrar sus datos
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh stop

aws-status: ## Muestra el estado y tipo de las EC2 y del RDS
	@$(AWS_POWER_ENV) bash scripts/aws-power.sh status

aws-seed-secrets: ## Copia los secretos de .env a SSM SecureString sin mostrarlos
	@AWS_REGION=$(AWS_REGION) node scripts/aws-seed-parameters.mjs .env
