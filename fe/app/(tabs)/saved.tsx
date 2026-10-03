import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Image,
  Icon,
  Spinner,
  Center,
  Pressable,
  Button,
  ButtonText,
} from '@gluestack-ui/themed';
import { MapPin, Sparkles, Clock, Footprints, ArrowRight, Compass } from 'lucide-react-native';
import { Link, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchMyTours, Tour } from '@/api/tours';
import { FONT_DISPLAY } from '@/constants/typography';
import { getImage } from '@/components/tour-details/utils';

type FilterType = 'all' | 'completed' | 'generating';

function SavedTourCard({ tour }: { tour: Tour }) {
  const generationStatus = (tour.metadata as any)?.generationStatus;
  const isGenerating =
    generationStatus === 'generating' || generationStatus === 'pending';
  const stopCount = tour.experiences?.length || 0;
  // Same real-photo-first logic as TourHeader.tsx's own cover image — this
  // card used to ignore mediaPresentation entirely and always show one of 4
  // hardcoded stock photos by array index, even for a tour whose first
  // Experience already has real, enriched photos (verified live: a genuine
  // Chilecito street photo existed but this screen still showed a stock
  // Buenos Aires obelisk). getImage()'s own category fallback covers the
  // no-real-photos case, so no separate DEFAULT_COVERS array is needed.
  // Always index 0 (the best/primary real photo), never this card's list
  // position — getImage()'s `index` picks *which real photo* to show
  // (gallery[index % gallery.length]), not a fallback-variety knob; passing
  // the card's list position here picked a different, sometimes wildly
  // mismatched real photo per card (verified live: a second real photo in
  // the array turned out to be an unrelated, mislabeled Wikimedia file).
  const firstExperience = tour.experiences?.[0]?.experience;
  const cover =
    tour.coverImage ||
    getImage(
      firstExperience?.mediaPresentation?.photos,
      0,
      firstExperience?.themes?.[0],
    );

  const durationStr = tour.duration
    ? `${Math.floor(tour.duration / 60)}h ${tour.duration % 60 > 0 ? `${tour.duration % 60}m` : ''}`
    : '2h 30m';

  const distanceStr = tour.totalDistance
    ? `${tour.totalDistance.toFixed(1)} km`
    : '2.4 km';

  if (isGenerating) {
    return (
      <Link href={`/tours/${tour.id}`} asChild>
        <Pressable testID={`saved-tour-${tour.id}`}>
          <Box
            bg='$white'
            borderRadius='$2xl'
            borderWidth={1.5}
            borderColor='$primary200'
            overflow='hidden'
            p='$4'
            shadowColor='$black'
            shadowOffset={{ width: 0, height: 2 }}
            shadowOpacity={0.06}
            shadowRadius={8}
            elevation={2}
          >
            <HStack space='md' alignItems='center'>
              <Box
                w={48}
                h={48}
                borderRadius='$xl'
                bg='$primary50'
                alignItems='center'
                justifyContent='center'
              >
                <Spinner size='small' color='$primary600' />
              </Box>
              <VStack flex={1}>
                <Box alignSelf='flex-start' bg='$primary100' px='$2' py='$0.5' borderRadius='$sm'>
                  <Text size='2xs' fontWeight='$bold' color='$primary800'>
                    ⚡ Generando con IA
                  </Text>
                </Box>
                <Heading
                  size='sm'
                  color='$textLight900'
                  numberOfLines={1}
                  style={{ fontFamily: FONT_DISPLAY }}
                  mt='$1'
                >
                  {tour.name}
                </Heading>
                <Text size='xs' color='$textLight500' numberOfLines={1}>
                  Buscando paradas y trazando el mejor camino...
                </Text>
              </VStack>
            </HStack>
          </Box>
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={`/tours/${tour.id}`} asChild>
      <Pressable testID={`saved-tour-${tour.id}`}>
        <Box
          bg='$white'
          borderRadius='$3xl'
          borderWidth={1}
          borderColor='$borderLight200'
          overflow='hidden'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 3 }}
          shadowOpacity={0.08}
          shadowRadius={12}
          elevation={3}
        >
          {/* Cover Photo with Badges & Stats Overlay */}
          <Box h={150} w='$full' position='relative' bg='$backgroundDark900'>
            <Image
              source={{ uri: cover }}
              alt={tour.name}
              w='$full'
              h='$full'
              resizeMode='cover'
            />
            {/* Dark Gradient Overlay */}
            <Box
              position='absolute'
              top={0}
              left={0}
              right={0}
              bottom={0}
              bg='rgba(15, 23, 42, 0.35)'
            />

            {/* AI Badge */}
            <Box position='absolute' top={12} left={12}>
              <Box bg='$primary600' px='$2.5' py='$1' borderRadius='$full'>
                <Text size='2xs' fontWeight='$bold' color='$white' textTransform='uppercase'>
                  ✨ Curado con IA
                </Text>
              </Box>
            </Box>

            {/* Inline Stats */}
            <Box position='absolute' bottom={10} left={12} right={12}>
              <HStack space='sm' alignItems='center'>
                <HStack space='xs' alignItems='center'>
                  <Icon as={Clock} size='2xs' color='$white' />
                  <Text size='2xs' fontWeight='$bold' color='$white'>
                    {durationStr}
                  </Text>
                </HStack>
                <Text size='2xs' color='rgba(255,255,255,0.7)'>•</Text>
                <HStack space='xs' alignItems='center'>
                  <Icon as={Footprints} size='2xs' color='$white' />
                  <Text size='2xs' fontWeight='$bold' color='$white'>
                    {distanceStr}
                  </Text>
                </HStack>
                <Text size='2xs' color='rgba(255,255,255,0.7)'>•</Text>
                <HStack space='xs' alignItems='center'>
                  <Icon as={MapPin} size='2xs' color='$white' />
                  <Text size='2xs' fontWeight='$bold' color='$white'>
                    {stopCount} paradas
                  </Text>
                </HStack>
              </HStack>
            </Box>
          </Box>

          {/* Card Body */}
          <VStack p='$4' space='xs'>
            <Heading
              size='md'
              color='$textLight900'
              numberOfLines={1}
              style={{ fontFamily: FONT_DISPLAY }}
            >
              {tour.name}
            </Heading>

            {tour.description ? (
              <Text size='xs' color='$textLight600' numberOfLines={2}>
                {tour.description}
              </Text>
            ) : null}

            <HStack
              mt='$3'
              pt='$3'
              borderTopWidth={1}
              borderTopColor='$borderLight100'
              justifyContent='space-between'
              alignItems='center'
            >
              <Text size='2xs' fontWeight='$semibold' color='$textLight400'>
                {tour.metadata?.generationRequest?.destination?.label || 'Buenos Aires'}
              </Text>

              <HStack space='xs' alignItems='center'>
                <Text size='xs' fontWeight='$bold' color='$primary600'>
                  Abrir Itinerario
                </Text>
                <Icon as={ArrowRight} size='2xs' color='$primary600' />
              </HStack>
            </HStack>
          </VStack>
        </Box>
      </Pressable>
    </Link>
  );
}

