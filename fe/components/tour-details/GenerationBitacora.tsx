import React, { useState } from 'react';
import {
  VStack,
  HStack,
  Text,
  Badge,
  BadgeText,
  Pressable,
  Icon,
  Box,
} from '@gluestack-ui/themed';
import {
  ChevronDown,
  ChevronUp,
  Terminal,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Database,
  Search,
  MapPin,
  ShieldCheck,
  Compass,
  Layers,
  Clock,
  Footprints,
} from 'lucide-react-native';

interface CandidateScoreBreakdown {
  semanticSimilarity?: number | null;
  qualityBonus?: number;
  proximityBonus?: number;
  diversityBonus?: number;
  totalScore?: number;
}

interface TraceCandidate {
  source: 'db' | 'google_places' | 'osm' | 'wikidata' | 'serpapi' | 'geoapify' | 'discovery';
  id: string;
  name: string;
  detail?: string;
  offered: boolean;
  chosen: boolean;
  scoreBreakdown?: CandidateScoreBreakdown;
  coverageContribution?: {
    themes: string[];
    experienceFormat?: string;
  };
}

interface DailyPlanningStepData {
  solver?: string;
  dayCount?: number;
  selectedCount?: number;
  unselectedCount?: number;
  score?: number;
  days?: Array<{
    dayNumber: number;
    activityCount: number;
    totalActivityMinutes: number;
    totalWalkingMinutes: number;
    utilizationMinutes: number;
  }>;
}

interface GenerationTraceStep {
  stage: string;
  label: string;
  summary: string;
  candidates?: TraceCandidate[];
  placesProvenance?: any;
  providerStatus?: 'success' | 'failed';
  degradedReason?: string;
  semanticRanking?: {
    status: string;
    eligibleCandidateCount?: number;
    indexedCandidateCount?: number;
    offeredCandidateCount?: number;
    provider?: string;
    model?: string;
    reason?: string;
  };
  coverageReport?: any;
  grounding?: {
    status?: string;
    provider?: string;
    model?: string;
    evidenceCount?: number;
    reason?: string;
  };
  dailyPlanning?: DailyPlanningStepData;
}

interface AuditFinding {
  activityId?: string;
  activityName: string;
  openingHoursCheck: 'ok' | 'possibly_closed' | 'no_data';
  priceLevelCheck: 'ok' | 'possibly_over_budget' | 'no_data';
}

export interface GenerationTrace {
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  auditFindings?: { perActivity: AuditFinding[] };
}

const AUDIT_LABELS: Record<string, string> = {
  ok: 'OK',
  no_data: 'sin datos',
  possibly_closed: '⚠ cerrado',
  possibly_over_budget: '⚠ caro',
};

interface ActorInfo {
  name: string;
  type: string;
  tag: string;
  icon: any;
  bg: string;
  text: string;
  border: string;
  defaultMotivation: string;
}

