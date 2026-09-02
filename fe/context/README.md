# Context (App State Management)

Global application state using React Context. The single `AppProvider` wraps the entire app and provides shared state to all screens.

## Architecture

```
context/
└── app.tsx    # AppContext + AppProvider + custom hooks
```

## State

`AppContext` manages:

| State                  | Type               | Description                             |
| ---------------------- | ------------------ | --------------------------------------- |
| `center`               | `{ lat, lng }`     | Current map center coordinates          |
| `address`              | `Address \| null`  | Selected address from search            |
| `selectedRadiusMeters` | `number`           | Search radius (default from env: 3000m) |

## Key Function

### `getExperiences(coordinatesProps?)`

Main verified-Experience fetching function used across the app:

1. Takes optional coordinates (falls back to address → center)
2. Tour/map screens query verified Experiences through their dedicated API boundaries.
3. Tour and map surfaces consume verified Experience snapshots from their own API boundaries.
4. Returns response with `fromCache` and `crawlingTriggered` flags

Called automatically on mount with default center (Buenos Aires).

## Custom Hooks

Exported hooks for consuming context in components:

| Hook                | Returns                                         | Usage                           |
| ------------------- | ----------------------------------------------- | ------------------------------- |
| `useMap()`          | `{ center, handleCenterChange }`                | Map center management           |
| `useAddress()`      | `{ address, setAddress }`                       | Address selection + auto-center |
| `useSearchRadius()` | `{ radiusMeters, setRadiusMeters }`             | Search radius control           |

### `useAddress()` side-effects

When an address is set, it automatically:

1. Updates the map center to the address coordinates
2. Triggers the address change handler in `useMap`
