# COLD #9 window-policy characterization (offline)

Question: can a different single-window *ranking* policy make the SolSalute
"Sample Mendoza Winery Itineraries" section (41153–43907, the source-defined
Uco composition) reach extraction independently of the volatile Serper
snippet?

Inputs: the committed SolSalute Cloudflare markdown (88,401 chars, 87 chunks,
`spikes/rw4-cloudflare-source-fidelity-2026-10-01/output.md`) and the
relevance contexts in `ctx.json` (COLD #7 and COLD #9 title/snippet/query
plus cross variants). Chunking/selection are ported verbatim from production;
only chunk scoring varies (`policy-eval.cjs`, `matrix*.cjs`).

Policies (`matrix-ABCD.out.json`, `matrix-EFG.out.json`):

| Policy | observed pass | cross pass | snippet-independent |
| --- | --- | --- | --- |
| D current (title+snippet+query merged) | 7/9 | 9/36 | 0/9 |
| A stable only (title+query) | 0/9 | 0/36 | 9/9 |
| B stable primary, snippet tie-break | 2/9 | 2/36 | 1/9 |
| C stable + snippet bonus ≤25% | 2/9 | 2/36 | 0/9 |
| E RRF(stable, snippet) | 0/9 | 0/36 | 0/9 |
| F stable + flat snippet coverage | 0/9 | 0/36 | 0/9 |
| G stable + snippet bonus ≤50% | 3/9 | 3/36 | 0/9 |

Conclusions:

- All bounded snippet-weighting alternatives were rejected.
- Stable title/query context alone ranks the itinerary chunk ~56–57 / 87
  (`chunk-scores.out.txt`): it is snippet-independent but never selects it.
- The snippet is the only useful signal and it is volatile.
- A ranking-only solution was not demonstrated. Progressive bounded
  examination of the already retrieved source was chosen instead: ranking
  orders the first window; later windows guarantee every retrieved chunk is
  eventually examined.
