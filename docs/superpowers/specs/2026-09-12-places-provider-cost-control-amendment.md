# Places provider cost-control amendment

Status: canonical amendment for `feat/preference-first-selection`

This amendment supersedes the narrow B1 wording in
`docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
that said Google Places should always request `editorialSummary` during baseline
searches.

## Provider boundary

The tour/acquisition core depends on the configurable `IPlacesApiService`
boundary, not directly on Google Places. Today the active provider may be Google
or Geoapify. Downstream evidence/classification code must remain provider-agnostic
and must not require a Google-only field to function correctly.

Provider-specific fields are optional evidence. Missing provider-specific fields
are a normal condition, not a degraded/error state by themselves.

## Google baseline-search cost control

`editorialSummary` remains supported by `PlaceData` and by observation metadata
so it can be preserved when a future selective enrichment path intentionally
obtains it.

However, baseline Google Nearby Search and Text Search MUST NOT request
`places.editorialSummary` in their field mask during the current development
phase. Google bills a request according to the highest-priced field requested;
`editorialSummary` promotes the whole search to the more expensive Enterprise +
Atmosphere tier.

Baseline Google search may continue requesting the provider facts needed today,
including `websiteUri`, `priceLevel`, `businessStatus`, rating/review count,
types, and `primaryTypeDisplayName` where supported.

A future task may add selective paid enrichment for a bounded subset of
candidates when evidence remains insufficient. That enrichment must be explicit,
budgeted, observable in trace/provenance, and must not become an implicit cost on
every Places search.

## Preferred narrative evidence order

Narrative context for classification should prefer already-available or free
sources before paid provider-specific enrichment, for example:

1. Wikivoyage tourism descriptions / section context;
2. Wikidata identity and structured claims / sitelinks;
3. Wikipedia summary/extract when identity can be resolved;
4. OSM structured tags / grounded context;
5. targeted web research when still needed;
6. optional paid provider-specific enrichment only when justified by remaining
   evidence insufficiency and budget.

This ordering is a cost/architecture policy, not a rule that every source must be
queried for every candidate. Acquisition/research should remain targeted and
bounded.

## B2+ classifier rule

B2 and later classification/ranking stages consume an evidence bundle, not a
Google-specific place object. They must work correctly with either Google or
Geoapify as the configured Places provider and must tolerate optional provider
fields being absent.

`editorialSummary` must never become a prerequisite for classification,
coverage, quality, or selection.
