import React from 'react';
import { Box, Heading } from '@gluestack-ui/themed';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { TourWizardForm } from '@/components/tours/TourWizardForm';
import { GenerateTourDto } from '@/api/tours';
import { useContext } from 'react';
import { AppContext } from '@/context/app';
import { useCreateTour } from '@/features/tours/use-create-tour';

export default function TourWizardScreen() {
  const router = useRouter();
  const {
    category,
    destination,
    latitude: latParam,
    longitude: lngParam
  } = useLocalSearchParams<{
    category?: string;
    destination?: string;
    latitude?: string;
    longitude?: string;
  }>();
  const { address } = useContext(AppContext);

  // Use the createTour hook
  const { createTour, isLoading, error } = useCreateTour({
    category,
  });

  const handleSubmit = async (preferences: GenerateTourDto) => {
    try {
      await createTour(preferences);
      // Navigation is handled automatically by the hook
    } catch (err) {
      console.error('Failed to generate tour', err);
      // Show error message to user
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Failed to generate a new tour. Please try again.';
      alert(errorMessage);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  const initialLocation = React.useMemo(() => {
    if (destination) {
      return latParam && lngParam
        ? { lat: parseFloat(latParam), lng: parseFloat(lngParam) }
        : undefined;
    }
    if (address?.lat && address?.lng) {
      return { lat: address.lat, lng: address.lng };
    }
    if (latParam && lngParam) {
      return { lat: parseFloat(latParam), lng: parseFloat(lngParam) };
    }
    return undefined;
  }, [destination, latParam, lngParam, address?.lat, address?.lng]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Nuevo Tour',
          presentation: 'modal',
          headerShown: false
        }}
      />
      <TourWizardForm
        isLoading={isLoading}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        initialDestination={destination}
        initialLocation={initialLocation}
      />
    </>
  );
}
