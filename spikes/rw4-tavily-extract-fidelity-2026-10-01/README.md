# RW4 Tavily Extract Fidelity Spike (2026-10-01)

## Executive Summary

| Check | Result |
| :--- | :--- |
| **Spike Verdict** | **RESULT A — ADVANCED FIXES IT** |
| **Root Cause of COLD #5 Loss** | Configuration issue: Zig-Zag relied on Tavily defaults (`extract_depth = "basic"`). Tavily's basic HTML parser systematically strips HTML list elements (`<ol>`, `<ul>`), completely amputating structured itineraries, stop sequences, and schedules. |
| **Effect of `extract_depth = "advanced"`** | 100% preservation of structured itinerary stops (`Alfa Crux`, `SuperUco`, `Bodega Azul`, `A16`, `Ojo de Agua`), schedules (`10 am`, `12 pm`, `2:30 pm`), outbound links, and prose. |
| **Effect of `format` (`markdown` vs `text`)** | Format does not fix the loss. `basic + text` also drops all lists (34,123 chars vs 50,517 chars in `advanced + text`). The loss occurs during HTML tree filtering, before serialization. |
| **Critical Discovery: Server-Side Cache Trap** | Tavily caches URL extractions on its servers. If a URL is first extracted with `basic`, subsequent requests with `extract_depth = "advanced"` on that exact URL hit Tavily's cache and return the stale `basic` payload (in ~10ms). Fresh requests reveal the true 85k+ char advanced extraction. |
| **Timeout Risk** | Critical. Tavily's documented default timeout for `advanced` is 30s (max 60s). In this spike, `advanced-text` took **16.50s**, which would have aborted under Zig-Zag's current hardcoded 15s client timeout. |
| **Incremental Cost** | Negligible. At `selectionLimit = 2`, `advanced` costs 0.8 credits (~$0.0064) vs 0.4 credits (~$0.0032) for `basic`. The delta is $0.0032 per tour run. |

---

## 1. Context & Motivation

In **COLD #5** (`2026-10-01`), deep extraction on `https://solsalute.com/blog/mendoza-argentina-wine-capital/` produced 52,974 characters of Markdown containing article headings (`### Uco Valley Itinerary`, `### Lujan de Cuyo Itinerary`), but omitted the actual winery stops (`Alfa Crux`, `SuperUco`, `Bodega Azul`). As a result, downstream LLM extraction found no admissible multi-component candidates.

This bounded fidelity spike was commissioned to determine:
1. Did Zig-Zag lose the SolSalute itinerary because it relied on Tavily `/extract`'s default `extract_depth = "basic"`?
2. Does `extract_depth = "advanced"` recover the itinerary?
3. Does the output format (`markdown` vs `text`) materially affect preservation?

**Invariants Maintained:**
- No production acquisition code was modified.
- No new canonical COLD was executed during this spike.
- Credentials loaded strictly from local `.env` and scanned for zero leaks.

---

## 2. Current Zig-Zag Implementation Audit

### File: `be/src/modules/tours/services/tavily-extract.service.ts`

```ts
const response = await fetch(this.apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${this.apiKey}`,
  },
  body: JSON.stringify({ urls: toFetch }),
  signal: AbortSignal.timeout(this.timeoutMs), // this.timeoutMs = 15000 (15 seconds)
});
```

### Inherited Defaults:
- **`extract_depth`**: Unspecified → defaults to `"basic"`.
- **`format`**: Unspecified → defaults to `"markdown"`.
- **`query`**: Unspecified → `undefined` (full-page extraction, no chunk reranking).
- **`chunks_per_source`**: Unspecified → `undefined` (Tavily chunking disabled).
- **`timeout`**: Unspecified in payload; client abort signal set to 15,000ms.

---

## 3. Official Tavily Extract API Contract & Pricing

*Documentation verified on 2026-10-01:*
- API Reference: `https://docs.tavily.com/documentation/api-reference/endpoint/extract.md`
- Credit Pricing: `https://docs.tavily.com/documentation/api-credits.md`

| Parameter | Type / Values | Default | Semantics & Architectural Impact |
| :--- | :--- | :--- | :--- |
| `extract_depth` | `"basic"` \| `"advanced"` | `"basic"` | `advanced` renders JavaScript and performs deep DOM traversal to retrieve tables, dynamic lists, and complex layouts. |
| `format` | `"markdown"` \| `"text"` | `"markdown"` | Serializes extracted DOM into GitHub-flavored Markdown or plain text. |
| `query` | `string` | None | Reranks and extracts specific chunks matching query. (Not used in Zig-Zag full extraction). |
| `chunks_per_source` | `integer` (1–5) | 3 | Number of chunks returned when `query` is provided. Ignored without `query`. |
| `timeout` | `float` (1.0–60.0) | 10s (basic) / 30s (adv) | Server-side extraction timeout. |
| `include_usage` | `boolean` | `false` | When true, returns `{ usage: { credits: number } }`. |