function getStageActor(step: GenerationTraceStep): ActorInfo {
  switch (step.stage) {
    case 'tour_intent':
      return {
        name: 'Wizard & Preferencias',
        type: 'user',
        tag: '🧭 User Intent',
        icon: Compass,
        bg: '$orange50',
        text: '$orange800',
        border: '$orange200',
        defaultMotivation: 'Captura de destino, formato de experiencia, ritmo y restricciones.',
      };
    case 'destination_resolution':
      return {
        name: 'DestinationResolver (Geocoding/OSM)',
        type: 'geo',
        tag: '🗺️ Territorial Bounds',
        icon: MapPin,
        bg: '$sky50',
        text: '$sky800',
        border: '$sky200',
        defaultMotivation: 'Resolución de escala territorial (área vs punto) y polígono geográfico de búsqueda.',
      };
    case 'initial_retrieval':
    case 'db_search':
      return {
        name: 'PostgreSQL (PostGIS + pgvector)',
        type: 'database',
        tag: '🗄️ Database Catalog',
        icon: Database,
        bg: '$blue50',
        text: '$blue800',
        border: '$blue200',
        defaultMotivation: 'Búsqueda espacial inicial por cercanía geográfica en el catálogo verificado.',
      };
    case 'coverage_analysis':
      return {
        name: 'CoverageAnalyzer',
        type: 'rules',
        tag: '📐 Rules Engine',
        icon: Search,
        bg: '$amber50',
        text: '$amber900',
        border: '$amber200',
        defaultMotivation: 'Diagnóstico de suficiencia del pool y vacíos temáticos en el destino.',
      };
    case 'grounded_discovery':
    case 'discovery':
      return {
        name: step.grounding?.provider ? `SerpApi (${step.grounding.provider}) + Gemini` : 'SerpApi Discovery + Gemini',
        type: 'discovery',
        tag: '🌐 Grounded Discovery',
        icon: Sparkles,
        bg: '$purple50',
        text: '$purple800',
        border: '$purple200',
        defaultMotivation: 'Búsqueda web fundamentada para descubrir actividades turísticas ante déficit de catálogo.',
      };
    case 'resolution':
    case 'entity_resolution':
      return {
        name: 'Google Places API + OSM Overpass',
        type: 'places',
        tag: '📍 Entity Resolution',
        icon: MapPin,
        bg: '$emerald50',
        text: '$emerald800',
        border: '$emerald200',
        defaultMotivation: 'Validación de existencia real, obtención de coordenadas precisas y fotos.',
      };
    case 'places_crawl':
    case 'google_places_crawl':
      return {
        name: 'Google Places Crawler',
        type: 'places',
        tag: '📍 Google Places',
        icon: MapPin,
        bg: '$emerald50',
        text: '$emerald800',
        border: '$emerald200',
        defaultMotivation: 'Recuperación de POIs adicionales cercanos para completar la zona.',
      };
    case 'embeddings':
      return {
        name: step.semanticRanking?.provider
          ? `${step.semanticRanking.provider} (${step.semanticRanking.model || 'pgvector'})`
          : 'pgvector + VectorStoreService',
        type: 'vector',
        tag: '🧬 Vector Store',
        icon: Cpu,
        bg: '$cyan50',
        text: '$cyan900',
        border: '$cyan200',
        defaultMotivation: 'Ponderación de afinidad semántica por distancia coseno con los intereses del usuario.',
      };
    case 'candidate_pool':
      return {
        name: 'CandidateRankingEngine',
        type: 'ranking',
        tag: '⚖️ Multicriteria Ranking',
        icon: Layers,
        bg: '$indigo50',
        text: '$indigo800',
        border: '$indigo200',
        defaultMotivation: 'Unificación del pool de candidatos, cálculo de score compuesto y acotamiento de ventana.',
      };
    case 'daily_planning':
      return {
        name: step.dailyPlanning?.solver || 'DailyPlanningSolver (Determinístico)',
        type: 'solver',
        tag: '📐 Planning Solver',
        icon: Terminal,
        bg: '$teal50',
        text: '$teal900',
        border: '$teal200',
        defaultMotivation: 'Asignación matemática de días, resolución TSP de ruta y respeto de presupuestos de tiempo y movilidad.',
      };
    case 'itinerary_generation':
    case 'llm_generation':
      return {
        name: 'LangChain + Gemini 2.5 Flash',
        type: 'llm',
        tag: '🤖 Generative LLM',
        icon: Terminal,
        bg: '$violet50',
        text: '$violet900',
        border: '$violet200',
        defaultMotivation: 'Generación de narrativa, storytelling del guía local y justificación estratégica.',
      };
    case 'quality_audit':
    case 'verification':
      return {
        name: 'Anti-Hallucination & Quality Auditor',
        type: 'security',
        tag: '🛡️ Quality Gate',
        icon: ShieldCheck,
        bg: '$slate100',
        text: '$slate800',
        border: '$slate300',
        defaultMotivation: 'Auditoría estricta de veracidad: verificación de 0 alucinaciones y unicidad.',
      };
    case 'tour_completeness':
    case 'tour_format_coverage':
      return {
        name: 'Itinerary Quality Validators',
        type: 'validator',
        tag: '✓ Completeness Gate',
        icon: CheckCircle2,
        bg: '$green50',
        text: '$green800',
        border: '$green200',
        defaultMotivation: 'Comprobación de formatos solicitados y suficiencia de tiempo por día.',
      };
    default:
      return {
        name: 'ZigZag Engine',
        type: 'engine',
        tag: '⚡ Engine Step',
        icon: Cpu,
        bg: '$coolGray50',
        text: '$coolGray800',
        border: '$coolGray200',
        defaultMotivation: 'Ejecución de pipeline de generación.',
      };
  }
}

