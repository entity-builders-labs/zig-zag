module.exports = {
  name: 'zig-zag',
  slug: 'zig-zag',
  version: '1.0.0',
  runtimeVersion: '1.0.0',
  extra: {
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    eas: {
      projectId: '34a46d03-0540-481a-8326-ea123a330635',
    },
  },
  assetBundlePatterns: ['**/*'],
  web: {
    bundler: 'metro',
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    },
  },
  ios: {
    bundleIdentifier: 'com.javieriseruk.zigzag',
    usesAppleSignIn: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Usamos tu ubicación para mostrar actividades cercanas a vos.',
    },
  },
  android: {
    package: 'com.entitiybuilders.zigzag',
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  plugins: [
    'expo-router',
    'expo-apple-authentication',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Usamos tu ubicación para mostrarte recorridos y actividades cercanas a vos.',
      },
    ],
  ],
  newArchEnabled: true,
};
