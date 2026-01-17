import React from 'react';
import { Box, VStack, Heading, ScrollView } from '@gluestack-ui/themed';
import { MoodsSection } from '@/components/home/MoodsSection';
import { HeroCard } from '@/components/home/HeroCard';
import { RoutesSection } from '@/components/home/RoutesSection';

export default function HomeScreen() {
  return (
    <Box flex={1} bg='#000'>
      <ScrollView
        flex={1}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <VStack space='2xl' pt='$4' pb='$8'>
          {/* Header Section */}
          <VStack space='md' px='$4' pt='$8'>
            <MoodsSection />
          </VStack>

          {/* Hero Card */}
          <HeroCard />

          {/* Routes Section */}
          <RoutesSection />
        </VStack>
      </ScrollView>
    </Box>
  );
}
