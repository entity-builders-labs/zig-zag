import React, { useEffect, useState } from 'react';
import { Dimensions, ScrollView, ActivityIndicator } from 'react-native';
import {
  Box,
  VStack,
  HStack,
  Text,
  Heading,
  Image,
  Button,
  ButtonText,
  Icon,
  Badge,
  BadgeText,
  Pressable,
  Center,
} from '@gluestack-ui/themed';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Clock,
  Footprints,
  Banknote,
  MapPin,
  Bus,
  Ticket,
  Info,
  ChevronRight,
} from 'lucide-react-native';
import { fetchTourById, Tour } from '../../api/tours';

const SCREEN_HEIGHT = Dimensions.get('window').height;

// --- Helper Functions ---

const getImage = (photos: any) => {
  if (Array.isArray(photos) && photos.length > 0) {
    const first = photos[0];
    return typeof first === 'string'
      ? first
      : first?.url || first?.photo_reference;
  }
  if (typeof photos === 'string') {
    return photos;
  }
  return 'https://images.unsplash.com/photo-1612287230217-969d69820d60?q=80&w=2836&auto=format&fit=crop'; // fallback
};

const getBadges = (activity: any) => {
  if (!activity) return [];
  const badges = [];
  if (activity.price) {
    badges.push({ text: `$${activity.price}`, action: 'info' });
  }
  if (activity.type) {
    badges.push({ text: activity.type, action: 'success' });
  }
  return badges;
};

// --- Components ---

const TourHeader = ({ tour }: { tour: Tour }) => {
  const router = useRouter();
  const firstActivity = tour.activities?.[0]?.activity;
  const imageUri = getImage(firstActivity?.photos);

  // Get tags from metadata or fallback to first activity type
  const tags =
    tour.metadata?.tags ||
    (firstActivity?.type
      ? [firstActivity.type]
      : tour.activities?.[0]?.activityType
        ? [tour.activities[0].activityType]
        : ['Tour']);

  return (
    <Box height={SCREEN_HEIGHT * 0.4} width='$full' position='relative'>
      {/* Background Image */}
      <Image
        source={{ uri: imageUri }}
        alt={tour.name}
        w='$full'
        h='$full'
        resizeMode='cover'
      />

      {/* Gradient Overlay (Simulated) */}
      <Box
        position='absolute'
        bottom={0}
        left={0}
        right={0}
        height='50%'
        bg='$black'
        opacity={0.6}
      />

      {/* Back Button */}
      <Box position='absolute' top={50} left={20} zIndex={10}>
        <Button
          size='sm'
          variant='solid'
          action='secondary'
          bg='rgba(255,255,255,0.2)'
          onPress={() => router.back()}
          borderRadius='$full'
          p='$2'
        >
          <Icon as={ArrowLeft} color='$white' size='xl' />
        </Button>
      </Box>

      {/* Title & Tags */}
      <VStack position='absolute' bottom={20} left={20} right={20} space='xs'>
        <HStack space='sm' flexWrap='wrap'>
          {tags.map((tag: string) => (
            <Badge
              key={tag}
              size='md'
              variant='solid'
              borderRadius='$full'
              action='info'
              bg='rgba(255,255,255,0.2)'
              borderColor='transparent'
            >
              <BadgeText color='$white' fontWeight='$medium'>
                {tag}
              </BadgeText>
            </Badge>
          ))}
        </HStack>
        <Heading color='$white' size='3xl' fontWeight='$bold' mt='$2'>
          {tour.name}
        </Heading>
      </VStack>
    </Box>
  );
};