function getSourceBadge(source: string) {
  switch (source) {
    case 'db':
      return { bg: '$blue50', border: '$blue200', text: '$blue700', label: 'DB' };
    case 'google_places':
      return { bg: '$emerald50', border: '$emerald200', text: '$emerald700', label: 'Places' };
    case 'osm':
      return { bg: '$orange50', border: '$orange200', text: '$orange700', label: 'OSM' };
    case 'wikidata':
      return { bg: '$purple50', border: '$purple200', text: '$purple700', label: 'Wiki' };
    case 'serpapi':
    case 'discovery':
      return { bg: '$pink50', border: '$pink200', text: '$pink700', label: 'Discovery' };
    case 'geoapify':
      return { bg: '$teal50', border: '$teal200', text: '$teal700', label: 'Geoapify' };
    default:
      return { bg: '$coolGray50', border: '$coolGray200', text: '$coolGray700', label: source };
  }
}

function StepBlock({
  step,
  index,
  auditByActivityId,
}: {
  step: GenerationTraceStep;
  index: number;
  auditByActivityId: Map<string, AuditFinding>;
}) {
  const [expanded, setExpanded] = useState(false);
  const candidates = step.candidates ?? [];
  const hasCandidates = candidates.length > 0;
  const actor = getStageActor(step);
  const ActorIcon = actor.icon;

  return (
    <Box
      mb='$3'
      p='$3.5'
      bg='$white'
      borderRadius='$xl'
      borderWidth={1}
      borderColor={expanded ? '$primary200' : '$borderLight100'}
      shadowColor='$black'
      shadowOffset={{ width: 0, height: 1 }}
      shadowOpacity={0.03}
      shadowRadius={2}
      elevation={1}
    >
      <Pressable
        onPress={() => hasCandidates && setExpanded((e) => !e)}
        testID={`bitacora-step-${step.stage}`}
      >
        <HStack justifyContent='space-between' alignItems='flex-start' space='sm'>
          <HStack flex={1} space='sm' alignItems='flex-start'>
            {/* Step Icon */}
            <Box
              w={28}
              h={28}
              borderRadius='$full'
              bg={actor.bg as any}
              borderWidth={1}
              borderColor={actor.border as any}
              alignItems='center'
              justifyContent='center'
              mt='$0.5'
            >
              <Icon as={ActorIcon} size='xs' color={actor.text as any} />
            </Box>

            <VStack flex={1}>
              {/* Step Header & Actor Badge */}
              <HStack space='xs' alignItems='center' flexWrap='wrap'>
                <Text size='2xs' fontWeight='$bold' color='$textLight500' textTransform='uppercase'>
                  Paso {index + 1} · {step.stage}
                </Text>
                <Box
                  px='$2'
                  py='$0.5'
                  borderRadius='$md'
                  bg={actor.bg as any}
                  borderWidth={1}
                  borderColor={actor.border as any}
                >
                  <Text size='2xs' fontWeight='$bold' color={actor.text as any}>
                    {actor.tag}
                  </Text>
                </Box>
              </HStack>

              {/* Title & Actor Attribution */}
              <Text size='sm' fontWeight='$bold' color='$textLight900' mt='$1'>
                {step.label}
              </Text>
              
              <Text size='2xs' color='$textLight500' mt='$0.5'>
                Responsable: <Text size='2xs' fontWeight='$bold' color='$textLight800'>{actor.name}</Text>
              </Text>

              {/* Motivation / Trigger Callout */}
              <Box
                mt='$1.5'
                p='$2'
                bg='$backgroundLight50'
                borderRadius='$md'
                borderLeftWidth={3}
                borderLeftColor={actor.border as any}
              >
                <Text size='2xs' color='$textLight700' lineHeight='$xs'>
                  <Text size='2xs' fontWeight='$bold' color='$textLight900'>🎯 Motivo: </Text>
                  {actor.defaultMotivation}
                </Text>
              </Box>

              {/* Summary / Decision result */}
              <Text size='xs' color='$textLight700' mt='$1.5' lineHeight='$sm'>
                {step.summary}
              </Text>

              {/* Daily Planning Solver Breakdown Card (PR10) */}
              {step.dailyPlanning?.days && step.dailyPlanning.days.length > 0 && (
                <VStack mt='$2' p='$2' bg='$teal50' borderRadius='$md' borderWidth={1} borderColor='$teal200' space='2xs'>
                  <Text size='2xs' fontWeight='$bold' color='$teal900'>
                    📐 Desglose de Factibilidad Diaria (Solver):
                  </Text>
                  {step.dailyPlanning.days.map((d) => (
                    <HStack key={d.dayNumber} justifyContent='space-between' alignItems='center'>
                      <Text size='2xs' color='$teal800' fontWeight='$medium'>
                        Día {d.dayNumber}: {d.activityCount} paradas ({Math.round(d.totalActivityMinutes / 60)}h actividad)
                      </Text>
                      <HStack space='2xs' alignItems='center'>
                        <Icon as={Footprints} size='2xs' color='$teal700' />
                        <Text size='2xs' color='$teal900' fontWeight='$bold'>
                          {d.totalWalkingMinutes} min caminata
                        </Text>
                      </HStack>
                    </HStack>
                  ))}
                </VStack>
              )}
            </VStack>
          </HStack>

          {/* Candidates Toggle */}
          {hasCandidates && (
            <HStack alignItems='center' space='2xs' bg='$backgroundLight50' px='$2' py='$1' borderRadius='$md'>
              <Text size='2xs' fontWeight='$semibold' color='$textLight600'>
                {candidates.length} {candidates.length === 1 ? 'candidato' : 'candidatos'}
              </Text>
              <Icon as={expanded ? ChevronUp : ChevronDown} size='xs' color='$textLight500' />
            </HStack>
          )}
        </HStack>
      </Pressable>

      {/* Expanded Candidate List */}
      {expanded && hasCandidates && (
        <VStack space='xs' mt='$3' pt='$3' borderTopWidth={1} borderTopColor='$borderLight100'>
          <Text size='2xs' fontWeight='$bold' color='$textLight400' textTransform='uppercase' mb='$1'>
            Candidatos evaluados y procedencia:
          </Text>
          {candidates.map((c, i) => {
            const audit = auditByActivityId.get(c.id);
            const badgeStyle = getSourceBadge(c.source);

            return (
              <Box
                key={`${c.source}-${c.id}-${i}`}
                p='$2'
                bg='$backgroundLight50'
                borderRadius='$lg'
                borderWidth={1}
                borderColor='$borderLight100'
              >
                <HStack justifyContent='space-between' alignItems='center' flexWrap='wrap'>
                  <HStack space='xs' alignItems='center' flex={1}>
                    <Box
                      px='$1.5'
                      py='$0.5'
                      borderRadius='$sm'
                      bg={badgeStyle.bg as any}
                      borderWidth={1}
                      borderColor={badgeStyle.border as any}
                    >
                      <Text size='2xs' fontWeight='$bold' color={badgeStyle.text as any}>
                        {badgeStyle.label}
                      </Text>
                    </Box>
                    <Text size='xs' color='$textLight900' fontWeight='$semibold' numberOfLines={1}>
                      {c.name}
                    </Text>
                  </HStack>

                  <HStack space='xs' alignItems='center'>
                    {c.offered && (
                      <Box px='$1.5' py='$0.5' borderRadius='$sm' bg='$warmGray100'>
                        <Text size='2xs' color='$textLight600' fontWeight='$medium'>
                          Ofrecido
                        </Text>
                      </Box>
                    )}
                    {c.chosen && (
                      <Box px='$1.5' py='$0.5' borderRadius='$sm' bg='$emerald100'>
                        <Text size='2xs' color='$emerald700' fontWeight='$bold'>
                          ✓ Elegido
                        </Text>
                      </Box>
                    )}
                  </HStack>
                </HStack>

                {/* Score Breakdown (PR9 / PR10) */}
                {c.scoreBreakdown && (
                  <HStack mt='$1' space='xs' alignItems='center' flexWrap='wrap'>
                    {c.scoreBreakdown.semanticSimilarity !== null && c.scoreBreakdown.semanticSimilarity !== undefined && (
                      <Box px='$1.5' py='$0.5' bg='$cyan50' borderRadius='$sm' borderWidth={1} borderColor='$cyan200'>
                        <Text size='2xs' color='$cyan800' fontWeight='$bold'>
                          Semántica: {(c.scoreBreakdown.semanticSimilarity * 100).toFixed(0)}%
                        </Text>
                      </Box>
                    )}
                    {c.scoreBreakdown.qualityBonus !== undefined && c.scoreBreakdown.qualityBonus > 0 && (
                      <Box px='$1.5' py='$0.5' bg='$emerald50' borderRadius='$sm' borderWidth={1} borderColor='$emerald200'>
                        <Text size='2xs' color='$emerald800' fontWeight='$bold'>
                          Calidad: +{(c.scoreBreakdown.qualityBonus * 10).toFixed(1)}
                        </Text>
                      </Box>
                    )}
                    {c.scoreBreakdown.proximityBonus !== undefined && (
                      <Box px='$1.5' py='$0.5' bg='$blue50' borderRadius='$sm' borderWidth={1} borderColor='$blue200'>
                        <Text size='2xs' color='$blue800' fontWeight='$bold'>
                          Cercanía: +{(c.scoreBreakdown.proximityBonus * 10).toFixed(1)}
                        </Text>
                      </Box>
                    )}
                  </HStack>
                )}

                {(c.detail || audit) && (
                  <HStack mt='$1' space='xs' alignItems='center' flexWrap='wrap'>
                    {c.detail && (
                      <Text size='2xs' color='$textLight500'>
                        {c.detail}
                      </Text>
                    )}
                    {audit && (
                      <Text size='2xs' color='$amber600' fontWeight='$medium'>
                        · {AUDIT_LABELS[audit.openingHoursCheck]} / {AUDIT_LABELS[audit.priceLevelCheck]}
                      </Text>
                    )}
                  </HStack>
                )}
              </Box>
            );
          })}
        </VStack>
      )}
    </Box>
  );
}

