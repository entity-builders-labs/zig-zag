import React from 'react';
import { Text } from '@gluestack-ui/themed';

export function WizardFieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size='2xs'
      fontWeight='$bold'
      color='$textLight400'
      textTransform='uppercase'
      letterSpacing={1}
    >
      {children}
    </Text>
  );
}
