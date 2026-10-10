| Batch | Rule | Unit | Run | Outcome | Atoms classified | 1st-pass issues | Relabel | Final issues | Per-segment mandatory recall (shadow if FAIL_CLOSED) | Segment verdicts |
|---|---|---|---|---|---|---|---|---|---|---|
| smoke-v1-gemini | STRICT | SOB_UNIT | 1 | FAIL_CLOSED | 182/182 | 8 | – | ROLE_INCONSISTENT a-037; ROLE_INCONSISTENT a-039; ROLE_INCONSISTENT a-049; ROLE_INCONSISTENT a-056; ROLE_INCONSISTENT a-063; ROLE_INCONSISTENT a-078; ROLE_INCONSISTENT a-079; ROLE_INCONSISTENT a-084 | S1-walk 3/8, S2-la-boca 2/2 | MISSING_MANDATORY:Casa Rosada|Cabildo|Mercado de San Telmo|Parque Lezama|Museo Histórico Nacional / OK |
| smoke-v1-gemini | STRICT | AG_UNIT | 1 | FAIL_CLOSED | 95/95 | 3 | – | ROLE_INCONSISTENT a-045; ROLE_INCONSISTENT a-074; NAME_NOT_IN_SPAN a-076 | S1-walk 8/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Obelisco,SEGMENT_MIXED:Caminito / OK / OK |
| smoke-v1-gemini | MEMBERSHIP | SOB_UNIT | 1 | FAIL_CLOSED | 182/182 | 3 | – | STOP_WITHOUT_ENTITY a-056; STOP_WITHOUT_ENTITY a-078; STOP_WITHOUT_ENTITY a-079 | S1-walk 3/8, S2-la-boca 2/2 | MISSING_MANDATORY:Casa Rosada|Cabildo|Mercado de San Telmo|Parque Lezama|Museo Histórico Nacional / OK |
| smoke-v1-gemini | MEMBERSHIP | AG_UNIT | 1 | FAIL_CLOSED | 95/95 | 1 | – | NAME_NOT_IN_SPAN a-076 | S1-walk 8/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Obelisco,SEGMENT_MIXED:Caminito / OK / OK |
| v2-single-gemini | STRICT | SOB_UNIT | 1 | INVALID_RUN | – | – | – | – | – | no raw output recorded (INVALID_RUN at capture time) |
| v2-single-gemini | STRICT | SOB_UNIT | 2 | INVALID_RUN | – | – | – | – | – | no raw output recorded (INVALID_RUN at capture time) |
| v2-single-gemini | STRICT | SOB_UNIT | 3 | INVALID_RUN | – | – | – | – | – | no raw output recorded (INVALID_RUN at capture time) |
| v2-single-gemini | STRICT | SOB_UNIT | 4 | FAIL_CLOSED | 182/182 | 2 | – | SPAN_NOT_IN_ATOM a-074; NAME_NOT_IN_MENTION_ATOM a-078 | S1-walk 7/8, S2-la-boca 2/2 | MISSING_MANDATORY:Parque Lezama / OK |
| v2-single-gemini | STRICT | SOB_UNIT | 5 | FAIL_CLOSED | 182/182 | 3 | – | SPAN_NOT_IN_ATOM a-055; SPAN_NOT_IN_ATOM a-073; NAME_NOT_IN_MENTION_ATOM a-078 | S1-walk 7/8, S2-la-boca 2/2 | MISSING_MANDATORY:Parque Lezama / OK |
| v2-single-gemini | STRICT | AG_UNIT | 1 | FAIL_CLOSED | 95/95 | 2 | – | ROLE_INCONSISTENT a-064; ROLE_INCONSISTENT a-074 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-single-gemini | STRICT | AG_UNIT | 2 | FAIL_CLOSED | 95/95 | 2 | – | ROLE_INCONSISTENT a-074; SPAN_NOT_IN_ATOM a-076 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-single-gemini | STRICT | AG_UNIT | 3 | FAIL_CLOSED | 95/95 | 4 | – | ROLE_INCONSISTENT a-045; ROLE_INCONSISTENT a-074; SPAN_NOT_IN_ATOM a-029; SPAN_NOT_IN_ATOM a-076 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-single-gemini | STRICT | AG_UNIT | 4 | FAIL_CLOSED | 95/95 | 4 | – | ROLE_INCONSISTENT a-043; ROLE_INCONSISTENT a-045; ROLE_INCONSISTENT a-072; ROLE_INCONSISTENT a-074 | S1-walk 6/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Teatro Colón|Obelisco|Plaza de Mayo / OK / OK |
| v2-single-gemini | STRICT | AG_UNIT | 5 | FAIL_CLOSED | 95/95 | 4 | – | ROLE_INCONSISTENT a-032; ROLE_INCONSISTENT a-073; ROLE_INCONSISTENT a-074; SPAN_NOT_IN_ATOM a-029 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-single-gemini | MEMBERSHIP | SOB_UNIT | 1 | INVALID_RUN | – | – | – | – | – | no raw output recorded (INVALID_RUN at capture time) |
| v2-single-gemini | MEMBERSHIP | SOB_UNIT | 2 | INVALID_RUN | – | – | – | – | – | no raw output recorded (INVALID_RUN at capture time) |
| v2-single-gemini | MEMBERSHIP | SOB_UNIT | 3 | INVALID_RUN | – | – | – | – | – | no raw output recorded (INVALID_RUN at capture time) |
| v2-single-gemini | MEMBERSHIP | SOB_UNIT | 4 | FAIL_CLOSED | 182/182 | 2 | – | SPAN_NOT_IN_ATOM a-074; NAME_NOT_IN_MENTION_ATOM a-078 | S1-walk 7/8, S2-la-boca 2/2 | MISSING_MANDATORY:Parque Lezama / OK |
| v2-single-gemini | MEMBERSHIP | SOB_UNIT | 5 | FAIL_CLOSED | 182/182 | 3 | – | SPAN_NOT_IN_ATOM a-055; SPAN_NOT_IN_ATOM a-073; NAME_NOT_IN_MENTION_ATOM a-078 | S1-walk 7/8, S2-la-boca 2/2 | MISSING_MANDATORY:Parque Lezama / OK |
| v2-single-gemini | MEMBERSHIP | AG_UNIT | 1 | ASSEMBLED | 95/95 | 0 | – | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-single-gemini | MEMBERSHIP | AG_UNIT | 2 | FAIL_CLOSED | 95/95 | 1 | – | SPAN_NOT_IN_ATOM a-076 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-single-gemini | MEMBERSHIP | AG_UNIT | 3 | FAIL_CLOSED | 95/95 | 2 | – | SPAN_NOT_IN_ATOM a-029; SPAN_NOT_IN_ATOM a-076 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-single-gemini | MEMBERSHIP | AG_UNIT | 4 | FAIL_CLOSED | 95/95 | 1 | – | STOP_WITHOUT_ENTITY a-072 | S1-walk 6/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Teatro Colón|Obelisco|Plaza de Mayo / OK / OK |
| v2-single-gemini | MEMBERSHIP | AG_UNIT | 5 | FAIL_CLOSED | 95/95 | 3 | – | STOP_WITHOUT_ENTITY a-032; STOP_WITHOUT_ENTITY a-073; SPAN_NOT_IN_ATOM a-029 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 1 | ASSEMBLED | 182/182 | 1 | 1 atoms | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 2 | FAIL_CLOSED | 182/182 | 2 | 2 atoms | NAME_NOT_IN_SPAN a-039 | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 3 | FAIL_CLOSED | 182/182 | 1 | 1 atoms | NAME_NOT_IN_MENTION_ATOM a-041 | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 4 | ASSEMBLED | 182/182 | 1 | 1 atoms | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | SOB_UNIT | 5 | ASSEMBLED | 182/182 | 4 | 4 atoms | none | S1-walk 8/8, S2-la-boca 2/2 | OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 1 | ASSEMBLED | 95/95 | 5 | 5 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 2 | ASSEMBLED | 95/95 | 1 | 1 atoms | none | S1-walk 8/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | MISSING_MANDATORY:Obelisco / OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 3 | ASSEMBLED | 95/95 | 3 | 3 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 4 | FAIL_CLOSED | 95/95 | 3 | 3 atoms | SPAN_NOT_IN_ATOM a-076 | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
| v2-batched-relabel-gemini | MEMBERSHIP | AG_UNIT | 5 | ASSEMBLED | 95/95 | 3 | 3 atoms | none | S1-walk 9/9, S2-la-boca 1/1, S3-puerto-madero 1/1 | OK / OK / OK |
