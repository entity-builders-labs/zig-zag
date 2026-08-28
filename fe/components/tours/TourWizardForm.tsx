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
  Coffee,
  Moon,
  ShoppingBag,
  Waves,
  Dumbbell,
  Check,
  Compass,
} from "lucide-react-native";
import { GenerateTourDto } from "@/api/tours";
import { DestinationInput } from "./DestinationInput";
import { DateRangePicker } from "./DateRangePicker";
import { Map } from "@/features/map";
import { AppContext } from "@/context/app";
import * as ExpoLocation from "expo-location";
import { parseLocalDate } from "@/utils/date";
import { FONT_DISPLAY } from "@/constants/typography";

interface TourWizardFormProps {
  onSubmit: (preferences: GenerateTourDto) => void;
  onCancel: () => void;
  initialLocation?: { lat: number; lng: number };
  isLoading?: boolean;
}

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
  { id: "Arquitectura", label: "Arquitectura", icon: Building2, api: "architecture" },
  { id: "Cafés", label: "Cafés", icon: Coffee, api: "cafes" },
  { id: "Vida Nocturna", label: "Vida Nocturna", icon: Moon, api: "nightlife" },
  { id: "Compras", label: "Compras", icon: ShoppingBag, api: "shopping" },
  { id: "Playa", label: "Playa", icon: Waves, api: "beach" },
  { id: "Deportes", label: "Deportes", icon: Dumbbell, api: "sports" },
];

const GROUP_OPTIONS = [
  { type: "solo" as const, icon: User, label: "Solo" },
  { type: "couple" as const, icon: Users, label: "Pareja" },
  { type: "family" as const, icon: Baby, label: "Familia" },
  { type: "friends" as const, icon: UserPlus, label: "Amigos" },
];

const TRANSPORT_OPTIONS = [
  { mode: "walking", icon: Footprints, label: "A pie" },
  { mode: "driving", icon: Car, label: "Auto" },
  { mode: "cycling", icon: Bike, label: "Bici" },
  { mode: "public_transport", icon: Bus, label: "Público" },
];

