# Planner comparison (P-D5 / P-D7 evidence) — 2026-10-12

Pre-registered in `PROTOCOL.md`. Fixtures `fixtures/` (frozen; raw provider responses in `fixtures/raw/`), recorded Geoapify walk/drive matrices replayed for every solver, independent hard-constraint checker `scripts/check` (in `common.py`). Reproduce: `scripts/build_fixtures.py` → `scripts/record_travel.py` (needs `GEOAPIFY_API_KEY`; outputs already recorded) → `scripts/run_all.py` → `scripts/run_posthoc_cpsat.py` → `scripts/analyze.py` → `scripts/report.py`.

Run manifest: OR-Tools 9.15.6755, Python 3.14.6; test-only weights {'desirability_per_unit': 1000, 'walk_cost_per_min': 10, 'drive_cost_per_min': 20, 'drive_leg_cost': 100, 'opening_hours_uncertainty_penalty': 100, 'idle_cost_per_min': 0}; limits {'max_continuous_walk_min': 30, 'daily_walk_budget_min': 150}; dates ['2026-11-10', '2026-11-11', '2026-11-12']; CP-SAT {'num_workers': 1, 'random_seed': 7}; Routing {'first_solution': 'PATH_CHEAPEST_ARC', 'metaheuristic': 'GUIDED_LOCAL_SEARCH'}.

## Correctness

