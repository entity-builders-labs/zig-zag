# Features Directory

Feature-based modules that encapsulate business logic, data fetching, and domain-specific components. Each feature folder groups its UI, hooks, and types together.

## Architecture

```
features/
├── map/
│   ├── index.tsx              # Map component (native, uses react-native-maps)
│   ├── index.web.tsx          # Web fallback map implementation
│   └── types.ts               # Map-related type definitions
├── tours/
│   ├── tours.tsx              # Tour list component
│   ├── use-tours.tsx          # Hook for fetching nearby tours
│   ├── use-create-tour.ts     # Hook for tour wizard generation flow
│   └── tour-generation-contract.ts # Canonical intent/mobility API contract
└── search-by-address-input.tsx  # Address search with autocomplete
```

## Feature Details

### Map (`map/`)

- **`index.tsx`** — Native map component using `react-native-maps` (MapView). Shows verified Experience markers, user location, and supports panning/zooming.
- **`index.web.tsx`** — Web-specific fallback implementation for map rendering.
- Platform-specific rendering handled automatically by React Native's file extension resolution.

### Tours (`tours/`)

- **`use-tours.tsx`** — Fetches nearby tours via `fetchNearbyTours()` API call. Uses the user's current map center coordinates.
- **`use-create-tour.ts`** — Manages the full tour creation wizard flow:
  1. Receives the canonical destination, intent, and mobility contract
  2. Calls `generateTour()` API
  3. Handles loading/error states
  4. Navigates to the created tour's detail page
- **`tour-generation-contract.ts`** — Defines provider-neutral destination
  scale, themes, experience formats, exploration style, transport modes,
  walking limits, accessibility, and the bounded supplemental preference.
