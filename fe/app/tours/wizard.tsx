import React from 'react';
import { Box, Heading } from '@gluestack-ui/themed';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { TourWizardForm } from '@/components/tours/TourWizardForm';
import {
  generateTour,
  generateTourActivities,
  GenerateTourDto,
} from '@/api/tours';
import { useContext, useState } from 'react';
import { AppContext } from '@/context/app';

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
  const [isGenerating, setIsGenerating] = useState(false);

  const handleSubmit = async (preferences: GenerateTourDto) => {
    setIsGenerating(true);
    try {
      const lat = latParam ? parseFloat(latParam) : address?.lat;
      const lng = lngParam ? parseFloat(lngParam) : address?.lng;

      // Create tour - it will automatically start generating activities in background
      const newTour = await generateTour({
        ...preferences,
        categories: category
          ? [category, ...(preferences.categories || [])]
          : preferences.categories,
        latitude: lat || preferences.latitude,
        longitude: lng || preferences.longitude,
      });

      if (newTour && newTour.id) {
        // Navigate to tour page immediately
        // Activities are being generated in background automatically
        router.replace(`/tours/${newTour.id}`);
      }
    } catch (err) {
      console.error('Failed to generate tour', err);
      alert('Failed to generate a new tour. Please try again.');
    } finally {
      setIsGenerating(false);
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
          headerShown: true,
        }}
      />
      <Box flex={1} bg='$white'>
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
      </Box>
    </>
  );
}
