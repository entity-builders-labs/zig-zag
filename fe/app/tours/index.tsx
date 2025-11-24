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
  Pressable,
} from '@gluestack-ui/themed';
import { FlatList } from 'react-native';
import { Link } from 'expo-router';
import axiosInstance from '@/api/config/axios';
import { useApi } from '@/api/hooks/useApi';
import { PaginatedResponseTour } from '@/components/types';

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
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [totalTours, setTotalTours] = useState<number>(0);

  const getTours = async () => {
    try {
      const response = (await axiosInstance.get(
        `/tours?page=${currentPage}`
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
          meta: meta,
        },
        success: true,
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
          code: 'API_ERROR',
        },
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

  return (
    <Box height='$full' bg='$backgroundLight100'>
      <FlatList
        data={data?.tours || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <VStack space='md' mb='$4'>
            <Heading>Tours</Heading>
            <Button onPress={() => setShowModal(true)}>
              <Text color='$white'>Create New Tour</Text>
            </Button>

            {loading && <Spinner size='large' />}

            {error && (
              <Box bg='$errorLight100' p='$3' borderRadius='$md'>
                <HStack space='sm' alignItems='center'>
                  <AlertCircleIcon color='$errorLight500' />
                  <Text color='$errorLight500'>{error.message}</Text>
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
                borderRadius='$md'
                shadowRadius={2}
                mb='$4'
              >
                <VStack space='sm'>
                  <Heading size='sm'>{tour.name}</Heading>
                  <Text>{tour.description}</Text>
                </VStack>
              </Box>
            </Pressable>
          </Link>
        )}
        ListFooterComponent={
          <HStack space='sm' justifyContent='center' mt='$4' mb='$8'>
            <Button
              variant='outline'
              onPress={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              isDisabled={currentPage === 1}
            >
              <Text>Previous</Text>
            </Button>
            <Text>
              Page {currentPage} of {totalPages}
            </Text>
            <Button
              variant='outline'
              onPress={() =>
                setCurrentPage((prev) => Math.min(totalPages, prev + 1))
              }
              isDisabled={currentPage === totalPages}
            >
              <Text>Next</Text>
            </Button>
          </HStack>
        }
      />
    </Box>
  );
}
