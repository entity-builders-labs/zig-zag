import React, { useEffect, useState } from "react";
import {
  VStack,
  Heading,
  ScrollView,
  Box,
  HStack,
  Image,
  Icon,
  Text,
  Spinner,
  Pressable,
} from "@gluestack-ui/themed";
import { MapPin, ChevronRight, Clock, Footprints, Sparkles, Heart } from "lucide-react-native";
import { Link, useRouter } from "expo-router";
import { useMap } from "@/context/app";
import { fetchNearbyTours, Tour } from "@/api/tours";
import { FONT_DISPLAY } from "@/constants/typography";

const FALLBACK_TOURS: Array<Partial<Tour> & { id: string; name: string; duration: number; coverImage: string; stopsCount: number; categoryTag: string; distanceKm: string }> = [
  {
    id: "tour-1",
    name: "Joyas Ocultas de San Telmo",
    duration: 2.2,
    coverImage: "https://images.unsplash.com/photo-1589909202802-8f4aadce1849?q=80&w=600&auto=format&fit=crop",
    stopsCount: 4,
    categoryTag: "Historia & Bohemio",
    distanceKm: "1.9 km",
  },
  {
    id: "tour-2",
    name: "Ruta de Cafés Notables & Literatura",
    duration: 1.8,
    coverImage: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=600&auto=format&fit=crop",
    stopsCount: 3,
    categoryTag: "Cafés",
    distanceKm: "1.4 km",
  },
  {
    id: "tour-3",
    name: "Palermo Soho: Murales & Diseño",
    duration: 2.5,
    coverImage: "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?q=80&w=600&auto=format&fit=crop",
    stopsCount: 5,
    categoryTag: "Arte Urbano",
    distanceKm: "2.3 km",
  },
  {
    id: "tour-4",
    name: "Arquitectura Clásica de Recoleta",
    duration: 3.0,
    coverImage: "https://images.unsplash.com/photo-1569336415962-a4bd9f69cd83?q=80&w=600&auto=format&fit=crop",
    stopsCount: 4,
    categoryTag: "Arquitectura",
    distanceKm: "2.6 km",
  },
];

interface RoutesSectionProps {
  category?: string;
  categoryTitle?: string;
}

export const RoutesSection = ({
  category = "walking",
  categoryTitle = "Rutas a pie recomendadas",
}: RoutesSectionProps) => {
  const router = useRouter();
  const { center } = useMap();
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadTours = async () => {
      if (!center) return;

      setLoading(true);
      try {
        const fetchedTours = await fetchNearbyTours(
          center.lat,
          center.lng,
          category === "all" ? "walking" : category
        );
        if (fetchedTours && fetchedTours.length > 0) {
          setTours(fetchedTours);
        }
      } catch (error) {
        console.error("Failed to fetch tours:", error);
      } finally {
        setLoading(false);
      }
    };

    loadTours();
  }, [center, category]);

  const displayTours = tours.length > 0 ? tours : (FALLBACK_TOURS as any as Tour[]);

  const getTourImage = (tour: any, index: number) => {
    if (tour.coverImage) return tour.coverImage;
    if (tour.activities?.[0]?.activity?.photos?.[0]) {
      const p = tour.activities[0].activity.photos[0];
      return typeof p === "string" ? p : p.url;
    }
    return FALLBACK_TOURS[index % FALLBACK_TOURS.length].coverImage;
  };

  const getDurationString = (tour: any) => {
    const d = tour.duration || 2;
    const hours = Math.floor(d);
    const mins = Math.round((d - hours) * 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <VStack space="md" mt="$2">
      <HStack
        px="$4"
        justifyContent="space-between"
        alignItems="center"
        w="$full"
      >
        <VStack>
          <Heading
            size="md"
            color="$textLight900"
            style={{ fontFamily: FONT_DISPLAY }}
          >
            {categoryTitle}
          </Heading>
          <Text size="2xs" color="$textLight500">
            Itinerarios curados para caminar y descubrir
          </Text>
        </VStack>

        <Pressable onPress={() => router.push("/tours")}>
          <HStack space="xs" alignItems="center">
            <Text size="xs" color="$primary600" fontWeight="$bold">
              Ver todos
            </Text>
            <Icon as={ChevronRight} size="2xs" color="$primary600" />
          </HStack>
        </Pressable>
      </HStack>

      {loading ? (
        <Box h={220} justifyContent="center" alignItems="center">
          <Spinner size="large" color="$primary500" />
        </Box>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 14, paddingHorizontal: 16 }}
        >
          {displayTours.map((tour: any, index: number) => {
            const imgUrl = getTourImage(tour, index);
            const stops = tour.activities?.length || tour.stopsCount || 4;
            const tag = tour.categoryTag || "Ruta a pie";

            return (
              <Pressable
                key={tour.id || index}
                onPress={() => router.push(`/tours/${tour.id}`)}
              >
                <Box
                  w={270}
                  bg="$white"
                  borderRadius="$2xl"
                  overflow="hidden"
                  borderWidth={1}
                  borderColor="$borderLight200"
                  shadowColor="$black"
                  shadowOffset={{ width: 0, height: 2 }}
                  shadowOpacity={0.06}
                  shadowRadius={8}
                  elevation={2}
                >
                  {/* Card Cover */}
                  <Box h={150} position="relative" bg="$backgroundLight200">
                    <Image
                      source={{ uri: imgUrl }}
                      alt={tour.name}
                      w="$full"
                      h="$full"
                      resizeMode="cover"
                    />

                    {/* Gradient overlay */}
                    <Box
                      position="absolute"
                      top={0}
                      left={0}
                      right={0}
                      bottom={0}
                      bg="$black"
                      opacity={0.2}
                    />

                    {/* Category Tag on Top Left */}
                    <Box position="absolute" top={10} left={10}>
                      <Box
                        bg="rgba(0, 0, 0, 0.6)"
                        px="$2.5"
                        py="$1"
                        borderRadius="$full"
                      >
                        <Text size="2xs" fontWeight="$bold" color="$white">
                          {tag}
                        </Text>
                      </Box>
                    </Box>

                    {/* Duration badge on Bottom Right */}
                    <Box position="absolute" bottom={10} right={10}>
                      <HStack
                        bg="rgba(255, 255, 255, 0.95)"
                        px="$2"
                        py="$0.5"
                        borderRadius="$full"
                        alignItems="center"
                        space="xs"
                      >
                        <Icon as={Clock} size="2xs" color="$textLight700" />
                        <Text size="2xs" fontWeight="$bold" color="$textLight900">
                          {getDurationString(tour)}
                        </Text>
                      </HStack>
                    </Box>
                  </Box>

                  {/* Card Details */}
                  <VStack p="$3.5" space="xs">
                    <Heading
                      size="sm"
                      color="$textLight900"
                      numberOfLines={1}
                      style={{ fontFamily: FONT_DISPLAY }}
                    >
                      {tour.name}
                    </Heading>

                    <HStack space="md" alignItems="center" mt="$1">
                      <HStack space="xs" alignItems="center">
                        <Icon as={MapPin} size="2xs" color="$primary600" />
                        <Text size="xs" color="$textLight600" fontWeight="$medium">
                          {stops} paradas
                        </Text>
                      </HStack>
                      <Text size="xs" color="$textLight400">•</Text>
                      <HStack space="xs" alignItems="center">
                        <Icon as={Footprints} size="2xs" color="$textLight500" />
                        <Text size="xs" color="$textLight500">
                          {tour.distanceKm || "2.1 km"}
                        </Text>
                      </HStack>
                    </HStack>
                  </VStack>
                </Box>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </VStack>
  );
};
