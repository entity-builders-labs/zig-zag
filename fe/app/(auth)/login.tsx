import React, { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  ButtonText,
  ButtonSpinner,
  Input,
  InputField,
  Center,
  Pressable,
  Image,
  Icon,
} from '@gluestack-ui/themed';
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonType,
  AppleAuthenticationButtonStyle,
} from 'expo-apple-authentication';
import { Mail, ArrowRight, Sparkles, KeyRound, Compass, ArrowLeft } from 'lucide-react-native';
import { useAuth } from '@/context/auth';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { FONT_DISPLAY } from '@/constants/typography';

type Step = 'providers' | 'email' | 'code';

const BACKGROUND_IMAGE =
  'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=1000&auto=format&fit=crop';

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
    <Box flex={1} bg='$backgroundDark950' position='relative' alignItems='center' justifyContent='center'>
      {/* Scenic Background with Gradient */}
      <Box position='absolute' top={0} left={0} right={0} bottom={0} zIndex={0}>
        <Image
          source={{ uri: BACKGROUND_IMAGE }}
          alt='Zig-Zag Travel'
          w='$full'
          h='$full'
          resizeMode='cover'
        />
        <Box
          position='absolute'
          top={0}
          left={0}
          right={0}
          bottom={0}
          bg='rgba(15, 23, 42, 0.78)'
        />
      </Box>

      {/* Responsive Centered Shell */}
      <Box
        w='$full'
        maxW={440}
        flex={1}
        p='$6'
        zIndex={1}
        justifyContent='space-between'
      >
        {/* Brand Header */}
        <VStack alignItems='center' mt='$10' space='xs'>
          <Box
            w={56}
            h={56}
            borderRadius='$2xl'
            bg='$primary600'
            alignItems='center'
            justifyContent='center'
            shadowColor='$primary500'
            shadowOffset={{ width: 0, height: 6 }}
            shadowOpacity={0.4}
            shadowRadius={12}
            elevation={6}
            borderWidth={1}
            borderColor='$primary300'
            mb='$3'
          >
            <Icon as={Compass} size='xl' color='$white' />
          </Box>

          <Heading
            size='3xl'
            color='$white'
            style={{ fontFamily: FONT_DISPLAY }}
            textAlign='center'
            letterSpacing='$sm'
          >
            Zig-Zag
          </Heading>
          <Text size='xs' color='$primary100' fontWeight='$medium' textAlign='center'>
            Explorá ciudades a tu propio ritmo con IA
          </Text>
        </VStack>

        {/* Floating Auth Card */}
        <Box
          bg='$white'
          borderRadius='$3xl'
          p='$6'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 8 }}
          shadowOpacity={0.16}
          shadowRadius={24}
          elevation={8}
          borderWidth={1}
          borderColor='$borderLight100'
          my='$6'
        >
          {error && (
            <Box bg='$red50' borderWidth={1} borderColor='$red200' borderRadius='$xl' p='$3' mb='$4'>
              <Text color='$red700' size='xs' fontWeight='$medium'>
                {error}
              </Text>
            </Box>
          )}

          {step === 'providers' && (
            <VStack space='md'>
              <VStack alignItems='center' mb='$2'>
                <Heading
                  size='md'
                  color='$textLight900'
                  style={{ fontFamily: FONT_DISPLAY }}
                  textAlign='center'
                >
                  Empezá a descubrir
                </Heading>
                <Text size='2xs' color='$textLight500' textAlign='center' mt='$0.5'>
                  Ingresá para guardar tus itinerarios y mapas
                </Text>
              </VStack>

              {/* Google Sign-In */}
              <GoogleSignInButton
                disabled={loading !== null}
                loading={loading === 'google'}
                onSignIn={handleGoogle}
                onError={handleGoogleError}
              />

              {/* Apple Sign-In (iOS only) */}
              {Platform.OS === 'ios' && (
                <Box w='$full' mt='$1'>
                  <AppleAuthenticationButton
                    buttonType={AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={16}
                    style={{ width: '100%', height: 48 }}
                    onPress={handleApple}
                  />
                </Box>
              )}

              {/* Divider */}
              <HStack alignItems='center' my='$1'>
                <Box flex={1} height={1} bg='$borderLight200' />
                <Text size='2xs' color='$textLight400' fontWeight='$semibold' px='$3' textTransform='uppercase'>
                  o con email
                </Text>
                <Box flex={1} height={1} bg='$borderLight200' />
              </HStack>

              {/* Email Option */}
              <Button
                size='lg'
                variant='outline'
                action='secondary'
                borderColor='$borderLight300'
                bg='$backgroundLight50'
                borderRadius='$2xl'
                h={48}
                onPress={() => setStep('email')}
                isDisabled={loading !== null}
                testID='login-email-link'
              >
                <Icon as={Mail} size='sm' color='$textLight700' mr='$2' />
                <ButtonText size='xs' fontWeight='$bold' color='$textLight800'>
                  Ingresar con código por Email
                </ButtonText>
              </Button>
            </VStack>
          )}

          {step === 'email' && (
            <VStack space='md'>
              <VStack alignItems='center' mb='$1'>
                <Heading
                  size='md'
                  color='$textLight900'
                  style={{ fontFamily: FONT_DISPLAY }}
                  textAlign='center'
                >
                  Ingresá tu Email
                </Heading>
                <Text size='2xs' color='$textLight500' textAlign='center' mt='$0.5'>
                  Te enviaremos un código de acceso único
                </Text>
              </VStack>

              <VStack space='xs'>
                <Text size='2xs' fontWeight='$bold' color='$textLight700' textTransform='uppercase' px='$1'>
                  Correo Electrónico
                </Text>
                <Input
                  size='lg'
                  borderRadius='$2xl'
                  borderColor='$borderLight300'
                  bg='$backgroundLight50'
                  h={48}
                >
                  <InputField
                    placeholder='tu@email.com'
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize='none'
                    keyboardType='email-address'
                    testID='login-email-input'
                    fontSize='$xs'
                  />
                </Input>
              </VStack>

              <Button
                size='lg'
                variant='solid'
                action='primary'
                bg='$primary500'
                borderRadius='$2xl'
                h={48}
                onPress={handleRequestCode}
                isDisabled={loading !== null || !email.trim()}
                testID='login-request-code-button'
              >
                {loading === 'email' ? (
                  <ButtonSpinner mr='$2' color='$white' />
                ) : (
                  <Icon as={Sparkles} size='xs' color='$white' mr='$2' />
                )}
                <ButtonText size='xs' fontWeight='$bold' color='$white'>
                  Enviar Código de Acceso
                </ButtonText>
              </Button>

              <Pressable onPress={() => setStep('providers')} py='$1'>
                <HStack space='xs' justifyContent='center' alignItems='center'>
                  <Icon as={ArrowLeft} size='2xs' color='$textLight500' />
                  <Text size='xs' color='$textLight600' fontWeight='$medium'>
                    Volver a opciones
                  </Text>
                </HStack>
              </Pressable>
            </VStack>
          )}

          {step === 'code' && (
            <VStack space='md'>
              <VStack alignItems='center' mb='$1'>
                <Heading
                  size='md'
                  color='$textLight900'
                  style={{ fontFamily: FONT_DISPLAY }}
                  textAlign='center'
                >
                  Verificá tu Código
                </Heading>
                <Text size='2xs' color='$textLight500' textAlign='center' mt='$0.5'>
                  Enviado a <Text size='2xs' fontWeight='$bold' color='$textLight900'>{email}</Text>
                </Text>
              </VStack>

              {devCode && (
                <Box bg='$amber50' borderWidth={1} borderColor='$amber200' borderRadius='$xl' p='$2.5'>
                  <Text color='$amber800' size='2xs' textAlign='center' fontWeight='$medium'>
                    💡 Modo desarrollo — código: <Text size='2xs' fontWeight='$bold' color='$amber900'>{devCode}</Text>
                  </Text>
                </Box>
              )}

              <VStack space='xs'>
                <Text size='2xs' fontWeight='$bold' color='$textLight700' textTransform='uppercase' px='$1'>
                  Código de 6 dígitos
                </Text>
                <Input
                  size='lg'
                  borderRadius='$2xl'
                  borderColor='$borderLight300'
                  bg='$backgroundLight50'
                  h={50}
                >
                  <InputField
                    placeholder='123456'
                    value={code}
                    onChangeText={setCode}
                    keyboardType='number-pad'
                    maxLength={6}
                    testID='login-code-input'
                    textAlign='center'
                    fontSize='$lg'
                    fontWeight='$bold'
                    letterSpacing='$xl'
                  />
                </Input>
              </VStack>

              <Button
                size='lg'
                variant='solid'
                action='primary'
                bg='$primary500'
                borderRadius='$2xl'
                h={48}
                onPress={handleVerifyCode}
                isDisabled={loading !== null || code.trim().length !== 6}
                testID='login-verify-code-button'
              >
                {loading === 'code' ? (
                  <ButtonSpinner mr='$2' color='$white' />
                ) : (
                  <Icon as={ArrowRight} size='xs' color='$white' mr='$2' />
                )}
                <ButtonText size='xs' fontWeight='$bold' color='$white'>
                  Ingresar a Zig-Zag
                </ButtonText>
              </Button>

              <HStack justifyContent='space-between' alignItems='center' pt='$1'>
                <Pressable onPress={() => setStep('email')}>
                  <Text size='2xs' color='$textLight500' fontWeight='$medium'>
                    Cambiar email
                  </Text>
                </Pressable>

                <Pressable onPress={handleRequestCode} disabled={loading !== null}>
                  <Text size='2xs' color='$primary600' fontWeight='$bold'>
                    Reenviar código
                  </Text>
                </Pressable>
              </HStack>
            </VStack>
          )}
        </Box>

        {/* Footer */}
        <VStack alignItems='center' mb='$4'>
          <Text size='2xs' color='rgba(255,255,255,0.6)' textAlign='center'>
            Al continuar, aceptás nuestros Términos de Servicio y Privacidad.
          </Text>
        </VStack>
      </Box>
    </Box>
  );
}