- 219 pre-registered runs + 15 post-hoc CP-SAT runs; every produced itinerary passed the checker (day windows, KNOWN opening windows incl. the composite's internal Mercado visit, known-closed days, travel-time consistency with the recorded matrix and chosen mode, continuous-walking limit, daily walking budget, mustInclude, duplicates, anchors).
- Hard-constraint violations by any produced Tour: **0**.
- Failures to produce a Tour when one exists: pre-registered CP-SAT (1 worker) returned UNKNOWN on 20 runs (all ~30-candidate pools in every city and LA pool 20 at dt=1).
- Explicit conflicts: S8 in all cities and LA S4 (its pre-registered must-include, the Chinese American Museum, opens Fr-Su only; trip Tue-Thu) — every solver reported the conflict; Routing/CP-SAT before solving, greedy after placement.

## Objective (test weights) / scheduled Experiences

| City | Scenario | greedy-current-walkrule | greedy-current-costmodes | greedy-insertion | routing-1s | routing-5s | cpsat-dt5 |
|---|---|---|---|---|---|---|---|
| BA | S1-normal-p10 | 6512 / 9 | 6565 / 9 | 6936 / 9 | 6680 / 9 | 6680 / 9 | 6998 / 9 |
| BA | S1-normal-p20 | 8984 / 14 | 10142 / 18 | 11598 / 19 | 11817 / 19 | 11975 / 19 | 11621 / 18 |
| BA | S1-normal-pall | 9534 / 16 | 11135 / 21 | 13648 / 26 | 13959 / 27 | 14355 / 27 | no solution |
| BA | S2-tight-hours | 8632 / 13 | 9099 / 14 | 10194 / 15 | – | 10294 / 15 | 8215 / 15 |
| BA | S3-unknown-penalize | 9534 / 16 | 11135 / 21 | 13648 / 26 | – | 14355 / 27 | no solution |
| BA | S3b-unknown-weight0 | 10434 / 16 | 12135 / 21 | 15062 / 26 | – | 15462 / 27 | no solution |
| BA | S4-mustinclude | 8160 / 13 | 12333 / 24 | 13468 / 27 | – | 13764 / 26 | 13145 / 26 |
| BA | S5-oversupply-1day | 4964 / 7 | 6179 / 9 | 6634 / 9 | – | 6696 / 9 | 6011 / 9 |
| BA | S6-spatial-walkonly-1day | 4964 / 7 | 4964 / 7 | 5706 / 8 | – | 5814 / 8 | 5604 / 8 |
| BA | S8-infeasible-must-closed | conflict (explicit) | conflict (explicit) | conflict (explicit) | – | conflict (explicit) | conflict (explicit) |
| BA | S9-anchors-none-p20 | 8984 / 14 | 10142 / 18 | 11598 / 19 | – | 11975 / 19 | 11621 / 18 |
| BA | S9-anchors-start-p20 | 8094 / 13 | 9761 / 18 | 10738 / 18 | – | 11192 / 19 | 11174 / 19 |
| BA | S9-anchors-startend-p20 | 7578 / 13 | 9024 / 18 | 10035 / 17 | – | 10421 / 18 | 9552 / 17 |
| PA | S1-normal-p10 | 5311 / 8 | 6341 / 10 | 6870 / 10 | 6896 / 10 | 6896 / 10 | 6912 / 10 |
| PA | S1-normal-p20 | 10356 / 17 | 11485 / 20 | 12664 / 20 | 12731 / 20 | 12731 / 20 | 12764 / 20 |
| PA | S1-normal-pall | 14110 / 23 | 14034 / 24 | 17405 / 28 | 17080 / 28 | 17080 / 28 | no solution |
| PA | S2-tight-hours | 7059 / 11 | 9963 / 17 | 10712 / 16 | – | 11960 / 18 | no solution |
| PA | S3-unknown-penalize | 14110 / 23 | 14034 / 24 | 17405 / 28 | – | 17080 / 28 | no solution |
| PA | S3b-unknown-weight0 | 15710 / 23 | 15634 / 24 | 18852 / 27 | – | 19250 / 28 | no solution |
| PA | S4-mustinclude | 10301 / 18 | 13384 / 24 | 16677 / 27 | – | 16995 / 28 | no solution |
| PA | S5-oversupply-1day | 3912 / 7 | 5183 / 8 | 6181 / 9 | – | 6804 / 10 | no solution |
| PA | S6-spatial-walkonly-1day | 2132 / 3 | 2132 / 3 | 5384 / 8 | – | 5801 / 9 | no solution |
| PA | S8-infeasible-must-closed | conflict (explicit) | conflict (explicit) | conflict (explicit) | – | conflict (explicit) | conflict (explicit) |
| PA | S9-anchors-none-p20 | 10356 / 17 | 11485 / 20 | 12664 / 20 | – | 12731 / 20 | 12764 / 20 |
| PA | S9-anchors-start-p20 | 9930 / 17 | 10935 / 20 | 12146 / 20 | – | 12268 / 20 | 12268 / 20 |
| PA | S9-anchors-startend-p20 | 9337 / 17 | 10256 / 20 | 10808 / 20 | – | 11560 / 20 | 11590 / 20 |
| LA | S1-normal-p10 | 2526 / 3 | 4483 / 10 | 5616 / 10 | 5660 / 10 | 5679 / 10 | 5679 / 10 |
| LA | S1-normal-p20 | 2526 / 3 | 5925 / 16 | 8495 / 20 | 9410 / 20 | 9581 / 20 | 8632 / 19 |
| LA | S1-normal-pall | 3839 / 7 | 5925 / 16 | 9824 / 22 | 9712 / 21 | 10165 / 21 | no solution |
| LA | S2-tight-hours | 3539 / 6 | 5323 / 13 | 7192 / 13 | – | 7191 / 14 | no solution |
| LA | S3-unknown-penalize | 3839 / 7 | 5925 / 16 | 9824 / 22 | – | 10165 / 21 | no solution |
| LA | S3b-unknown-weight0 | 4339 / 7 | 6725 / 16 | 10429 / 21 | – | 11028 / 22 | no solution |
| LA | S4-mustinclude | conflict (explicit) | conflict (explicit) | conflict (explicit) | – | conflict (explicit) | conflict (explicit) |
| LA | S5-oversupply-1day | 2213 / 5 | 3277 / 7 | 4287 / 8 | – | 4589 / 9 | 3594 / 8 |
| LA | S6-spatial-walkonly-1day | 2213 / 5 | 2213 / 5 | 2256 / 5 | – | 2256 / 5 | 2256 / 5 |
| LA | S8-infeasible-must-closed | conflict (explicit) | conflict (explicit) | conflict (explicit) | – | conflict (explicit) | conflict (explicit) |
| LA | S9-anchors-none-p20 | 2526 / 3 | 5925 / 16 | 8495 / 20 | – | 9581 / 20 | 8632 / 19 |
| LA | S9-anchors-start-p20 | 1443 / 3 | 5940 / 17 | 8718 / 19 | – | 8688 / 20 | 8203 / 20 |
| LA | S9-anchors-startend-p20 | 355 / 3 | 4636 / 17 | 6646 / 19 | – | 7545 / 20 | 5488 / 18 |

Reference budgets on the ~30-candidate pools: BA routing-30s 14355 / 27; PA routing-30s 17322 / 28; LA routing-30s 10218 / 22.

## Runtime (wall seconds, median / max of 3 repetitions; Routing and CP-SAT are budget-bound)

| City | Pool | greedy-current | greedy-insertion | routing-1s | routing-5s | cpsat-dt1 | cpsat-dt5 | arcs |
|---|---|---|---|---|---|---|---|---|
| BA | 10 | 0.0/0.0 | 0.001/0.001 | 1.001/1.24 | 5.004/5.005 | 0.034/0.73 optimal | 0.034/0.036 optimal | 90 |
| BA | 20 | 0.0/0.0 | 0.008/0.008 | 1.003/1.004 | 5.006/5.009 | 1.607/1.711 | 7.2/7.705 | 380 |
| BA | 29 | 0.001/0.001 | 0.028/0.028 | 1.007/1.008 | 5.01/5.012 | 1.605/1.699 (no sol.) | 6.679/6.783 (no sol.) | 812 |
| PA | 10 | 0.0/0.0 | 0.001/0.001 | 1.003/1.004 | 5.008/5.01 | 0.04/0.04 optimal | 0.045/0.05 optimal | 90 |
| PA | 20 | 0.0/0.0 | 0.014/0.015 | 1.004/1.007 | 5.004/5.005 | 0.553/0.575 optimal | 0.558/0.692 optimal | 380 |
| PA | 30 | 0.001/0.001 | 0.036/0.036 | 1.008/1.009 | 5.01/5.011 | 1.307/1.394 (no sol.) | 6.734/6.781 (no sol.) | 870 |
| LA | 10 | 0.0/0.0 | 0.001/0.001 | 1.001/1.002 | 5.005/5.007 | 0.058/0.06 optimal | 0.058/0.065 optimal | 90 |
| LA | 20 | 0.0/0.0 | 0.009/0.009 | 1.004/1.005 | 5.005/5.005 | 1.199/1.211 (no sol.) | 4.945/5.059 | 380 |
| LA | 30 | 0.0/0.0 | 0.025/0.03 | 1.007/1.01 | 5.01/5.012 | 1.327/1.379 (no sol.) | 6.156/6.649 (no sol.) | 870 |

Repeated runs were identical for every greedy, Routing and 1-worker CP-SAT configuration (Routing is time-limited GLS: identical here, but a time limit is not a deterministic stop criterion in principle).

## Post-hoc CP-SAT variants (not pre-registered; S1 ~30 candidates)

| City | Variant | Status | Objective / n | Upper bound | Hint (greedy-insertion) | Wall s (2 runs) | Identical |
|---|---|---|---|---|---|---|---|
| BA | w8-dt5 | FEASIBLE | 14209 / 27 | 15170.0 | 13648 | [7.864, 9.514] | False |
| BA | w8-dt30 | FEASIBLE | 14427 / 27 | 15169.0 | 13648 | [45.978, 54.827] | False |
| BA | w1-hint-dt5 | FEASIBLE | 13752 / 26 | 15340.0 | 13648 | [8.395, 9.32] | True |
| BA | w1-hint-dt30 | FEASIBLE | 13805 / 26 | 15340.0 | 13648 | [34.868, 33.846] | True |
| BA | w8-hint-dt5 | FEASIBLE | 13986 / 26 | 15168.0 | 13648 | [8.455, 11.328] | False |
| PA | w8-dt5 | FEASIBLE | 16677 / 28 | 18652.0 | 17405 | [8.146, 7.145] | False |
| PA | w8-dt30 | FEASIBLE | 16748 / 28 | 18652.0 | 17405 | [42.74, 41.918] | False |
| PA | w1-hint-dt5 | FEASIBLE | 17408 / 28 | 18740.0 | 17405 | [9.845, 9.613] | True |
| PA | w1-hint-dt30 | FEASIBLE | 17408 / 28 | 18740.0 | 17405 | [38.063, 37.147] | True |
| PA | w8-hint-dt5 | FEASIBLE | 17509 / 28 | 18652.0 | 17405 | [7.764, 7.187] | False |
| LA | w8-dt5 | FEASIBLE | 9748 / 21 | 12781.0 | 9824 | [9.645, 8.815] | False |
| LA | w8-dt30 | FEASIBLE | 8825 / 21 | 12757.0 | 9824 | [49.875, 43.028] | False |
| LA | w1-hint-dt5 | FEASIBLE | 9824 / 22 | 14372.0 | 9824 | [5.887, 5.969] | True |
| LA | w1-hint-dt30 | FEASIBLE | 9824 / 22 | 14372.0 | 9824 | [28.491, 26.487] | True |
| LA | w8-hint-dt5 | FEASIBLE | 9824 / 22 | 12782.0 | 9824 | [7.682, 7.823] | False |

## Representative itineraries (S1, ~30 candidates, Routing 5 s vs greedy best-insertion)

**BA — routing-5s** (objective 14355, 27 Experiences, travel 136.8 min, walking 85.1 min, idle 13.7 min, UNKNOWN-hours visits 14)

- 2026-11-10: 09:00 Cementerio de la Recoleta → 10:03 Biblioteca Nacional Mariano  [drive 2′] → 11:07 Columna del Foro Romano (hours unknown) [drive 3′] → 12:16 Jardín Botánico Carlos Thays (hours unknown) [walk 8′] → 13:23 Obelisco (hours unknown) [drive 6′] → 14:25 Catedral Metropolitana [drive 2′] → 15:32 Museo Mitre [walk 6′] → 16:35 Buque Museo Corbeta A.R.A. U [drive 2′] → 17:38 Torre de los Ingleses (hours unknown) [drive 3′]
- 2026-11-11: 09:00 El Hipopótamo (hours unknown) → 10:09 Plaza Dorrego (hours unknown) [walk 9′] → 11:16 El Zanjón de Granados (histo (hours unknown) [walk 6′] → 12:18 San Telmo walk (Defensa Chil [walk 1′] → 13:16 Club Español (hours unknown) [drive 3′] → 14:26 Palacio Barolo (hours unknown) [walk 9′] → 15:37 Confitería El Molino (hours unknown) [walk 11′] → 16:41 Casa Museo Bernardo Houssay (hours unknown) [drive 4′] → 17:50 Museo Fotográfico Simik [drive 8′]
- 2026-11-12: 09:00 Espacio Memoria y Derechos H → 10:11 Museo Sitio de Memoria ESMA [walk 10′] → 11:19 Instituto Sanmartiniano (hours unknown) [drive 8′] → 12:24 Teatro Colón [drive 5′] → 13:28 Edificio Kavanagh (hours unknown) [drive 3′] → 14:32 Manzana de las Luces [drive 3′] → 15:37 Basílica de San Francisco (hours unknown) [walk 4′] → 16:46 Museo Casa Rosada [walk 9′] → 17:57 Buque Museo Fragata A.R.A. ' [walk 11′]

**BA — greedy-insertion** (objective 13648, 26 Experiences, travel 146.8 min, walking 91.2 min, idle 12.6 min, UNKNOWN-hours visits 14)

- 2026-11-10: 09:00 Confitería El Molino (hours unknown) → 10:11 Palacio Barolo (hours unknown) [walk 11′] → 11:21 Club Español (hours unknown) [walk 9′] → 12:34 Obelisco (hours unknown) [walk 12′] → 13:44 Teatro Colón [walk 9′] → 14:49 Cementerio de la Recoleta [drive 4′] → 15:53 Casa Museo Bernardo Houssay (hours unknown) [drive 4′] → 17:02 Museo Fotográfico Simik [drive 8′]
- 2026-11-11: 09:00 Espacio Memoria y Derechos H → 10:09 Jardín Botánico Carlos Thays (hours unknown) [drive 8′] → 11:17 Columna del Foro Romano (hours unknown) [walk 8′] → 12:24 Torre de los Ingleses (hours unknown) [drive 7′] → 13:29 Museo Mitre [drive 4′] → 14:32 Edificio Kavanagh (hours unknown) [drive 2′] → 15:35 Buque Museo Corbeta A.R.A. U [drive 3′] → 16:41 Instituto Sanmartiniano (hours unknown) [drive 6′] → 17:43 Biblioteca Nacional Mariano  [drive 1′]
- 2026-11-12: 09:00 El Zanjón de Granados (histo (hours unknown) → 10:05 Museo Casa Rosada [drive 5′] → 11:16 Catedral Metropolitana [walk 11′] → 12:22 Manzana de las Luces [walk 6′] → 13:27 Basílica de San Francisco (hours unknown) [walk 4′] → 14:36 San Telmo walk (Defensa Chil [walk 9′] → 15:34 Plaza Dorrego (hours unknown) [walk 3′] → 16:45 El Hipopótamo (hours unknown) [walk 10′] → 17:49 Buque Museo Fragata A.R.A. ' [drive 3′]

**PA — routing-5s** (objective 17080, 28 Experiences, travel 168.5 min, walking 125.7 min, idle 9.5 min, UNKNOWN-hours visits 19)

- 2026-11-10: 09:00 Arc de Triomphe (hours unknown) → 09:58 Champs Élysées (hours unknown) [walk 13′] → 10:48 Musée d'Orsay [drive 5′] → 12:32 Assemblée nationale (hours unknown) [walk 14′] → 13:22 Palais de l'Élysée (hours unknown) [drive 4′] → 14:12 Opéra Garnier [drive 5′] → 15:04 Musée des Arts et Métiers [drive 7′] → 16:37 Centre Georges Pompidou (hours unknown) [drive 2′] → 18:12 Panthéon (hours unknown) [drive 4′]
- 2026-11-11: 09:00 Palais Royal (hours unknown) → 09:52 Arc de Triomphe du Carrousel (hours unknown) [walk 6′] → 10:41 Musée du Louvre (hours unknown) [walk 4′] → 12:11 Pyramide du Louvre (hours unknown) [walk 0′] → 12:58 Pont Neuf (hours unknown) [drive 2′] → 13:52 Conciergerie [walk 9′] → 15:25 Sainte-Chapelle (hours unknown) [walk 2′] → 16:20 Cathédrale Notre-Dame de Par [walk 10′] → 17:07 Université Paris 1 Panthéon- (hours unknown) [drive 1′] → 18:02 Pendule de Foucault (hours unknown) [walk 10′]
- 2026-11-12: 09:30 Église de la Madeleine → 10:26 Place Vendôme (hours unknown) [walk 10′] → 11:24 Place de la Concorde (hours unknown) [walk 12′] → 12:18 Petit Palais, Musée des beau [walk 9′] → 13:51 Musée d'Art Moderne de Paris [drive 3′] → 15:38 Tour Eiffel (hours unknown) [walk 16′] → 16:34 Champ de Mars [walk 11′] → 17:23 Hôtel des Invalides (hours unknown) [drive 4′] → 18:14 Jardin du Luxembourg (hours unknown) [drive 6′]

**PA — greedy-insertion** (objective 17405, 28 Experiences, travel 137.8 min, walking 104.2 min, idle 18.2 min, UNKNOWN-hours visits 19)

- 2026-11-10: 09:00 Jardin du Luxembourg (hours unknown) → 10:00 Musée des Arts et Métiers [drive 8′] → 11:33 Centre Georges Pompidou (hours unknown) [drive 2′] → 13:06 Conciergerie [drive 3′] → 14:39 Sainte-Chapelle (hours unknown) [walk 2′] → 15:34 Cathédrale Notre-Dame de Par [walk 10′] → 16:21 Université Paris 1 Panthéon- (hours unknown) [drive 1′] → 17:16 Panthéon (hours unknown) [walk 10′] → 18:02 Pendule de Foucault (hours unknown) [walk 0′]
- 2026-11-11: 09:00 Assemblée nationale (hours unknown) → 09:48 Hôtel des Invalides (hours unknown) [drive 3′] → 10:36 Musée d'Orsay [drive 2′] → 12:08 Arc de Triomphe du Carrousel (hours unknown) [drive 1′] → 12:57 Pyramide du Louvre (hours unknown) [walk 4′] → 13:42 Musée du Louvre (hours unknown) [walk 0′] → 15:16 Église de la Madeleine [drive 3′] → 16:13 Opéra Garnier [walk 12′] → 17:09 Place Vendôme (hours unknown) [walk 10′] → 18:08 Palais Royal (hours unknown) [walk 13′]
- 2026-11-12: 09:00 Champ de Mars → 09:56 Tour Eiffel (hours unknown) [walk 11′] → 10:55 Musée d'Art Moderne de Paris [walk 14′] → 12:31 Place de la Concorde (hours unknown) [drive 5′] → 13:25 Petit Palais, Musée des beau [walk 9′] → 15:05 Palais de l'Élysée (hours unknown) [walk 10′] → 15:52 Grand Palais (hours unknown) [drive 1′] → 17:24 Champs Élysées (hours unknown) [drive 2′] → 18:11 Arc de Triomphe (hours unknown) [drive 2′]

**LA — routing-5s** (objective 10165, 21 Experiences, travel 105.6 min, walking 35.3 min, idle 27.4 min, UNKNOWN-hours visits 9)

- 2026-11-10: 09:00 Koreatown (hours unknown) → 09:51 La Brea Tar Pits (hours unknown) [drive 6′] → 11:00 Los Angeles County Museum of [walk 4′] → 12:40 Petersen Automotive Museum [walk 9′] → 14:26 The J. Paul Getty Museum [drive 15′] → 16:03 Hammer Museum [drive 6′] → 17:39 The Playboy Mansion (hours unknown) [drive 5′]
- 2026-11-11: 09:00 Hollywood Sign (hours unknown) → 09:54 Madame Tussaud's (hours unknown) [drive 9′] → 11:27 Walk of Fame (hours unknown) [walk 2′] → 12:15 Hollywood Wax Museum [walk 3′] → 13:49 The Hollywood Museum (hours unknown) [walk 4′] → 15:27 Hollyhock House (hours unknown) [drive 8′] → 17:07 Griffith Observatory [drive 10′]
- 2026-11-12: 09:30 Natural History Museum of Lo → 11:09 California Science Center [walk 9′] → 12:46 Grammy Museum [drive 7′] → 14:18 1100 Wilshire (hours unknown) [drive 2′] → 15:06 The Broad Museum [drive 2′] → 16:37 Museum of Contemporary Art [drive 0′] → 18:12 Angels Flight [walk 5′]

**LA — greedy-insertion** (objective 9824, 22 Experiences, travel 146.8 min, walking 34.9 min, idle 17.2 min, UNKNOWN-hours visits 10)

- 2026-11-10: 09:00 Koreatown (hours unknown) → 10:00 Petersen Automotive Museum [drive 7′] → 11:39 La Brea Tar Pits (hours unknown) [walk 9′] → 12:29 Los Angeles County Museum of [walk 4′] → 14:08 Walk of Fame (hours unknown) [drive 8′] → 14:56 Hollywood Wax Museum [walk 3′] → 16:30 The Hollywood Museum (hours unknown) [walk 4′] → 18:09 Hollywood Sign (hours unknown) [drive 8′]
- 2026-11-11: 09:00 Santa Monica Pier (hours unknown) → 10:01 The J. Paul Getty Museum [drive 16′] → 11:38 Hammer Museum [drive 6′] → 13:14 The Playboy Mansion (hours unknown) [drive 5′] → 14:08 Museum of Tolerance (hours unknown) [drive 8′] → 15:45 Academy Museum of Motion Pic [drive 6′] → 17:29 Lucas Museum of Narrative Ar (hours unknown) [drive 13′]
- 2026-11-12: 09:00 1100 Wilshire (hours unknown) → 09:53 Natural History Museum of Lo [drive 7′] → 11:30 Grammy Museum [drive 6′] → 13:03 The Broad Museum [drive 3′] → 14:43 Angels Flight [walk 10′] → 15:34 Museum of Contemporary Art [walk 6′] → 17:21 Griffith Observatory [drive 16′]

