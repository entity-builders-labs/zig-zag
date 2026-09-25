import React, { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  Share,
  useWindowDimensions,
} from "react-native";
import { File, Paths } from "expo-file-system";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Box,
  HStack,
  Icon,
  Pressable,
  Text,
  VStack,
} from "@gluestack-ui/themed";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clock,
  Download,
  FileJson,
  Layers,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
  XCircle,
} from "lucide-react-native";
import { copyTextToClipboard } from "@/utils/copy-to-clipboard";
import type {
  CandidateScoreBreakdown,
  GenerationTrace,
  GenerationTraceStep,
  TraceCandidate,
  TraceCandidateDecision,
  TraceDecision,
  TraceEntityResolutionAttempt,
  TraceEntityResolutionDecision,
  TraceGeographicComponent,
  TraceGeographicValidationDecision,
  TraceMaterializationDecision,
  TraceRuleEvaluation,
} from "@/api/generation-trace-contract";

export type { GenerationTrace } from "@/api/generation-trace-contract";

type GeographicDecisionReason =
  | "OUTSIDE_DESTINATION_BOUNDARY"
  | "OUTSIDE_CANONICAL_AREA_BOUNDARY"
  | "OUTSIDE_POINT_RADIUS_SCOPE"
  | "COUNTRY_CONFLICT"
  | "REGION_CONFLICT"
  | "LOCALITY_CONFLICT"
  | "OUTSIDE_ROUTE_DESTINATION_RADIUS"
  | "EXTERNAL_AREA_SCOPE_MISMATCH"
  | "EXTERNAL_ROUTE_SCOPE_MISMATCH";

interface GenerationBitacoraProps {
  trace: GenerationTrace;
  tourName?: string;
  totalDays?: number;
  categories?: string[];
}

const COLORS = {
  page: "#08111E",
  shell: "#0C1726",
  panel: "#111D2C",
  panelStrong: "#0C1623",
  panelSoft: "#172435",
  border: "#26374B",
  borderSoft: "#1D2C3E",
  text: "#F4F7FB",
  textMuted: "#A8B5C7",
  textDim: "#7F8EA3",
  blue: "#5B91F5",
  blueSoft: "#16315F",
  green: "#65D891",
  greenBg: "#123B2A",
  amber: "#F5B942",
  amberBg: "#3A2B0B",
  red: "#F06A6A",
  redBg: "#3B1C20",
  slate: "#8290A3",
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeDecision(step: GenerationTraceStep): TraceDecision {
  if (step.decision) return step.decision;
  if (step.providerStatus === "failed") {
    return {
      status: "WARN",
      outcome: "LEGACY_STEP_DEGRADED",
      reason: step.degradedReason || step.summary,
      reasonCodes: step.degradedReason ? [step.degradedReason] : [],
    };
  }
  return {
    status: "INFO",
    outcome: "LEGACY_TRACE_STEP",
    reason: step.summary,
    reasonCodes: [],
  };
}

function normalizeCandidates(
  step: GenerationTraceStep,
): TraceCandidateDecision[] {
  if (step.candidateDecisions?.length) return step.candidateDecisions;
  return (step.candidates ?? []).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    source: candidate.source,
    status: candidate.chosen
      ? "SELECTED"
      : candidate.offered
        ? "ELIGIBLE"
        : "REJECTED",
    reason: candidate.detail,
    scoreBreakdown: candidate.scoreBreakdown,
  }));
}

function statusVisual(status?: string) {
  switch (status) {
    case "PASS":
      return {
        icon: CheckCircle2,
        color: COLORS.green,
        bg: COLORS.greenBg,
        label: "PASS",
      };
    case "FAIL":
      return {
        icon: XCircle,
        color: COLORS.red,
        bg: COLORS.redBg,
        label: "FAIL",
      };
    case "WARN":
      return {
        icon: AlertTriangle,
        color: COLORS.amber,
        bg: COLORS.amberBg,
        label: "WARN",
      };
    case "SKIPPED":
      return {
        icon: CircleHelp,
        color: COLORS.slate,
        bg: COLORS.panelSoft,
        label: "SKIPPED",
      };
    default:
      return {
        icon: CircleHelp,
        color: COLORS.blue,
        bg: COLORS.blueSoft,
        label: status || "INFO",
      };
  }
}

function formatClock(value?: string): string {
  if (!value) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false });
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined || durationMs === null) return "—";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

const GEOGRAPHIC_REASON_LABELS: Record<GeographicDecisionReason, string> = {
  OUTSIDE_DESTINATION_BOUNDARY: "Fuera del límite del destino",
  OUTSIDE_CANONICAL_AREA_BOUNDARY: "Fuera del área canónica de la experiencia",
  OUTSIDE_POINT_RADIUS_SCOPE: "Fuera del radio permitido",
  COUNTRY_CONFLICT: "Conflicto de país",
  REGION_CONFLICT: "Conflicto de región",
  LOCALITY_CONFLICT: "Conflicto de localidad",
  OUTSIDE_ROUTE_DESTINATION_RADIUS: "Fuera del radio regional de la ruta",
  EXTERNAL_AREA_SCOPE_MISMATCH: "Fuera del área solicitada",
  EXTERNAL_ROUTE_SCOPE_MISMATCH: "Fuera del corredor de la ruta",
};

function humanGeographicReason(reason?: string): string | undefined {
  if (!reason) return undefined;
  return GEOGRAPHIC_REASON_LABELS[reason as GeographicDecisionReason];
}

function formatDistanceMeters(value?: number): string | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

function compactValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return safeJson(value);
  return String(value);
}

function candidateScore(candidate: TraceCandidateDecision): string {
  const total = candidate.scoreBreakdown?.totalScore;
  if (typeof total === "number") return total.toFixed(2);
  const semantic = candidate.scoreBreakdown?.semanticSimilarity;
  if (typeof semantic === "number") return semantic.toFixed(2);
  return "—";
}

function semanticScore(candidate: TraceCandidateDecision): string {
  const semantic = candidate.scoreBreakdown?.semanticSimilarity;
  return typeof semantic === "number" ? semantic.toFixed(2) : "—";
}

const V4_PRODUCT_GROUPS: Record<string, string> = {
  preference_interpretation: "Qué viaje entendimos",
  tour_intent: "Qué viaje entendimos",
  destination_resolution: "Destino resuelto",
  db_search: "Cobertura de preferencias",
  coverage_analysis: "Cobertura de preferencias",
  discovery: "Qué faltaba",
  acquisition: "Búsqueda de nuevas opciones",
  places_crawl: "Búsqueda de nuevas opciones",
  entity_resolution: "Verificación y clasificación",
  geographic_validation: "Verificación y clasificación",
  catalog_materialization: "Verificación y clasificación",
  candidate_pool: "Selección de Experiences",
  embeddings: "Selección de Experiences",
  daily_planning: "Armado del itinerario",
  planning_initial: "Armado del itinerario",
  planning_backfill: "Armado del itinerario",
  finalization: "Resultado final",
  verification: "Resultado final",
  tour_completeness: "Resultado final",
};

function productGroupForStage(stage: string): string | undefined {
  return V4_PRODUCT_GROUPS[stage];
}