const QuickStatsBar = ({ tour }: { tour: Tour }) => {
  return (
    <HStack
      bg='$white'
      p='$4'
      mx='$4'
      mt={-25}
      borderRadius='$xl'
      shadowColor='$black'
      shadowOffset={{ width: 0, height: 2 }}
      shadowOpacity={0.1}
      shadowRadius={8}
      elevation={5}
      justifyContent='space-around'
      alignItems='center'
    >
      <HStack alignItems='center' space='xs'>
        <Icon as={Clock} size='sm' color='$textLight500' />
        <Text size='sm' fontWeight='$bold' color='$textLight900'>
          {tour.duration ? `${Math.round(tour.duration)}h` : 'N/A'}
        </Text>
      </HStack>
      <Box w={1} h={20} bg='$borderLight200' />
      <HStack alignItems='center' space='xs'>
        <Icon as={Footprints} size='sm' color='$textLight500' />
        <Text size='sm' fontWeight='$bold' color='$textLight900'>
          {tour.totalDistance ? `${tour.totalDistance.toFixed(1)} km` : 'N/A'}
        </Text>
      </HStack>
      <Box w={1} h={20} bg='$borderLight200' />
      <HStack alignItems='center' space='xs'>
        <Icon as={Banknote} size='sm' color='$textLight500' />
        <Text size='sm' fontWeight='$bold' color='$textLight900'>
          {tour.price ? `$${tour.price}` : 'Free'}
        </Text>
      </HStack>
    </HStack>
  );
};

const SmartConnector = ({ data }: { data: any }) => {
  return (
    <HStack flex={1}>
      {/* Timeline Line */}
      <Box width={40} alignItems='center'>
        <Box
          flex={1}
          width={2}
          bg='$borderLight300'
          borderStyle='dashed'
          borderWidth={1}
          borderColor='#E5E5E5'
        />
      </Box>

      {/* Content */}
      <Box flex={1} py='$4'>
        <Box
          bg='$backgroundLight50'
          py='$2'
          px='$3'
          borderRadius='$full'
          alignSelf='flex-start'
          borderWidth={1}
          borderColor='$borderLight200'
        >
          <HStack space='sm' alignItems='center'>
            <Icon
              as={data.mode === 'bus' ? Bus : Footprints}
              size='xs'
              color='$primary500'
            />
            <Text size='xs' fontWeight='$medium' color='$textLight700'>
              {data.label} • {data.duration}
            </Text>
          </HStack>
        </Box>
      </Box>
    </HStack>
  );
};

const TourStopCard = ({ data, isLast }: { data: any; isLast: boolean }) => {
  return (
    <HStack flex={1}>
      {/* Timeline Node */}
      <Box width={40} alignItems='center' position='relative'>
        {/* Top Line */}
        <Box height={20} width={2} bg='$borderLight300' />

        {/* Node Dot */}
        <Box
          width={16}
          height={16}
          borderRadius='$full'
          bg='$primary500'
          borderWidth={3}
          borderColor='$white'
          zIndex={1}
          shadowColor='$primary500'
          shadowOffset={{ width: 0, height: 0 }}
          shadowOpacity={0.5}
          shadowRadius={4}
        />

        {/* Bottom Line (if not last) */}
        {!isLast && <Box flex={1} width={2} bg='$borderLight300' />}
      </Box>

      {/* Card Content */}
      <Box flex={1} pb='$6' pr='$4'>
        <Box
          bg='$white'
          borderRadius='$xl'
          overflow='hidden'
          borderWidth={1}
          borderColor='$borderLight100'
          shadowColor='$black'
          shadowOffset={{ width: 0, height: 1 }}
          shadowOpacity={0.05}
          shadowRadius={3}
          elevation={2}
        >
          <HStack>
            <Image
              source={{ uri: data.image }}
              alt={data.title}
              width={100}
              height={100}
              resizeMode='cover'
            />
            <VStack p='$3' flex={1} justifyContent='space-between'>
              <VStack>
                <Heading size='sm' numberOfLines={1} ellipsizeMode='tail'>
                  {data.title}
                </Heading>
                <Text size='xs' color='$textLight500' numberOfLines={2} mt='$1'>
                  {data.description}
                </Text>
              </VStack>

              <HStack
                justifyContent='space-between'
                alignItems='center'
                mt='$2'
              >
                <HStack space='xs'>
                  {data.badges?.map((badge: any, idx: number) => (
                    <Badge
                      key={idx}
                      size='sm'
                      action={badge.action}
                      variant='outline'
                      borderRadius='$sm'
                    >
                      <BadgeText fontSize='$2xs'>{badge.text}</BadgeText>
                    </Badge>
                  ))}
                </HStack>

                {/* Action Button */}
                <Button size='xs' variant='link' action='primary' p='$0'>
                  <ButtonText size='xs' fontWeight='$bold'>
                    Ver
                  </ButtonText>
                  <Icon as={ChevronRight} size='xs' ml='$1' />
                </Button>
              </HStack>
            </VStack>
          </HStack>
        </Box>
      </Box>
    </HStack>
  );
};