export default function SavedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const load = async () => {
        setLoading(true);
        setError(null);
        try {
          const { tours: myTours } = await fetchMyTours();
          if (!cancelled) setTours(myTours || []);
        } catch {
          if (!cancelled) setError('No pudimos cargar tus tours.');
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

  const completedTours = useMemo(() => {
    return tours.filter((t) => {
      const status = (t.metadata as any)?.generationStatus;
      return status !== 'generating' && status !== 'pending';
    });
  }, [tours]);

  const generatingTours = useMemo(() => {
    return tours.filter((t) => {
      const status = (t.metadata as any)?.generationStatus;
      return status === 'generating' || status === 'pending';
    });
  }, [tours]);

  const filteredTours = useMemo(() => {
    if (activeFilter === 'completed') return completedTours;
    if (activeFilter === 'generating') return generatingTours;
    return tours;
  }, [activeFilter, tours, completedTours, generatingTours]);

  if (loading) {
    return (
      <Center flex={1} bg='$backgroundLight50'>
        <Spinner size='large' color='$primary500' />
      </Center>
    );
  }

  return (
    <Box flex={1} bg='$backgroundLight50'>
      {/* Header Bar */}
      <Box
          px='$5'
          pb='$3'
          bg='$white'
          borderBottomWidth={1}
          borderBottomColor='$borderLight100'
          style={{ paddingTop: insets.top + 16 }}
        >
          <Heading size='xl' color='$textLight900' style={{ fontFamily: FONT_DISPLAY }}>
            Mis Recorridos
          </Heading>
          <Text size='xs' color='$textLight500' mt='$0.5'>
            Tus itinerarios guardados y exploraciones
          </Text>

          {/* Filter Pills */}
          <HStack space='xs' mt='$3' pb='$1'>
            <Pressable onPress={() => setActiveFilter('all')}>
              <Box
                px='$3.5'
                py='$1.5'
                borderRadius='$full'
                bg={activeFilter === 'all' ? '$primary500' : '$backgroundLight100'}
              >
                <Text
                  size='xs'
                  fontWeight='$bold'
                  color={activeFilter === 'all' ? '$white' : '$textLight600'}
                >
                  Todos ({tours.length})
                </Text>
              </Box>
            </Pressable>

            <Pressable onPress={() => setActiveFilter('completed')}>
              <Box
                px='$3.5'
                py='$1.5'
                borderRadius='$full'
                bg={activeFilter === 'completed' ? '$primary500' : '$backgroundLight100'}
              >
                <Text
                  size='xs'
                  fontWeight='$bold'
                  color={activeFilter === 'completed' ? '$white' : '$textLight600'}
                >
                  Completados ({completedTours.length})
                </Text>
              </Box>
            </Pressable>

            {generatingTours.length > 0 && (
              <Pressable onPress={() => setActiveFilter('generating')}>
                <Box
                  px='$3.5'
                  py='$1.5'
                  borderRadius='$full'
                  bg={activeFilter === 'generating' ? '$primary500' : '$backgroundLight100'}
                >
                  <Text
                    size='xs'
                    fontWeight='$bold'
                    color={activeFilter === 'generating' ? '$white' : '$textLight600'}
                  >
                    En Curso ({generatingTours.length})
                  </Text>
                </Box>
              </Pressable>
            )}
          </HStack>
        </Box>

        {/* Content Body */}
        {filteredTours.length === 0 ? (
          <Center flex={1} p='$6'>
            <VStack space='md' alignItems='center' maxWidth={320}>
              <Box
                w={72}
                h={72}
                borderRadius='$3xl'
                bg='$primary50'
                alignItems='center'
                justifyContent='center'
                mb='$2'
              >
                <Icon as={Compass} size='xl' color='$primary600' />
              </Box>
              <Heading size='md' textAlign='center' style={{ fontFamily: FONT_DISPLAY }}>
                {activeFilter === 'generating'
                  ? 'No hay tours generándose'
                  : 'Aún no tenés recorridos guardados'}
              </Heading>
              <Text size='xs' color='$textLight500' textAlign='center'>
                {activeFilter === 'generating'
                  ? 'Todos tus recorridos fueron procesados correctamente.'
                  : 'Diseñá tu primer tour a medida con inteligencia artificial en segundos.'}
              </Text>
              <Button
                mt='$3'
                size='md'
                variant='solid'
                action='primary'
                bg='$primary500'
                borderRadius='$2xl'
                onPress={() => router.push('/tours/wizard')}
              >
                <Icon as={Sparkles} size='xs' color='$white' mr='$1.5' />
                <ButtonText size='sm' fontWeight='$bold' color='$white'>
                  Crear mi primer tour
                </ButtonText>
              </Button>
            </VStack>
          </Center>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            alwaysBounceVertical={true}
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 110 }}
          >
            <VStack space='lg'>
              {filteredTours.map((tour) => (
                <SavedTourCard key={tour.id} tour={tour} />
              ))}
            </VStack>
          </ScrollView>
        )}
      </Box>
  );
}