### Official Credit Cost Model:
- **`basic`**: 1 credit per 5 successful URLs = **0.2 credits / URL**.
- **`advanced`**: 2 credits per 5 successful URLs = **0.4 credits / URL**.
- **Pay-as-you-go Rate**: $0.008 per API credit ($8.00 per 1,000 credits).
- **Zig-Zag Impact (`selectionLimit = 2`)**:
  - `basic`: $2 \times 0.2 = 0.4\text{ credits} \approx \$0.0032$.
  - `advanced`: $2 \times 0.4 = 0.8\text{ credits} \approx \$0.0064$.
  - **Net Difference**: \$0.0032 per tour execution.

---

## 4. Origin Reference Proof

Direct HTTP fetch of `https://solsalute.com/blog/mendoza-argentina-wine-capital/`:
- **HTTP Status**: 200 OK (duration 402ms)
- **Content Length**: 476,591 characters (HTML source)
- **SHA-256**: `f1af4e4265a3ab60988c9aa9b66574f31a6a05133e969c605facdf142dba14ff`
- **Location**: `reference/solsalute-origin.html` and `reference/solsalute-origin-itinerary-excerpt.html`

### Proven Origin Structure:
The origin HTML contains an `<ol class="wp-block-list">` block under `<h3 id="uco-valley-itinerary">`:
1. `<a href="https://www.agostinowinegroup.com/alfa-crux-wines">Alfa Crux</a> – 10 am – This winery is the furthest, so start here and work your way back up...`
2. `<a href="https://superuco.com/">SuperUco</a> – 12 pm – It will take you 40 minutes to drive here from Alfa Crux so you’ll need to schedule SuperUco for no earlier than noon.`
3. `Optional Bonus Tasting at Corazon del Sol or Solo Contigo...`
4. `<a href="https://bodegalaazul.com/">Bodega Azul</a> – 2:30 pm for lunch – You’ll spend the remaining hours of your afternoon hours here...`

And under `<h3 id="lujan-de-cuyo-itinerary">`:
1. `<a href="http://a16sa.com/en/">A16</a> – 10 am – Start your day with a tasting and a tour at A16.`
2. `...pick from: Ruca Malen, Cruzat, Vinas Cobos, Septima, Susan Balbo for winery #2 at 11:30`
3. `<a href="https://ojodeagua.ch/">Ojo de Agua</a> – 1:30 pm for a winery lunch...`

---

## 5. Four-Arm Experimental Results

Tested live against Tavily `/extract` with `include_usage: true` and 60s client abort signal.

| Arm | Mode & Format | Chars | Tavily Time | In-Itinerary Stops (`Alfa Crux`, `SuperUco`, `Bodega Azul`) | Ordered Stops Marker (`1.`, `2.`) | Schedule Times (`10 am`, `12 pm`, `2:30 pm`) | Outbound Links | Verdict |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **A** | `basic + markdown` | 52,974 | 1.80s | **LOST** (0 / 3) | **NO** | **NO** | **NO** | **FAIL** |
| **B** | `advanced + markdown` | 85,287 | 5.58s | **PRESERVED** (3 / 3) | **YES** (`1.`, `2.`, `3.`, `4.`) | **YES** | **YES** | **PASS** |
| **C** | `basic + text` | 34,123 | 1.90s | **LOST** (0 / 3) | **NO** | **NO** | **NO** | **FAIL** |
| **D** | `advanced + text` | 50,517 | 16.50s | **PRESERVED** (3 / 3) | **YES** (`1.`, `2.`, `3.`, `4.`) | **YES** | N/A (text) | **PASS** |

### Output Files Generated:
- `outputs/basic-markdown.md` (52,974 chars, SHA256: `404927ca...`)
- `outputs/advanced-markdown.md` (85,287 chars, SHA256: `228bea7a...`)
- `outputs/basic-text.txt` (34,123 chars, SHA256: `2f7d8112...`)
- `outputs/advanced-text.txt` (50,517 chars, SHA256: `9af7fa29...`)

---

## 6. Structural Fidelity & Amputation Analysis

To determine whether this was an isolated glitch or general behavior, we inspected multiple structures across the page:

