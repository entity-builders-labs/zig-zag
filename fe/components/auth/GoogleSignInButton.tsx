import React from 'react';
import {
  Box,
  Button,
  ButtonSpinner,
  ButtonText,
  HStack,
} from '@gluestack-ui/themed';
import { GoogleIcon } from './GoogleIcon';

type Props = {
  disabled: boolean;
  loading: boolean;
  onSignIn: (idToken?: string) => Promise<void>;
  onError: (message: string) => void;
};

// `onError` is part of Props (shared with the .web.tsx variant)
export function GoogleSignInButton({
  disabled,
  loading,
  onSignIn,
}: Props) {
  const isInteractive = !disabled && !loading;

  return (
    <Button
      variant='outline'
      action='secondary'
      h={48}
      w='$full'
      borderRadius='$2xl'
      bg='$white'
      borderWidth={1.5}
      borderColor={'#747775' as any}
      style={{
        borderWidth: 1.5,
        borderColor: '#747775',
        height: 48,
        borderRadius: 16,
        backgroundColor: '#FFFFFF',
      }}
      onPress={() => onSignIn()}
      isDisabled={!isInteractive}
      testID='login-google-button'
      accessibilityLabel='Continuar con Google'
    >
      <HStack alignItems='center' justifyContent='center' space='sm'>
        {loading ? (
          <ButtonSpinner color='#1F1F1F' />
        ) : (
          <Box mr='$1'>
            <GoogleIcon size={20} />
          </Box>
        )}
        <ButtonText
          size='sm'
          fontWeight='$medium'
          color='#1F1F1F'
          style={{ letterSpacing: -0.2 }}
        >
          {loading ? 'Iniciando sesión...' : 'Continuar con Google'}
        </ButtonText>
      </HStack>
    </Button>
  );
}

