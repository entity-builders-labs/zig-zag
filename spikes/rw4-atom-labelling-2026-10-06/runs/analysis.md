
## v2-batched-relabel-gemini (10 valid runs)

### SOB_UNIT
| Oracle MANDATORY item | run 1 (A) | run 2 (FC) | run 3 (FC) | run 4 (A) | run 5 (A) |
|---|---|---|---|---|---|
| Plaza de Mayo | STOP@a-002 | STOP@a-002 | STOP@a-002 | STOP@a-002 | STOP@a-002 |
| Casa Rosada | STOP@a-009 | STOP@a-009 | STOP@a-009 | STOP@a-009 | STOP@a-009 |
| Cabildo | STOP@a-020 | STOP@a-020 | STOP@a-020 | STOP@a-020 | STOP@a-020 |
| Catedral Metropolitana | STOP@a-022 | STOP@a-022 | STOP@a-022 | STOP@a-022 | STOP@a-022 |
| Mercado de San Telmo | a-055:PASS_BY a-060:NON_ITINERARY a-061:ITINERARY_STOP | a-055:PASS_BY a-060:NON_ITINERARY a-061:ITINERARY_STOP | a-055:PASS_BY a-060:NON_ITINERARY a-061:ITINERARY_STOP | a-055:PASS_BY a-060:NON_ITINERARY a-061:ITINERARY_STOP | a-055:PASS_BY a-060:NON_ITINERARY a-061:ITINERARY_STOP |
| Plaza Dorrego | STOP@a-061 | STOP@a-061 | STOP@a-061 | STOP@a-061 | STOP@a-061 |
| Parque Lezama | STOP@a-073 | STOP@a-073 | STOP@a-073 | STOP@a-073 | STOP@a-073 |
| Museo Histórico Nacional | STOP@a-079 | STOP@a-079 | STOP@a-079 | STOP@a-079 | STOP@a-079 |
| Caminito | STOP@a-090 | STOP@a-090 | STOP@a-090 | STOP@a-090 | STOP@a-090 |
| La Bombonera | STOP@a-098 | STOP@a-098 | STOP@a-098 | STOP@a-098 | STOP@a-098 |

Alternatives (oracle ALTERNATIVE → emitted role per run):

Per run: ACCEPTABLE promoted to mandatory / non-oracle mandatory names / segment openers:
- run 1: promoted [Defensa, Estados Unidos, Bar Sur, Museum of Modern Arts, Club Atlético, Boca]; not-in-oracle [Feria San Telmo, oldest neighborhood of the capital city]; segments {start: 16m} {a-085:BUS+a-086:TAXI: 3m} {a-105:BUS: 0m}; reasons OK / OK
- run 2: promoted [Defensa, Estados Unidos, Bar Sur, Paseo de Colon]; not-in-oracle [Feria San Telmo]; segments {start: 14m} {a-085:BUS+a-086:TAXI: 2m} {a-105:BUS: 0m}; reasons OK / OK
- run 3: promoted [Defensa, Estados Unidos, Bar Sur, Museum of Modern Arts, Boca]; not-in-oracle [Feria San Telmo, oldest neighborhood of the capital city, big building with columns]; segments {start: 16m} {a-085:BUS+a-086:TAXI: 3m} {a-105:BUS: 0m}; reasons OK / OK
- run 4: promoted [Defensa, Estados Unidos, Bar Sur, Museum of Modern Arts, Club Atlético, Boca]; not-in-oracle [Feria San Telmo, neighborhood, big building with columns]; segments {start: 17m} {a-085:BUS+a-086:TAXI: 3m} {a-105:BUS: 0m}; reasons OK / OK
- run 5: promoted [Defensa, Estados Unidos, Bar Sur, Paseo de Colon, Museum of Modern Arts, Boca]; not-in-oracle [Mausoleum of General San Martín, Feria San Telmo, restaurants, oldest neighborhood of the capital city, big building with columns]; segments {start: 19m} {a-085:BUS+a-086:TAXI: 3m} {a-105:BUS: 0m}; reasons OK / OK

### AG_UNIT
| Oracle MANDATORY item | run 1 (A) | run 2 (A) | run 3 (A) | run 4 (FC) | run 5 (A) |
|---|---|---|---|---|---|
| Teatro Colón | STOP@a-010 | STOP@a-010 | STOP@a-010 | STOP@a-010 | STOP@a-010 |
| Obelisco | STOP@a-012 | a-012:PASS_BY | STOP@a-012 | STOP@a-012 | STOP@a-012 |
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
- Nuestra Parrilla: ALTERNATIVE, OPTIONAL_STOP, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Coffee Town: ALTERNATIVE, OPTIONAL_STOP, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Saigón: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Desnivel: ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE
- Trade Sky Bar: OPTIONAL_STOP, ALTERNATIVE, ALTERNATIVE, ALTERNATIVE, OPTIONAL_STOP