function getLegacyOutput(
  step: GenerationTraceStep,
): Record<string, unknown> | undefined {
  const compatibility: Record<string, unknown> = {};
  if (step.coverageReport !== undefined)
    compatibility.coverageReport = step.coverageReport;
  if (step.semanticRanking !== undefined)
    compatibility.semanticRanking = step.semanticRanking;
  if (step.grounding !== undefined) compatibility.grounding = step.grounding;
  if (step.dailyPlanning !== undefined)
    compatibility.dailyPlanning = step.dailyPlanning;
  if (step.tourCompleteness !== undefined)
    compatibility.tourCompleteness = step.tourCompleteness;
  if (step.tourFormatCoverage !== undefined)
    compatibility.tourFormatCoverage = step.tourFormatCoverage;
  if (step.candidatePool !== undefined)
    compatibility.candidatePool = step.candidatePool;
  return Object.keys(compatibility).length ? compatibility : undefined;
}

function identityEvidenceLabel(
  evidence: TraceEntityResolutionAttempt["identityEvidence"][number],
): string {
  switch (evidence.type) {
    case "EXACT_NAME":
      return `EXACT_NAME multiplicity=${evidence.identityMultiplicity}`;
    case "DECLARED_ALIAS_MATCH":
      return `DECLARED_ALIAS_MATCH multiplicity=${evidence.identityMultiplicity}`;
    case "ADDRESS_MATCH":
      return "ADDRESS_MATCH";
    case "WIKIDATA_IDENTITY_MATCH":
      return `WIKIDATA_IDENTITY_MATCH source=${evidence.source} hintMatched=${String(evidence.hintMatched)} candidateMatched=${String(evidence.candidateMatched)}`;
    case "WIKIDATA_UNAVAILABLE":
      return "WIKIDATA_UNAVAILABLE";
    case "IDENTITY_CONVERGENCE":
      return `IDENTITY_CONVERGENCE prior=${evidence.priorStrategy}`;
    case "STRUCTURED_ROUTE_RESOLUTION":
      return `STRUCTURED_ROUTE_RESOLUTION segments=${evidence.segmentExternalIds.length} destination=${evidence.destinationCompatibility} ${evidence.ambiguity}`;
    case "CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH":
      return `CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH variant=${evidence.retrievalVariant} multiplicity=${evidence.identityMultiplicity}`;
  }
}

function TraceBadge({ status }: { status?: string }) {
  const visual = statusVisual(status);
  return (
    <Box px="$2" py="$1" borderRadius="$md" bg={visual.bg as any}>
      <Text size="2xs" fontWeight="$bold" color={visual.color as any}>
        {visual.label}
      </Text>
    </Box>
  );
}

