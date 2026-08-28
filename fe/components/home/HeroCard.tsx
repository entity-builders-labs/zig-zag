import React from "react";
import { Box, Image, VStack, HStack, Text, Heading, Button, ButtonText, Icon, Pressable } from "@gluestack-ui/themed";
import { Sparkles, Clock, MapPin, ArrowRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { FONT_DISPLAY } from "@/constants/typography";

const HERO_CARD_IMAGE =
  "https://images.unsplash.com/photo-1589909202802-8f4aadce1849?q=80&w=1200&auto=format&fit=crop";

export const HeroCard = () => {
  const router = useRouter();

  const handleCreateWithAI = () => {
    router.push("/tours/wizard");
  };

  return (
    <Box px="$4">
      <Box
        height={380}
        rounded="$3xl"
        overflow="hidden"
        position="relative"
        bg="$backgroundDark900"
        shadowColor="$black"
        shadowOffset={{ width: 0, height: 4 }}
        shadowOpacity={0.12}
        shadowRadius={12}
        elevation={5}
      >
        <Image
          source={{ uri: HERO_CARD_IMAGE }}
          alt="Palacio Barolo y Buenos Aires"
          w="$full"
          h="$full"
          resizeMode="cover"
        />

        {/* Gradient / Dark overlay */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          bg="$black"
          opacity={0.35}
        />

        {/* Top Tag */}
        <Box position="absolute" top={16} left={16} zIndex={2}>
          <HStack
            bg="rgba(255, 255, 255, 0.9)"
            backdropBlur="md"
            px="$3"
            py="$1.5"
            borderRadius="$full"
            alignItems="center"
            space="xs"
            shadowColor="$black"
            shadowOffset={{ width: 0, height: 1 }}
            shadowOpacity={0.1}
            shadowRadius={3}
          >
            <Icon as={Sparkles} size="xs" color="$primary600" />
            <Text size="2xs" fontWeight="$bold" color="$primary700" textTransform="uppercase" letterSpacing={0.8}>
              Itinerario del Día
            </Text>
          </HStack>
        </Box>

        {/* Bottom Content Overlay */}
        <VStack
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          p="$5"
          space="sm"
          zIndex={2}
        >
          <VStack space="xs">
            <Heading
              color="$white"
              size="xl"
              fontWeight="$bold"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Atardecer en Palacio Barolo & San Telmo
            </Heading>
            <HStack space="md" alignItems="center">
              <HStack space="xs" alignItems="center">
                <Icon as={Clock} size="xs" color="rgba(255,255,255,0.8)" />
                <Text size="xs" color="rgba(255,255,255,0.9)" fontWeight="$medium">
                  2h 45m
                </Text>
              </HStack>
              <Text size="xs" color="rgba(255,255,255,0.6)">•</Text>
              <HStack space="xs" alignItems="center">
                <Icon as={MapPin} size="xs" color="rgba(255,255,255,0.8)" />
                <Text size="xs" color="rgba(255,255,255,0.9)" fontWeight="$medium">
                  2.4 km (4 paradas)
                </Text>
              </HStack>
            </HStack>
          </VStack>

          <Button
            onPress={handleCreateWithAI}
            bg="$primary500"
            rounded="$2xl"
            h={48}
            mt="$2"
            shadowColor="$primary500"
            shadowOffset={{ width: 0, height: 3 }}
            shadowOpacity={0.35}
            shadowRadius={6}
            elevation={3}
          >
            <HStack space="xs" alignItems="center" justifyContent="center">
              <Icon as={Sparkles} size="sm" color="$white" />
              <ButtonText color="$white" fontWeight="$bold" size="sm">
                Diseñar Tour a Medida con IA
              </ButtonText>
              <Icon as={ArrowRight} size="xs" color="$white" ml="$1" />
            </HStack>
          </Button>
        </VStack>
      </Box>
    </Box>
  );
};
