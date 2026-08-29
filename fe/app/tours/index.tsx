import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Heading,
  VStack,
  HStack,
  Text,
  Spinner,
  AlertCircleIcon,
  Pressable
} from '@gluestack-ui/themed';
import { FlatList } from 'react-native';
import { Link, useLocalSearchParams, router } from 'expo-router';
import axiosInstance from '@/api/config/axios';
import { useApi } from '@/api/hooks/useApi';
import { PaginatedResponseTour } from '@/components/types';
import { AppContext } from '@/context/app';
import { useContext } from 'react';
// Leaflet CSS usually requires special handling in React Native Web or might cause issues in Native.
// Assuming this is web-compatible or handled.
if (typeof window !== 'undefined') {
  try {
    require('leaflet/dist/leaflet.css');
  } catch (e) {
    // ignore if not available
  }
}

interface PaginatedResponse {
  data: PaginatedResponseTour | null;
}

export default function ToursScreen() {
  const {
    category,
    latitude: latParam,
    longitude: lngParam
  } = useLocalSearchParams<{
    category?: string;
    latitude?: string;
    longitude?: string;
  }>();
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTours, setTotalTours] = useState<number>(0);

  const { address } = useContext(AppContext);

  const handleGenerateUniqueTour = () => {
    const lat = latParam ? parseFloat(latParam) : address?.lat;
    const lng = lngParam ? parseFloat(lngParam) : address?.lng;
    router.push({
      pathname: '/tours/wizard',
      params: {
        ...(category ? { category } : {}),
        ...(lat !== undefined ? { latitude: String(lat) } : {}),
        ...(lng !== undefined ? { longitude: String(lng) } : {})
      }
    });
  };

  const getTours = async () => {
    try {
      const params = new URLSearchParams({
        page: currentPage.toString()
      });
      if (category) {
        params.append('category', category);
      }

      const lat = latParam || address?.lat.toString();
      const lng = lngParam || address?.lng.toString();

      if (lat && lng) {
        params.append('latitude', lat);
        params.append('longitude', lng);
        params.append('radius', '10000');
      }

      const response = (await axiosInstance.get(
        `/tours?${params.toString()}`
      )) as PaginatedResponse;

      console.log('$$$ response:', response);

      if (!response.data) {
        throw new Error('No data returned from API');
      }

      const { tours, meta } = response.data;
      setTotalPages(meta?.totalPages || 1);
      setTotalTours(tours.length);
      return {
        data: {
          tours: tours,
          meta: meta
        },
        success: true
      };
    } catch (error) {
      return {
        data: null,
        success: false,
        error: {
          message:
            error instanceof Error
              ? error.message
              : 'Failed to fetch activities',
          code: 'API_ERROR'
        }
      };
    }
  };

  const { data, error, loading } = useApi<PaginatedResponseTour>(getTours);

  // Effect to update local state when data changes
  useEffect(() => {
    if (loading) return;
    if (data) {
      setTotalPages(data.meta?.totalPages || 1);
      setTotalTours(data.tours.length);
    }
  }, [data]);

  // Reset page when category changes
  useEffect(() => {
    setCurrentPage(1);
  }, [category]);

  return (
    <Box height='$full' bg='$backgroundLight50'>
      <FlatList
        data={data?.tours || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        ListHeaderComponent={
          <VStack space='md' mb='$4'>
            <Heading
              size='xl'
              color='$textLight900'
              style={{ fontFamily: FONT_DISPLAY }}
            >
              {category ? `Tours: ${category}` : 'Explorar Recorridos'}
            </Heading>
            <Text size='sm' color='$textLight500'>
              {category
                ? `Mostrando experiencias curadas para ${category}`
                : 'Descubrí caminatas y recorridos creados con IA'}
            </Text>

            <HStack space='sm' mt='$2'>
              <Button
                flex={1}
                bg='$primary500'
                borderRadius='$2xl'
                h={48}
                onPress={() => router.push('/tours/wizard')}
                isDisabled={isGenerating}
              >
                <ButtonText color='$white' fontWeight='$bold'>
                  ✨ Crear Nuevo Tour
                </ButtonText>
              </Button>

              <Button
                onPress={handleGenerateUniqueTour}
                isDisabled={isGenerating}
                variant='outline'
                borderColor='$primary500'
                borderRadius='$2xl'
                h={48}
                px='$4'
              >
                {isGenerating ? (
                  <Spinner color='$primary500' size='small' />
                ) : (
                  <ButtonText color='$primary600' fontWeight='$bold'>
                    🪄 IA Sorpresa
                  </ButtonText>
                )}
              </Button>
            </HStack>

            {loading && (
              <Box py='$8' alignItems='center'>
                <Spinner size='large' color='$primary500' />
              </Box>
            )}

            {error && (
              <Box bg='$errorLight100' p='$4' borderRadius='$xl'>
                <HStack space='sm' alignItems='center'>
                  <AlertCircleIcon color='$errorLight500' />
                  <Text color='$errorLight500' size='sm'>
                    {error.message}
                  </Text>
                </HStack>
              </Box>
            )}
          </VStack>
        }
        renderItem={({ item: tour }) => (
          <Link href={`/tours/${tour.id}`} asChild>
            <Pressable>
              <Box
                bg='$white'
                p='$4'
                borderRadius='$2xl'
                borderWidth={1}
                borderColor='$borderLight100'
                shadowColor='$black'
                shadowOffset={{ width: 0, height: 2 }}
                shadowOpacity={0.04}
                shadowRadius={6}
                elevation={2}
                mb='$3'
              >
                <VStack space='xs'>
                  <Heading
                    size='sm'
                    color='$textLight900'
                    style={{ fontFamily: FONT_DISPLAY }}
                  >
                    {tour.name}
                  </Heading>
                  {tour.description && (
                    <Text size='xs' color='$textLight500' numberOfLines={2}>
                      {tour.description}
                    </Text>
                  )}
                  <HStack space='md' mt='$2' alignItems='center'>
                    <Text size='2xs' fontWeight='$bold' color='$primary600'>
                      📍 {tour.activities?.length || 0} paradas
                    </Text>
                    {tour.totalDistance && (
                      <Text size='2xs' color='$textLight500'>
                        🚶‍♂️ {tour.totalDistance.toFixed(1)} km
                      </Text>
                    )}
                  </HStack>
                </VStack>
              </Box>
            </Pressable>
          </Link>
        )}
        ListFooterComponent={
          totalPages > 1 ? (
            <HStack space='sm' justifyContent='center' mt='$4' mb='$8'>
              <Button
                variant='outline'
                borderRadius='$full'
                onPress={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                isDisabled={currentPage === 1}
              >
                <ButtonText>Anterior</ButtonText>
              </Button>
              <Box px='$3' py='$2'>
                <Text size='sm' color='$textLight700'>
                  Página {currentPage} de {totalPages}
                </Text>
              </Box>
              <Button
                variant='outline'
                borderRadius='$full'
                onPress={() =>
                  setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                }
                isDisabled={currentPage === totalPages}
              >
                <ButtonText>Siguiente</ButtonText>
              </Button>
            </HStack>
          ) : null
        }
      />
    </Box>
  );
}
