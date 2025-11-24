import React from 'react';
import { ScrollView, Button, ButtonText, Icon } from '@gluestack-ui/themed';
import { Sparkles, Landmark, Trees, Coffee } from 'lucide-react-native';

const MOODS = [
  { id: '1', label: 'Romántico', icon: Sparkles },
  { id: '2', label: 'Historia', icon: Landmark },
  { id: '3', label: 'Aventura', icon: Trees },
  { id: '4', label: 'Cafés', icon: Coffee },
];

export const MoodsSection = () => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingRight: 20 }}
    >
      {MOODS.map((mood) => (
        <Button
          key={mood.id}
          variant='outline'
          borderColor='#D1D5DB'
          rounded='$full'
          size='sm'
          bg='$white'
          action='secondary'
        >
          <Icon as={mood.icon} mr='$2' size='sm' color='#4B5563' />
          <ButtonText color='#1A1A1A' fontWeight='$medium'>
            {mood.label}
          </ButtonText>
        </Button>
      ))}
    </ScrollView>
  );
};
