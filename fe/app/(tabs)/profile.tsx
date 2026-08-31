import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Icon,
  Pressable,
  Button,
  ButtonText,
  ScrollView,
  Center,
  Spinner,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  Footprints,
  Compass,
  MapPin,
  Sparkles,
  LogOut,
  ChevronRight,
  Globe,
  Ruler,
  Sliders,
  Award,
  Bell,
} from 'lucide-react-native';
import { useAuth } from '@/context/auth';
import { fetchMyTours, Tour } from '@/api/tours';
import { FONT_DISPLAY } from '@/constants/typography';
import { enablePushNotifications } from '@/features/notifications/push-notifications';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(true);
  const [notificationStatus, setNotificationStatus] = useState<
    'idle' | 'enabling' | 'enabled' | 'denied' | 'error'
  >('idle');

  const handleEnableNotifications = async () => {
    if (notificationStatus === 'enabling') return;
    setNotificationStatus('enabling');
    try {
      setNotificationStatus(
        (await enablePushNotifications()) ? 'enabled' : 'denied',
      );
    } catch {
      setNotificationStatus('error');
    }
  };

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const load = async () => {
        setLoading(true);
        try {
          const { tours: myTours } = await fetchMyTours();
          if (!cancelled) setTours(myTours || []);
        } catch {
          // Fallback to empty if error
        } finally {
          if (!cancelled) setLoading(false);
        }
      };

      load();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const stats = useMemo(() => {
    const totalTours = tours.length;
    const totalStops = tours.reduce((acc, t) => acc + (t.activities?.length || 0), 0);
    const totalKm = tours.reduce((acc, t) => acc + (t.totalDistance || 2.4), 0);

    return {
      tours: totalTours,
      stops: totalStops,
      km: totalKm > 0 ? totalKm.toFixed(1) : '0.0',
    };
  }, [tours]);

  const initials = useMemo(() => {
    if (user?.name) {
      const parts = user.name.trim().split(' ');
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }
      return user.name.slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return 'ZZ';
  }, [user]);

  const explorerLevel = tours.length >= 5 ? 3 : tours.length >= 2 ? 2 : 1;

  return (
    <Box flex={1} bg='$backgroundLight100' alignItems='center'>
      <Box
        w='$full'
        maxW={560}
        flex={1}
        bg='$backgroundLight50'
        position='relative'
        shadowColor='$black'
        shadowOffset={{ width: 0, height: 4 }}
        shadowOpacity={0.06}
        shadowRadius={16}
        elevation={4}
      >
        <ScrollView
          flex={1}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Profile Header */}
          <Box
            p='$6'
            bg='$white'
            borderBottomWidth={1}
            borderBottomColor='$borderLight100'
            alignItems='center'
          >
            {/* Avatar with gradient & glow */}
            <Box
              w={80}
              h={80}
              borderRadius='$full'
              bg='$primary600'
              alignItems='center'
              justifyContent='center'
              shadowColor='$primary500'
              shadowOffset={{ width: 0, height: 4 }}
              shadowOpacity={0.25}
              shadowRadius={10}
              elevation={4}
              borderWidth={3}
              borderColor='$primary100'
              mb='$3'
            >
              <Text
                size='2xl'
                fontWeight='$bold'
                color='$white'
                style={{ fontFamily: FONT_DISPLAY }}
              >
                {initials}
              </Text>
            </Box>

            <Heading
              size='lg'
              color='$textLight900'
              style={{ fontFamily: FONT_DISPLAY }}
            >
              {user?.name || 'Explorador Zig-Zag'}
            </Heading>
            <Text size='xs' color='$textLight500' mt='$0.5'>
              {user?.email || 'viajero@zigzag.app'}
            </Text>

            {/* Level Badge */}
            <Box
              mt='$3'
              px='$3'
              py='$1'
              bg='$amber50'
              borderRadius='$full'
              borderWidth={1}
              borderColor='$amber200'
            >
              <HStack space='xs' alignItems='center'>
                <Icon as={Award} size='xs' color='$amber700' />
                <Text size='2xs' fontWeight='$bold' color='$amber800'>
                  Explorador Urbano • Nivel {explorerLevel}
                </Text>
              </HStack>
            </Box>
          </Box>

          {/* Stats Dashboard */}
          <Box p='$4'>
            <Text
              size='2xs'
              fontWeight='$bold'
              color='$textLight400'
              textTransform='uppercase'
              letterSpacing='$lg'
              mb='$2.5'
              px='$1'
            >
              Tus Estadísticas de Viaje
            </Text>

            {loading ? (
              <Center py='$6'>
                <Spinner size='small' color='$primary500' />
              </Center>
            ) : (
              <HStack space='sm'>
                <Box
                  flex={1}
                  bg='$white'
                  p='$3.5'
                  borderRadius='$2xl'
                  borderWidth={1}
                  borderColor='$borderLight200'
                  alignItems='center'
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={0.04}
                  shadowRadius={4}
                  elevation={1}
                >
                  <Text
                    size='xl'
                    fontWeight='$bold'
                    color='$primary600'
                    style={{ fontFamily: FONT_DISPLAY }}
                  >
                    {stats.tours}
                  </Text>
                  <Text size='2xs' color='$textLight500' fontWeight='$medium' mt='$0.5'>
                    Tours Creados
                  </Text>
                </Box>

                <Box
                  flex={1}
                  bg='$white'
                  p='$3.5'
                  borderRadius='$2xl'
                  borderWidth={1}
                  borderColor='$borderLight200'
                  alignItems='center'
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={0.04}
                  shadowRadius={4}
                  elevation={1}
                >
                  <Text
                    size='xl'
                    fontWeight='$bold'
                    color='$textLight900'
                    style={{ fontFamily: FONT_DISPLAY }}
                  >
                    {stats.stops}
                  </Text>
                  <Text size='2xs' color='$textLight500' fontWeight='$medium' mt='$0.5'>
                    Paradas
                  </Text>
                </Box>

                <Box
                  flex={1}
                  bg='$white'
                  p='$3.5'
                  borderRadius='$2xl'
                  borderWidth={1}
                  borderColor='$borderLight200'
                  alignItems='center'
                  shadowColor='$black'
                  shadowOffset={{ width: 0, height: 1 }}
                  shadowOpacity={0.04}
                  shadowRadius={4}
                  elevation={1}
                >
                  <Text
                    size='xl'
                    fontWeight='$bold'
                    color='$emerald600'
                    style={{ fontFamily: FONT_DISPLAY }}
                  >
                    {stats.km}
                  </Text>
                  <Text size='2xs' color='$textLight500' fontWeight='$medium' mt='$0.5'>
                    Km Caminados
                  </Text>
                </Box>
              </HStack>
            )}
          </Box>

          {/* Preferences & Settings */}
          <VStack px='$4' space='md'>
            {/* Travel Preferences */}
            <VStack space='xs'>
              <Text
                size='2xs'
                fontWeight='$bold'
                color='$textLight400'
                textTransform='uppercase'
                letterSpacing='$lg'
                px='$1'
              >
                Preferencias de Viaje
              </Text>

              <Box
                bg='$white'
                borderRadius='$2xl'
                borderWidth={1}
                borderColor='$borderLight200'
                overflow='hidden'
              >
                <Box p='$3.5' borderBottomWidth={1} borderBottomColor='$borderLight100'>
                  <HStack justifyContent='space-between' alignItems='center'>
                    <HStack space='md' alignItems='center'>
                      <Icon as={Footprints} size='sm' color='$primary600' />
                      <VStack>
                        <Text size='xs' fontWeight='$bold' color='$textLight900'>
                          Ritmo de Caminata
                        </Text>
                        <Text size='2xs' color='$textLight500'>
                          Moderado (aprox. 3 km/h)
                        </Text>
                      </VStack>
                    </HStack>
                    <Text size='xs' fontWeight='$bold' color='$primary600'>
                      Modificar
                    </Text>
                  </HStack>
                </Box>

                <Pressable
                  onPress={handleEnableNotifications}
                  p='$3.5'
                  borderBottomWidth={1}
                  borderBottomColor='$borderLight100'
                  testID='enable-notifications-button'
                >
                  <HStack justifyContent='space-between' alignItems='center'>
                    <HStack space='md' alignItems='center'>
                      <Icon as={Bell} size='sm' color='$textLight600' />
                      <VStack>
                        <Text size='xs' fontWeight='$bold' color='$textLight900'>
                          Notificaciones
                        </Text>
                        <Text size='2xs' color='$textLight500'>
                          Avisos cuando tu itinerario esté listo
                        </Text>
                      </VStack>
                    </HStack>
                    <Text size='xs' fontWeight='$bold' color='$primary600'>
                      {notificationStatus === 'enabling'
                        ? 'Activando…'
                        : notificationStatus === 'enabled'
                          ? 'Activadas'
                          : notificationStatus === 'denied'
                            ? 'Sin permiso'
                            : notificationStatus === 'error'
                              ? 'Reintentar'
                              : 'Activar'}
                    </Text>
                  </HStack>
                </Pressable>

                <Box p='$3.5'>
                  <HStack justifyContent='space-between' alignItems='center'>
                    <HStack space='md' alignItems='center'>
                      <Icon as={Sliders} size='sm' color='$tertiary600' />
                      <VStack>
                        <Text size='xs' fontWeight='$bold' color='$textLight900'>
                          Intereses Predilectos
                        </Text>
                        <Text size='2xs' color='$textLight500'>
                          Historia, Arquitectura, Gastronomía
                        </Text>
                      </VStack>
                    </HStack>
                    <Text size='xs' fontWeight='$bold' color='$primary600'>
                      Editar
                    </Text>
                  </HStack>
                </Box>
              </Box>
            </VStack>

            {/* App Settings */}
            <VStack space='xs'>
              <Text
                size='2xs'
                fontWeight='$bold'
                color='$textLight400'
                textTransform='uppercase'
                letterSpacing='$lg'
                px='$1'
              >
                Cuenta & Configuración
              </Text>

              <Box
                bg='$white'
                borderRadius='$2xl'
                borderWidth={1}
                borderColor='$borderLight200'
                overflow='hidden'
              >
                <Box p='$3.5' borderBottomWidth={1} borderBottomColor='$borderLight100'>
                  <HStack justifyContent='space-between' alignItems='center'>
                    <HStack space='md' alignItems='center'>
                      <Icon as={Ruler} size='sm' color='$textLight600' />
                      <VStack>
                        <Text size='xs' fontWeight='$bold' color='$textLight900'>
                          Unidades de Distancia
                        </Text>
                        <Text size='2xs' color='$textLight500'>
                          Kilómetros (km)
                        </Text>
                      </VStack>
                    </HStack>
                    <Text size='xs' fontWeight='$bold' color='$textLight400'>
                      km
                    </Text>
                  </HStack>
                </Box>

                <Box p='$3.5'>
                  <HStack justifyContent='space-between' alignItems='center'>
                    <HStack space='md' alignItems='center'>
                      <Icon as={Globe} size='sm' color='$textLight600' />
                      <VStack>
                        <Text size='xs' fontWeight='$bold' color='$textLight900'>
                          Idioma
                        </Text>
                        <Text size='2xs' color='$textLight500'>
                          Español
                        </Text>
                      </VStack>
                    </HStack>
                    <Text size='xs' fontWeight='$bold' color='$textLight400'>
                      ES
                    </Text>
                  </HStack>
                </Box>
              </Box>
            </VStack>

            {/* Logout Button */}
            <Box pt='$2'>
              <Button
                size='lg'
                variant='outline'
                action='negative'
                borderColor='$red200'
                bg='$red50'
                borderRadius='$2xl'
                h={48}
                onPress={signOut}
                testID='logout-button'
              >
                <Icon as={LogOut} size='xs' color='$red600' mr='$2' />
                <ButtonText size='sm' fontWeight='$bold' color='$red600'>
                  Cerrar Sesión
                </ButtonText>
              </Button>
            </Box>
          </VStack>
        </ScrollView>
      </Box>
    </Box>
  );
}
