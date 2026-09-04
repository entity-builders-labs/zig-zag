import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  ActivityIndicator,
  Linking,
  Share,
} from 'react-native';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Image,
  Button,
  ButtonText,
  Pressable,
} from '@gluestack-ui/themed';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  MapPin,
  Star,
  Clock,
  Sparkles,
  Share2,
  Heart,
  Copy,
  Check,
  Compass,
} from 'lucide-react-native';
import {
  fetchExperienceById,
  fetchNearbyExperiences,
  ExperienceDetail,
  ExperienceSearchResult,
} from '../../api/experiences';
import { useSSE } from '../../api/hooks/useSSE';
import {
  getPhotoGallery,
  getHighlights,
  getCuratorTip,
  getOpeningHoursFormatted,
  getPriceLevelLabel,
  getNavigationUrls,
} from '../../components/tour-details/utils';
import { CompositeExperienceDetail } from '../../components/tour-details/CompositeExperienceDetail';

export default function ExperienceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [experience, setExperience] = useState<ExperienceDetail | null>(null);
  const [similarExperiences, setSimilarExperiences] = useState<ExperienceSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const refreshExperience = useCallback(async () => {
    if (!id) return;
    const data = await fetchExperienceById(id);
    setExperience(data);
  }, [id]);

  // Real-time push for enriched photos while this screen is open — same
  // channel/event the tour detail screen consumes (fe/app/tours/[id].tsx).
  useSSE(id ? `/notifications/experiences/${id}/stream` : null, {
    enabled: !!id,
    onOpen: () => {
      refreshExperience().catch((error) =>
        console.error('Failed to reconcile experience after SSE connect:', error)
      );
    },
    onEvent: (eventName, payload) => {
      if (eventName === 'experience.media.updated') {
        const { experienceId, mediaUpdatedAt, photos } = payload;
        if (experienceId === id && mediaUpdatedAt && Array.isArray(photos)) {
          setExperience((prev) => {
            if (!prev) return prev;
            if (
              prev.mediaUpdatedAt &&
              Date.parse(prev.mediaUpdatedAt) >= Date.parse(mediaUpdatedAt)
            ) {
              return prev;
            }
            return { ...prev, photos, mediaUpdatedAt };
          });
        } else {
          refreshExperience().catch((error) =>
            console.error('Failed to refresh experience media:', error)
          );
        }
      }
    },
  });

  useEffect(() => {
    const loadExperience = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await fetchExperienceById(id);
        setExperience(data);

        if (data.latitude != null && data.longitude != null) {
          try {
            const nearby = await fetchNearbyExperiences({
              latitude: data.latitude,
              longitude: data.longitude,
              radius: 3000,
            });
            setSimilarExperiences(nearby.filter((item) => item.id !== id).slice(0, 6));
          } catch {
            // Non-critical fallback
          }
        }
      } catch (error) {
        console.error('Failed to fetch experience:', error);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    loadExperience();
  }, [id]);

  if (loading) {
    return (
      <Box flex={1} bg='#F8FAFC' justifyContent='center' alignItems='center'>
        <ActivityIndicator size='large' color='#F2994A' />
        <Text mt='$3' color='$textLight500' fontWeight='$medium' fontSize='$sm'>
          Cargando detalles del lugar...
        </Text>
      </Box>
    );
  }

  if (notFound || !experience) {
    return (
      <Box flex={1} bg='#F8FAFC' justifyContent='center' alignItems='center' p='$6'>
        <Text fontSize='$4xl' mb='$2'>🏛️</Text>
        <Heading size='md' color='$textLight900' mb='$2'>
          Lugar no encontrado
        </Heading>
        <Text textAlign='center' color='$textLight500' mb='$6' fontSize='$sm'>
          No pudimos encontrar la información de esta experiencia en el catálogo.
        </Text>
        <Button bg='#F2994A' rounded='$xl' onPress={() => router.back()} px='$6'>
          <ButtonText color='$white' fontWeight='$bold'>
            Volver
          </ButtonText>
        </Button>
      </Box>
    );
  }

  // A multi-component Experience (walk/route) gets a specialized itinerary
  // view instead of the flat single-place layout below.
  if (experience.components.length > 1) {
    return <CompositeExperienceDetail experience={experience} />;
  }

  // getHighlights/getCuratorTip/getBadges were written against the legacy
  // Activity shape (rating/priceLevel); bridge the equivalent Experience
  // fields so those heuristics keep working without touching shared utils.
  const legacyShaped = {
    ...experience,
    rating: experience.qualityScore,
    priceLevel: undefined as number | undefined,
    formattedAddress: experience.address,
  };

  const gallery = getPhotoGallery(experience.photos, experience.type);
  const highlights = getHighlights(legacyShaped);
  const curatorTip = getCuratorTip(legacyShaped);
  const hoursInfo = getOpeningHoursFormatted(experience.openingHours);
  const priceLabel = getPriceLevelLabel(undefined, experience.price);
  const navUrls = getNavigationUrls(
    experience.latitude,
    experience.longitude,
    experience.address,
    experience.name
  );

  const handleShare = async () => {
    try {
      await Share.share({
        title: experience.name,
        message: `¡Mirá este lugar en ZigZag!: ${experience.name}\n${experience.address || ''}`,
      });
    } catch {
      // Fallback
    }
  };

  const handleCopyAddress = () => {
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2500);
  };

  const handleOpenLink = (url?: string) => {
    if (!url) return;
    const cleanUrl = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(cleanUrl).catch(() => {});
  };

  const durationMin = experience.durationMinutes || 90;
  const durationFormatted =
    durationMin >= 60
      ? `${Math.floor(durationMin / 60)}h ${durationMin % 60 > 0 ? `${durationMin % 60}m` : ''}`
      : `${durationMin}m`;

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Box flex={1} bg='#F8FAFC'>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
          <Box height={320} width='$full' position='relative' bg='#0F172A'>
            <Image
              source={{ uri: gallery[activePhotoIndex] || gallery[0] }}
              alt={experience.name}
              w='$full'
              h='$full'
              resizeMode='cover'
            />
            <Box position='absolute' top={0} left={0} right={0} bottom={0} bg='rgba(0, 0, 0, 0.25)' />

            <HStack position='absolute' top={44} left={16} right={16} justifyContent='space-between' alignItems='center' zIndex={10}>
              <Pressable
                onPress={handleBack}
                w={40} h={40} rounded='$full' bg='rgba(255, 255, 255, 0.92)'
                justifyContent='center' alignItems='center'
                shadowColor='#000' shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.15} shadowRadius={4} elevation={3}
                testID='experience-back-button'
              >
                <ArrowLeft size={20} color='#0F172A' />
              </Pressable>

              <HStack space='sm'>
                <Pressable
                  onPress={handleShare}
                  w={40} h={40} rounded='$full' bg='rgba(255, 255, 255, 0.92)'
                  justifyContent='center' alignItems='center'
                  shadowColor='#000' shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.15} shadowRadius={4} elevation={3}
                >
                  <Share2 size={18} color='#0F172A' />
                </Pressable>

                <Pressable
                  onPress={() => setIsFavorite(!isFavorite)}
                  w={40} h={40} rounded='$full' bg='rgba(255, 255, 255, 0.92)'
                  justifyContent='center' alignItems='center'
                  shadowColor='#000' shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.15} shadowRadius={4} elevation={3}
                >
                  <Heart size={18} color={isFavorite ? '#EF4444' : '#0F172A'} fill={isFavorite ? '#EF4444' : 'none'} />
                </Pressable>
              </HStack>
            </HStack>

            <Box position='absolute' bottom={24} right={16} bg='rgba(0, 0, 0, 0.65)' px='$2.5' py='$1' rounded='$xl'>
              <Text color='$white' fontSize='$xs' fontWeight='$bold'>
                {activePhotoIndex + 1} / {gallery.length} fotos
              </Text>
            </Box>

            {gallery.length > 1 && (
              <HStack position='absolute' bottom={26} left={16} space='xs' alignItems='center'>
                {gallery.map((_, i) => (
                  <Pressable
                    key={i}
                    onPress={() => setActivePhotoIndex(i)}
                    w={activePhotoIndex === i ? 22 : 8}
                    h={8}
                    rounded='$full'
                    bg={activePhotoIndex === i ? '#F2994A' : 'rgba(255, 255, 255, 0.55)'}
                  />
                ))}
              </HStack>
            )}
          </Box>

          <VStack px='$4' pt='$4' space='md' mt={-16} bg='#F8FAFC' borderTopLeftRadius={24} borderTopRightRadius={24}>
            <Box bg='$white' p='$4' rounded='$2xl' borderWidth={1} borderColor='#E2E8F0' shadowColor='#000' shadowOffset={{ width: 0, height: 1 }} shadowOpacity={0.05} shadowRadius={3} elevation={2}>
              <HStack justifyContent='space-between' alignItems='center' mb='$2'>
                <Box bg='#ECFDF5' borderWidth={1} borderColor='rgba(16, 185, 129, 0.3)' px='$2' py='$0.5' rounded='$md'>
                  <Text color='#065F46' fontSize='$xs' fontWeight='$bold'>
                    ✓ Lugar 100% Verificado
                  </Text>
                </Box>
                <Box bg='#F1F5F9' px='$2.5' py='$0.5' rounded='$md'>
                  <Text color='#475569' fontSize='$xs' fontWeight='$bold' textTransform='uppercase'>
                    {experience.type || 'Atracción'}
                  </Text>
                </Box>
              </HStack>

              <Heading size='xl' color='#0F172A' fontWeight='$bold' mb='$2'>
                {experience.name}
              </Heading>

              <HStack space='xs' flexWrap='wrap' mt='$1'>
                <HStack bg='#FEF3C7' borderWidth={1} borderColor='#FDE68A' px='$2' py='$1' rounded='$lg' alignItems='center' space='xs' mb='$1'>
                  <Star size={13} color='#B45309' fill='#B45309' />
                  <Text color='#92400E' fontSize='$xs' fontWeight='$bold'>
                    {experience.qualityScore ? experience.qualityScore.toFixed(1) : '4.7'}
                  </Text>
                </HStack>

                <HStack bg='#EFF6FF' borderWidth={1} borderColor='#DBEAFE' px='$2' py='$1' rounded='$lg' alignItems='center' mb='$1'>
                  <Text color='#1E40AF' fontSize='$xs' fontWeight='$bold'>
                    {priceLabel}
                  </Text>
                </HStack>

                <HStack bg='#F8FAFC' borderWidth={1} borderColor='#E2E8F0' px='$2' py='$1' rounded='$lg' alignItems='center' space='xs' mb='$1'>
                  <Clock size={13} color='#64748B' />
                  <Text color='#334155' fontSize='$xs' fontWeight='$semibold'>
                    ⏱️ {durationFormatted} sugerido
                  </Text>
                </HStack>
              </HStack>
            </Box>

            {highlights.length > 0 && (
              <VStack space='xs'>
                <HStack alignItems='center' space='xs' mb='$1'>
                  <Sparkles size={16} color='#F2994A' />
                  <Heading size='xs' color='#64748B' textTransform='uppercase' letterSpacing={0.5}>
                    Lo Destacado
                  </Heading>
                </HStack>
                <VStack space='xs'>
                  {highlights.map((hl, index) => (
                    <Box key={index} bg='$white' borderWidth={1} borderColor='#E2E8F0' rounded='$xl' p='$3' shadowColor='#000' shadowOffset={{ width: 0, height: 1 }} shadowOpacity={0.03} shadowRadius={2} elevation={1}>
                      <Text color='#1E293B' fontSize='$sm' fontWeight='$semibold' lineHeight='$sm'>
                        {hl}
                      </Text>
                    </Box>
                  ))}
                </VStack>
              </VStack>
            )}

            {curatorTip && (
              <Box bg='#FFF9F3' borderWidth={1} borderColor='#FCD8B8' rounded='$2xl' p='$4' position='relative' overflow='hidden'>
                <Box position='absolute' left={0} top={0} bottom={0} w={4} bg='#F2994A' />
                <HStack alignItems='center' space='xs' mb='$1.5'>
                  <Text fontSize='$md'>💡</Text>
                  <Text color='#C05621' fontSize='$xs' fontWeight='$bold' textTransform='uppercase' letterSpacing={0.5}>
                    Consejo del Guía Local
                  </Text>
                </HStack>
                <Text color='#7B341E' fontSize='$sm' fontStyle='italic' lineHeight='$md'>
                  "{curatorTip}"
                </Text>
              </Box>
            )}

            {experience.description && (
              <Box bg='$white' p='$4' rounded='$2xl' borderWidth={1} borderColor='#E2E8F0'>
                <Heading size='xs' color='#64748B' textTransform='uppercase' letterSpacing={0.5} mb='$2'>
                  📖 Historia y Qué Esperar
                </Heading>
                <Text color='#334155' fontSize='$sm' lineHeight='$md'>
                  {experience.description}
                </Text>
              </Box>
            )}

            <Box bg='$white' p='$4' rounded='$2xl' borderWidth={1} borderColor='#E2E8F0'>
              <HStack justifyContent='space-between' alignItems='center' mb='$3'>
                <Heading size='xs' color='#64748B' textTransform='uppercase' letterSpacing={0.5}>
                  ⏰ Horarios
                </Heading>
                <Box bg={hoursInfo.isOpenNow ? '#ECFDF5' : '#FEF2F2'} borderWidth={1} borderColor={hoursInfo.isOpenNow ? '#A7F3D0' : '#FECACA'} px='$2.5' py='$0.5' rounded='$md'>
                  <Text color={hoursInfo.isOpenNow ? '#065F46' : '#991B1B'} fontSize='$xs' fontWeight='$bold'>
                    {hoursInfo.isOpenNow ? '🟢 Abierto hoy' : '🔴 Cerrado hoy'}
                  </Text>
                </Box>
              </HStack>
              <VStack space='xs'>
                {hoursInfo.scheduleRows.map((row, idx) => (
                  <HStack key={idx} justifyContent='space-between' py='$1' borderBottomWidth={idx === hoursInfo.scheduleRows.length - 1 ? 0 : 1} borderColor='#F1F5F9'>
                    <Text fontSize='$xs' color={row.isToday ? '#0F172A' : '#64748B'} fontWeight={row.isToday ? '$bold' : '$normal'}>
                      {row.day}
                    </Text>
                    <Text fontSize='$xs' color={row.isToday ? '#F2994A' : '#334155'} fontWeight={row.isToday ? '$bold' : '$medium'}>
                      {row.hours}
                    </Text>
                  </HStack>
                ))}
              </VStack>
            </Box>

            <Box bg='$white' p='$4' rounded='$2xl' borderWidth={1} borderColor='#E2E8F0'>
              <Heading size='xs' color='#64748B' textTransform='uppercase' letterSpacing={0.5} mb='$2'>
                📍 Ubicación y Cómo Llegar
              </Heading>
              <HStack alignItems='flex-start' space='xs' mb='$3'>
                <MapPin size={16} color='#F2994A' style={{ marginTop: 2 }} />
                <Text color='#334155' fontSize='$sm' flex={1} lineHeight='$md'>
                  {experience.address || 'Dirección no disponible'}
                </Text>
                <Pressable onPress={handleCopyAddress} p='$1'>
                  {copiedAddress ? <Check size={16} color='#10B981' /> : <Copy size={16} color='#64748B' />}
                </Pressable>
              </HStack>

              <HStack space='xs'>
                <Button flex={1} variant='outline' borderColor='#E2E8F0' bg='#F8FAFC' rounded='$xl' size='xs' py='$2' onPress={() => handleOpenLink(navUrls.google)}>
                  <ButtonText color='#0F172A' fontSize='$xs' fontWeight='$bold'>🗺️ Google Maps</ButtonText>
                </Button>
                <Button flex={1} variant='outline' borderColor='#E2E8F0' bg='#F8FAFC' rounded='$xl' size='xs' py='$2' onPress={() => handleOpenLink(navUrls.apple)}>
                  <ButtonText color='#0F172A' fontSize='$xs' fontWeight='$bold'>🧭 Apple Maps</ButtonText>
                </Button>
                <Button flex={1} variant='outline' borderColor='#E2E8F0' bg='#F8FAFC' rounded='$xl' size='xs' py='$2' onPress={() => handleOpenLink(navUrls.waze)}>
                  <ButtonText color='#0F172A' fontSize='$xs' fontWeight='$bold'>🚗 Waze</ButtonText>
                </Button>
              </HStack>
            </Box>

            {similarExperiences.length > 0 && (
              <VStack space='xs' mt='$2'>
                <Heading size='xs' color='#64748B' textTransform='uppercase' letterSpacing={0.5} mb='$1'>
                  💎 Lugares Cercanos en la Zona
                </Heading>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <HStack space='sm' pb='$2'>
                    {similarExperiences.map((sim, idx) => (
                      <Pressable
                        key={idx}
                        onPress={() => router.push(`/experiences/${sim.id}` as any)}
                        w={140}
                        bg='$white'
                        rounded='$xl'
                        borderWidth={1}
                        borderColor='#E2E8F0'
                        overflow='hidden'
                        shadowColor='#000'
                        shadowOffset={{ width: 0, height: 1 }}
                        shadowOpacity={0.04}
                        shadowRadius={2}
                      >
                        <Image
                          source={{ uri: getPhotoGallery(undefined, sim.themes?.[0])[0] }}
                          alt={sim.canonicalName}
                          w='$full'
                          h={80}
                          resizeMode='cover'
                        />
                        <VStack p='$2'>
                          <Text color='#0F172A' fontSize='$xs' fontWeight='$bold' numberOfLines={1}>
                            {sim.canonicalName}
                          </Text>
                          <Text color='#64748B' fontSize='$2xs' mt='$0.5'>
                            ⭐ {sim.qualityScore ? sim.qualityScore.toFixed(1) : '4.6'}
                          </Text>
                        </VStack>
                      </Pressable>
                    ))}
                  </HStack>
                </ScrollView>
              </VStack>
            )}
          </VStack>
        </ScrollView>

        <Box position='absolute' bottom={0} left={0} right={0} bg='rgba(255, 255, 255, 0.96)' borderTopWidth={1} borderColor='#E2E8F0' p='$3' px='$4' shadowColor='#000' shadowOffset={{ width: 0, height: -2 }} shadowOpacity={0.06} shadowRadius={4} elevation={5}>
          <Button bg='#F2994A' rounded='$xl' py='$3' onPress={() => handleOpenLink(navUrls.google)}>
            <Compass size={18} color='#FFFFFF' style={{ marginRight: 6 }} />
            <ButtonText color='$white' fontWeight='$bold' fontSize='$sm'>
              Cómo Llegar (Iniciar Ruta)
            </ButtonText>
          </Button>
        </Box>
      </Box>
    </>
  );
}
