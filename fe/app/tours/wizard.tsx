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
    latitude: latParam,
    longitude: lngParam,
  } = useLocalSearchParams<{
    category?: string;
    latitude?: string;
    longitude?: string;
  }>();
  const { address } = useContext(AppContext);

  // Use the createTour hook
  const { createTour, isLoading, error } = useCreateTour({
    category,
    initialLatitude: latParam ? parseFloat(latParam) : address?.lat,
    initialLongitude: lngParam ? parseFloat(lngParam) : address?.lng,
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

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Nuevo Tour',
          presentation: 'modal',
          headerShown: false,
        }}
      />
      <TourWizardForm
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        initialLocation={
          address?.lat && address?.lng
            ? { lat: address.lat, lng: address.lng }
            : latParam && lngParam
              ? { lat: parseFloat(latParam), lng: parseFloat(lngParam) }
              : undefined
        }
      />
    </>
  );
}
