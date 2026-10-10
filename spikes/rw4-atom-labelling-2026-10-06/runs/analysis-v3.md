
## v3-batched-relabel-gemini (8 valid runs)

### SOB_UNIT
| Oracle MANDATORY item | run 1 (A) | run 2 (A) | run 4 (A) |
|---|---|---|---|
| Plaza de Mayo | STOP@a-002 | STOP@a-002 | STOP@a-002 |
| Casa Rosada | STOP@a-004 | STOP@a-009 | STOP@a-009 |
| Cabildo | STOP@a-004 | STOP@a-020 | STOP@a-020 |
| Catedral Metropolitana | STOP@a-004 | STOP@a-022 | STOP@a-022 |
| Mercado de San Telmo | a-055:PASS_BY a-060:NON_ITINERARY a-061:PASS_BY | a-055:PASS_BY a-060:NON_ITINERARY a-061:PASS_BY | a-055:PASS_BY a-060:NON_ITINERARY a-061:PASS_BY |
| Plaza Dorrego | STOP@a-061 | STOP@a-061 | STOP@a-061 |
| Parque Lezama | STOP@a-073 | STOP@a-073 | STOP@a-073 |
| Museo Histórico Nacional | STOP@a-079 | STOP@a-079 | STOP@a-079 |
| Caminito | STOP@a-090 | STOP@a-090 | STOP@a-090 |
| La Bombonera | STOP@a-098 | STOP@a-098 | STOP@a-098 |

Alternatives (oracle ALTERNATIVE → emitted role per run):

Per run: ACCEPTABLE promoted to mandatory / non-oracle mandatory names / segment openers:
- run 1: promoted [National Bank, Defensa, Estados Unidos, Bar Sur, Museum of Modern Arts, Club Atlético, Avenida Caseros, Boca]; not-in-oracle [Feria San Telmo, oldest neighborhood of the capital city]; segments {start: 19m} {a-085:BUS+a-086:TAXI: 3m} {a-105:BUS: 0m}; reasons OK / OK
- run 2: promoted [Bar Sur, Museum of Modern Arts, Club Atlético, Avenida Caseros, Boca, La Boca]; not-in-oracle [Feria San Telmo, oldest neighborhood of the capital city]; segments {start: 15m} {a-085:BUS+a-086:TAXI: 4m} {a-105:BUS: 0m}; reasons OK / OK
- run 4: promoted [Defensa, Estados Unidos, Bar Sur, Museum of Modern Arts, Club Atlético, Avenida Caseros, Boca]; not-in-oracle [Feria San Telmo, neighborhood, San Telmo, big building]; segments {start: 19m} {a-085:BUS+a-086:TAXI: 3m} {a-105:BUS: 0m}; reasons OK / OK

### AG_UNIT
| Oracle MANDATORY item | run 1 (A) | run 2 (A) | run 3 (A) | run 4 (A) | run 5 (FC) |
|---|---|---|---|---|---|
| Teatro Colón | STOP@a-010 | STOP@a-010 | STOP@a-011 | STOP@a-010 | STOP@a-010 |
| Obelisco | STOP@a-012 | STOP@a-012 | STOP@a-012 | STOP@a-012 | STOP@a-012 |
| Plaza de Mayo | STOP@a-012 | STOP@a-012 | STOP@a-012 | STOP@a-012 | STOP@a-012 |
| Farmacia La Estrella | STOP@a-028 | STOP@a-028 | STOP@a-028 | STOP@a-028 | STOP@a-028 |
| Librería de Ávila | STOP@a-031 | STOP@a-031 | STOP@a-031 | STOP@a-031 | STOP@a-031 |
| Monumento de Mafalda | STOP@a-034 | STOP@a-034 | STOP@a-034 | STOP@a-034 | STOP@a-034 |
| Casa Mínima | STOP@a-038 | STOP@a-038 | STOP@a-038 | STOP@a-038 | STOP@a-038 |
| Mercado de San Telmo | STOP@a-040 | STOP@a-040 | STOP@a-040 | STOP@a-040 | STOP@a-040 |
| El Patio de los Ezeiza | STOP@a-053 | STOP@a-053 | STOP@a-053 | STOP@a-053 | STOP@a-053 |
| Caminito | STOP@a-058 | STOP@a-058 | STOP@a-058 | STOP@a-058 | STOP@a-058 |
| Puente de la Mujer | STOP@a-070 | STOP@a-070 | STOP@a-070 | STOP@a-070 | STOP@a-070 |

Alternatives (oracle ALTERNATIVE → emitted role per run):
- Café Tortoni: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- London City: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Alfonso: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Nuestra Parrilla: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Coffee Town: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Saigón: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Desnivel: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Trade Sky Bar: ALTERNATIVE, ITINERARY_STOP, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE

Per run: ACCEPTABLE promoted to mandatory / non-oracle mandatory names / segment openers:
- run 1: promoted [Congress building, Casa Rosada, Cathedral, Cabildo, Defensa Street, Museum of the city, Don Carlos, Puerto Madero]; not-in-oracle [Subte station "Tribunales", Plaza, San Telmo, a house in Chile 371, La Boca]; segments {start: 19m} {a-058:BUS+a-059:BUS: 4m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m}; reasons OK / OK / OK
- run 2: promoted [Casa Rosada, Cathedral, Cabildo, Museum of the city, Don Carlos, Puerto Madero]; not-in-oracle [San Telmo]; segments {a-010:METRO: 14m} {a-058:BUS+a-059:BUS: 3m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 1m}; reasons OK / OK / OK
- run 3: promoted [Congress building, Casa Rosada, Cathedral, Cabildo, Defensa Street, Galería Solar, Don Carlos, Puerto Madero]; not-in-oracle [Subte station "Tribunales", Plaza, San Telmo, a house in Chile 371, La Boca]; segments {a-010:METRO: 19m} {a-058:UNSPECIFIED+a-059:BUS: 4m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m}; reasons OK / OK / OK
- run 4: promoted [Congress building, Casa Rosada, Cathedral, Cabildo, Defensa Street, "Don Carlos", Puerto Madero]; not-in-oracle [Plaza, San Telmo, Chile 371]; segments {start: 17m} {a-058:BUS+a-059:BUS: 4m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m}; reasons OK / OK / OK
- run 5: promoted [Casa Rosada, Cathedral, Cabildo, Defensa Street, Museum of the city, "Don Carlos", Puerto Madero]; not-in-oracle [Plaza, San Telmo]; segments {start: 16m} {a-058:BUS+a-059:BUS: 4m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m}; reasons OK / OK / OK
