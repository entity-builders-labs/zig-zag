# App Directory (Expo Router)

File-based routing powered by [Expo Router](https://docs.expo.dev/router/introduction/). Each file in this directory maps to a route in the app.

## Navigation Structure

```
app/
├── _layout.tsx              # Root layout: providers wrapping order
├── (tabs)/                  # Bottom tab navigator
│   ├── _layout.tsx          # Tab bar configuration
│   ├── index.tsx            # 🏠 Home tab (default)
│   ├── map.tsx              # 🗺️ Map tab
│   ├── saved.tsx            # 💾 Saved tab
│   └── profile.tsx          # 👤 Profile tab
└── tours/                   # Tour stack (pushes over tabs)
    ├── _layout.tsx          # Stack navigator config
    ├── index.tsx            # Tour list / discovery
    ├── wizard.tsx           # Tour creation wizard
    └── [id].tsx             # Tour detail (dynamic route)
```

## Provider Wrapping Order

In `_layout.tsx`, providers are nested in this order (outermost first):

1. **`GluestackUIProvider`** — UI theme/config
2. **`SafeAreaProvider`** — Safe area insets
3. **`ErrorBoundary`** — Global error handling
4. **`GestureHandlerRootView`** — Gesture support
5. **`AppProvider`** — App state (map, activities, address)
6. **`AutocompleteDropdownContextProvider`** — Address autocomplete

## Navigation Flows

- **Home → Tour**: User taps a tour card → pushes `tours/[id]`
- **Home → Wizard**: User taps "Create Tour" → pushes `tours/wizard`
- **Wizard → Detail**: After tour generation → navigates to `tours/[id]`
- **Tab switching**: Bottom tabs switch between Home, Map, Saved, Profile
