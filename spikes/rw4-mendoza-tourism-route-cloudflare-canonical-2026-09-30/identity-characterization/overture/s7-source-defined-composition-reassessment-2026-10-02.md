# RW4 S7 — Overture reassessment under source-defined composition

Status: characterization only. This document supersedes the old use of the
destination-centroid 80 km circle as an Overture candidate-admission rule. It
does not change the existing identity policy, run COLD/WARM, or persist data.

## Release check

- Accessed: 2026-10-02.
- Official STAC catalog: `https://stac.overturemaps.org/catalog.json`.
- Current release: `2026-09-23.1` (`latest: true`).
- Places schema: v2.0.0; use `taxonomy` and `basic_category`, not removed
  `categories`.
- Data path:
  `s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/`.

The official Places guide describes monthly releases, per-row upstream source
and license data, and the source licenses relevant here: CDLA-Permissive-2.0,
Apache-2.0, and CC0-1.0. Apache-derived records require NOTICE handling.

## Scope correction

The prior probe's 80 km destination-centroid circle was an
`OPERATIONAL_DATA_ACCESS_WINDOW` for the read-only remote GeoParquet query.
It is not geographic validity or identity evidence. Under §P2-18, a
ROUTE_LIKE source-defined composition with no strict anchor may retrieve an
out-of-destination candidate from a country-bounded provider query and remains
subject to normal identity verification and source-composition support.

## Fixture results

| Hint | Acquisition | Existing verifier | Result |
| --- | --- | --- | --- |
| Alfa Crux | Exact unique record `79eb9ee4-0591-49f3-a077-51a7926a3ada`; Meta `113197860037852`, CDLA-Permissive-2.0 | `EXACT_NAME` / `SINGLE` → `VERIFIED` | Useful candidate; group website and shared phone are not needed or treated as identity. |
| SuperUco | Exact unique record `753ed444-8e83-4178-8ad3-a05e9a28b7c5`; Meta `276131252581993`, CDLA-Permissive-2.0 | `EXACT_NAME` / `SINGLE` → `VERIFIED` | Useful candidate; the shared source/provider domain is recorded provenance, not a verifier shortcut. |
| Bodega Azul | No provider-declared exact name. `Bodega La Azul` is a non-authorized query variant and has multiple records, including winery `d97a65d2-7613-41eb-ab26-fc577699f26d` and a store sharing website/phone. | No exact/declared-alias/address evidence for source hint → `INSUFFICIENT_EVIDENCE`; the alternate spelling's exact pool is `MULTIPLE` → `AMBIGUOUS`. | Unverified. Required corroboration: a provider-declared alias or a unique, component-bound independent address/identity fact. Website, phone, brand, and proximity cannot collapse facilities. |
| A16 | No exact candidate. Broad related results include distinct facilities and two unconflated Bodega A16 records. | No evidence → `INSUFFICIENT_EVIDENCE` | Fail closed. |

All four rows retain release, Overture feature ID, upstream dataset/provider,
upstream record ID where supplied, license, and upstream update time. Overture
GERS IDs remain provider-native identities only; they are never cross-provider
identity proof.

## S7 verdict

```text
OVERTURE IDENTITY ACQUISITION VERDICT = STRONG_CANDIDATE
```

Overture materially closes acquisition coverage for Alfa Crux and SuperUco
without changing the verifier. It does not resolve Bodega Azul and it does not
make A16 pass. A production integration must use a release-aware, provider-owned
local index; remote GeoParquet must not be scanned during identity resolution.
