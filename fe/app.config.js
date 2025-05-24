module.exports = {
  name: 'zig-zag',
  version: '1.0.0',
  extra: {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    eas: {
      projectId: '34a46d03-0540-481a-8326-ea123a330635',
    },
  },
  updates: {
    url: 'https://u.expo.dev/34a46d03-0540-481a-8326-ea123a330635',
  },
  runtimeVersion: '1.0.0',
  assetBundlePatterns: ['**/*'],
  web: {
    bundler: 'metro',
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    },
  },
  ios: {
    bundleIdentifier: 'com.juanobrach.zig-zag',
  },
  android: {
    package: 'com.juanobrach.zigzag',
  },
  newArchEnabled: true,
};