export const TourWizardForm: React.FC<TourWizardFormProps> = ({
  onSubmit,
  onCancel,
  initialLocation,
  isLoading = false,
}) => {
  const { setCenter } = useContext(AppContext);
  const [currentStep, setCurrentStep] = useState(1);
  const [destination, setDestination] = useState<string>("");
  const [destinationCoords, setDestinationCoords] = useState<
    { lat: number; lng: number } | undefined
  >(initialLocation);
  const [destinationRadius, setDestinationRadius] = useState<number | undefined>(undefined);
  const [destinationIsDirty, setDestinationIsDirty] = useState(false);

  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [days, setDays] = useState<number>(3);
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);

  // Step 2 & 3 state
  const [selectedInterests, setSelectedInterests] = useState<string[]>(["Historia", "Comida"]);
  const [groupType, setGroupType] = useState<"solo" | "couple" | "family" | "friends">("solo");
  const [travelPace, setTravelPace] = useState<"relaxed" | "moderate" | "fast">("moderate");
  const [budgetLevel, setBudgetLevel] = useState<"low" | "medium" | "high">("medium");
  const [transportationMode, setTransportationMode] = useState<string[]>(["walking"]);
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

  const toggleTransportationMode = (mode: string) => {
    setTransportationMode((prev) => {
      if (prev.includes(mode)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== mode);
      }
      return [...prev, mode];
    });
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

    const preferences: GenerateTourDto = {
      destination: destination || undefined,
      destinationLatitude: destinationCoords?.lat,
      destinationLongitude: destinationCoords?.lng,
      days,
      budgetLevel,
      transportationMode: transportationMode as any,
      travelPace,
      groupType,
      interests: interestApis.length > 0 ? interestApis : undefined,
      startDates: startDates.length > 0 ? startDates : undefined,
      latitude: destinationCoords?.lat || initialLocation?.lat,
      longitude: destinationCoords?.lng || initialLocation?.lng,
      radius: destinationRadius,
      includeExistingActivities: true,
      skipImageGeneration: true,
    };

    onSubmit(preferences);
  };

  // STEP 1: DESTINO Y FECHAS
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
      <VStack space="xl" flex={1}>
        <VStack space="xs">
          <Heading size="lg" color="$textLight900" style={{ fontFamily: FONT_DISPLAY }}>
            ¿A dónde querés viajar?
          </Heading>
          <Text size="sm" color="$textLight500">
            Elegí una ciudad o zona y las fechas para tu itinerario.
          </Text>
        </VStack>

        {/* Search Input */}
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

        {/* Map Preview */}
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

        {/* Date Range Picker */}
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

        {/* Location Toggle */}
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

  // STEP 2: INTERESES & RITMO
  const renderStep2 = () => {
    return (
      <VStack space="xl" flex={1}>
        <VStack space="xs">
          <Heading size="lg" color="$textLight900" style={{ fontFamily: FONT_DISPLAY }}>
            ¿Qué te apasiona explorar?
          </Heading>
          <Text size="sm" color="$textLight500">
            Seleccioná tus intereses clave para que la IA arme tu recorrido.
          </Text>
        </VStack>

        {/* Interests 2-Column Grid */}
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

        {/* Ritmo de Viaje (Pace Selector) */}
        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Ritmo de Exploración
          </Text>
          <HStack bg="$backgroundLight100" p="$1" borderRadius="$2xl" borderWidth={1} borderColor="$borderLight200">
            {[
              { key: "relaxed" as const, label: "Relajado", desc: "Pocas paradas" },
              { key: "moderate" as const, label: "Equilibrado", desc: "Ritmo ideal" },
              { key: "fast" as const, label: "Intenso", desc: "Al máximo" },
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

        {/* Group Type */}
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
      </VStack>
    );
  };

  // STEP 3: MOVILIDAD, PRESUPUESTO Y NOTAS
  const renderStep3 = () => {
    return (
      <VStack space="xl" flex={1}>
        <VStack space="xs">
          <Heading size="lg" color="$textLight900" style={{ fontFamily: FONT_DISPLAY }}>
            Movilidad y Preferencias
          </Heading>
          <Text size="sm" color="$textLight500">
            Últimos detalles para que tu experiencia sea perfecta.
          </Text>
        </VStack>

        {/* Transportation Mode */}
        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Medio de transporte preferido
          </Text>
          <HStack space="sm" justifyContent="space-between">
            {TRANSPORT_OPTIONS.map(({ mode, icon: IconComponent, label }) => {
              const isSelected = transportationMode.includes(mode);
              return (
                <Pressable
                  key={mode}
                  onPress={() => toggleTransportationMode(mode)}
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

        {/* Presupuesto */}
        <VStack space="sm">
          <Text size="xs" fontWeight="$bold" color="$textLight700" textTransform="uppercase" letterSpacing={1}>
            Nivel de Presupuesto
          </Text>
          <HStack bg="$backgroundLight100" p="$1" borderRadius="$2xl" borderWidth={1} borderColor="$borderLight200">
            {[
              { key: "low" as const, label: "$ Económico", desc: "Lugares accesibles y gratuitos" },
              { key: "medium" as const, label: "$$ Moderado", desc: "Balance entre precio y calidad" },
              { key: "high" as const, label: "$$$ Premium", desc: "Experiencias y alta gama" },
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

        {/* Special Notes / AI Prompts */}
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
              h={100}
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
        return "Intereses y Estilo";
      case 3:
        return "Movilidad y Preferencias";
      default:
        return "";
    }
  };

  return (
    <Box flex={1} bg="$backgroundLight50">
      {/* Top Navigation Bar & Progress Indicator */}
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

        {/* Progress Bar */}
        <Box h={4} w="$full" bg="$backgroundLight200" borderRadius="$full" overflow="hidden">
          <Box h="$full" w={getStepProgress()} bg="$primary500" borderRadius="$full" />
        </Box>
      </Box>

      {/* Form Content */}
      <ScrollView flex={1} showsVerticalScrollIndicator={false}>
        <Box p="$5" pb="$28">
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
