import 'react-native';

declare module '@gluestack-ui/themed' {
  import { ComponentProps } from 'react';
  import { ViewStyle, TextStyle, ImageStyle } from 'react-native';

  type StyleProp = ViewStyle | TextStyle | ImageStyle;

  // Extend all Gluestack UI components to accept className
  interface StyledComponentProps<T, P, Props, Name, Component> {
    className?: string;
  }
}
