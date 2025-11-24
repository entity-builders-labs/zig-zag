module.exports = {
  name: 'zig-zag',
  version: '1.0.0',
  extra: {
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
  },
  assetBundlePatterns: ['**/*'],
  web: {
    bundler: 'metro',
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    },
  },
  ios: {
    bundleIdentifier: 'com.juanobrach.zig-zag',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Usamos tu ubicación para mostrar actividades cercanas a vos.',
    },
  },
  android: {
    package: 'com.juanobrach.zigzag',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  newArchEnabled: false,
};