// --- Main Screen ---

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tour, setTour] = useState<Tour | null>(null);
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<any[]>([]);

  useEffect(() => {
    const loadTour = async () => {
      if (!id) return;
      console.log('$$$ id:', id);
      try {
        setLoading(true);
        const data = await fetchTourById(id);
        console.log('$$$ data:', data);
        setTour(data);

        // Transform activities to stops
        const transformedStops: any[] = [];
        const activities = data.activities || [];

        activities.forEach((item, index) => {
          // Handle potentially null activity (if relation is missing but inline data exists)
          const activity = item.activity;
          const activityId = activity?.id || `inline-${index}`;
          const activityName =
            activity?.name || item.activityName || 'Unknown Activity';
          const activityPhotos = activity?.photos;
          const activityDescription = activity?.description || item.notes;

          // Only add if we have at least a name
          if (!activityName) return;

          // Add Location
          transformedStops.push({
            type: 'location',
            id: activityId,
            title: activityName,
            image: getImage(activityPhotos),
            description: activityDescription,
            badges: getBadges(activity || { type: item.activityType }), // basic fallback for badges
          });

          // Add Transport if not last and we have info or just default
          if (index < activities.length - 1) {
            // Check if we have travel time info, otherwise generic walk
            const duration = item.travelTimeToNext
              ? `${Math.round(item.travelTimeToNext)} min`
              : '10 min'; // Default assumption

            transformedStops.push({
              type: 'transport',
              id: `t-${index}`,
              mode: 'walk',
              label: 'Caminata',
              duration: duration,
            });
          }
        });
        console.log('$$$ activities:', activities.length);
        setStops(transformedStops);
      } catch (error) {
        console.error('Failed to fetch tour:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTour();
  }, [id]);

  if (loading) {
    return (
      <Box
        flex={1}
        bg='$backgroundLight50'
        justifyContent='center'
        alignItems='center'
      >
        <ActivityIndicator size='large' color='#0000ff' />
      </Box>
    );
  }

  if (!tour) {
    return (
      <Box
        flex={1}
        bg='$backgroundLight50'
        justifyContent='center'
        alignItems='center'
      >
        <Text>Tour not found</Text>
      </Box>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <Box flex={1} bg='$backgroundLight50'>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          <TourHeader tour={tour} />

          <Box position='relative' zIndex={10}>
            <QuickStatsBar tour={tour} />
          </Box>

          <VStack mt='$6' px='$4'>
            <Heading size='md' mb='$4' color='$textLight800'>
              Tu Recorrido
            </Heading>

            <VStack>
              {stops.map((item, index) => {
                if (item.type === 'location') {
                  return (
                    <TourStopCard
                      key={item.id}
                      data={item}
                      isLast={index === stops.length - 1}
                    />
                  );
                } else {
                  return <SmartConnector key={item.id} data={item} />;
                }
              })}
            </VStack>
          </VStack>
        </ScrollView>

        {/* Floating CTA */}
        <Box
          position='absolute'
          bottom={0}
          left={0}
          right={0}
          p='$4'
          bg='$white'
          borderTopWidth={1}
          borderTopColor='$borderLight100'
        >
          <Button
            size='lg'
            variant='solid'
            action='primary'
            borderRadius='$full'
            shadowColor='$primary500'
            shadowOffset={{ width: 0, height: 4 }}
            shadowOpacity={0.3}
            shadowRadius={8}
            elevation={5}
          >
            <ButtonText fontWeight='$bold'>Comenzar Recorrido</ButtonText>
            <Icon as={MapPin} color='$white' ml='$2' />
          </Button>
        </Box>
      </Box>
    </>
  );
}
