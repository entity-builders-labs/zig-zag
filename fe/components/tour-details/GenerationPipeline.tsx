import React from 'react';
import { VStack, HStack, Box, Text } from '@gluestack-ui/themed';

// Grouped from the REAL sequential messages tour-activity-generation.service.ts
// writes to tour.metadata.generationMessage as generation progresses (see
// updateGenerationStatus call sites) — not fabricated. Matched by substring
// since the backend sends free text, not a stage enum; stages are ordered,
// so whichever one matches the CURRENT message marks every earlier stage as
// done too.
const STAGES: { label: string; match: RegExp }[] = [
  { label: 'Buscando lugares cercanos', match: /iniciando|búsqueda de actividades|google maps/i },
  { label: 'Generando itinerario con IA', match: /itinerario|inteligencia artificial/i },
  { label: 'Guardando actividades', match: /guardando|portada/i },
];

function activeStageIndex(message: string): number {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (STAGES[i].match.test(message)) return i;
  }
  return 0;
}

export const GenerationPipeline = ({ message }: { message: string }) => {
  const activeIndex = activeStageIndex(message);

  return (
    <VStack space='sm' mt='$3' w='$full' alignItems='flex-start'>
      {STAGES.map((stage, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <HStack key={stage.label} space='sm' alignItems='center'>
            <Box
              width={16}
              height={16}
              borderRadius='$full'
              alignItems='center'
              justifyContent='center'
              bg={done ? '$primary500' : 'transparent'}
              borderWidth={active ? 2 : 0}
              borderColor='$primary500'
            >
              {done && (
                <Text size='2xs' color='$white' fontWeight='$bold'>
                  ✓
                </Text>
              )}
            </Box>
            <Text
              size='xs'
              color={done || active ? '$textLight800' : '$textLight400'}
              fontWeight={active ? '$bold' : '$normal'}
            >
              {stage.label}
            </Text>
          </HStack>
        );
      })}
    </VStack>
  );
};
