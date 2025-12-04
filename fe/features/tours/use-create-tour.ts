import { useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { generateTour, GenerateTourDto, Tour } from '@/api/tours';

interface UseCreateTourOptions {
  category?: string;
  initialLatitude?: number;
  initialLongitude?: number;
}

interface UseCreateTourReturn {
  createTour: (preferences: GenerateTourDto) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
  tour: Tour | null;
}

/**
 * Custom hook for creating tours
 * Handles state management, API integration, validation, and navigation
 */
export function useCreateTour(
  options: UseCreateTourOptions = {}
): UseCreateTourReturn {
  const { category, initialLatitude, initialLongitude } = options;
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);

  /**
   * Validates that the tour preferences have required location data
   */
  const validatePreferences = (
    preferences: GenerateTourDto
  ): { valid: boolean; errorMessage?: string } => {
    const hasLatitude =
      preferences.latitude !== undefined ||
      preferences.destinationLatitude !== undefined ||
      initialLatitude !== undefined;
    const hasLongitude =
      preferences.longitude !== undefined ||
      preferences.destinationLongitude !== undefined ||
      initialLongitude !== undefined;
    const hasDestination = !!preferences.destination;

    if (!hasLatitude && !hasLongitude && !hasDestination) {
      return {
        valid: false,
        errorMessage: 'Se requiere un destino o coordenadas para crear el tour',
      };
    }

    if ((hasLatitude && !hasLongitude) || (!hasLatitude && hasLongitude)) {
      return {
        valid: false,
        errorMessage: 'Se requieren ambas coordenadas (latitud y longitud)',
      };
    }

    return { valid: true };
  };

  /**
   * Creates a tour with the given preferences
   */
  const createTour = useCallback(
    async (preferences: GenerateTourDto) => {
      // Reset previous error and tour
      setError(null);
      setTour(null);
      setIsLoading(true);

      try {
        // Validate preferences
        const validation = validatePreferences(preferences);
        if (!validation.valid) {
          const validationError = new Error(validation.errorMessage);
          setError(validationError);
          setIsLoading(false);
          throw validationError;
        }

        // Merge preferences with initial options
        const lat =
          preferences.latitude ||
          preferences.destinationLatitude ||
          initialLatitude;
        const lng =
          preferences.longitude ||
          preferences.destinationLongitude ||
          initialLongitude;

        const tourData: GenerateTourDto = {
          ...preferences,
          categories: category
            ? [category, ...(preferences.categories || [])]
            : preferences.categories,
          latitude: lat || preferences.latitude,
          longitude: lng || preferences.longitude,
        };

        // Call API to generate tour
        const newTour = await generateTour(tourData);

        if (!newTour || !newTour.id) {
          throw new Error('El tour se creó pero no se recibió un ID válido');
        }

        // Update state with created tour
        setTour(newTour);
        setIsLoading(false);

        // Navigate to tour detail page
        router.replace(`/tours/${newTour.id}`);
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error('Error desconocido al crear el tour');

        // Enhance error message for common cases
        if (err && typeof err === 'object' && 'response' in err) {
          const axiosError = err as any;
          if (axiosError.response?.data?.message) {
            error.message = axiosError.response.data.message;
          } else if (axiosError.response?.status === 400) {
            error.message =
              'Datos inválidos. Por favor verifica la información.';
          } else if (axiosError.response?.status === 500) {
            error.message =
              'Error del servidor. Por favor intenta nuevamente más tarde.';
          } else if (axiosError.message === 'Network Error') {
            error.message =
              'Error de conexión. Verifica tu conexión a internet.';
          }
        }

        setError(error);
        setIsLoading(false);
        throw error;
      }
    },
    [category, initialLatitude, initialLongitude, router]
  );

  return {
    createTour,
    isLoading,
    error,
    tour,
  };
}
