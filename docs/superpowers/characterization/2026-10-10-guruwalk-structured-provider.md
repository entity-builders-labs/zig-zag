# GuruWalk structured-tour characterization — closeout summary

Date: 2026-10-10
Original spike: `GURUWALK-STRUCTURED-TOUR-1`

Verdict:

```text
GURUWALK_STRONG_STRUCTURED_PROVIDER
free tours only
```

## Access

Official public MCP:
`https://back.guruwalk.com/mcp`

Observed characteristics:

- no authentication/API key required;
- read-only machine-readable tools with output schemas;
- destination listing currently capped at page 3;
- destination input is fuzzy and therefore must receive a previously resolved
  city, never an arbitrary neighborhood string.

## Buenos Aires

Observed:
- 607 listings total;
- 59 free tours;
- 46 free tours reachable through the listing cap;
- 141 paid city tours;
- 31 free tours matched the target areas;
- 43/46 reachable free tours had usable stop arrays;
- 30/31 target-area free tours had usable stop arrays;
- median duration 135 minutes, range 60–210.

For free tours, the provider returns ordered stop names directly.
Paid tours do not expose the same stop list.

## Contract implications

Available structured information includes:
- provider tour id;
- title and provider URL;
- city;
- guide;
- duration;
- languages;
- meeting-point coordinates/instructions;
- availability;
- rating/images;
- ordered stop names for free tours.

Missing or unsafe as identity authority:
- stop coordinates from the public MCP;
- stop descriptions;
- end point;
- optional/alternative-stop semantics;
- reliable translated stop identity.

The guide order is provider presentation order and is not guaranteed to be an
optimal walking route.

## Recommended integration

```text
GuruWalk tour
→ provider-owned Experience

GuruWalk stop names
→ optional GeoEntity hints for planning/context

booking/display
→ retain GuruWalk provenance and tracking URL
```

Do not silently copy GuruWalk itineraries into a provider-independent Zig-Zag
catalog without explicit reuse permission.

The original untracked dossier contains raw responses, normalized fixtures and
reproduction scripts:

`spikes/guruwalk-structured-tour-2026-10-09/`
