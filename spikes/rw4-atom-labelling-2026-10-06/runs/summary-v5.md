| Batch | Rule | Unit | Run | Outcome | Atoms classified | 1st-pass issues | Relabel | Final issues | Per-segment mandatory recall (shadow if FAIL_CLOSED) | Segment verdicts |
|---|---|---|---|---|---|---|---|---|---|---|
| v5-batched-relabel-gemini | ENTITY_ROLES | SOB_UNIT | 1 | ASSEMBLED | 182/182 | 2 | 2 atoms | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | SOB_UNIT | 2 | CONTRACT_FAIL_CLOSED | 182/182 | 2 | 2 atoms | NAME_NOT_IN_MENTION_ATOM a-078 | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | SOB_UNIT | 3 | ASSEMBLED | 182/182 | 0 | – | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | SOB_UNIT | 4 | CONTRACT_FAIL_CLOSED | 182/182 | 6 | 6 atoms | NAME_NOT_IN_MENTION_ATOM a-078 | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | SOB_UNIT | 5 | CONTRACT_FAIL_CLOSED | 182/182 | 3 | 3 atoms | NAME_NOT_IN_MENTION_ATOM a-078 | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | AG_UNIT | 1 | ASSEMBLED | 95/95 | 1 | 1 atoms | none | S1-walk 8/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Obelisco / OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | AG_UNIT | 2 | ASSEMBLED | 95/95 | 0 | – | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | AG_UNIT | 3 | ASSEMBLED | 95/95 | 2 | 2 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | AG_UNIT | 4 | ASSEMBLED | 95/95 | 3 | 3 atoms | none | S1-walk 8/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Obelisco / OK / OK |
| v5-batched-relabel-gemini | ENTITY_ROLES | AG_UNIT | 5 | ASSEMBLED | 95/95 | 2 | 2 atoms | none | S1-walk 8/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Obelisco / OK / OK |
| v5-regression-gemini | ENTITY_ROLES | RW3_EV3 | 1 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v5-regression-gemini | ENTITY_ROLES | RW3_EV3 | 2 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v5-regression-gemini | ENTITY_ROLES | RW3_EV3 | 3 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v5-regression-gemini | ENTITY_ROLES | ROUTE_EXPERIENCE | 1 | ASSEMBLED | 6/6 | 0 | – | none | ALL 3/3 | OK |
| v5-regression-gemini | ENTITY_ROLES | ROUTE_EXPERIENCE | 2 | ASSEMBLED | 6/6 | 0 | – | none | ALL 3/3 | OK |
| v5-regression-gemini | ENTITY_ROLES | ROUTE_EXPERIENCE | 3 | ASSEMBLED | 6/6 | 0 | – | none | ALL 3/3 | OK |
