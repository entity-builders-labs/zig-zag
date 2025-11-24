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
} from '@gluestack-ui/themed';
import axiosInstance from '@/api/config/axios';
import { useApi } from '@/api/hooks/useApi';

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
  tours: Tour[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface Tour {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
}

export default function ToursScreen() {
  const [tours, setTours] = useState<Tour[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [totalTours, setTotalTours] = useState<number>(0);

  const getTours = async () => {
    try {
      const response = (await axiosInstance.get(
        `/tours?page=${currentPage}`
      )) as PaginatedResponse;

      if (!response.tours) {
        throw new Error('No data returned from API');
      }

      const { tours, meta } = response;
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

  const { data, error, loading } = useApi<PaginatedResponse>(getTours);

  // Effect to update local state when data changes
  useEffect(() => {
    if (data?.tours) {
      setTours(data.tours);
      if (data.meta) {
        setTotalPages(data.meta.totalPages);
        setTotalTours(data.meta.total);
      }
    }
  }, [data]);

  return (
    <Box
      display='flex'
      flexDirection='row'
      height='$full'
      p='$4'
      bg='$backgroundLight100'
    >
      <Box width='$full' bg='$backgroundLight100'>
        <VStack space='md'>
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

          {tours.map((tour) => (
            <Box
              key={tour.id}
              bg='$white'
              p='$4'
              borderRadius='$md'
              shadowRadius={2}
            >
              <VStack space='sm'>
                <Heading size='sm'>{tour.name}</Heading>
                <Text>{tour.description}</Text>
              </VStack>
            </Box>
          ))}

          <HStack space='sm' justifyContent='center' mt='$4'>
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
        </VStack>
      </Box>
    </Box>
  );
}
