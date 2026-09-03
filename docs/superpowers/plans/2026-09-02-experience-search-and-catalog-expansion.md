# Experience Search & Catalog Expansion

**Repositorio:** `jiseruk/zig-zag`  
**Plan relacionado:** Experience Domain V2  
**Estado:** diferido para ejecutar después del cierre del recovery plan actual

## Objetivo

Construir un buscador de `Experience` orientado a producto, conceptualmente similar a Viator: el usuario elige un destino, aplica filtros propios de las Experiences, consulta primero el catálogo persistido y, opcionalmente, pide ampliar resultados mediante grounded discovery. Las Experiences descubiertas pasan por el pipeline V2 normal y quedan reutilizables en el catálogo.

Este plan reemplaza el concepto anterior de `CatalogPopulationJob` como feature principal. Poblar el catálogo no es un dominio separado: es un efecto natural de adquirir Experiences durante una búsqueda.

## Invariantes

- `Experience` sigue siendo la única unidad planificable.
- `GeoEntity` sigue limitado a `PLACE | AREA | ROUTE`.
- No crear una entidad `CatalogPopulation`, un pipeline paralelo ni un planner nuevo.
- Buscar Experiences no crea un `Tour` automáticamente.
- Grounded search descubre candidatos, pero no decide resultados finales ni arma itinerarios.
- Todo candidato externo pasa por el pipeline V2 estándar: `extract → resolve → geographic validation → dedupe → persist → embedding → requery`.
- El catálogo local es siempre la primera fuente.
- Los filtros de búsqueda son propiedades/intenciones de Experience; no deben mezclarse con restricciones específicas de un Tour.

## 1. Experience Search

El producto debe exponer una búsqueda por destino similar a:

```text
Destino: Mendoza

Filtros:
- themes: wine, gastronomy, culture, outdoor, art, etc.
- traits: accessible, family-friendly, vegan-friendly, etc.
- intents/facets: visit, walk, route, food, nightlife, day_trip, etc.
- duración mínima/máxima
- precio mínimo/máximo
- free text
- exclusiones
```

No pertenecen a este contrato:

- cantidad de días del Tour;
- pace del itinerario;
- hora de comienzo de los días;
- movilidad del Tour;
- distribución por día;
- cantidad de Experiences por día;
- restricciones internas del planner.

### Contrato orientativo

```ts
interface ExperienceSearchRequest {
  destination: DestinationRef;
  filters?: {
    themes?: string[];
    traits?: string[];
    intents?: string[];
    duration?: {
      minMinutes?: number;
      maxMinutes?: number;
    };
    price?: {
      min?: number;
      max?: number;
    };
    freeText?: string;
    exclusions?: string[];
  };
  discovery?: {
    mode: 'catalog_only' | 'catalog_then_grounded';
  };
  pagination?: {
    limit: number;
    cursor?: string;
  };
}
```

La forma final del contrato debe reutilizar vocabulario y tipos V2 existentes cuando corresponda; no duplicar enums/facets ya modelados.

## 2. Catalog-first

Una búsqueda normal debe ser:

```text
ExperienceSearchRequest
  → resolver destino
  → consultar catálogo verificado
  → aplicar filtros/scoring determinísticos
  → paginar
  → devolver resultados
```

No debe invocarse grounded discovery por defecto sólo porque existan pocos resultados, salvo que el request lo autorice expresamente o el producto defina un modo equivalente de expansión.

La respuesta debe distinguir resultados ya existentes del catálogo de aquellos adquiridos durante la expansión.

## 3. “Buscar más experiencias”

El usuario puede pedir explícitamente ampliar la búsqueda.

```text
catálogo actual
  ↓
usuario: Buscar más experiencias
  ↓
grounded discovery enfocado en destino + filtros
  ↓
extracción tipada
  ↓
resolución de GeoEntities
  ↓
validación geográfica
  ↓
dedupe SAME | NEW | AMBIGUOUS
  ↓
persistencia
  ↓
embedding
  ↓
requery del catálogo
  ↓
resultados actualizados
```

No persistir candidatos sin evidencia/resolución/validación. No etiquetar requested themes/intents como hechos demostrados si la evidencia no los soporta.

## 4. Free-text

El free-text puede reutilizar el mecanismo V2 de interpretación de preferencias:

```text
"quiero bodegas pequeñas y evitar lugares demasiado turísticos"
```

El LLM interpreta la intención en una estructura tipada. La aplicación de filtros, penalties y ranking posterior es determinística.

