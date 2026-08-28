import React, { useState, useContext, useEffect } from "react";
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  ButtonText,
  ScrollView,
  Pressable,
  Icon,
  Textarea,
  TextareaInput,
  Switch,
} from "@gluestack-ui/themed";
import {
  ArrowLeft,
  MapPin,
  Sparkles,
  User,
  Users,
  Baby,
  UserPlus,
  Footprints,
  Car,
  Bike,
  Bus,
  Landmark,
  Utensils,
  Palette,
  Trees,
  Building2,
  Moon,
  ShoppingBag,
  Waves,
  Dumbbell,
  Check,
  Compass,
  Route,
  Salad,
} from "lucide-react-native";
import { GenerateTourDto } from "@/api/tours";
import { DestinationInput } from "./DestinationInput";
import { DateRangePicker } from "./DateRangePicker";
import { Map } from "@/features/map";
import { AppContext } from "@/context/app";
import * as ExpoLocation from "expo-location";
import { FONT_DISPLAY } from "@/constants/typography";

interface TourWizardFormProps {
  onSubmit: (preferences: GenerateTourDto) => void;
  onCancel: () => void;
  initialLocation?: { lat: number; lng: number };
  initialDestination?: string;
  initialInterests?: string[];
  isLoading?: boolean;
}

// 1. Tipos de Experiencia (Disparan composite activities)
interface ExperienceFormatItem {
  id: string;
  api: string;
  label: string;
  desc: string;
  icon: any;
}

const EXPERIENCE_FORMAT_ITEMS: ExperienceFormatItem[] = [
  {
    id: "neighborhood_walks",
    api: "neighborhood_walks",
    label: "Caminatas por barrios",
    desc: "Recorridos a pie por zonas emblemáticas",
    icon: Footprints,
  },
  {
    id: "point_visits",
    api: "point_visits",
    label: "Puntos de interés",
    desc: "Monumentos, atracciones y sitios destacados",
    icon: Landmark,
  },
  {
    id: "thematic_routes",
    api: "thematic_routes",
    label: "Rutas temáticas",
    desc: "Circuitos históricos, culturales o arquitectónicos",
    icon: Route,
  },
  {
    id: "immersive_experiences",
    api: "immersive_experiences",
    label: "Experiencias",
    desc: "Actividades vivenciales, talleres y gastronomía",
    icon: Sparkles,
  },
];

// 2. Intereses canónicos (10 opciones oficiales, sin Café agregado)
interface InterestItem {
  id: string;
  label: string;
  icon: any;
  api: string;
}

const INTEREST_ITEMS: InterestItem[] = [
  { id: "Historia", label: "Historia", icon: Landmark, api: "history" },
  { id: "Comida", label: "Gastronomía", icon: Utensils, api: "food" },
  { id: "Arte", label: "Arte & Museos", icon: Palette, api: "art" },
  { id: "Naturaleza", label: "Naturaleza", icon: Trees, api: "nature" },
  { id: "Cultura", label: "Cultura", icon: Compass, api: "culture" },
  { id: "Arquitectura", label: "Arquitectura", icon: Building2, api: "architecture" },
  { id: "Playa", label: "Playa", icon: Waves, api: "beach" },
  { id: "Compras", label: "Compras", icon: ShoppingBag, api: "shopping" },
  { id: "Vida Nocturna", label: "Vida Nocturna", icon: Moon, api: "nightlife" },
  { id: "Deportes", label: "Deportes", icon: Dumbbell, api: "sports" },
];

const GROUP_OPTIONS = [
  { type: "solo" as const, icon: User, label: "Solo" },
  { type: "couple" as const, icon: Users, label: "Pareja" },
  { type: "family" as const, icon: Baby, label: "Familia" },
  { type: "friends" as const, icon: UserPlus, label: "Amigos" },
];

const TRANSPORT_OPTIONS = [
  { mode: "walking" as const, icon: Footprints, label: "A pie" },
  { mode: "public_transport" as const, icon: Bus, label: "Transporte público" },
  { mode: "cycling" as const, icon: Bike, label: "Bicicleta" },
  { mode: "driving" as const, icon: Car, label: "Auto" },
];

