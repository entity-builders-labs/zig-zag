import { useCallback, useState } from 'react';
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
  ScrollView,
} from '@gluestack-ui/themed';
import { MapPin, Sparkles } from 'lucide-react-native';
import { Link, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { fetchMyTours, Tour } from '@/api/tours';

const DEFAULT_COVER =
  'https://images.unsplash.com/photo-1569336415962-a4bd9f69cd83?q=80&w=1000&auto=format&fit=crop';

function TourCard({ tour }: { tour: Tour }) {
  const generationStatus = (tour.metadata as any)?.generationStatus;
  const isGenerating =
    generationStatus === 'generating' || generationStatus === 'pending';

  return (
    <Link href={`/tours/${tour.id}`} asChild>
      <Pressable testID={`saved-tour-${tour.id}`}>
        <HStack
          bg='$white'
          rounded='$2xl'
          overflow='hidden'
          shadowColor='#000'
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.05}
          shadowRadius={8}
          elevation={2}
          h={100}
        >
          <Box w={100} bg='$gray100'>
            <Image
              source={{ uri: tour.coverImage || DEFAULT_COVER }}
              alt={tour.name}
              w='$full'
              h='$full'
              resizeMode='cover'
            />
          </Box>
          <VStack flex={1} p='$3' justifyContent='center' space='xs'>
            <Heading size='sm' color='#1A1A1A' numberOfLines={1}>
              {tour.name}
            </Heading>
            {isGenerating ? (
              <HStack space='xs' alignItems='center'>
                <Spinner size='small' />
                <Text size='xs' color='#6B7280'>
                  Generando actividades...
                </Text>
              </HStack>
            ) : (
              <HStack space='sm' alignItems='center'>
                <Icon as={MapPin} size='xs' color='#6B7280' />
                <Text size='sm' color='#6B7280'>
                  {tour.activities?.length || 0} paradas
                </Text>
              </HStack>
            )}
          </VStack>
        </HStack>
      </Pressable>
    </Link>
  );
}

export default function SavedScreen() {
  const router = useRouter();
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const load = async () => {
        setLoading(true);
        setError(null);
        try {
          const { tours: myTours } = await fetchMyTours();
          if (!cancelled) setTours(myTours);
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

  if (loading) {
    return (
      <Center flex={1}>
        <Spinner size='large' />
      </Center>
    );
  }

  if (error) {
    return (
      <Center flex={1} p='$4'>
        <Text color='$red600'>{error}</Text>
      </Center>
    );
  }

  if (tours.length === 0) {
    return (
      <Center flex={1} p='$6'>
        <VStack space='md' alignItems='center'>
          <Heading size='lg'>Guardados</Heading>
          <Text color='$textLight500' textAlign='center'>
            Todavía no creaste ningún tour. Armá uno y va a aparecer acá.
          </Text>
          <Button onPress={() => router.push('/tours/wizard')} size='lg'>
            <Icon as={Sparkles} size='sm' color='$white' mr='$2' />
            <ButtonText>Crear tour</ButtonText>
          </Button>
        </VStack>
      </Center>
    );
  }

  return (
    <ScrollView flex={1} bg='$backgroundLight50'>
      <VStack space='md' p='$4'>
        <Heading size='xl'>Guardados</Heading>
        <VStack space='sm'>
          {tours.map((tour) => (
            <TourCard key={tour.id} tour={tour} />
          ))}
        </VStack>
      </VStack>
    </ScrollView>
  );
}