| HTML Element | Origin HTML | `basic + markdown` | `advanced + markdown` | Finding |
| :--- | :---: | :---: | :---: | :--- |
| **Headings (`<h2>`, `<h3>`, `<h4>`)** | Present | Preserved | Preserved | Both modes preserve headings. |
| **Paragraphs (`<p>`)** | Present | Preserved | Preserved | Both modes preserve standard paragraphs. |
| **Inline Links (`<a href="...">`)** | Present | Preserved | Preserved | Both modes convert inline paragraph links. |
| **Ordered Lists (`<ol>`)** | Present | **STRIPPED** | **PRESERVED** | **`basic` drops ALL `<ol>` blocks; `advanced` retains `1.`, `2.`, etc.** |
| **Unordered Lists (`<ul>`)** | Present | **STRIPPED** | **PRESERVED** | **`basic` drops ALL `<ul>` blocks; `advanced` retains `* ` bullets.** |

### Key Forensic Excerpt (Uco Valley Itinerary):

#### In `basic + markdown`:
```markdown
### Uco Valley Itinerary

If I were to plan a wine tasting in Valle de Uco Itinerary for a friend, this is the day I’d schedule for them.

![A bottle of wine on a table next to a basket of bread](data:image/png;base64...)
```
*(The `<ol>` list containing Alfa Crux, SuperUco, and Bodega Azul was completely deleted).*

#### In `advanced + markdown`:
```markdown
### Uco Valley Itinerary

If I were to plan a wine tasting in Valle de Uco Itinerary for a friend, this is the day I’d schedule for them.

1. [Alfa Crux](https://www.agostinowinegroup.com/alfa-crux-wines) – 10 am – This winery is the furthest, so start here and work your way back up. Their first tour is at 10 am, so wake up early and eat a hearty breakfast to prepare yourself for all that wine you’ll be drinking today.
2. [SuperUco](https://superuco.com/) – 12 pm – It will take you 40 minutes to drive here from Alfa Crux so you’ll need to schedule SuperUco for no earlier than noon.
3. Optional Bonus Tasting at [Corazon del Sol](https://www.corazondelsol.com/) or [Solo Contigo](http://solocontigowine.com/): If you have time for an extra tasting after SuperUco and before your lunch reservation, see if you can squeeze in a quick tasting at one of these two wineries. They’re on the same property as SuperUco (as they form part of The Vines).
4. [Bodega Azul](https://bodegalaazul.com/) – 2:30 pm for lunch – You’ll spend the remaining hours of your afternoon hours here, so sit back and enjoy the meal. Stretch your legs in between courses under the Mendoza sun looking at the mountains, or lounge on the sofas in the grass after lunch.
```

---

## 7. Critical Architectural Findings

### 1. Tavily Server-Side Cache Trap
Tavily caches URL extractions on its backend keyed by URL.
- When an identical bare URL is called with `advanced` after having been queried with `basic`, Tavily serves the cached `basic` result in ~10ms (`usage.credits = 0`), ignoring `extract_depth: "advanced"`.
- This means toggling `extract_depth` in production without cache busting or waiting for Tavily's server-side cache TTL would silently serve the defective basic extraction!
- **Mitigation**: Production deep extraction must account for provider caching (e.g. passing query parameters or ensuring clean fresh extraction).

### 2. Timeout Mismatch Risk
- Current Zig-Zag production timeout: `15000` ms (15 seconds).
- Tavily documentation: Default timeout for `advanced` is **30 seconds** (configurable up to 60s).
- In this spike: `advanced-text` took **16.50s**.
- **Conclusion**: Retaining the 15-second client timeout with `advanced` extraction creates an acute risk of false timeout failures on complex or slow-loading web pages. The timeout MUST be increased (e.g. 35s–45s) when adopting `advanced`.

---

## 8. Final Diagnosis & Recommendations

### Official Diagnosis:
```text
COLD #5 Tavily loss = configuration issue
(Zig-Zag used Tavily /extract with default extract_depth: "basic",
 which strips HTML list structures. Content requiring structured
 itinerary preservation demands extract_depth: "advanced".)
```

### Recommendation for Production (Do NOT implement in this task):
When updating `TavilyWebSourceContentProvider`:
1. Add `extract_depth: 'advanced'` to the request body.
2. Explicitly specify `format: 'markdown'`.
3. Increase `timeoutMs` from `15000` to `35000` or `45000` (compatible with Tavily's 30s server default).
4. Include cache-awareness to prevent hitting stale Tavily server-side basic extractions.

### Recommendation for COLD #6:
COLD #6 should run with **Tavily `advanced`** once the production provider configuration and timeout are updated. There is no need to abandon Tavily or build an emergency Cloudflare crawler; Tavily's advanced extraction faithfully recovers the itinerary stops and full route composition.