const WALKING_DISTANCE_OPTIONS = [
  { km: 3, label: "3 km", desc: "Suave / Paseo corto" },
  { km: 5, label: "5 km", desc: "Moderado / Estándar" },
  { km: 8, label: "8 km", desc: "Activo / Caminador" },
  { km: 12, label: "12+ km", desc: "Gran explorador" },
];

const DIETARY_OPTIONS = [
  { id: "vegetarian", label: "Vegetariano" },
  { id: "vegan", label: "Vegano" },
  { id: "gluten-free", label: "Sin Gluten (Celíaco)" },
];

export const TourWizardForm: React.FC<TourWizardFormProps> = ({
  onSubmit,
  onCancel,
  initialLocation,
  initialDestination,
  initialInterests,
  isLoading = false,
}) => {
  const { setCenter } = useContext(AppContext);
  const [currentStep, setCurrentStep] = useState(1);
  const [destination, setDestination] = useState<string>(initialDestination || "");
  const [destinationCoords, setDestinationCoords] = useState<
    { lat: number; lng: number } | undefined
  >(initialLocation);
  const [destinationRadius, setDestinationRadius] = useState<number | undefined>(undefined);
  const [destinationIsDirty, setDestinationIsDirty] = useState(false);

  // Fechas y Días
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [days, setDays] = useState<number>(3);
  const [useCurrentLocation, setUseCurrentLocation] = useState(!initialDestination);

  // Paso 2: Estilo, Ritmo y Movilidad
  const [groupType, setGroupType] = useState<"solo" | "couple" | "family" | "friends">("solo");
  const [budgetLevel, setBudgetLevel] = useState<"low" | "medium" | "high">("medium");
  const [travelPace, setTravelPace] = useState<"relaxed" | "moderate" | "fast">("moderate");
  const [maxWalkingDistanceKm, setMaxWalkingDistanceKm] = useState<number>(5);
  const [transportationMode, setTransportationMode] = useState<
    ("walking" | "driving" | "public_transport" | "cycling")[]
  >(["walking"]);

  // Paso 3: Experiencias, Intereses y Notas
  const [selectedExperienceFormats, setSelectedExperienceFormats] = useState<string[]>([
    "neighborhood_walks",
    "point_visits",
  ]);
  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    initialInterests && initialInterests.length > 0
      ? initialInterests
      : ["Historia", "Comida"]
  );
  const [selectedDietary, setSelectedDietary] = useState<string[]>([]);
  const [specialNotes, setSpecialNotes] = useState<string>("");

  useEffect(() => {
    const getInitialLocation = async () => {
      if (initialLocation && !destinationCoords) {
        setDestinationCoords(initialLocation);
        setCenter(initialLocation);
        return;
      }

      if (useCurrentLocation && !destinationCoords) {
        try {
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const location = await ExpoLocation.getCurrentPositionAsync({});
            const coords = {
              lat: location.coords.latitude,
              lng: location.coords.longitude,
            };
            setDestinationCoords(coords);
            setCenter(coords);
          }
        } catch (error) {
          console.error("Error getting initial location:", error);
        }
      }
    };

    getInitialLocation();
  }, []);

  useEffect(() => {
    if (destinationCoords) {
      setCenter(destinationCoords);
    } else if (initialLocation) {
      setCenter(initialLocation);
    }
  }, [destinationCoords, initialLocation, setCenter]);

  const toggleInterest = (interestId: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interestId)
        ? prev.filter((i) => i !== interestId)
        : [...prev, interestId]
    );
  };

  const toggleExperienceFormat = (formatId: string) => {
    setSelectedExperienceFormats((prev) => {
      if (prev.includes(formatId)) {
        // Keep at least one format selected
        return prev.length > 1 ? prev.filter((f) => f !== formatId) : prev;
      }
      return [...prev, formatId];
    });
  };

  const toggleTransportationMode = (mode: "walking" | "driving" | "public_transport" | "cycling") => {
    setTransportationMode((prev) => {
      if (prev.includes(mode)) {
        return prev.length > 1 ? prev.filter((m) => m !== mode) : prev;
      }
      return [...prev, mode];
    });
  };

  const toggleDietary = (id: string) => {
    setSelectedDietary((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (currentStep === 1 && destinationIsDirty) {
      return;
    }
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    } else {
      onCancel();
    }
  };

  const handleLocationToggle = async (value: boolean) => {
    setUseCurrentLocation(value);
    if (value) {
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const location = await ExpoLocation.getCurrentPositionAsync({});
          const coords = {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          };
          setDestinationCoords(coords);
          setCenter(coords);
        }
      } catch (error) {
        console.error("Error getting location:", error);
      }
    } else {
      if (!destination) {
        setDestinationCoords(undefined);
      }
    }
  };

  const handleSubmit = () => {
    const startDates: string[] = [];
    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) {
        startDates.push(start.toISOString());
      }
    }
    if (endDate && endDate !== startDate) {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) {
        startDates.push(end.toISOString());
      }
    }

    const interestApis = selectedInterests
      .map((id) => INTEREST_ITEMS.find((item) => item.id === id)?.api)
      .filter(Boolean) as string[];

    const lat = destinationCoords?.lat ?? initialLocation?.lat ?? -34.6037;
    const lng = destinationCoords?.lng ?? initialLocation?.lng ?? -58.3816;

    const maxWalkPerDayMeters = maxWalkingDistanceKm * 1000;
    const maxContinuousWalk =
      travelPace === "relaxed" ? 1000 : travelPace === "fast" ? 3000 : 1500;

    const destName = destination || (useCurrentLocation ? "Mi ubicación" : "Buenos Aires");

    const preferences: GenerateTourDto = {
      name: destName,
      destination: {
        label: destName,
        latitude: lat,
        longitude: lng,
        radiusMeters: destinationRadius || 3000,
        scaleHint: destinationRadius && destinationRadius < 1500 ? "specific_point" : "settlement",
      },
      destinationLatitude: lat,
      destinationLongitude: lng,
      latitude: lat,
      longitude: lng,
      radius: destinationRadius || 3000,
      days,
      budgetLevel,
      groupType,
      travelPace,
      transportationMode,
      totalDistance: maxWalkingDistanceKm * days,
      interests: interestApis.length > 0 ? interestApis : ["history", "food"],
      dietaryRestrictions: selectedDietary.length > 0 ? selectedDietary : undefined,
      intent: {
        interests: interestApis.length > 0 ? interestApis : ["history", "food"],
        experienceFormats: selectedExperienceFormats,
        explorationStyle: travelPace,
        additionalPreferences: specialNotes.trim() ? specialNotes.trim() : undefined,
      },
      mobility: {
        allowedTransportationModes: transportationMode,
        maxWalkingDistancePerDayMeters: maxWalkPerDayMeters,
        maxContinuousWalkingDistanceMeters: maxContinuousWalk,
        travelPace,
        accessibilityNeeds: [],
      },
      startDates: startDates.length > 0 ? startDates : undefined,
      includeExistingActivities: true,
      skipImageGeneration: true,
      excludeTours: [],
      categories: [],
    };

    onSubmit(preferences);
  };

  // PASO 1: DESTINO Y FECHAS
  const renderStep1 = () => {
    const mapCoords = destinationCoords || initialLocation;
    const marker = mapCoords
      ? [
          {
            id: "destination",
            coordinate: {
              latitude: mapCoords.lat,
              longitude: mapCoords.lng,
            },
            title:
              destination ||
              (useCurrentLocation ? "Mi ubicación actual" : "Ubicación seleccionada"),
            description: "",
          },
        ]
      : [];

    return (
      <VStack space="xl">
        <VStack space="xs">
          <Heading size="lg" color="$textLight900" style={{ fontFamily: FONT_DISPLAY }}>
            ¿A dónde querés viajar?
          </Heading>
          <Text size="sm" color="$textLight500">
            Elegí una ciudad o zona y las fechas para tu itinerario.
          </Text>
        </VStack>

        <Box position="relative" zIndex={10}>
          <Text size="xs" fontWeight="$bold" color="$textLight700" mb="$2" textTransform="uppercase" letterSpacing={1}>
            Destino o Punto de Partida
          </Text>
          <DestinationInput
            value={destination}
            onDestinationChange={(dest, coords, radiusMeters) => {
              setDestination(dest);
              if (coords) {
                setDestinationCoords(coords);
              }
              setDestinationRadius(radiusMeters);
            }}
            onDirtyChange={setDestinationIsDirty}
          />
          {destinationIsDirty && (
            <Text color="$error600" size="xs" mt="$1">
              Elegí una opción de la lista para confirmar el destino
            </Text>
          )}
        </Box>

        <Box
          h={180}
          borderRadius="$2xl"
          overflow="hidden"
          borderWidth={1}
          borderColor="$borderLight200"
          shadowColor="$black"
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.06}
          shadowRadius={6}
          elevation={2}
        >
          {mapCoords ? (
            <Box h="$full" w="$full">
              <Map markers={marker} />
            </Box>
          ) : (
            <Box bg="$backgroundLight100" h="$full" justifyContent="center" alignItems="center">
              <Icon as={Compass} size="xl" color="$textLight400" />
              <Text mt="$2" color="$textLight500" size="xs" fontWeight="$medium">
                Buscá un destino para previsualizar el mapa
              </Text>
            </Box>
          )}
        </Box>

        <Box position="relative" zIndex={1}>
          <Text size="xs" fontWeight="$bold" color="$textLight700" mb="$2" textTransform="uppercase" letterSpacing={1}>
            Fechas y Duración
          </Text>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            days={days}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onDaysChange={setDays}
          />
        </Box>

        <HStack
          bg="$white"
          p="$3.5"
          borderRadius="$xl"
          borderWidth={1}
          borderColor="$borderLight200"
          justifyContent="space-between"
          alignItems="center"
        >
          <HStack space="sm" alignItems="center" flex={1}>
            <Box p="$2" bg="$primary50" borderRadius="$full">
              <Icon as={MapPin} size="sm" color="$primary600" />
            </Box>
            <VStack flex={1}>
              <Text size="sm" fontWeight="$bold" color="$textLight900">
                Usar mi ubicación actual
              </Text>
              <Text size="2xs" color="$textLight500">
                Partir desde donde estás ahora
              </Text>
            </VStack>
          </HStack>
          <Switch
            value={useCurrentLocation}
            onToggle={handleLocationToggle}
            trackColor={{ false: "#E2E8F0", true: "#EA580C" }}
            thumbColor="#FFFFFF"
          />
        </HStack>
      </VStack>
    );
  };

  // PASO 2: COMPAÑÍA, RITMO Y MOVILIDAD
  const renderStep2 = () => {
    return (
      <VStack space="xl">
        <VStack space="xs">
          <Heading size="lg" color="$textLight900" style={{ fontFamily: FONT_DISPLAY }}>
            ¿Cómo te gusta viajar?
          </Heading>
          <Text size="sm" color="$textLight500">
            Ajustá el ritmo, la compañía y la movilidad de tu viaje.
          </Text>
        </VStack>

        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            ¿Con quién viajás?
          </Text>
          <HStack space="sm" justifyContent="space-between">
            {GROUP_OPTIONS.map(({ type, icon: IconComponent, label }) => {
              const isSelected = groupType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => setGroupType(type)}
                  flex={1}
                >
                  <Box
                    py="$3"
                    borderRadius="$2xl"
                    bg={isSelected ? "$primary50" : "$white"}
                    borderWidth={1.5}
                    borderColor={isSelected ? "$primary500" : "$borderLight200"}
                    alignItems="center"
                    justifyContent="center"
                    shadowColor="$black"
                    shadowOffset={{ width: 0, height: 1 }}
                    shadowOpacity={isSelected ? 0.08 : 0.02}
                    shadowRadius={3}
                    elevation={isSelected ? 2 : 1}
                  >
                    <Box
                      p="$2"
                      borderRadius="$full"
                      bg={isSelected ? "$primary500" : "$backgroundLight100"}
                      mb="$1"
                    >
                      <Icon
                        as={IconComponent}
                        size="sm"
                        color={isSelected ? "$white" : "$textLight600"}
                      />
                    </Box>
                    <Text
                      size="2xs"
                      fontWeight={isSelected ? "$bold" : "$medium"}
                      color={isSelected ? "$primary900" : "$textLight700"}
                    >
                      {label}
                    </Text>
                  </Box>
                </Pressable>
              );
            })}
          </HStack>
        </VStack>

        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Nivel de Presupuesto
          </Text>
          <HStack bg="$backgroundLight100" p="$1" borderRadius="$2xl" borderWidth={1} borderColor="$borderLight200">
            {[
              { key: "low" as const, label: "$ Económico", desc: "Lugares accesibles" },
              { key: "medium" as const, label: "$$ Moderado", desc: "Equilibrio calidad" },
              { key: "high" as const, label: "$$$ Premium", desc: "Experiencias VIP" },
            ].map((b) => {
              const isSelected = budgetLevel === b.key;
              return (
                <Pressable
                  key={b.key}
                  flex={1}
                  onPress={() => setBudgetLevel(b.key)}
                >
                  <Box
                    py="$2.5"
                    px="$1"
                    alignItems="center"
                    borderRadius="$xl"
                    bg={isSelected ? "$white" : "transparent"}
                    borderWidth={isSelected ? 1 : 0}
                    borderColor="$borderLight200"
                    shadowColor="$black"
                    shadowOffset={{ width: 0, height: 1 }}
                    shadowOpacity={isSelected ? 0.08 : 0}
                    shadowRadius={3}
                    elevation={isSelected ? 2 : 0}
                  >
                    <Text
                      size="xs"
                      fontWeight={isSelected ? "$bold" : "$semibold"}
                      color={isSelected ? "$primary600" : "$textLight600"}
                    >
                      {b.label}
                    </Text>
                  </Box>
                </Pressable>
              );
            })}
          </HStack>
        </VStack>

        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Ritmo de Exploración
          </Text>
          <HStack bg="$backgroundLight100" p="$1" borderRadius="$2xl" borderWidth={1} borderColor="$borderLight200">
            {[
              { key: "relaxed" as const, label: "Relajado", desc: "Pocas paradas, sin apuro" },
              { key: "moderate" as const, label: "Equilibrado", desc: "Ritmo ideal" },
              { key: "fast" as const, label: "Intenso", desc: "Al máximo provecho" },
            ].map((p) => {
              const isActive = travelPace === p.key;
              return (
                <Pressable
                  key={p.key}
                  flex={1}
                  onPress={() => setTravelPace(p.key)}
                >
                  <Box
                    py="$2.5"
                    px="$1"
                    alignItems="center"
                    borderRadius="$xl"
                    bg={isActive ? "$primary500" : "transparent"}
                    shadowColor="$black"
                    shadowOffset={{ width: 0, height: 1 }}
                    shadowOpacity={isActive ? 0.15 : 0}
                    shadowRadius={3}
                    elevation={isActive ? 2 : 0}
                  >
                    <Text
                      size="xs"
                      fontWeight={isActive ? "$bold" : "$semibold"}
                      color={isActive ? "$white" : "$textLight600"}
                    >
                      {p.label}
                    </Text>
                  </Box>
                </Pressable>
              );
            })}
          </HStack>
        </VStack>

        <VStack space="sm">
          <HStack justifyContent="space-between" alignItems="center">
            <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
              Caminata máxima por día
            </Text>
            <Text size="xs" fontWeight="$bold" color="$primary600">
              {maxWalkingDistanceKm} km / día
            </Text>
          </HStack>
          <HStack space="xs" justifyContent="space-between">
            {WALKING_DISTANCE_OPTIONS.map((opt) => {
              const isSelected = maxWalkingDistanceKm === opt.km;
              return (
                <Pressable
                  key={opt.km}
                  onPress={() => setMaxWalkingDistanceKm(opt.km)}
                  flex={1}
                >
                  <Box
                    py="$2.5"
                    px="$1"
                    borderRadius="$xl"
                    bg={isSelected ? "$primary50" : "$white"}
                    borderWidth={1.5}
                    borderColor={isSelected ? "$primary500" : "$borderLight200"}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Text
                      size="xs"
                      fontWeight={isSelected ? "$bold" : "$semibold"}
                      color={isSelected ? "$primary900" : "$textLight800"}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      size="3xs"
                      color={isSelected ? "$primary700" : "$textLight400"}
                      numberOfLines={1}
                    >
                      {opt.desc.split(" ")[0]}
                    </Text>
                  </Box>
                </Pressable>
              );
            })}
          </HStack>
        </VStack>

        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Medios de transporte preferidos
          </Text>
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap="$2.5">
            {TRANSPORT_OPTIONS.map(({ mode, icon: IconComponent, label }) => {
              const isSelected = transportationMode.includes(mode);
              return (
                <Pressable
                  key={mode}
                  onPress={() => toggleTransportationMode(mode)}
                  w="48%"
                >
                  <Box
                    p="$3"
                    borderRadius="$2xl"
                    bg={isSelected ? "$primary50" : "$white"}
                    borderWidth={1.5}
                    borderColor={isSelected ? "$primary500" : "$borderLight200"}
                    flexDirection="row"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <HStack space="xs" alignItems="center" flex={1}>
                      <Box
                        p="$1.5"
                        borderRadius="$lg"
                        bg={isSelected ? "$primary500" : "$backgroundLight100"}
                      >
                        <Icon
                          as={IconComponent}
                          size="xs"
                          color={isSelected ? "$white" : "$textLight600"}
                        />
                      </Box>
                      <Text
                        size="xs"
                        fontWeight={isSelected ? "$bold" : "$medium"}
                        color={isSelected ? "$primary900" : "$textLight800"}
                        numberOfLines={1}
                        flex={1}
                      >
                        {label}
                      </Text>
                    </HStack>
                    {isSelected && (
                      <Box
                        w={16}
                        h={16}
                        borderRadius="$full"
                        bg="$primary500"
                        alignItems="center"
                        justifyContent="center"
                      >
                        <Icon as={Check} size="3xs" color="$white" />
                      </Box>
                    )}
                  </Box>
                </Pressable>
              );
            })}
          </Box>
        </VStack>
      </VStack>
    );
  };

  // PASO 3: TIPOS DE EXPERIENCIA, INTERESES Y NOTAS
  const renderStep3 = () => {
    return (
      <VStack space="xl">
        <VStack space="xs">
          <Heading size="lg" color="$textLight900" style={{ fontFamily: FONT_DISPLAY }}>
            ¿Qué querés vivir en este viaje?
          </Heading>
          <Text size="sm" color="$textLight500">
            Elegí los tipos de experiencia e intereses para generar tu itinerario.
          </Text>
        </VStack>

        <VStack space="sm">
          <HStack justifyContent="space-between" alignItems="center">
            <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
              Tipos de Experiencia ({selectedExperienceFormats.length})
            </Text>
            <Text size="2xs" color="$primary600" fontWeight="$bold">
              Multi-selección
            </Text>
          </HStack>
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap="$2.5">
            {EXPERIENCE_FORMAT_ITEMS.map((item) => {
              const isSelected = selectedExperienceFormats.includes(item.id);
              const IconComp = item.icon;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => toggleExperienceFormat(item.id)}
                  w="100%"
                >
                  <Box
                    p="$3.5"
                    borderRadius="$2xl"
                    bg={isSelected ? "$primary50" : "$white"}
                    borderWidth={1.5}
                    borderColor={isSelected ? "$primary500" : "$borderLight200"}
                    shadowColor="$black"
                    shadowOffset={{ width: 0, height: 1 }}
                    shadowOpacity={isSelected ? 0.08 : 0.03}
                    shadowRadius={4}
                    elevation={isSelected ? 2 : 1}
                    flexDirection="row"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <HStack space="md" alignItems="center" flex={1}>
                      <Box
                        p="$2.5"
                        borderRadius="$xl"
                        bg={isSelected ? "$primary500" : "$backgroundLight100"}
                      >
                        <Icon
                          as={IconComp}
                          size="md"
                          color={isSelected ? "$white" : "$textLight700"}
                        />
                      </Box>
                      <VStack flex={1} space="2xs">
                        <Text
                          size="sm"
                          fontWeight={isSelected ? "$bold" : "$semibold"}
                          color={isSelected ? "$primary900" : "$textLight900"}
                        >
                          {item.label}
                        </Text>
                        <Text
                          size="xs"
                          color={isSelected ? "$primary700" : "$textLight500"}
                          numberOfLines={1}
                        >
                          {item.desc}
                        </Text>
                      </VStack>
                    </HStack>
                    {isSelected && (
                      <Box
                        w={20}
                        h={20}
                        borderRadius="$full"
                        bg="$primary500"
                        alignItems="center"
                        justifyContent="center"
                      >
                        <Icon as={Check} size="2xs" color="$white" />
                      </Box>
                    )}
                  </Box>
                </Pressable>
              );
            })}
          </Box>
        </VStack>

        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Intereses principales ({selectedInterests.length} seleccionados)
          </Text>
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap="$2.5">
            {INTEREST_ITEMS.map((item) => {
              const isSelected = selectedInterests.includes(item.id);
              const IconComp = item.icon;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => toggleInterest(item.id)}
                  w="48%"
                >
                  <Box
                    p="$3.5"
                    borderRadius="$2xl"
                    bg={isSelected ? "$primary50" : "$white"}
                    borderWidth={1.5}
                    borderColor={isSelected ? "$primary500" : "$borderLight200"}
                    shadowColor="$black"
                    shadowOffset={{ width: 0, height: 1 }}
                    shadowOpacity={isSelected ? 0.08 : 0.03}
                    shadowRadius={4}
                    elevation={isSelected ? 2 : 1}
                    flexDirection="row"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <HStack space="sm" alignItems="center" flex={1}>
                      <Box
                        p="$2"
                        borderRadius="$xl"
                        bg={isSelected ? "$primary500" : "$backgroundLight100"}
                      >
                        <Icon
                          as={IconComp}
                          size="sm"
                          color={isSelected ? "$white" : "$textLight700"}
                        />
                      </Box>
                      <Text
                        size="xs"
                        fontWeight={isSelected ? "$bold" : "$medium"}
                        color={isSelected ? "$primary900" : "$textLight800"}
                        numberOfLines={1}
                        flex={1}
                      >
                        {item.label}
                      </Text>
                    </HStack>
                    {isSelected && (
                      <Box
                        w={18}
                        h={18}
                        borderRadius="$full"
                        bg="$primary500"
                        alignItems="center"
                        justifyContent="center"
                      >
                        <Icon as={Check} size="2xs" color="$white" />
                      </Box>
                    )}
                  </Box>
                </Pressable>
              );
            })}
          </Box>
        </VStack>

        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Preferencias Alimentarias (Opcional)
          </Text>
          <HStack space="xs" flexWrap="wrap">
            {DIETARY_OPTIONS.map((diet) => {
              const isSelected = selectedDietary.includes(diet.id);
              return (
                <Pressable
                  key={diet.id}
                  onPress={() => toggleDietary(diet.id)}
                >
                  <Box
                    py="$2"
                    px="$3"
                    borderRadius="$full"
                    bg={isSelected ? "$primary50" : "$white"}
                    borderWidth={1.5}
                    borderColor={isSelected ? "$primary500" : "$borderLight200"}
                    flexDirection="row"
                    alignItems="center"
                    mb="$1.5"
                  >
                    <Icon as={Salad} size="xs" color={isSelected ? "$primary600" : "$textLight400"} mr="$1.5" />
                    <Text
                      size="xs"
                      fontWeight={isSelected ? "$bold" : "$medium"}
                      color={isSelected ? "$primary900" : "$textLight700"}
                    >
                      {diet.label}
                    </Text>
                  </Box>
                </Pressable>
              );
            })}
          </HStack>
        </VStack>

        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Indicaciones especiales para la IA
          </Text>
          <Box
            bg="$white"
            borderRadius="$2xl"
            borderWidth={1}
            borderColor="$borderLight200"
            p="$3"
            shadowColor="$black"
            shadowOffset={{ width: 0, height: 1 }}
            shadowOpacity={0.03}
            shadowRadius={4}
            elevation={1}
          >
            <Textarea
              borderWidth={0}
              h={90}
              p="$0"
            >
              <TextareaInput
                placeholder="Ej: Buscamos opciones pet friendly, con terrazas al sol y evitar caminar en subida..."
                value={specialNotes}
                onChangeText={setSpecialNotes}
                color="$textLight900"
                fontSize="$sm"
              />
            </Textarea>
          </Box>
        </VStack>
      </VStack>
    );
  };

  const getStepProgress = () => {
    switch (currentStep) {
      case 1:
        return "33%";
      case 2:
        return "66%";
      case 3:
        return "100%";
      default:
        return "0%";
    }
  };

  const getStepName = () => {
    switch (currentStep) {
      case 1:
        return "Destino y Fechas";
      case 2:
        return "Estilo y Movilidad";
      case 3:
        return "Experiencias e Intereses";
      default:
        return "";
    }
  };

  return (
    <Box flex={1} h="$full" bg="$backgroundLight50">
      <Box bg="$backgroundLight50" pt="$12" pb="$3" px="$4" borderBottomWidth={1} borderBottomColor="$borderLight100">
        <HStack alignItems="center" justifyContent="space-between" mb="$3">
          <Pressable onPress={handleBack}>
            <Box
              w={36}
              h={36}
              borderRadius="$full"
              bg="$white"
              borderWidth={1}
              borderColor="$borderLight200"
              alignItems="center"
              justifyContent="center"
              shadowColor="$black"
              shadowOffset={{ width: 0, height: 1 }}
              shadowOpacity={0.05}
              shadowRadius={2}
              elevation={1}
            >
              <Icon as={ArrowLeft} size="sm" color="$textLight800" />
            </Box>
          </Pressable>

          <VStack alignItems="center">
            <Text size="2xs" fontWeight="$extrabold" color="$primary600" textTransform="uppercase" letterSpacing={1.2}>
              Paso {currentStep} de 3
            </Text>
            <Heading size="sm" color="$textLight900" style={{ fontFamily: FONT_DISPLAY }}>
              {getStepName()}
            </Heading>
          </VStack>

          <Box w={36} alignItems="flex-end">
            <Text size="xs" fontWeight="$bold" color="$primary600">
              {getStepProgress()}
            </Text>
          </Box>
        </HStack>

        <Box h={4} w="$full" bg="$backgroundLight200" borderRadius="$full" overflow="hidden">
          <Box h="$full" w={getStepProgress()} bg="$primary500" borderRadius="$full" />
        </Box>
      </Box>

      <ScrollView
        flex={1}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="always"
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 160 }}
      >
        <Box p="$5">
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </Box>
      </ScrollView>

      {/* Floating Bottom Action CTA */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        bg="$white"
        borderTopWidth={1}
        borderTopColor="$borderLight100"
        p="$4"
        pb="$8"
        shadowColor="$black"
        shadowOffset={{ width: 0, height: -4 }}
        shadowOpacity={0.06}
        shadowRadius={10}
        elevation={10}
      >
        <Button
          onPress={handleNext}
          bg={currentStep === 3 ? "$primary500" : "$textLight900"}
          borderRadius="$2xl"
          h={54}
          isDisabled={currentStep === 1 && destinationIsDirty}
          shadowColor={currentStep === 3 ? "$primary500" : "$black"}
          shadowOffset={{ width: 0, height: 3 }}
          shadowOpacity={currentStep === 3 ? 0.3 : 0.15}
          shadowRadius={6}
          elevation={4}
        >
          <HStack space="xs" alignItems="center" justifyContent="center">
            {currentStep === 3 && <Icon as={Sparkles} size="md" color="$white" />}
            <ButtonText
              color="$white"
              fontWeight="$bold"
              size="md"
            >
              {currentStep === 3 ? "Generar Itinerario Inteligente" : "Continuar"}
            </ButtonText>
          </HStack>
        </Button>
      </Box>
      {isLoading && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          bg="$backgroundLight50"
          zIndex={999}
          justifyContent="center"
          alignItems="center"
          p="$6"
        >
          <Box
            w={80}
            h={80}
            borderRadius="$full"
            bg="$primary50"
            borderWidth={2}
            borderColor="$primary200"
            alignItems="center"
            justifyContent="center"
            mb="$5"
            shadowColor="$primary500"
            shadowOffset={{ width: 0, height: 4 }}
            shadowOpacity={0.2}
            shadowRadius={8}
            elevation={4}
          >
            <Icon as={Sparkles} size="xl" color="$primary500" />
          </Box>
          <Heading size="lg" color="$textLight900" textAlign="center" style={{ fontFamily: FONT_DISPLAY }}>
            Diseñando tu Itinerario
          </Heading>
          <Text size="sm" color="$textLight500" textAlign="center" mt="$2" maxW={280}>
            La IA está seleccionando los mejores lugares, optimizando paradas y calculando rutas a pie...
          </Text>
        </Box>
      )}
    </Box>
  );
};