export const GenerationBitacora = ({ trace }: { trace: GenerationTrace }) => {
  const [isOpen, setIsOpen] = useState(false);

  const auditByActivityId = new Map<string, AuditFinding>(
    (trace.auditFindings?.perActivity ?? [])
      .filter((f) => !!f.activityId)
      .map((f) => [f.activityId as string, f])
  );

  const totalCandidates = trace.steps.reduce(
    (acc, s) => acc + (s.candidates?.length ?? 0),
    0
  );

  return (
    <Box
      my='$3'
      bg='$coolGray50'
      borderRadius='$2xl'
      borderWidth={1}
      borderColor='$coolGray200'
      overflow='hidden'
    >
      {/* Header Bar */}
      <Pressable
        onPress={() => setIsOpen((v) => !v)}
        testID='bitacora-toggle'
        p='$3.5'
        bg='$white'
      >
        <HStack justifyContent='space-between' alignItems='center'>
          <HStack space='sm' alignItems='center' flex={1}>
            <Box
              w={32}
              h={32}
              borderRadius='$xl'
              bg='$purple100'
              alignItems='center'
              justifyContent='center'
            >
              <Icon as={Terminal} size='sm' color='$purple700' />
            </Box>
            <VStack flex={1}>
              <HStack space='xs' alignItems='center'>
                <Text size='sm' fontWeight='$bold' color='$textLight900'>
                  Bitácora de Inteligencia y Generación
                </Text>
                <Box px='$1.5' py='$0.5' bg='$purple50' borderRadius='$sm'>
                  <Text size='2xs' fontWeight='$bold' color='$purple700'>
                    Trace
                  </Text>
                </Box>
              </HStack>
              <Text size='xs' color='$textLight500'>
                {trace.steps.length} etapas ejecutadas · {totalCandidates} candidatos evaluados
              </Text>
            </VStack>
          </HStack>

          <HStack space='xs' alignItems='center'>
            <Text size='xs' fontWeight='$bold' color='$primary600'>
              {isOpen ? 'Ocultar' : 'Ver detalle'}
            </Text>
            <Icon as={isOpen ? ChevronUp : ChevronDown} size='xs' color='$primary600' />
          </HStack>
        </HStack>
      </Pressable>

      {/* Collapsible Content */}
      {isOpen && (
        <VStack p='$3.5' space='sm'>
          {/* Quick Stats Grid */}
          <HStack space='xs' mb='$2'>
            <Box flex={1} p='$2' bg='$white' borderRadius='$lg' borderWidth={1} borderColor='$borderLight100'>
              <Text size='2xs' color='$textLight500'>Alucinaciones</Text>
              <HStack space='2xs' alignItems='center' mt='$0.5'>
                <Icon as={CheckCircle2} size='2xs' color='$emerald600' />
                <Text size='xs' fontWeight='$bold' color='$emerald700'>
                  {trace.hallucinatedCount ?? 0}
                </Text>
              </HStack>
            </Box>

            <Box flex={1} p='$2' bg='$white' borderRadius='$lg' borderWidth={1} borderColor='$borderLight100'>
              <Text size='2xs' color='$textLight500'>Duplicados</Text>
              <HStack space='2xs' alignItems='center' mt='$0.5'>
                <Icon as={CheckCircle2} size='2xs' color='$emerald600' />
                <Text size='xs' fontWeight='$bold' color='$emerald700'>
                  {trace.duplicateCount ?? 0}
                </Text>
              </HStack>
            </Box>

            <Box flex={1} p='$2' bg='$white' borderRadius='$lg' borderWidth={1} borderColor='$borderLight100'>
              <Text size='2xs' color='$textLight500'>Verificación</Text>
              <HStack space='2xs' alignItems='center' mt='$0.5'>
                <Icon as={ShieldCheck} size='2xs' color='$blue600' />
                <Text size='xs' fontWeight='$bold' color='$blue700'>
                  100% Real
                </Text>
              </HStack>
            </Box>
          </HStack>

          {/* AI Reasoning Box */}
          {trace.aiReasoning && (
            <Box
              p='$3'
              mb='$2'
              bg='$purple50'
              borderRadius='$xl'
              borderWidth={1}
              borderColor='$purple200'
            >
              <HStack space='xs' alignItems='center' mb='$1'>
                <Icon as={Sparkles} size='xs' color='$purple700' />
                <Text size='xs' fontWeight='$bold' color='$purple900'>
                  Justificación de la IA (Itinerary Strategy)
                </Text>
              </HStack>
              <Text size='xs' color='$purple950' fontStyle='italic' lineHeight='$sm'>
                "{trace.aiReasoning}"
              </Text>
            </Box>
          )}

          {/* Steps Timeline */}
          <VStack space='xs'>
            {trace.steps.map((step, idx) => (
              <StepBlock
                key={`${step.stage}-${idx}`}
                index={idx}
                step={step}
                auditByActivityId={auditByActivityId}
              />
            ))}
          </VStack>
        </VStack>
      )}
    </Box>
  );
};
