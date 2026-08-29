import { config as defaultConfig } from '@gluestack-ui/config';
import { createConfig } from '@gluestack-ui/themed';

// Palette derived from the tour-flow redesign mockup (see the plan doc):
// ink #16232a, paper #f6f3ea/#fbf9f3, brass #c89b3c (primary), rose #b85c6b
// (tertiary — the composite/experience accent). Each ramp interpolates from
// a light anchor through the base hue at ~500 down to ink at 950.
//
// IMPORTANT: this is the file that actually matters — `@gluestack-ui/themed`
// renders through `@gluestack-style/react`'s own CSS-in-JS engine, which
// reads `tokens.colors.primary500` etc from THIS config object (passed to
// `createConfig`/`GluestackUIProvider` in app/_layout.tsx). It does not read
// `components/ui/gluestack-ui-provider/config.ts` — that file only feeds a
// separate, unused NativeWind `vars()`/CSS-custom-property path (dead code
// in this app, since app/_layout.tsx imports `GluestackUIProvider` directly
// from `@gluestack-ui/themed`, not the local wrapped one) — kept in sync for
// consistency, but this file is the one every `$primary500`-style prop
// actually resolves against.
const primary = {
  primary0: '#FFFDF9',
  primary50: '#FFF7ED',
  primary100: '#FFEDD5',
  primary200: '#FED7AA',
  primary300: '#FDBA74',
  primary400: '#FB923C',
  primary500: '#EA580C',
  primary600: '#C2410C',
  primary700: '#9A3412',
  primary800: '#7C2D12',
  primary900: '#431407',
  primary950: '#16232A',
};

const tertiary = {
  tertiary0: '#FFFDF9',
  tertiary50: '#FFF1F2',
  tertiary100: '#FFE4E6',
  tertiary200: '#FECDD3',
  tertiary300: '#FDA4AF',
  tertiary400: '#FB7185',
  tertiary500: '#E11D48',
  tertiary600: '#BE123C',
  tertiary700: '#9F1239',
  tertiary800: '#881337',
  tertiary900: '#4C0519',
  tertiary950: '#16232A',
};

const secondary = {
  secondary0: '#F6F3EA',
  secondary50: '#DEDED7',
  secondary100: '#C6C8C3',
  secondary200: '#A2A8A6',
  secondary300: '#7F8889',
  secondary400: '#526065',
  secondary500: '#2B3D45',
  secondary600: '#24353D',
  secondary700: '#1F2E36',
  secondary800: '#1B2A31',
  secondary900: '#18252D',
  secondary950: '#16232A',
};

const textLight = {
  textLight0: '#FFFFFF',
  textLight50: '#E9EBEC',
  textLight100: '#D3D7D9',
  textLight200: '#A8B0B3',
  textLight300: '#7D888C',
  textLight400: '#5C6A6F',
  textLight500: '#46545A',
  textLight600: '#37444A',
  textLight700: '#2B363B',
  textLight800: '#20292E',
  textLight900: '#1A2226',
  textLight950: '#16232A',
};

const borderLight = {
  borderLight0: '#FFFFFF',
  borderLight50: '#E6E8E9',
  borderLight100: '#CDD1D3',
  borderLight200: '#A8AFB2',
  borderLight300: '#828D92',
  borderLight400: '#546269',
  borderLight500: '#46545A',
  borderLight600: '#37444A',
  borderLight700: '#2B363B',
  borderLight800: '#20292E',
  borderLight900: '#1A2226',
  borderLight950: '#16232A',
};

const backgroundLight = {
  backgroundLight0: '#FBF9F3',
  backgroundLight50: '#F8F6EF',
  backgroundLight100: '#F6F3EB',
  backgroundLight200: '#F2EEE5',
  backgroundLight300: '#EEE9DF',
  backgroundLight400: '#C5C3BC',
  backgroundLight500: '#939592',
  backgroundLight600: '#6C7171',
  backgroundLight700: '#4C5557',
  backgroundLight800: '#354044',
  backgroundLight900: '#222E34',
  backgroundLight950: '#16232A',
  backgroundLightMuted: '#F6F3EB',
};

export const config = createConfig({
  ...defaultConfig,
  tokens: {
    ...defaultConfig.tokens,
    colors: {
      ...defaultConfig.tokens.colors,
      ...primary,
      ...tertiary,
      ...secondary,
      ...textLight,
      ...borderLight,
      ...backgroundLight,
    },
  },
  components: {
    ...defaultConfig.components,
  },
});