function TimelineStep({
  step,
  index,
  active,
  onPress,
}: {
  step: GenerationTraceStep;
  index: number;
  active: boolean;
  onPress: () => void;
}) {
  const decision = normalizeDecision(step);
  const visual = statusVisual(step.status ?? decision.status);
  const StatusIcon = visual.icon;
  const candidates = normalizeCandidates(step);
  const secondary =
    step.degradedReason ||
    (candidates.length ? `${candidates.length} candidatos` : undefined) ||
    decision.outcome;

  return (
    <Pressable onPress={onPress} testID={`bitacora-step-${step.stage}`}>
      <Box
        p="$3"
        borderRadius="$lg"
        borderWidth={1}
        borderColor={active ? COLORS.blue : "transparent"}
        bg={active ? "#12243D" : "transparent"}
        mb="$1"
      >
        <HStack alignItems="flex-start" space="sm">
          <Box
            mt="$0.5"
            w={22}
            h={22}
            borderRadius="$sm"
            bg={active ? COLORS.blue : visual.bg}
            alignItems="center"
            justifyContent="center"
          >
            <Text
              size="2xs"
              fontWeight="$bold"
              color={active ? "#FFFFFF" : visual.color}
            >
              {index + 1}
            </Text>
          </Box>
          <VStack flex={1}>
            <HStack
              justifyContent="space-between"
              alignItems="center"
              space="xs"
            >
              <Text
                size="xs"
                fontWeight="$semibold"
                color={COLORS.text}
                flex={1}
              >
                {productGroupForStage(step.stage) || step.label}
              </Text>
              <Text size="2xs" color={COLORS.textMuted}>
                {formatClock(step.timing?.startedAt)}
              </Text>
              <Icon as={StatusIcon} size="2xs" color={visual.color as any} />
            </HStack>

            <Text size="2xs" color={COLORS.textMuted} mt="$0.5">
              {step.component || step.stage}
            </Text>
            {secondary ? (
              <Text size="2xs" color={visual.color as any} mt="$1">
                {secondary}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      </Box>
    </Pressable>
  );
}

function MetricCard({ rule }: { rule: TraceRuleEvaluation }) {
  return (
    <Box
      style={{ minWidth: 160 }}
      flex={1}
      p="$3"
      bg={COLORS.panelSoft as any}
      borderRadius="$lg"
      borderWidth={1}
      borderColor={COLORS.border as any}
    >
      <HStack justifyContent="space-between" alignItems="center" space="sm">
        <Text size="xs" color={COLORS.text} flex={1}>
          {rule.rule}
        </Text>
        <TraceBadge status={rule.result} />
      </HStack>
      {(rule.actual !== undefined || rule.expected !== undefined) && (
        <Text size="xs" color={COLORS.textMuted} mt="$2">
          {rule.actual !== undefined ? compactValue(rule.actual) : "—"}
          {rule.expected !== undefined
            ? ` · esperado ${compactValue(rule.expected)}`
            : ""}
        </Text>
      )}
      <Text size="2xs" color={COLORS.textDim} mt="$2">
        {rule.reason}
      </Text>
    </Box>
  );
}

function InputsPanel({ inputs }: { inputs?: Record<string, unknown> }) {
  return (
    <Panel title="Inputs" icon={FileJson}>
      {inputs && Object.keys(inputs).length ? (
        <VStack space="sm">
          {Object.entries(inputs).map(([key, value]) => (
            <HStack key={key} space="md" alignItems="flex-start">
              <Text size="xs" color={COLORS.textMuted} width={125}>
                {key}
              </Text>
              <Text size="xs" color={COLORS.text} flex={1}>
                {compactValue(value)}
              </Text>
            </HStack>
          ))}
        </VStack>
      ) : (
        <Text size="xs" color={COLORS.textDim}>
          Sin inputs registrados para esta etapa.
        </Text>
      )}
    </Panel>
  );
}

function RulesPanel({ rules }: { rules?: TraceRuleEvaluation[] }) {
  return (
    <Panel title="Reglas Evaluadas" icon={ShieldCheck}>
      {rules?.length ? (
        <VStack>
          {rules.map((rule, index) => (
            <Box
              key={`${rule.ruleId}-${index}`}
              py="$2.5"
              borderBottomWidth={index === rules.length - 1 ? 0 : 1}
              borderBottomColor={COLORS.borderSoft as any}
            >
              <HStack alignItems="center" space="sm">
                <Text size="2xs" color={COLORS.textMuted} width={118}>
                  {rule.ruleId}
                </Text>
                <Text size="xs" color={COLORS.text} flex={1}>
                  {rule.rule}
                </Text>
                <TraceBadge status={rule.result} />
              </HStack>
              <Text size="2xs" color={COLORS.textDim} mt="$1.5" ml={128}>
                {rule.reason}
              </Text>
            </Box>
          ))}
        </VStack>
      ) : (
        <Text size="xs" color={COLORS.textDim}>
          Sin reglas registradas para esta etapa.
        </Text>
      )}
    </Panel>
  );
}

function DecisionPanel({ step }: { step: GenerationTraceStep }) {
  const decision = normalizeDecision(step);
  const visual = statusVisual(step.status ?? decision.status);
  return (
    <Panel title="Decisión" icon={Terminal}>
      <HStack justifyContent="space-between" alignItems="center" mb="$3">
        <Text size="xs" color={COLORS.textMuted}>
          outcome
        </Text>
        <Text size="xs" fontWeight="$bold" color={visual.color as any}>
          {decision.outcome}
        </Text>
      </HStack>
      {decision.reasonCodes?.length ? (
        <VStack space="xs" mb="$3">
          <Text size="xs" color={COLORS.textMuted}>
            reasonCodes
          </Text>
          {decision.reasonCodes.map((code, idx) => (
            <Text key={`${code}-${idx}`} size="xs" color={COLORS.text}>
              • {code}
            </Text>
          ))}
        </VStack>
      ) : null}
      {decision.triggeredActions?.length ? (
        <VStack space="xs" mb="$3">
          <Text size="xs" color={COLORS.textMuted}>
            triggeredActions
          </Text>
          {decision.triggeredActions.map((action, idx) => (
            <Text key={`${action}-${idx}`} size="xs" color={COLORS.text}>
              • {action}
            </Text>
          ))}
        </VStack>
      ) : null}
      <Text size="xs" color={COLORS.textMuted}>
        Por qué
      </Text>
      <Text size="xs" color={COLORS.text} mt="$1.5">
        {decision.reason || step.summary}
      </Text>
    </Panel>
  );
}

function CandidatePanel({
  candidates,
}: {
  candidates: TraceCandidateDecision[];
}) {
  const visible = candidates.slice(0, 12);
  return (
    <Panel title={`Candidatos Analizados (${candidates.length})`} icon={Search}>
      {visible.length ? (
        <VStack>
          {visible.map((candidate, index) => (
            <Box
              key={`${candidate.id}-${index}`}
              py="$2"
              borderBottomWidth={index === visible.length - 1 ? 0 : 1}
              borderBottomColor={COLORS.borderSoft as any}
            >
              <HStack alignItems="center" space="sm">
                <Text size="2xs" color={COLORS.textDim} width={18}>
                  {index + 1}
                </Text>
                <Text size="xs" color={COLORS.text} flex={1}>
                  {candidate.name}
                </Text>
                <Text size="2xs" color={COLORS.textMuted}>
                  Score: {candidateScore(candidate)}
                </Text>
                <Text size="2xs" color={COLORS.textMuted}>
                  Sem: {semanticScore(candidate)}
                </Text>
              </HStack>
              <HStack ml={28} mt="$1" alignItems="center" space="sm">
                {candidate.source ? (
                  <Box
                    px="$1.5"
                    py="$0.5"
                    borderRadius="$sm"
                    bg={COLORS.panelStrong as any}
                  >
                    <Text size="2xs" color={COLORS.textDim}>
                      {candidate.source}
                    </Text>
                  </Box>
                ) : null}
                <Text
                  size="2xs"
                  color={statusVisual(candidate.status).color as any}
                >
                  {candidate.status}
                </Text>
                {candidate.reason ? (
                  <Text size="2xs" color={COLORS.textDim} flex={1}>
                    {candidate.reason}
                  </Text>
                ) : null}
              </HStack>
            </Box>
          ))}
          {candidates.length > visible.length ? (
            <Text size="2xs" color={COLORS.blue} mt="$2">
              + {candidates.length - visible.length} candidatos adicionales en
              el trace
            </Text>
          ) : null}
        </VStack>
      ) : (
        <Text size="xs" color={COLORS.textDim}>
          Sin decisiones de candidatos para esta etapa.
        </Text>
      )}
    </Panel>
  );
}

function relationVisual(relation?: "accepted" | "offending" | "evaluated") {
  switch (relation) {
    case "accepted":
      return { label: "Aceptado", color: COLORS.green };
    case "offending":
      return { label: "Ofensivo", color: COLORS.red };
    case "evaluated":
      return { label: "Evaluado", color: COLORS.textMuted };
    default:
      return { label: relation ?? "—", color: COLORS.textDim };
  }
}

function GeographicComponentRow({
  component,
}: {
  component: TraceGeographicComponent;
}) {
  const visual = relationVisual(component.relation);
  const distance = formatDistanceMeters(component.distanceToBoundaryMeters);
  const humanReason = humanGeographicReason(component.decisionReason);

  return (
    <Box
      py="$2"
      borderBottomWidth={1}
      borderBottomColor={COLORS.borderSoft as any}
    >
      <HStack alignItems="center" space="sm" flexWrap="wrap">
        <Text size="xs" fontWeight="$semibold" color={COLORS.text} flex={1}>
          {component.hintName}
        </Text>
        {component.role ? (
          <Text size="2xs" color={COLORS.textDim}>
            {component.role}
          </Text>
        ) : null}
        <Text size="2xs" fontWeight="$bold" color={visual.color as any}>
          {visual.label}
        </Text>
      </HStack>

      <VStack mt="$1" space="xs">
        {component.hintKey ? (
          <Text size="2xs" color={COLORS.textDim}>
            Clave:{" "}
            <Text color={COLORS.textMuted as any}>{component.hintKey}</Text>
          </Text>
        ) : null}
        {component.resolvedGeoEntityId ? (
          <Text size="2xs" color={COLORS.textDim}>
            GeoEntity:{" "}
            <Text color={COLORS.textMuted as any}>
              {component.resolvedGeoEntityId}
            </Text>
          </Text>
        ) : null}
      </VStack>

      {component.decisionReason ? (
        <VStack mt="$1" space="xs">
          <Text
            size="2xs"
            color={COLORS.textDim}
            style={{ fontFamily: "monospace" }}
          >
            {component.decisionReason}
          </Text>
          {humanReason ? (
            <Text size="xs" color={COLORS.text}>
              {humanReason}
            </Text>
          ) : null}
        </VStack>
      ) : component.relation === "evaluated" ? (
        <Text size="2xs" color={COLORS.textDim} mt="$1">
          evaluado
        </Text>
      ) : null}

      {distance ? (
        <Text size="2xs" color={COLORS.amber} mt="$1">
          {distance}
        </Text>
      ) : null}
    </Box>
  );
}

function GeographicCandidateCard({
  decision,
}: {
  decision: TraceGeographicValidationDecision;
}) {
  const accepted = decision.accepted;
  return (
    <Box
      p="$3"
      mb="$3"
      borderRadius="$lg"
      borderWidth={1}
      borderColor={(accepted ? COLORS.green : COLORS.red) as any}
      bg={COLORS.panelSoft as any}
    >
      <HStack
        justifyContent="space-between"
        alignItems="flex-start"
        space="sm"
        flexWrap="wrap"
      >
        <Text size="sm" fontWeight="$bold" color={COLORS.text} flex={1}>
          {decision.candidateName}
        </Text>
        <Box
          px="$2"
          py="$1"
          borderRadius="$md"
          bg={(accepted ? COLORS.greenBg : COLORS.redBg) as any}
        >
          <Text
            size="2xs"
            fontWeight="$bold"
            color={(accepted ? COLORS.green : COLORS.red) as any}
          >
            {accepted ? "ACEPTADA" : "RECHAZADA"}
          </Text>
        </Box>
      </HStack>

      <VStack mt="$1.5" space="xs">
        <Text size="2xs" color={COLORS.textDim}>
          Clave del candidato:{" "}
          <Text color={COLORS.textMuted as any}>
            {decision.candidateTraceKey}
          </Text>
        </Text>
        <Text size="2xs" color={COLORS.textDim}>
          status: <Text color={COLORS.textMuted as any}>{decision.status}</Text>
        </Text>
        {decision.strategy ? (
          <Text size="2xs" color={COLORS.textDim}>
            Estrategia:{" "}
            <Text color={COLORS.textMuted as any}>{decision.strategy}</Text>
          </Text>
        ) : null}
        {decision.validationIntent ? (
          <Text size="2xs" color={COLORS.textDim}>
            Intent de validación:{" "}
            <Text color={COLORS.textMuted as any}>
              {decision.validationIntent}
            </Text>
          </Text>
        ) : null}
      </VStack>

      {decision.destinationBoundary?.name ||
      decision.destinationBoundary?.externalId ? (
        <Box mt="$2">
          <Text size="2xs" color={COLORS.textDim}>
            Destino validado
          </Text>
          <Text size="xs" color={COLORS.text}>
            {[
              decision.destinationBoundary.name,
              decision.destinationBoundary.externalId,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </Box>
      ) : null}

      {decision.scope ? (
        <Box mt="$2">
          <Text size="2xs" color={COLORS.textDim}>
            Scope externo
          </Text>
          <Text size="xs" color={COLORS.text}>
            {[
              decision.scope.kind,
              decision.scope.anchorName,
              decision.scope.geoEntityId,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </Box>
      ) : null}

      {decision.rejectionReasons?.length ? (
        <Box mt="$2">
          <Text size="2xs" color={COLORS.textDim} mb="$1">
            Motivos de rechazo
          </Text>
          {decision.rejectionReasons.map((reason, idx) => (
            <HStack
              key={`${reason}-${idx}`}
              space="xs"
              alignItems="center"
              mt="$0.5"
              flexWrap="wrap"
            >
              <Text
                size="2xs"
                color={COLORS.red as any}
                style={{ fontFamily: "monospace" }}
              >
                {reason}
              </Text>
              {humanGeographicReason(reason) ? (
                <Text size="xs" color={COLORS.text}>
                  {humanGeographicReason(reason)}
                </Text>
              ) : null}
            </HStack>
          ))}
        </Box>
      ) : null}

      {decision.components?.length ? (
        <Box mt="$3">
          <Text size="2xs" color={COLORS.textDim} mb="$1">
            Componentes evaluados
          </Text>
          {decision.components.map((component, idx) => (
            <GeographicComponentRow
              key={`${component.hintKey ?? component.hintName}-${idx}`}
              component={component}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function GeographicAuditPanel({
  decisions,
}: {
  decisions: TraceGeographicValidationDecision[];
}) {
  return (
    <Panel title="Auditoría geográfica" icon={MapPin}>
      <VStack>
        {decisions.map((decision, idx) => (
          <GeographicCandidateCard
            key={`${decision.candidateTraceKey}-${idx}`}
            decision={decision}
          />
        ))}
      </VStack>
    </Panel>
  );
}

function coverageLabel(
  coverage: NonNullable<TraceEntityResolutionDecision["coverage"]>,
): string {
  return (
    `resolved ${coverage.identityResolvedComponents}/${coverage.totalComponents}` +
    ` · geo-accepted ${coverage.geographicallyAcceptedComponents}` +
    ` · ambiguous ${coverage.ambiguousComponents}` +
    ` · conflicted ${coverage.conflictedComponents}` +
    ` · composition ${coverage.sourceCompositionComplete ? "complete" : "incomplete"}` +
    (coverage.openResearchDeficits.length
      ? ` · research: ${coverage.openResearchDeficits.join(", ")}`
      : "")
  );
}

function CompositeOutcomePanel({
  decisions,
}: {
  decisions: TraceMaterializationDecision[];
}) {
  return (
    <Panel title="Resultado por composite" icon={Layers}>
      <VStack>
        {decisions.map((decision, idx) => {
          const outcome = decision.compositeOutcome;
          if (!outcome) return null;
          const geography =
            outcome.geographicDecision.status === "NOT_EVALUATED"
              ? `geography NOT_EVALUATED (${outcome.geographicDecision.reason})`
              : outcome.geographicDecision.status === "ACCEPTED"
                ? `geography ACCEPTED${outcome.geographicDecision.strategy ? ` (${outcome.geographicDecision.strategy})` : ""}`
                : `geography REJECTED (${outcome.geographicDecision.reasons.join(", ")})`;
          const persistence =
            outcome.persistence.status === "PERSISTED"
              ? `PERSISTED ${outcome.persistence.experienceId}`
              : `NOT_PERSISTED (${outcome.persistence.reasons.join(", ")})`;
          return (
            <Box key={`${decision.candidateTraceKey}-${idx}`} mb="$2">
              <Text size="xs" fontWeight="$bold" color={COLORS.text}>
                {decision.candidateName}
              </Text>
              {outcome.coverage ? (
                <Text size="2xs" color={COLORS.textMuted}>
                  {coverageLabel(outcome.coverage)}
                </Text>
              ) : null}
              <Text size="2xs" color={COLORS.textMuted}>
                {geography} · {persistence}
              </Text>
              <Text
                size="2xs"
                color={outcome.plannerEligible ? COLORS.green : COLORS.red}
              >
                {outcome.plannerEligible
                  ? "planner-eligible"
                  : "not planner-eligible"}
              </Text>
            </Box>
          );
        })}
      </VStack>
    </Panel>
  );
}

function EntityResolutionAuditPanel({
  decisions,
}: {
  decisions: TraceEntityResolutionDecision[];
}) {
  return (
    <Panel title="Auditoría de resolución de entidades" icon={Search}>
      <VStack>
        {decisions.map((decision, candidateIndex) => (
          <Box key={`${decision.candidateTraceKey}-${candidateIndex}`} mb="$3">
            <Text size="xs" fontWeight="$bold" color={COLORS.text}>
              {decision.candidateName}
            </Text>
            <Text
              size="2xs"
              color={decision.accepted ? COLORS.green : COLORS.red}
            >
              {decision.accepted ? "ACCEPTED" : "REJECTED"}
              {decision.rejectionReasons.length
                ? ` · ${decision.rejectionReasons.join(", ")}`
                : ""}
            </Text>
            {decision.coverage ? (
              <Text size="2xs" color={COLORS.textMuted}>
                {coverageLabel(decision.coverage)}
              </Text>
            ) : null}
            {decision.hints.map((hint) => (
              <Box
                key={hint.key}
                mt="$2"
                p="$2"
                bg={COLORS.panelSoft as any}
                borderRadius="$md"
              >
                <HStack justifyContent="space-between" flexWrap="wrap">
                  <Text size="xs" color={COLORS.text}>
                    {hint.name}
                  </Text>
                  <Text size="2xs" color={COLORS.textMuted}>
                    {hint.role}
                    {hint.identityStatus ? ` · ${hint.identityStatus}` : ""}
                  </Text>
                </HStack>
                {hint.evidenceKeys.length ? (
                  <Text size="2xs" color={COLORS.textDim} mt="$1">
                    evidence: {hint.evidenceKeys.join(", ")}
                  </Text>
                ) : null}
                {hint.attempts?.map(
                  (attempt: TraceEntityResolutionAttempt, attemptIndex) => (
                    <Box
                      key={`${attempt.strategy}-${attemptIndex}`}
                      mt="$2"
                      pl="$2"
                      borderLeftWidth={2}
                      borderLeftColor={COLORS.border as any}
                    >
                      <HStack justifyContent="space-between" flexWrap="wrap">
                        <Text size="2xs" color={COLORS.blue}>
                          {attempt.strategy}
                        </Text>
                        <Text
                          size="2xs"
                          color={
                            attempt.candidateAcquired
                              ? COLORS.green
                              : COLORS.textDim
                          }
                        >
                          {attempt.executionStatus === "failed"
                            ? "execution failed"
                            : attempt.candidateAcquired
                              ? "candidate acquired"
                              : "no candidate"}
                        </Text>
                      </HStack>
                      <Text size="2xs" color={COLORS.textDim}>
                        {attempt.provider
                          ? `provider=${attempt.provider}`
                          : "provider=UNKNOWN"}
                        {attempt.query ? ` · query=${attempt.query}` : ""}
                        {attempt.providerResultCount !== undefined
                          ? ` · providerResultCount=${attempt.providerResultCount}`
                          : ""}
                        {attempt.poolCandidateCount !== undefined
                          ? ` · poolCandidateCount=${attempt.poolCandidateCount}`
                          : ""}
                        {attempt.failureStage
                          ? ` · failureStage=${attempt.failureStage}`
                          : ""}
                        {attempt.candidateFoundBeforeFailure !== undefined
                          ? ` · candidateFoundBeforeFailure=${attempt.candidateFoundBeforeFailure}`
                          : ""}
                        {attempt.failureReason
                          ? ` · failureReason=${attempt.failureReason}`
                          : ""}
                        {attempt.verificationDecision
                          ? ` · ${attempt.verificationDecision}`
                          : ""}
                        {attempt.destinationCompatibility
                          ? ` · destination=${attempt.destinationCompatibility.verdict}/${attempt.destinationCompatibility.reason}`
                          : ""}
                        {attempt.routeResolution
                          ? ` · route=${attempt.routeResolution.status}/${attempt.routeResolution.reason} clusters=${attempt.routeResolution.compatibleClusterCount}/${attempt.routeResolution.clusterCount}${
                              attempt.routeResolution.resolvedSegmentCount !==
                              undefined
                                ? ` segments=${attempt.routeResolution.resolvedSegmentCount}`
                                : ""
                            }`
                          : ""}
                      </Text>
                      {attempt.selectedCandidate ? (
                        <Text size="2xs" color={COLORS.textMuted}>
                          {attempt.selectedCandidate.canonicalName} ·{" "}
                          {attempt.selectedCandidate.externalId} ·{" "}
                          {attempt.selectedCandidate.kind}
                        </Text>
                      ) : null}
                      {attempt.identityEvidence.length ? (
                        <VStack mt="$1">
                          {attempt.identityEvidence.map(
                            (evidence, evidenceIndex) => (
                              <Text
                                key={`${evidence.type}-${evidenceIndex}`}
                                size="2xs"
                                color={COLORS.textMuted}
                              >
                                evidence: {identityEvidenceLabel(evidence)}
                              </Text>
                            ),
                          )}
                        </VStack>
                      ) : null}
                    </Box>
                  ),
                )}
                <Text
                  size="2xs"
                  color={hint.status === "resolved" ? COLORS.green : COLORS.red}
                  mt="$2"
                >
                  final: {hint.status}
                  {hint.reason ? ` · ${hint.reason}` : ""}
                </Text>
                {hint.geography ? (
                  <Text size="2xs" color={COLORS.textMuted} mt="$1">
                    geography: {hint.geography.geographicRelation} ·{" "}
                    {hint.geography.geoEntityKind ?? "UNKNOWN"}/
                    {hint.geography.canonicalGeometry}
                    {hint.geography.distanceToBoundaryMeters !== undefined
                      ? ` · ${Math.round(hint.geography.distanceToBoundaryMeters)}m to boundary`
                      : ""}
                  </Text>
                ) : null}
                {hint.deficit ? (
                  <Text size="2xs" color={COLORS.textMuted} mt="$1">
                    deficit: {hint.deficit.reason} ·{" "}
                    {hint.deficit.classification}
                  </Text>
                ) : null}
                {hint.resolvedGeoEntity ? (
                  <Text size="2xs" color={COLORS.green} mt="$1">
                    geoEntityId=
                    {hint.resolvedGeoEntity.geoEntityId ?? "UNKNOWN"} ·
                    canonicalName=
                    {hint.resolvedGeoEntity.canonicalName ?? "UNKNOWN"} ·
                    provider={hint.resolvedGeoEntity.provider ?? "UNKNOWN"} ·
                    externalId={hint.resolvedGeoEntity.externalId ?? "UNKNOWN"}
                  </Text>
                ) : null}
              </Box>
            ))}
          </Box>
        ))}
      </VStack>
    </Panel>
  );
}

function OutputPanel({ step }: { step: GenerationTraceStep }) {
  const output = step.outputs || getLegacyOutput(step);
  return (
    <Panel title="Output" icon={FileJson}>
      <Box p="$3" bg={COLORS.panelStrong as any} borderRadius="$md">
        <Text size="2xs" color="#89D6A6" fontFamily="monospace">
          {output ? safeJson(output) : "// Sin output estructurado registrado"}
        </Text>
      </Box>
    </Panel>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<any>;
  children: React.ReactNode;
}) {
  return (
    <Box
      flex={1}
      style={{ minWidth: 260 }}
      bg={COLORS.panel as any}
      borderWidth={1}
      borderColor={COLORS.border as any}
      borderRadius="$lg"
      p="$4"
    >
      <HStack alignItems="center" space="sm" mb="$3">
        <Icon as={icon} size="sm" color={COLORS.blue as any} />
        <Text size="sm" fontWeight="$semibold" color={COLORS.text}>
          {title}
        </Text>
      </HStack>
      {children}
    </Box>
  );
}

function StageDetail({
  step,
  index,
  nextStep,
}: {
  step: GenerationTraceStep;
  index: number;
  nextStep?: GenerationTraceStep;
}) {
  const decision = normalizeDecision(step);
  const visual = statusVisual(step.status ?? decision.status);
  const rules = step.rules ?? [];
  const candidates = normalizeCandidates(step);

  return (
    <VStack flex={1}>
      <Box
        px="$5"
        pt="$5"
        pb="$4"
        borderBottomWidth={1}
        borderBottomColor={COLORS.border as any}
      >
        <HStack
          justifyContent="space-between"
          alignItems="flex-start"
          space="lg"
          flexWrap="wrap"
        >
          <VStack flex={1} style={{ minWidth: 260 }}>
            <HStack alignItems="center" space="sm" flexWrap="wrap">
              <Box
                w={32}
                h={32}
                borderRadius="$full"
                bg={COLORS.blue as any}
                alignItems="center"
                justifyContent="center"
              >
                <Text size="xs" fontWeight="$bold" color="#FFFFFF">
                  {index + 1}
                </Text>
              </Box>
              <Text size="lg" fontWeight="$bold" color={COLORS.text}>
                Paso {index + 1}
              </Text>
              <Text size="lg" color={COLORS.text}>
                {productGroupForStage(step.stage) || step.label}
              </Text>
            </HStack>
            <HStack mt="$2" ml={42} space="lg" flexWrap="wrap">
              <Text size="xs" color={COLORS.textMuted}>
                Responsable:{" "}
                <Text color={COLORS.text}>{step.component || step.stage}</Text>
              </Text>
              <HStack alignItems="center" space="xs">
                <Icon as={Clock} size="2xs" color={COLORS.textMuted as any} />
                <Text size="xs" color={COLORS.textMuted}>
                  Duración:{" "}
                  <Text color={COLORS.text}>
                    {formatDuration(step.timing?.durationMs)}
                  </Text>
                </Text>
              </HStack>
            </HStack>
          </VStack>
          <Box
            style={{ minWidth: 260, maxWidth: 380 }}
            p="$3"
            borderRadius="$lg"
            borderWidth={1}
            borderColor={visual.color as any}
            bg={visual.bg as any}
          >
            <Text size="xs" fontWeight="$bold" color={visual.color as any}>
              ESTADO: {decision.outcome}
            </Text>
            <Text size="xs" color={COLORS.text} mt="$1">
              {decision.reason || step.summary}
            </Text>
          </Box>
        </HStack>
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
      >
        {rules.length ? (
          <Box flexDirection="row" flexWrap="wrap" gap={12} mb="$4">
            {rules.slice(0, 6).map((rule, idx) => (
              <MetricCard key={`${rule.ruleId}-${idx}`} rule={rule} />
            ))}
          </Box>
        ) : null}

        <Box flexDirection="row" flexWrap="wrap" gap={12} mb="$4">
          <InputsPanel inputs={step.inputs} />
          <RulesPanel rules={rules} />
          <DecisionPanel step={step} />
        </Box>

        {step.stage === "geographic_validation" &&
        step.geographicValidationAudit?.length ? (
          <Box flexDirection="row" flexWrap="wrap" gap={12} mb="$4">
            <GeographicAuditPanel decisions={step.geographicValidationAudit} />
          </Box>
        ) : null}

        {step.stage === "catalog_materialization" &&
        step.materializationAudit?.some((item) => item.compositeOutcome) ? (
          <Box flexDirection="row" flexWrap="wrap" gap={12} mb="$4">
            <CompositeOutcomePanel decisions={step.materializationAudit} />
          </Box>
        ) : null}

        {step.stage === "entity_resolution" &&
        step.entityResolutionAudit?.length ? (
          <Box flexDirection="row" flexWrap="wrap" gap={12} mb="$4">
            <EntityResolutionAuditPanel
              decisions={step.entityResolutionAudit}
            />
          </Box>
        ) : null}

        <Box flexDirection="row" flexWrap="wrap" gap={12}>
          <CandidatePanel candidates={candidates} />
          <OutputPanel step={step} />
        </Box>
      </ScrollView>

      <HStack
        px="$5"
        py="$3"
        justifyContent="space-between"
        alignItems="center"
        borderTopWidth={1}
        borderTopColor={COLORS.border as any}
        bg={COLORS.panelStrong as any}
      >
        <HStack alignItems="center" space="sm">
          <Text size="xs" color={COLORS.textMuted}>
            Siguiente paso:
          </Text>
          <Text size="xs" fontWeight="$semibold" color={COLORS.blue}>
            {nextStep?.component || nextStep?.label || "Fin del pipeline"}
          </Text>
        </HStack>
        <Text size="xs" color={COLORS.textMuted}>
          Etapa {index + 1} de {index + 1 + (nextStep ? 1 : 0)}+
        </Text>
      </HStack>
    </VStack>
  );
}

export function formatGenerationBitacora(trace: GenerationTrace): string {
  const lines = [
    `Generation Trace v${trace.version ?? 1}`,
    `Steps: ${trace.steps.length}`,
    "",
  ];

  trace.steps.forEach((step, index) => {
    const decision = normalizeDecision(step);
    lines.push(
      `${String(index + 1).padStart(2, "0")} · ${step.stage} · ${step.status ?? decision.status}`,
      step.label,
      step.component ? `Component: ${step.component}` : "",
      `Decision: ${decision.outcome}`,
      `Why: ${decision.reason}`,
    );
    if (decision.reasonCodes?.length)
      lines.push(`Reason codes: ${decision.reasonCodes.join(", ")}`);
    if (decision.triggeredActions?.length)
      lines.push(`Next: ${decision.triggeredActions.join(" -> ")}`);
    if (step.rules?.length) {
      lines.push("Rules:");
      for (const item of step.rules) {
        lines.push(
          `  [${item.result}] ${item.ruleId} — ${item.rule}`,
          `    ${item.reason}`,
          item.actual !== undefined
            ? `    actual=${safeJson(item.actual)}`
            : "",
          item.expected !== undefined
            ? `    expected=${safeJson(item.expected)}`
            : "",
        );
      }
    }
    const candidates = normalizeCandidates(step);
    if (candidates.length) {
      lines.push("Candidates:");
      for (const candidate of candidates) {
        lines.push(
          `  [${candidate.status}] ${candidate.name} (${candidate.id})`,
          candidate.reason ? `    ${candidate.reason}` : "",
          candidate.reasonCodes?.length
            ? `    reasons=${candidate.reasonCodes.join(", ")}`
            : "",
        );
      }
    }
    lines.push("");
  });

  return lines.filter((line) => line !== "").join("\n");
}

function renderSummaryPoints(trace: GenerationTrace) {
  const points: {
    icon: any;
    title: string;
    desc: string;
    color: string;
    bg: string;
  }[] = [];

  // 1. Preference / Intent
  const intentStep = trace.steps.find(
    (s) => s.stage === "preference_interpretation" || s.stage === "tour_intent",
  );
  if (intentStep) {
    points.push({
      icon: Sparkles,
      title: "Intención y Preferencias",
      desc:
        intentStep.summary ||
        "Preferencias interpretadas y combinadas con filtros.",
      color: COLORS.blue,
      bg: COLORS.blueSoft,
    });
  }

  // 2. Destination
  const destStep = trace.steps.find(
    (s) => s.stage === "destination_resolution",
  );
  if (destStep) {
    points.push({
      icon: MapPin,
      title: "Destino",
      desc: destStep.summary || "Límites geográficos resueltos.",
      color: COLORS.green,
      bg: COLORS.greenBg,
    });
  }

  // 3. Validation / Discovery
  const geoStep = trace.steps.find((s) => s.stage === "geographic_validation");
  const discoveryStep = trace.steps.find(
    (s) => s.stage === "experience_discovery" || s.stage === "grounded_search",
  );
  if (
    geoStep ||
    discoveryStep ||
    trace.executionSummary?.acceptedExperiences != null
  ) {
    const accepted = trace.executionSummary?.acceptedExperiences ?? 0;
    const rejected = trace.executionSummary?.rejectedProposals ?? 0;
    points.push({
      icon: ShieldCheck,
      title: "Validación Geográfica",
      desc:
        geoStep?.summary ||
        `${accepted} experiencias verificadas con evidencia real (${rejected} descartadas).`,
      color: COLORS.amber,
      bg: COLORS.amberBg,
    });
  }

  // 4. Daily Planning / Itinerary
  const planningStep = trace.steps.find((s) => s.stage === "daily_planning");
  if (planningStep || trace.executionSummary?.selectedExperiences != null) {
    const selected = trace.executionSummary?.selectedExperiences ?? 0;
    points.push({
      icon: Layers,
      title: "Planificación de Itinerario",
      desc:
        planningStep?.summary ||
        `${selected} experiencias programadas en el itinerario diario.`,
      color: COLORS.blue,
      bg: COLORS.blueSoft,
    });
  }

  if (points.length === 0) {
    const text =
      trace.executionSummary?.orderedStages
        ?.map((stage) => String(stage.summary ?? ""))
        .join(" ") || "Ejecución finalizada.";
    return (
      <Text size="xs" color={COLORS.textMuted} lineHeight="$sm">
        {text}
      </Text>
    );
  }

  return points.map((p, idx) => {
    const PointIcon = p.icon;
    return (
      <HStack key={idx} space="sm" alignItems="flex-start" py="$1">
        <Box
          w={22}
          h={22}
          borderRadius="$full"
          bg={p.bg as any}
          alignItems="center"
          justifyContent="center"
          mt="$0.5"
        >
          <Icon as={PointIcon} size="xs" color={p.color as any} />
        </Box>
        <VStack flex={1}>
          <Text size="2xs" fontWeight="$bold" color={COLORS.text}>
            {p.title}
          </Text>
          <Text size="xs" color={COLORS.textMuted} lineHeight="$xs">
            {p.desc}
          </Text>
        </VStack>
      </HStack>
    );
  });
}

export const GenerationBitacora = ({
  trace,
  tourName,
  totalDays,
  categories,
}: GenerationBitacoraProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [selectedStep, setSelectedStep] = useState(0);
  const [downloadState, setDownloadState] = useState<"idle" | "done">("idle");
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const insets = useSafeAreaInsets();
  const topInset = insets.top > 0 ? insets.top : Platform.OS === "ios" ? 44 : 0;
  const bottomInset =
    insets.bottom > 0 ? insets.bottom : Platform.OS === "ios" ? 20 : 0;

  const stats = useMemo(() => {
    const rules = trace.steps.flatMap((step) => step.rules ?? []);
    return {
      failures: rules.filter((item) => item.result === "FAIL").length,
      warnings: rules.filter((item) => item.result === "WARN").length,
      candidates: trace.steps.reduce(
        (total, step) => total + normalizeCandidates(step).length,
        0,
      ),
    };
  }, [trace]);

  const completed = !trace.steps.some(
    (step) => (step.status ?? normalizeDecision(step).status) === "FAIL",
  );
  const selected =
    trace.steps[Math.min(selectedStep, Math.max(trace.steps.length - 1, 0))];
  const generatedAt = trace.steps.find((step) => step.timing?.startedAt)?.timing
    ?.startedAt;

  const handleDownload = async () => {
    const json = safeJson(trace);

    // On Web: native browser file download using Blob and anchor
    if (Platform.OS === "web") {
      try {
        const webDocument = (globalThis as any).document;
        const BlobCtor = (globalThis as any).Blob;
        const webUrl = (globalThis as any).URL;
        if (webDocument && BlobCtor && webUrl) {
          const blob = new BlobCtor([json], { type: "application/json" });
          const url = webUrl.createObjectURL(blob);
          const anchor = webDocument.createElement("a");
          anchor.href = url;
          anchor.download = "generation-trace-v4.json";
          anchor.click();
          webUrl.revokeObjectURL(url);
          setDownloadState("done");
          return;
        }
      } catch {
        // Fallback to clipboard below if document/blob fails
      }
    }

    // On Mobile (iOS / Android): write physical file and share URI (prevents WhatsApp/messaging freeze)
    try {
      if (Platform.OS !== "web") {
        const file = new File(Paths.cache, "generation-trace-v4.json");
        file.write(json);
        await Share.share({
          url: file.uri,
          title: "generation-trace-v4.json",
        });
        setDownloadState("done");
        return;
      }
      await copyTextToClipboard(json);
      setDownloadState("done");
    } catch {
      // User cancelled share or file write error
    }
  };

  return (
    <>
      <Pressable onPress={() => setIsOpen(true)} testID="bitacora-toggle">
        <Box
          my="$3"
          p="$3.5"
          bg={COLORS.panelStrong as any}
          borderRadius="$xl"
          borderWidth={1}
          borderColor={COLORS.border as any}
        >
          <HStack justifyContent="space-between" alignItems="center" space="sm">
            <HStack alignItems="center" space="sm" flex={1}>
              <Box
                w={34}
                h={34}
                borderRadius="$lg"
                bg={COLORS.blueSoft as any}
                alignItems="center"
                justifyContent="center"
              >
                <Icon as={Terminal} size="sm" color={COLORS.blue as any} />
              </Box>
              <VStack flex={1}>
                <Text size="sm" fontWeight="$bold" color={COLORS.text}>
                  Bitácora de Generación
                </Text>
                <Text size="2xs" color={COLORS.textMuted}>
                  v{trace.version ?? 1} · {trace.steps.length} etapas ·{" "}
                  {stats.failures} fails · {stats.warnings} warnings ·{" "}
                  {stats.candidates} decisiones
                </Text>
              </VStack>
            </HStack>
            <Text size="xs" color={COLORS.blue}>
              Abrir
            </Text>
          </HStack>
        </Box>
      </Pressable>

      <Modal
        visible={isOpen}
        animationType="slide"
        onRequestClose={() => setIsOpen(false)}
        statusBarTranslucent
      >
        <Box
          flex={1}
          bg={COLORS.panelStrong as any}
          style={{
            paddingTop: topInset,
            paddingBottom: bottomInset,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          }}
        >
          <Box flex={1} bg={COLORS.page as any}>
            <Box
              px={desktop ? "$5" : "$3"}
              py="$3"
              borderBottomWidth={1}
              borderBottomColor={COLORS.border as any}
              bg={COLORS.panelStrong as any}
            >
              <HStack
                justifyContent="space-between"
                alignItems="center"
                space="lg"
                flexWrap="wrap"
              >
                <HStack
                  alignItems="center"
                  space="sm"
                  flex={1}
                  style={{ minWidth: 280 }}
                >
                  <Pressable
                    onPress={() => setIsOpen(false)}
                    w={40}
                    h={40}
                    borderRadius="$lg"
                    borderWidth={1}
                    borderColor={COLORS.border as any}
                    bg={COLORS.panel as any}
                    alignItems="center"
                    justifyContent="center"
                    accessibilityLabel="Cerrar bitácora"
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Icon as={ArrowLeft} size="sm" color={COLORS.text as any} />
                  </Pressable>
                  <VStack flex={1}>
                    <HStack alignItems="center" space="sm" flexWrap="wrap">
                      <Text size="lg" fontWeight="$bold" color={COLORS.text}>
                        Bitácora de Generación
                      </Text>
                      <Box
                        px="$2"
                        py="$1"
                        borderRadius="$full"
                        bg={
                          completed
                            ? (COLORS.greenBg as any)
                            : (COLORS.redBg as any)
                        }
                      >
                        <Text
                          size="2xs"
                          fontWeight="$bold"
                          color={
                            completed
                              ? (COLORS.green as any)
                              : (COLORS.red as any)
                          }
                        >
                          {completed ? "COMPLETADO" : "CON ERRORES"}
                        </Text>
                      </Box>
                    </HStack>
                    <Text size="xs" color={COLORS.textMuted} mt="$0.5">
                      {tourName || "Tour"}
                      {totalDays
                        ? ` · ${totalDays} día${totalDays === 1 ? "" : "s"}`
                        : ""}
                      {categories?.length ? ` · ${categories.join(", ")}` : ""}
                    </Text>
                  </VStack>
                </HStack>

                <HStack alignItems="center" space="md">
                  <Text size="2xs" color={COLORS.textMuted}>
                    {generatedAt
                      ? `Generado ${new Date(generatedAt).toLocaleString()}`
                      : `Trace v${trace.version ?? 1}`}
                  </Text>
                  <Pressable
                    onPress={handleDownload}
                    px="$3"
                    py="$2.5"
                    borderRadius="$lg"
                    borderWidth={1}
                    borderColor={COLORS.border as any}
                    bg={COLORS.panel as any}
                  >
                    <HStack alignItems="center" space="xs">
                      <Icon
                        as={Download}
                        size="xs"
                        color={COLORS.text as any}
                      />
                      <Text size="xs" color={COLORS.text}>
                        {downloadState === "done"
                          ? "JSON listo"
                          : "Descargar JSON"}
                      </Text>
                    </HStack>
                  </Pressable>
                  <Pressable
                    onPress={() => setIsOpen(false)}
                    w={36}
                    h={36}
                    borderRadius="$lg"
                    borderWidth={1}
                    borderColor={COLORS.border as any}
                    bg={COLORS.panel as any}
                    alignItems="center"
                    justifyContent="center"
                    accessibilityLabel="Cerrar bitácora"
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Icon as={X} size="sm" color={COLORS.text as any} />
                  </Pressable>
                </HStack>
              </HStack>

              {trace.executionSummary && (
                <Box mt="$2.5">
                  <Pressable
                    onPress={() => setIsSummaryExpanded(!isSummaryExpanded)}
                    p="$2.5"
                    borderRadius="$lg"
                    bg={COLORS.panel as any}
                    borderWidth={1}
                    borderColor={COLORS.borderSoft as any}
                    accessibilityRole="button"
                    accessibilityLabel="Alternar resumen de ejecución"
                    testID="bitacora-summary-toggle"
                  >
                    <HStack justifyContent="space-between" alignItems="center">
                      <HStack
                        alignItems="center"
                        space="sm"
                        flexWrap="wrap"
                        flex={1}
                      >
                        <Text size="xs" fontWeight="$bold" color={COLORS.text}>
                          Resumen de ejecución
                        </Text>
                        <Box
                          px="$2"
                          py="$0.5"
                          borderRadius="$full"
                          bg={COLORS.blueSoft as any}
                        >
                          <Text
                            size="2xs"
                            color={COLORS.blue}
                            fontWeight="$medium"
                          >
                            {trace.executionSummary.selectedExperiences != null
                              ? `${trace.executionSummary.selectedExperiences} seleccionadas`
                              : `${trace.steps.length} etapas`}{" "}
                            · {trace.steps.length} etapas
                          </Text>
                        </Box>
                        {trace.executionSummary.acceptedExperiences != null && (
                          <Box
                            px="$2"
                            py="$0.5"
                            borderRadius="$full"
                            bg={COLORS.greenBg as any}
                          >
                            <Text
                              size="2xs"
                              color={COLORS.green}
                              fontWeight="$medium"
                            >
                              {trace.executionSummary.acceptedExperiences}{" "}
                              validadas
                            </Text>
                          </Box>
                        )}
                        {Boolean(trace.executionSummary.rejectedProposals) && (
                          <Box
                            px="$2"
                            py="$0.5"
                            borderRadius="$full"
                            bg={COLORS.amberBg as any}
                          >
                            <Text
                              size="2xs"
                              color={COLORS.amber}
                              fontWeight="$medium"
                            >
                              {trace.executionSummary.rejectedProposals}{" "}
                              descartadas
                            </Text>
                          </Box>
                        )}
                      </HStack>
                      <HStack alignItems="center" space="xs">
                        <Text
                          size="2xs"
                          color={COLORS.blue}
                          fontWeight="$medium"
                        >
                          {isSummaryExpanded ? "Ocultar" : "Ver detalle"}
                        </Text>
                        <Icon
                          as={isSummaryExpanded ? ChevronUp : ChevronDown}
                          size="xs"
                          color={COLORS.blue as any}
                        />
                      </HStack>
                    </HStack>
                  </Pressable>

                  {isSummaryExpanded && (
                    <Box
                      mt="$2"
                      p="$3"
                      borderRadius="$lg"
                      bg={COLORS.panelStrong as any}
                      borderWidth={1}
                      borderColor={COLORS.border as any}
                      style={{ maxHeight: 220 }}
                    >
                      <ScrollView showsVerticalScrollIndicator={false}>
                        <VStack space="xs">{renderSummaryPoints(trace)}</VStack>
                      </ScrollView>
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            {desktop ? (
              <HStack flex={1}>
                <Box
                  width={326}
                  borderRightWidth={1}
                  borderRightColor={COLORS.border as any}
                  bg={COLORS.shell as any}
                >
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ padding: 12 }}
                  >
                    {trace.steps.map((step, index) => (
                      <TimelineStep
                        key={`${step.stage}-${index}`}
                        step={step}
                        index={index}
                        active={selectedStep === index}
                        onPress={() => setSelectedStep(index)}
                      />
                    ))}
                  </ScrollView>
                </Box>
                {selected ? (
                  <StageDetail
                    step={selected}
                    index={selectedStep}
                    nextStep={trace.steps[selectedStep + 1]}
                  />
                ) : null}
              </HStack>
            ) : (
              <VStack flex={1}>
                <Box
                  py="$2"
                  borderBottomWidth={1}
                  borderBottomColor={COLORS.border as any}
                  bg={COLORS.shell as any}
                >
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 8 }}
                  >
                    <HStack space="xs">
                      {trace.steps.map((step, index) => (
                        <Pressable
                          key={`${step.stage}-${index}`}
                          onPress={() => setSelectedStep(index)}
                        >
                          <Box
                            style={{ minWidth: 150 }}
                            p="$2.5"
                            borderRadius="$lg"
                            borderWidth={1}
                            borderColor={
                              selectedStep === index
                                ? (COLORS.blue as any)
                                : (COLORS.border as any)
                            }
                            bg={
                              selectedStep === index
                                ? ("#12243D" as any)
                                : (COLORS.panel as any)
                            }
                          >
                            <Text size="2xs" color={COLORS.textDim}>
                              Paso {index + 1}
                            </Text>
                            <Text
                              size="xs"
                              fontWeight="$semibold"
                              color={COLORS.text}
                              numberOfLines={1}
                            >
                              {productGroupForStage(step.stage) || step.label}
                            </Text>
                            <Text
                              size="2xs"
                              color={
                                statusVisual(
                                  step.status ?? normalizeDecision(step).status,
                                ).color as any
                              }
                              mt="$1"
                            >
                              {normalizeDecision(step).outcome}
                            </Text>
                          </Box>
                        </Pressable>
                      ))}
                    </HStack>
                  </ScrollView>
                </Box>
                {selected ? (
                  <StageDetail
                    step={selected}
                    index={selectedStep}
                    nextStep={trace.steps[selectedStep + 1]}
                  />
                ) : null}
              </VStack>
            )}
          </Box>
        </Box>
      </Modal>
    </>
  );
};
