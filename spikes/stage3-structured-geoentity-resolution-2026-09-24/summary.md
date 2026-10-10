# Structured GeoEntity Resolution spike — per-hint summary

19 resolutions (14 corpus + 5 real-name addendum). Full raw provider payloads
and candidate lists in `matrix.json`. See `assessment.md` for the gate
verdict and root-cause analysis.

| Hint | Kind | Status | Notes |
|---|---|---|---|
| Defensa Street | ROUTE | NOT_FOUND | English gloss, no OSM match |
| Dorrego Square | PLACE | NOT_FOUND | English gloss, no OSM match |
| San Lorenzo Passage | ROUTE | NOT_FOUND | English gloss, no OSM match |
| El Zanjón de Granados | PLACE | **RESOLVED** | Clean, single Geoapify match, real category |
| Mafalda Statue | PLACE | NOT_FOUND | Valid per Group B |
| Caminito Street | ROUTE | NOT_FOUND | English gloss, no OSM match |
| Boca Juniors Stadium | PLACE | NOT_FOUND | Valid per Group B |
| Ezeiza Mansion | PLACE | NOT_FOUND | Valid per Group B |
| Galería Güemes | PLACE | AMBIGUOUS | 2 real distinct places; map_to_area never touched |
| Recoleta Cemetery | PLACE | NOT_FOUND | English gloss + structural gap (see below) |
| Plaza Dorrego | PLACE | AMBIGUOUS | Correct candidate present in the set (park) |
| San Martín | AREA | RESOLVED | **False-positive risk**: resolved to a distant, wrong partido |
| Plaza San Martín | PLACE | AMBIGUOUS | 5 real candidates across Greater Buenos Aires |
| Caminito | PLACE | AMBIGUOUS | None of the 4 is the actual attraction; safe non-answer |
| Defensa (addendum) | ROUTE | AMBIGUOUS | All 5 segments in wrong partidos, San Telmo absent |
| Pasaje San Lorenzo (addendum) | ROUTE | AMBIGUOUS | All 5 segments in Chaco/Santa Fe, San Telmo absent |
| Caminito (addendum, ROUTE) | ROUTE | AMBIGUOUS | All 4 segments in Ezeiza/La Matanza/Lomas, La Boca absent |
| Estadio Alberto J. Armando (addendum) | PLACE | **RESOLVED** | Clean, "La Bombonera", real category |
| Cementerio de la Recoleta (addendum) | PLACE | NOT_FOUND | Structural gap: `landuse=cemetery`, not `class=place` |
