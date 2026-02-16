# Components Directory

Reusable UI components organized by feature area. Shared across screens and features.

## Architecture

```
components/
├── home/                      # Home screen components
│   ├── BottomTabBar.tsx       # Custom bottom tab bar
│   ├── HeroCard.tsx           # Featured content hero card
│   ├── MoodsSection.tsx       # Mood/category selection pills
│   └── RoutesSection.tsx      # Tour routes carousel on home
├── tour-details/              # Tour detail screen components
│   ├── TourHeader.tsx         # Tour cover image + title + stats
│   ├── QuickStatsBar.tsx      # Duration, distance, price bar
│   ├── DayHeader.tsx          # Day separator header
│   ├── TourStopCard.tsx       # Individual activity stop card
│   ├── SmartConnector.tsx     # Visual connector between stops
│   ├── types.ts               # Tour detail type definitions
│   └── utils.ts               # Helper utilities
├── tours/                     # Tour creation/wizard components
│   ├── TourWizardForm.tsx     # Multi-step wizard form (~20KB)
│   ├── DestinationInput.tsx   # Destination search with autocomplete
│   └── DateRangePicker.tsx    # Date selection component
├── ui/                        # Base UI primitives
│   ├── bottom-sheet/          # Bottom sheet component
│   ├── gluestack-ui-provider/ # Gluestack theme provider
│   └── icon/                  # Icon components
├── LocationInput.tsx          # Shared location input component
└── types.ts                   # Shared component type definitions
```

## Component Groups

### Home (`home/`)

Components composing the main Home tab screen:

- **`RoutesSection`** — Most complex; fetches and renders tour cards in a horizontal carousel with category filtering
- **`MoodsSection`** — Quick-access mood/interest pills
- **`HeroCard`** — Promotional hero banner

### Tour Details (`tour-details/`)

Components for the `tours/[id]` screen — a full itinerary view:

- **`TourHeader`** — Cover image with gradient overlay, tour name, description
- **`TourStopCard`** — Activity card with photos, time, notes
- **`SmartConnector`** — Visual line/arrow connecting tour stops with travel time
- **`DayHeader`** — Day number separator for multi-day tours

### Tour Wizard (`tours/`)

Multi-step form for generating a new AI tour:

- **`TourWizardForm`** — The main wizard component (~20KB): destination, dates, interests, budget, pace, group type, dietary restrictions
- **`DestinationInput`** — Address autocomplete search for destination
- **`DateRangePicker`** — Calendar-based date range selection

### UI Primitives (`ui/`)

Low-level UI components:

- **Bottom sheet** — Draggable bottom sheet with context provider
- **Gluestack provider** — Theme configuration for `@gluestack-ui/themed`
- **Icons** — Shared icon components
