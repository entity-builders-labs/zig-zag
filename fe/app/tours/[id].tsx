import React from 'react';
import { Dimensions, ScrollView } from 'react-native';
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
} from '@gluestack-ui/themed';
import { Stack, useRouter } from 'expo-router';
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

// --- Mock Data ---

const SCREEN_HEIGHT = Dimensions.get('window').height;

const TOUR_DATA = {
  id: '1',
  title: 'Joyas Ocultas de Palermo',
  image:
    'https://images.unsplash.com/photo-1612287230217-969d69820d60?q=80&w=2836&auto=format&fit=crop',
  stats: {
    duration: '2h 30m',
    distance: '3.5 km',
    price: '$5000',
  },
  tags: ['Arte', 'Arquitectura', 'Café'],
  stops: [
    {
      type: 'location',
      id: 'l1',
      title: 'Museo MALBA',
      image:
        'https://images.unsplash.com/photo-1554232682-b9ef9c92f8de?q=80&w=2940&auto=format&fit=crop',
      badges: [
        { text: '$$', action: 'info' },
        { text: 'Abierto', action: 'success' },
      ],
      description: 'Icono del arte latinoamericano moderno.',
    },
    {
      type: 'transport',
      id: 't1',
      mode: 'bus',
      label: 'Bus 152',
      duration: '15 min',
    },
    {
      type: 'location',
      id: 'l2',
      title: 'Jardín Japonés',
      image:
        'https://images.unsplash.com/photo-1613328829839-91b293d9a2d9?q=80&w=2671&auto=format&fit=crop',
      badges: [
        { text: '$$$', action: 'info' },
        { text: 'Cierra pronto', action: 'warning' },
      ],
      description: 'Un oasis de calma y belleza tradicional.',
    },
    {
      type: 'transport',
      id: 't2',
      mode: 'walk',
      label: 'Caminata',
      duration: '10 min',
    },
    {
      type: 'location',
      id: 'l3',
      title: 'Planetario Galileo Galilei',
      image:
        'https://images.unsplash.com/photo-1518182170546-0766de6f6a56?q=80&w=2000&auto=format&fit=crop', // Generic space/night img
      badges: [{ text: 'Gratis', action: 'success' }],
      description: 'Observatorio icónico con espectáculos de luces.',
    },
  ],
};

// --- Components ---

const TourHeader = () => {
  const router = useRouter();

  return (
    <Box height={SCREEN_HEIGHT * 0.4} width='$full' position='relative'>
      {/* Background Image */}
      <Image
        source={{ uri: TOUR_DATA.image }}
        alt={TOUR_DATA.title}
        width='$full'
        height='$full'
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
          {TOUR_DATA.tags.map((tag) => (
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
          {TOUR_DATA.title}
        </Heading>
      </VStack>
    </Box>
  );
};

const QuickStatsBar = () => {
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
          {TOUR_DATA.stats.duration}
        </Text>
      </HStack>
      <Box w={1} h={20} bg='$borderLight200' />
      <HStack alignItems='center' space='xs'>
        <Icon as={Footprints} size='sm' color='$textLight500' />
        <Text size='sm' fontWeight='$bold' color='$textLight900'>
          {TOUR_DATA.stats.distance}
        </Text>
      </HStack>
      <Box w={1} h={20} bg='$borderLight200' />
      <HStack alignItems='center' space='xs'>
        <Icon as={Banknote} size='sm' color='$textLight500' />
        <Text size='sm' fontWeight='$bold' color='$textLight900'>
          {TOUR_DATA.stats.price}
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
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <Box flex={1} bg='$backgroundLight50'>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          <TourHeader />

          <Box position='relative' zIndex={10}>
            <QuickStatsBar />
          </Box>

          <VStack mt='$6' px='$4'>
            <Heading size='md' mb='$4' color='$textLight800'>
              Tu Recorrido
            </Heading>

            <VStack>
              {TOUR_DATA.stops.map((item, index) => {
                if (item.type === 'location') {
                  return (
                    <TourStopCard
                      key={item.id}
                      data={item}
                      isLast={index === TOUR_DATA.stops.length - 1}
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
