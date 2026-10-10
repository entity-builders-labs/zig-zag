| Batch | Rule | Unit | Run | Outcome | Atoms classified | 1st-pass issues | Relabel | Final issues | Per-segment mandatory recall (shadow if FAIL_CLOSED) | Segment verdicts |
|---|---|---|---|---|---|---|---|---|---|---|
| v4-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 1 | ASSEMBLED | 182/182 | 7 | 7 atoms | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v4-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 2 | ASSEMBLED | 182/182 | 0 | – | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v4-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 3 | INVALID_RUN | – | – | – | – | – | The operation was aborted due to timeout |
| v4-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 4 | ASSEMBLED | 182/182 | 7 | 7 atoms | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v4-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 5 | ASSEMBLED | 182/182 | 9 | 9 atoms | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v4-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 1 | CONTRACT_FAIL_CLOSED | 95/95 | 5 | 5 atoms | ROLE_INCONSISTENT a-068 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v4-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 2 | ASSEMBLED | 95/95 | 1 | 1 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v4-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 3 | CONTRACT_FAIL_CLOSED | 95/95 | 1 | 1 atoms | NAME_NOT_IN_MENTION_ATOM a-043 | S1-walk 8/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Obelisco / OK / OK |
| v4-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 4 | ASSEMBLED | 95/95 | 3 | 3 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v4-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 5 | ASSEMBLED | 95/95 | 1 | 1 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v4-regression-gemini | MEMBERSHIP | RW3_EV3 | 1 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v4-regression-gemini | MEMBERSHIP | RW3_EV3 | 2 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v4-regression-gemini | MEMBERSHIP | RW3_EV3 | 3 | ASSEMBLED | 2/2 | 0 | – | none | ALL 4/4 | OK |
| v4-regression-gemini | MEMBERSHIP | ROUTE_EXPERIENCE | 1 | CONTRACT_FAIL_CLOSED | 6/6 | 1 | 1 atoms | ROLE_INCONSISTENT a-003 | ALL 3/3 | OK |
| v4-regression-gemini | MEMBERSHIP | ROUTE_EXPERIENCE | 2 | CONTRACT_FAIL_CLOSED | 6/6 | 1 | 1 atoms | ROLE_INCONSISTENT a-003 | ALL 3/3 | OK |
| v4-regression-gemini | MEMBERSHIP | ROUTE_EXPERIENCE | 3 | ASSEMBLED | 6/6 | 0 | – | none | ALL 3/3 | OK |