## 5. Day trips

`day_trip` es sólo otro intent/facet de Experience.

Para búsquedas normales:

```text
destination = Buenos Aires
intent = culture
→ experiences IN Buenos Aires
```

Para `day_trip`:

```text
destination = Buenos Aires
intent = day_trip
→ same-day experiences / escapadas FROM Buenos Aires
```

La semántica especial pertenece al grounded query/prompt builder. No existe `DayTrip`, `DayTripService`, queue, job, planner o persistencia separados.

## 6. Seleccionar Experiences y crear un Tour

El usuario puede seleccionar una o más Experiences de los resultados y luego pedir crear un Tour con ellas.

El Tour usa el mismo pipeline y planner determinístico existente. La selección se expresa como constraints sobre IDs de Experiences, no creando otro modelo de Tour.

Contrato orientativo:

```ts
experienceSelection: {
  selectedIds: string[];
  mode: 'required' | 'required_and_fill' | 'preferred';
}
```

Semántica:

- `required`: incluir únicamente/obligatoriamente las seleccionadas si son temporal y geográficamente factibles.
- `required_and_fill`: las seleccionadas son obligatorias y el planner completa huecos con otras Experiences compatibles. Este es el candidato a default de producto.
- `preferred`: seleccionadas como fuerte preferencia, pero no hard constraint.

El planner determina días, orden, horarios y routing. Un LLM nunca decide cómo componer el Tour.

## 7. UI orientativa

```text
Experiencias en Mendoza

[Wine] [Gastronomy] [Culture] [Outdoor] [Family] [Accessible] ...

[resultado Experience]
[Seleccionar]

...

[Buscar más experiencias]

Seleccionadas: 4
[Crear tour con seleccionadas]
```

El wizard de Tour y el buscador de Experiences pueden compartir vocabulario de preferences/facets, pero no deben compartir campos que sólo tengan sentido para planificación de Tours.

## 8. Administración / prewarm

Si más adelante hace falta precargar un destino desde administración, el admin debe ser otro cliente del mismo motor de búsqueda/adquisición, por ejemplo:

```text
Admin prewarm Mendoza + wine + gastronomy
  → Experience acquisition/search pipeline
```

No reintroducir un dominio `CatalogPopulationJob` salvo que exista una necesidad operativa demostrada de scheduling/job management independiente. Aun en ese caso, el job debe orquestar el mismo motor y no implementar acquisition por su cuenta.

## 9. Observabilidad

Para expansión grounded registrar de forma auditable:

- request canónico;
- query/prompt exacto;
- provider/model;
- raw response;
- evidence;
- candidates extracted;
- resolución geográfica;
- rechazos;
- dedupe decisions;
- persisted/reused IDs;
- embedding outcome;
- requery result counts;
- redaction centralizada de secretos.

## 10. Acceptance scenarios

Como mínimo:

1. Mendoza + wine/gastronomy encuentra Experiences existentes sin llamar grounded search cuando `catalog_only`.
2. La misma búsqueda en modo de expansión ejecuta discovery, persiste sólo candidatos válidos y reconsulta el catálogo.
3. Un candidato SAME reutiliza/enriquece la Experience existente; AMBIGUOUS no fusiona destructivamente.
4. Free-text negativo se interpreta, pero el filtrado/ranking es determinístico.
5. `day_trip` desde Buenos Aires produce queries de escapadas de un día desde Buenos Aires y usa el mismo pipeline V2.
6. Seleccionar Experiences y crear Tour no duplica Experiences y produce `TourExperience` snapshots normales.
7. `required_and_fill` conserva las seleccionadas factibles y completa con catálogo.
8. Repetir la misma expansión no genera duplicados.
9. Una caída del grounded provider no elimina resultados locales existentes ni corrompe catálogo.
10. Ningún endpoint de búsqueda crea Tour hasta que el usuario lo pide explícitamente.

## Fuera de alcance inicial

- marketplace/checkout/reservas de terceros;
- disponibilidad o precios en tiempo real de Viator/GetYourGuide;
- nuevo modelo DayTrip;
- nuevo planner;
- recomendación LLM del itinerario;
- importación masiva administrativa como dominio independiente.

## Gate de diseño

Antes de implementar este plan, cerrar el Experience Domain V2 recovery plan actual y partir de un HEAD con sus gates verdes. Este documento debe ejecutarse como trabajo posterior, no mezclarse con el cierre del refactor V2.