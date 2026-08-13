# AWS CI/CD y entorno apagable

La infraestructura se administra con Terraform en `us-east-1` y está pensada para una etapa de desarrollo: conserva los datos, pero la EC2 y RDS permanecen detenidos salvo cuando se quiere usar o desplegar la app.

## Arquitectura

- Expo Web exportado a un bucket S3 privado y servido por CloudFront.
- API pública en otra distribución CloudFront; el origen es un ALB que sólo acepta tráfico desde CloudFront y exige un header secreto de origen.
- Backend NestJS en una EC2 `t3.micro`, sin SSH y administrada con SSM.
- PostgreSQL 16 en RDS `db.t3.micro`, Single-AZ y privado, con la extensión `pgvector` habilitada. AWS genera y rota la contraseña maestra en Secrets Manager.
- Groq genera tours. Bedrock Titan Text Embeddings V2 genera vectores de 256 dimensiones y pgvector (en la misma RDS) los guarda/busca — no hay una base de datos vectorial separada.
- No hay NAT Gateway. La EC2 tiene IP pública sólo para salida; su security group no acepta tráfico público.

## Secretos

Los secretos de aplicación se guardan como un único JSON cifrado en SSM Parameter Store:

```text
/zig-zag/prod/app
```

Terraform sólo conoce el nombre del parámetro, no su valor, por lo que Groq, SMTP, JWT, Google y Geoapify no entran en el estado. La contraseña de RDS es la excepción administrada por el propio RDS en Secrets Manager. No se usan access keys permanentes en GitHub: Actions asume roles con OIDC.

Completar `.env` local y sembrar SSM sin imprimir valores:

```bash
make aws-seed-secrets
```

Valores requeridos: `GROQ_API_KEY`, `GEOAPIFY_API_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_IDS`, `SMTP_HOST`, `SMTP_USER` y `SMTP_PASS`.

## Bootstrap de una cuenta AWS nueva

Se necesita AWS CLI autenticado y Terraform 1.10 o superior.

1. Crear el backend de estado y el rol OIDC de Terraform:

   ```bash
   cd terraform/bootstrap
   terraform init
   terraform apply
   terraform output
   ```

2. En GitHub configurar estas repository variables con los outputs anteriores:

   - `TF_STATE_BUCKET`
   - `AWS_GITHUB_TERRAFORM_ROLE_ARN`
   - `BUDGET_ALERT_EMAIL`

3. Crear los environments `production-infra` y `production`; conviene exigir aprobación manual en `production-infra`.

4. Ejecutar el workflow `Terraform` con `action=apply`. El apply termina ejecutando `make aws-stop`.

5. Copiar el output `github_cd_role_arn` a la variable GitHub `AWS_GITHUB_CD_ROLE_ARN`. Agregar también:

   - variable `GOOGLE_WEB_CLIENT_ID`;
   - secrets `GOOGLE_MAPS_API_KEY` y `GEOAPIFY_API_KEY` para el build web.

   En Google Cloud, agregar la URL CloudFront del frontend como Authorized JavaScript Origin. El valor de `GOOGLE_WEB_CLIENT_ID` debe estar incluido también en `GOOGLE_CLIENT_IDS` dentro del parámetro SSM.

6. Ejecutar `make aws-seed-secrets`. A partir de ahí, un CI exitoso en `main` dispara CD.

Para un primer apply local, copiar `terraform/terraform.tfvars.example` a `terraform/terraform.tfvars`, inicializar el backend con el bucket del bootstrap y detener al finalizar:

```bash
cd terraform
terraform init -backend-config="bucket=BUCKET_DEL_BOOTSTRAP" -backend-config="region=us-east-1"
terraform apply
cd ..
make aws-stop
```

## Encender y apagar

Con credenciales AWS locales:

```bash
make aws-status
make aws-start
make aws-stop
```

`aws-start` espera RDS y luego inicia el backend. `aws-stop` detiene la EC2 y RDS sin borrar datos. También existe el workflow manual `AWS Power` con `status`, `start` y `stop` — es 100% manual, sin cron: nadie apaga el entorno si no lo pedís explícitamente.

AWS vuelve a iniciar automáticamente una instancia RDS detenida después de siete días. Como no hay apagado automático, si te olvidás de correr `make aws-stop`/el workflow manual, esa RDS se puede quedar prendida indefinidamente — vale la pena chequear `make aws-status` de vez en cuando.

Detener no lleva el costo a cero. Permanecen facturables el ALB, la IPv4 pública reservada mientras la EC2 está encendida, EBS, almacenamiento/backups de RDS, S3 y CloudFront según uso. Hay un AWS Budget mensual de USD 10 con avisos al 50%, 80% y 100%; un presupuesto alerta, no impide gasto.

## Workflows

- `CI`: backend typecheck/lint/unit/build, export web, backend E2E y dos Playwright determinísticos. Los artefactos fallidos conservan video, trace, screenshots y logs por 14 días.
- `CD`: sólo después de CI verde en `main` (o manual). Construye una imagen inmutable, publica frontend, enciende la infraestructura, despliega por SSM, hace smoke test y siempre vuelve a apagarla.
- `Terraform`: `fmt/validate` sin credenciales en PRs de infraestructura; plan/apply manuales con OIDC y apply protegido por environment.
- `AWS Power`: encendido/apagado 100% manual, sin cron.

Los cuatro Playwright marcados `@live` llaman a Groq y/o mapas reales y se excluyen del CI para no consumir cuota ni volverlo inestable. Se ejecutan deliberadamente desde una máquina local con los servicios encendidos:

```bash
yarn workspace fe test:e2e --grep @live
```

Para ver el navegador y conservar todos los videos:

```bash
E2E_VIDEO=on E2E_SLOWMO=1 yarn workspace fe test:e2e --grep @live --headed
```

