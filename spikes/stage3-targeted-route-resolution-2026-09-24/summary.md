# Targeted ROUTE resolution + AREA destination compatibility — summary

Real local Overpass (`zigzag-overpass-argentina`) and Nominatim
(`zigzag-nominatim-argentina`). Destination resolved by the real
`DestinationResolutionService`: `osm:relation:1224652` "Buenos Aires"
(admin_level 8, inside CABA `3082668`), country `AR`, acquisition radius
17 800 m (farthest corner of the destination boundary's bbox). Full raw
data: `matrix.json`. Gate verdicts and analysis: `assessment.md`.

"Correct present" = the result set contains a way of the real CABA street
(the manually verified oracle seed way, or any way topologically connected
to it). Oracle ids are evaluation-only; no resolver sees them.

## ROUTE

| Hint | Retrieval variants | Old Nominatim bare-name (status / correct present) | Nominatim structured (correct present per variant) | Targeted Overpass (status) | Clusters (total / destination-compatible) | Correct cluster present | Continuity-gap what-if (60 m) |
|---|---|---|---|---|---|---|---|
| Defensa Street | `Defensa Street`, `Defensa` | NOT_FOUND / no | no, **yes** | **RESOLVED** (14-way CABA cluster through San Telmo) | 9 / 1 | yes | RESOLVED |
| Defensa | `Defensa` | AMBIGUOUS / no (5 GBA partidos) | **yes** | **RESOLVED** (same cluster) | 9 / 1 | yes | RESOLVED |
| San Lorenzo Passage | `San Lorenzo Passage`, `San Lorenzo` | NOT_FOUND / no | no, no | AMBIGUOUS (San Telmo 3-way cluster + Flores footway) | 17 / 2 | yes | AMBIGUOUS |
| Pasaje San Lorenzo | `Pasaje San Lorenzo`, `San Lorenzo` | AMBIGUOUS / no (Chaco, Santa Fe) | no, no | AMBIGUOUS (same two CABA clusters) | 17 / 2 | yes | AMBIGUOUS |
| Caminito Street | `Caminito Street`, `Caminito` | NOT_FOUND / no | no, no | **RESOLVED** (La Boca, `way/144844726`) | 1 / 1 | yes | RESOLVED |
| Caminito | `Caminito` | AMBIGUOUS / no (Ezeiza, La Matanza, Lomas) | no | **RESOLVED** (La Boca) | 1 / 1 | yes | RESOLVED |
| Florida Street | `Florida Street`, `Florida` | NOT_FOUND / no | no, no | **RESOLVED** (8-way CABA cluster; first probed segment in Retiro) | 7 / 1 | yes | RESOLVED |
| Balcarce | `Balcarce` | AMBIGUOUS / no | no | AMBIGUOUS (one real street split into 5 non-node-sharing fragments) | 18 / 5 | yes | AMBIGUOUS (2 compatible) |
| Chile Street | `Chile Street`, `Chile` | NOT_FOUND / no | no, **yes** | AMBIGUOUS (20-way cluster + 1 detached fragment) | 5 / 2 | yes | AMBIGUOUS |
| Avenida de Mayo | `Avenida de Mayo`, `de Mayo` | AMBIGUOUS / no | **yes**, no | **RESOLVED** (14-way Monserrat cluster, found by RAW) | 3 / 1 | yes | RESOLVED |
| Pasaje Giuffra | `Pasaje Giuffra`, `Giuffra` | NOT_FOUND / no | no, **yes** | NOT_FOUND (OSM name is "Doctor José M. Giuffra") | 0 / 0 | **no** | NOT_FOUND |
| Plaza Dorrego (negative) | `Plaza Dorrego` | **RESOLVED — false positive** (La Matanza bus-stop *nodes*, `class=highway`) | no | NOT_FOUND | 0 / 0 | n/a | NOT_FOUND |
| El Zanjón de Granados (negative) | `El Zanjón de Granados` | NOT_FOUND | no | NOT_FOUND | 0 / 0 | n/a | NOT_FOUND |
| Bulevar Oroño (negative, Rosario) | `Bulevar Oroño`, `Oroño` | AMBIGUOUS (Santa Fe segments) | no, no | NOT_FOUND | 0 / 0 | n/a | NOT_FOUND |

## AREA

Destination admin hierarchy (at the destination point):
`2:Argentina → 4:Ciudad Autónoma de Buenos Aires → 5:Comuna 1 → 8:Buenos Aires (1224652) → 9:San Nicolás`.

| Hint | Candidate | Candidate admin hierarchy | Verdict | Final status |
|---|---|---|---|---|
| San Telmo | `relation/2223069` San Telmo | Argentina → CABA → Comuna 1 → Buenos Aires → San Telmo | COMPATIBLE | **RESOLVED** |
| Recoleta | `relation/2224056` Recoleta | Argentina → CABA → Comuna 2 → Buenos Aires → Recoleta | COMPATIBLE | **RESOLVED** |
| Monserrat | `relation/2222917` Monserrat | Argentina → CABA → Comuna 1 → Buenos Aires → Monserrat | COMPATIBLE | **RESOLVED** |
| Belgrano | `relation/2222180` Belgrano | Argentina → CABA → Comuna 13 → Buenos Aires → Belgrano | COMPATIBLE | **RESOLVED** |
| San Martín | `relation/9168783` Ciudad del Libertador General San Martín | Argentina → Provincia de Buenos Aires → Partido de General San Martín → Ciudad del Libertador General San Martín | INCOMPATIBLE (outside destination admin unit) | **INCOMPATIBLE** |
| La Plata | `relation/3266014` La Plata | Argentina → Provincia de Buenos Aires → Partido de La Plata → La Plata | INCOMPATIBLE | INCOMPATIBLE |
| Villa General Belgrano | `relation/3595872` | Argentina → Provincia de Buenos Aires → Partido de Lanús → Gerli → Villa General Belgrano | INCOMPATIBLE | INCOMPATIBLE |
| Fisherton | `relation/3565095` | Argentina → Santa Fe → … → Rosario → Distrito Noroeste → Fisherton | INCOMPATIBLE | INCOMPATIBLE |
| Cerro de las Rosas | `relation/4278191` (Córdoba), `relation/18615975` (Catamarca) | Argentina → Córdoba → … / Argentina → Catamarca → … | INCOMPATIBLE (both) | INCOMPATIBLE |
| Rosario | — (Nominatim's top-5 had no area-eligible object) | — | — | NOT_FOUND |
