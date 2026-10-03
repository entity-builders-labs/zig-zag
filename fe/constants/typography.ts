import { Platform } from 'react-native';

// Serif display face for headings, matching the tour-flow redesign mockup's
// `ui-serif, Georgia` choice — a system serif, not a downloaded font, so
// there's no expo-font/asset-loading infra to add for this pass.
export const FONT_DISPLAY = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia',
});
