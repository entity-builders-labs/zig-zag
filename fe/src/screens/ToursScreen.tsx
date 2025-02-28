import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  FormControl,
  Heading,
  Input,
  Modal,
  TextArea,
  VStack,
  HStack,
  Text,
  Spinner,
  AlertCircleIcon,
} from '@gluestack-ui/themed';
import axiosInstance from '../api/config/axios';
import 'leaflet/dist/leaflet.css';
import { useApi } from '../api/hooks/useApi';

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

interface Activity {
  id: string;
  name: string;
  tourId: string;
  latitude: number;
  longitude: number;
}

export const ToursScreen: React.FC = () => {
  const [tours, setTours] = useState<Tour[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [setError] = useState<string | null>(null);
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

  return (
    <Box display='flex' flexDirection='row' height='$12'>
      <Box
        width='$1/2'
        bg='$backgroundLight100'
        p='$4'
        borderRightWidth={1}
        borderColor='$borderLight200'
      >
        <VStack space='md'>
          <Button onPress={() => setShowModal(true)}>Create New Tour</Button>

          {isLoading && <Spinner size='large' />}

          {error && (
            <Box bg='$errorLight100' p='$3' borderRadius='$md'>
              <HStack space='sm' alignItems='center'>
                <AlertCircleIcon color='$errorLight500' />
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
              Previous
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
              Next
            </Button>
          </HStack>
        </VStack>
      </Box>
      <Box flex={1} bg='$backgroundLight100'></Box>
    </Box>
  );
};
