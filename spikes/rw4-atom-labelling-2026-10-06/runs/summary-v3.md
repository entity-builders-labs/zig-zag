| Batch | Rule | Unit | Run | Outcome | Atoms classified | 1st-pass issues | Relabel | Final issues | Per-segment mandatory recall (shadow if FAIL_CLOSED) | Segment verdicts |
|---|---|---|---|---|---|---|---|---|---|---|
| v3-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 1 | ASSEMBLED | 182/182 | 1 | 1 atoms | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v3-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 2 | ASSEMBLED | 182/182 | 0 | – | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v3-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 3 | INVALID_RUN | – | – | – | – | – | The operation was aborted due to timeout |
| v3-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 4 | ASSEMBLED | 182/182 | 0 | – | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v3-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 5 | INVALID_RUN | – | – | – | – | – | The operation was aborted due to timeout |
| v3-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 1 | ASSEMBLED | 95/95 | 7 | 7 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v3-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 2 | ASSEMBLED | 95/95 | 2 | 2 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v3-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 3 | ASSEMBLED | 95/95 | 3 | 3 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v3-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 4 | ASSEMBLED | 95/95 | 1 | 1 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v3-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 5 | CONTRACT_FAIL_CLOSED | 95/95 | 7 | 7 atoms | ROLE_INCONSISTENT a-020 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v3-regression-gemini | MEMBERSHIP | RW3_EV3 | 1 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v3-regression-gemini | MEMBERSHIP | RW3_EV3 | 2 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v3-regression-gemini | MEMBERSHIP | RW3_EV3 | 3 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v3-regression-gemini | MEMBERSHIP | ROUTE_EXPERIENCE | 1 | ASSEMBLED | 6/6 | 0 | – | none | ALL 3/3 | OK |
| v3-regression-gemini | MEMBERSHIP | ROUTE_EXPERIENCE | 2 | CONTRACT_FAIL_CLOSED | 6/6 | 1 | 1 atoms | ROLE_INCONSISTENT a-003 | ALL 3/3 | OK |
| v3-regression-gemini | MEMBERSHIP | ROUTE_EXPERIENCE | 3 | ASSEMBLED | 6/6 | 0 | – | none | ALL 3/3 | OK |