Per run: ACCEPTABLE promoted to mandatory / non-oracle mandatory names / segment openers:
- run 1: promoted [Congress building, Casa Rosada, Cathedral, Cabildo, Don Carlos, Puerto Madero]; not-in-oracle [San Telmo]; segments {start: 14m} {a-058:BUS+a-059:BUS: 4m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m}; reasons OK / OK / OK
- run 2: promoted [Congress building, Casa Rosada, the Cathedral, the Cabildo, Defensa Street, Museum of the city, National School of Buenos Aires, "Don Carlos", Puerto Madero]; not-in-oracle [San Telmo]; segments {start: 16m} {a-058:BUS+a-059:BUS: 3m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m} {a-077:BUS: 0m}; reasons MISSING_MANDATORY:Obelisco / OK / OK
- run 3: promoted [Congress building, Casa Rosada, Cathedral, Cabildo, Defensa Street, "Don Carlos", Puerto Madero]; not-in-oracle [Subte station "Tribunales", Plaza, San Telmo]; segments {start: 17m} {a-058:BUS+a-059:BUS: 5m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 1m} {a-077:BUS: 0m}; reasons OK / OK / OK
- run 4: promoted [Congress building, Casa Rosada, Cathedral, Cabildo, Defensa Street, Museum of the city, "Don Carlos", Puerto Madero]; not-in-oracle [Subte station "Tribunales", San Telmo, Plaza Dorrego]; segments {start: 18m} {a-058:BUS+a-059:BUS: 4m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m}; reasons OK / OK / OK
- run 5: promoted [Congress building, Casa Rosada, the Cathedral, the Cabildo, "Don Carlos", Puerto Madero]; not-in-oracle [Subte station "Tribunales", San Telmo]; segments {start: 15m} {a-058:BUS+a-059:BUS: 3m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m}; reasons OK / OK / OK

## v2-single-gemini (7 valid runs)

### SOB_UNIT
| Oracle MANDATORY item | run 4 (FC) | run 5 (FC) |
|---|---|---|
| Plaza de Mayo | STOP@a-002 | STOP@a-002 |
| Casa Rosada | STOP@a-009 | STOP@a-009 |
| Cabildo | STOP@a-020 | STOP@a-020 |
| Catedral Metropolitana | STOP@a-022 | STOP@a-022 |
| Mercado de San Telmo | a-055:PASS_BY a-060:NON_ITINERARY a-061:PASS_BY | a-055:PASS_BY a-060:NON_ITINERARY a-061:PASS_BY |
| Plaza Dorrego | STOP@a-061 | STOP@a-061 |
| Parque Lezama | a-073:PASS_BY a-077:NON_ITINERARY a-080:PASS_BY | STOP@a-073 |
| Museo Histórico Nacional | STOP@a-079 | STOP@a-079 |
| Caminito | STOP@a-090 | STOP@a-090 |
| La Bombonera | STOP@a-098 | STOP@a-098 |

Alternatives (oracle ALTERNATIVE → emitted role per run):

Per run: ACCEPTABLE promoted to mandatory / non-oracle mandatory names / segment openers:
- run 4: promoted [Defensa, Estados Unidos, Bar Sur, Avenida San Juan, Museum of Modern Arts, Avenida Paseo Colon, Boca, La Boca]; not-in-oracle [Feria San Telmo, capital city, typical red walkway]; segments {start: 17m} {a-085:BUS+a-086:TAXI: 4m} {a-105:BUS: 0m}; reasons MISSING_MANDATORY:Parque Lezama / OK
- run 5: promoted [Defensa, Estados Unidos, Bar Sur, Avenida San Juan, Museum of Modern Arts, Avenida Paseo Colon, Boca, La Boca]; not-in-oracle [Feria San Telmo, oldest neighborhood of the capital city, big building with columns, typical red walkway]; segments {start: 18m} {a-085:BUS+a-086:TAXI: 4m} {a-105:BUS: 0m}; reasons MISSING_MANDATORY:Parque Lezama / OK

### AG_UNIT
| Oracle MANDATORY item | run 1 (A) | run 2 (FC) | run 3 (FC) | run 4 (FC) | run 5 (FC) |
|---|---|---|---|---|---|
| Teatro Colón | STOP@a-010 | STOP@a-010 | STOP@a-010 | STOP@a-010 | STOP@a-010 |
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
- Trade Sky Bar: OPTIONAL_STOP, OPTIONAL_STOP, ALTERNATIVE, OPTIONAL_STOP, OPTIONAL_STOP

Per run: ACCEPTABLE promoted to mandatory / non-oracle mandatory names / segment openers:
- run 1: promoted [Congress building, Casa Rosada, Cathedral, Cabildo, Defensa Street, Puerto Madero]; not-in-oracle [Subte station "Tribunales", Plaza, San Telmo]; segments {start: 17m} {a-058:BUS+a-059:BUS: 3m} {a-069:BUS: 2m} {a-075:TAXI+a-077:TAXI: 0m}; reasons OK / OK / OK
- run 2: promoted [Congress building, Casa Rosada, Cathedral, Cabildo, Defensa Street, Puerto Madero, Darsena Sur, Av. Int. Hernan Giralt]; not-in-oracle [Tribunales, San Telmo]; segments {start: 16m} {a-058:BUS: 2m} {a-069:BUS: 4m} {a-075:UNSPECIFIED: 0m}; reasons OK / OK / OK
- run 3: promoted [Puerto Madero]; not-in-oracle [San Telmo, LA BOCA]; segments {start: 10m} {a-058:BUS+a-059:BUS: 4m} {a-069:BUS: 2m} {a-075:UNSPECIFIED+a-077:METRO: 0m}; reasons OK / OK / OK
- run 4: promoted [Defensa Street, "Don Carlos", Puerto Madero]; not-in-oracle [San Telmo]; segments {start: 9m} {a-026:UNSPECIFIED: 8m} {a-058:BUS+a-059:BUS: 4m} {a-069:BUS: 2m} {a-075:UNSPECIFIED: 0m} {a-077:BUS: 0m}; reasons MISSING_MANDATORY:Teatro Colón|Obelisco|Plaza de Mayo / OK / OK
- run 5: promoted [Casa Rosada, Defensa Street, Puerto Madero]; not-in-oracle [San Telmo]; segments {start: 12m} {a-058:UNSPECIFIED+a-059:BUS: 3m} {a-069:BUS: 2m} {a-075:UNSPECIFIED+a-077:METRO: 0m}; reasons OK / OK / OK
