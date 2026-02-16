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
| `activities`           | `Activity[]`       | Cached activities for current location  |
| `activitiesLoading`    | `boolean`          | Loading state                           |
| `activitiesError`      | `ApiError \| null` | Error state                             |
| `selectedRadiusMeters` | `number`           | Search radius (default from env: 3000m) |

## Key Function

### `getActivities(coordinatesProps?)`

Main data fetching function used across the app:

1. Takes optional coordinates (falls back to address → center)
2. Calls `POST /activities/search-hybrid` with lat/lng/radius
3. Updates `activities` state with results
4. Returns response with `fromCache` and `crawlingTriggered` flags

Called automatically on mount with default center (Buenos Aires).

## Custom Hooks

Exported hooks for consuming context in components:

| Hook                | Returns                                         | Usage                           |
| ------------------- | ----------------------------------------------- | ------------------------------- |
| `useMap()`          | `{ center, handleCenterChange }`                | Map center management           |
| `useAddress()`      | `{ address, setAddress }`                       | Address selection + auto-center |
| `useActivities()`   | `{ activities, loading, error, getActivities }` | Activities data                 |
| `useSearchRadius()` | `{ radiusMeters, setRadiusMeters }`             | Search radius control           |

### `useAddress()` side-effects

When an address is set, it automatically:

1. Updates the map center to the address coordinates
2. Triggers the address change handler in `useMap`
