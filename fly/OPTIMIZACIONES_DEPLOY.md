# Optimizaciones para Deploy Rápido en Fly.io

Este documento describe las optimizaciones implementadas para acelerar los deploys en Fly.io.

## Optimizaciones Implementadas

### 1. **Docker Build Cache**

- ✅ Uso de `--mount=type=cache` para cachear `node_modules` y dependencias globales
- ✅ Orden optimizado de capas: archivos que cambian menos frecuentemente primero
- ✅ Separación de dependencias de producción y desarrollo

### 2. **Remote Builder**

- ✅ Uso de `--remote-only` en los scripts de deploy
- El remote builder de Fly.io es más rápido que builds locales
- Mejor uso de recursos y cache compartido

### 3. **.dockerignore Optimizado**

- ✅ Exclusión de archivos innecesarios (tests, docs, node_modules, etc.)
- Reduce el contexto de build enviado a Docker
- Builds más rápidos al transferir menos datos

### 4. **Multi-stage Builds Optimizados**

- ✅ Separación clara de etapas: deps → builder → runner
- ✅ Solo copiar lo necesario en cada etapa
- ✅ Imágenes finales más pequeñas

## Consejos Adicionales para Deploys Más Rápidos

### 1. **Usar Build Cache de Fly.io**

Fly.io mantiene cache automáticamente, pero puedes forzar rebuild sin cache si es necesario:

```bash
# Rebuild sin cache (solo si hay problemas)
fly deploy --no-cache --app zig-zag-backend
```

### 2. **Deploy Solo cuando Cambie Código Relevante**

- No hacer deploy si solo cambias documentación o archivos de configuración local
- Usar `--build-only` para probar builds sin deployar:

```bash
fly deploy --build-only --app zig-zag-backend
```

### 3. **Paralelizar Deploys**

Si necesitas deployar backend y frontend:

```bash
# Terminal 1
./fly/deploy-be.sh

# Terminal 2 (en paralelo)
./fly/deploy-fe.sh
```

### 4. **Monitorear Tiempos de Build**

Revisa los logs para identificar cuellos de botella:

```bash
fly logs --app zig-zag-backend
```

### 5. **Optimizar Dependencias**

- Revisa periódicamente si hay dependencias innecesarias
- Usa `yarn why <package>` para ver qué depende de qué
- Considera usar `yarn install --production` en la imagen final (si aplica)

### 6. **Usar Build Secrets Correctamente**

- Los secrets de Fly.io NO están disponibles durante el build
- Pásalos como `--build-arg` cuando sea necesario
- Los scripts ya hacen esto automáticamente

### 7. **Considerar Build Machines Más Grandes**

Si los builds son muy lentos, puedes usar máquinas más potentes:

```toml
# En fly-be.toml o fly-fe.toml
[build]
  builder = "flyio/builders:full"  # Builder más potente
```

### 8. **Cache de Prisma**

Prisma genera el cliente en cada build. Para acelerar:

- El schema de Prisma se copia antes del código fuente
- Esto maximiza el cache cuando solo cambia el código

## Tiempos Esperados

Con estas optimizaciones, los tiempos típicos son:

- **Backend**: 3-5 minutos (primera vez), 1-3 minutos (con cache)
- **Frontend**: 4-6 minutos (primera vez), 2-4 minutos (con cache)

## Troubleshooting

### Build muy lento

1. Verifica que `.dockerignore` esté actualizado
2. Revisa si hay archivos grandes siendo copiados innecesariamente
3. Considera usar `--no-cache` una vez para limpiar cache corrupto

### Cache no funciona

1. Verifica que los archivos `package.json` y `yarn.lock` no cambien frecuentemente
2. Asegúrate de que el orden de las capas en el Dockerfile sea correcto
3. Los `--mount=type=cache` requieren BuildKit (activado por defecto en Fly.io)

### Remote builder falla

1. Verifica tu conexión a internet
2. Intenta sin `--remote-only` para usar builder local como fallback
3. Revisa los logs: `fly logs --app <app-name>`

## Próximas Optimizaciones Posibles

1. **Build en paralelo**: Si tienes múltiples servicios, deployarlos en paralelo
2. **CI/CD**: Automatizar deploys solo cuando cambie código relevante
3. **Image layers**: Usar imágenes base más pequeñas o personalizadas
4. **Dependency caching**: Cachear dependencias en un volumen compartido (avanzado)
