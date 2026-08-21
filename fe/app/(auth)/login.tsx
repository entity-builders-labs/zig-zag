import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import {
  Box,
  VStack,
  Heading,
  Text,
  Button,
  ButtonText,
  ButtonSpinner,
  Input,
  InputField,
  Center,
  Pressable,
} from '@gluestack-ui/themed';
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonType,
  AppleAuthenticationButtonStyle,
} from 'expo-apple-authentication';
import { useAuth } from '@/context/auth';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { FONT_DISPLAY } from '@/constants/typography';

type Step = 'providers' | 'email' | 'code';

function errorMessage(error: unknown): string {
  const anyError = error as any;
  return (
    anyError?.response?.data?.message ||
    anyError?.message ||
    'Algo salió mal. Probá de nuevo.'
  );
}

export default function LoginScreen() {
  const { signInWithGoogle, signInWithApple, requestEmailCode, signInWithEmailCode } =
    useAuth();

  const [step, setStep] = useState<Step>('providers');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = useCallback(async (webIdToken?: string) => {
    setError(null);
    setLoading('google');
    try {
      await signInWithGoogle(webIdToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  }, [signInWithGoogle]);

  const handleGoogleError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleApple = async () => {
    setError(null);
    setLoading('apple');
    try {
      await signInWithApple();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  };

  const handleRequestCode = async () => {
    if (!email.trim()) return;
    setError(null);
    setLoading('email');
    try {
      const result = await requestEmailCode(email.trim());
      setDevCode(result.devCode ?? null);
      setStep('code');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) return;
    setError(null);
    setLoading('code');
    try {
      await signInWithEmailCode(email.trim(), code.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  };

  return (
    <Center flex={1} p='$6' bg='$backgroundLight50'>
      <VStack space='xl' w='$full' maxWidth={360}>
        <VStack space='xs' alignItems='center'>
          <Heading size='2xl' style={{ fontFamily: FONT_DISPLAY }}>
            Zig-Zag
          </Heading>
          <Text color='$textLight500'>Iniciá sesión para armar tu tour</Text>
        </VStack>

        {error && (
          <Box bg='$red50' borderRadius='$md' p='$3'>
            <Text color='$red700' size='sm'>
              {error}
            </Text>
          </Box>
        )}

        {step === 'providers' && (
          <VStack space='md'>
            <GoogleSignInButton
              disabled={loading !== null}
              loading={loading === 'google'}
              onSignIn={handleGoogle}
              onError={handleGoogleError}
            />

            {Platform.OS === 'ios' && (
              <AppleAuthenticationButton
                buttonType={AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={6}
                style={{ width: '100%', height: 44 }}
                onPress={handleApple}
              />
            )}

            <Button
              size='lg'
              variant='link'
              onPress={() => setStep('email')}
              isDisabled={loading !== null}
              testID='login-email-link'
            >
              <ButtonText>Continuar con email</ButtonText>
            </Button>
          </VStack>
        )}

        {step === 'email' && (
          <VStack space='md'>
            <Input size='lg'>
              <InputField
                placeholder='tu@email.com'
                value={email}
                onChangeText={setEmail}
                autoCapitalize='none'
                keyboardType='email-address'
                testID='login-email-input'
              />
            </Input>
            <Button
              size='lg'
              onPress={handleRequestCode}
              isDisabled={loading !== null || !email.trim()}
              testID='login-request-code-button'
            >
              {loading === 'email' && (
                <ButtonSpinner mr='$2' color='$secondary950' />
              )}
              <ButtonText color='$secondary950'>Enviar código</ButtonText>
            </Button>
            <Pressable onPress={() => setStep('providers')}>
              <Text color='$textLight500' textAlign='center' size='sm'>
                Volver
              </Text>
            </Pressable>
          </VStack>
        )}

        {step === 'code' && (
          <VStack space='md'>
            <Text color='$textLight500' size='sm' textAlign='center'>
              Te enviamos un código a {email}
            </Text>
            {devCode && (
              <Box bg='$amber50' borderRadius='$md' p='$3'>
                <Text color='$amber800' size='xs'>
                  Modo desarrollo — código: {devCode}
                </Text>
              </Box>
            )}
            <Input size='lg'>
              <InputField
                placeholder='123456'
                value={code}
                onChangeText={setCode}
                keyboardType='number-pad'
                maxLength={6}
                testID='login-code-input'
              />
            </Input>
            <Button
              size='lg'
              onPress={handleVerifyCode}
              isDisabled={loading !== null || code.trim().length !== 6}
              testID='login-verify-code-button'
            >
              {loading === 'code' && (
                <ButtonSpinner mr='$2' color='$secondary950' />
              )}
              <ButtonText color='$secondary950'>Verificar</ButtonText>
            </Button>
            <Pressable onPress={handleRequestCode} disabled={loading !== null}>
              <Text color='$textLight500' textAlign='center' size='sm'>
                Reenviar código
              </Text>
            </Pressable>
          </VStack>
        )}
      </VStack>
    </Center>
  );
}
