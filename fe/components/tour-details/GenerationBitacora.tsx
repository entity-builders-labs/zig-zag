import React, { useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, useWindowDimensions } from 'react-native';
import {
  Box,
  HStack,
  Icon,
  Pressable,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleHelp,
  Clock,
  Download,
  FileJson,
  Search,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react-native';
import { copyTextToClipboard } from '@/utils/copy-to-clipboard';

interface CandidateScoreBreakdown {
  semanticSimilarity?: number | null;
  qualityBonus?: number;
  proximityBonus?: number;
  diversityBonus?: number;
  totalScore?: number;
}

interface TraceRuleEvaluation {
  ruleId: string;
  rule: string;
  result: 'PASS' | 'FAIL' | 'WARN' | 'SKIPPED';
  reason: string;
  inputs?: Record<string, unknown>;
  expected?: unknown;
  actual?: unknown;
}

interface TraceDecision {
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  outcome: string;
  reason: string;
  reasonCodes?: string[];
  triggeredActions?: string[];
}

interface TraceCandidateDecision {
  id: string;
  name: string;
  source?: string;
  status: 'ELIGIBLE' | 'REJECTED' | 'RANKED' | 'SELECTED' | 'UNSELECTED';
  reason?: string;
  reasonCodes?: string[];
  scoreBreakdown?: CandidateScoreBreakdown;
  rules?: TraceRuleEvaluation[];
  dayNumber?: number;
  order?: number;
}

interface LegacyTraceCandidate {
  source: string;
  id: string;
  name: string;
  detail?: string;
  offered: boolean;
  chosen: boolean;
  scoreBreakdown?: CandidateScoreBreakdown;
}

interface GenerationTraceStep {
  stage: string;
  label: string;
  summary: string;
  component?: string;
  status?: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  inputs?: Record<string, unknown>;
  rules?: TraceRuleEvaluation[];
  decision?: TraceDecision;
  outputs?: Record<string, unknown>;
  candidateDecisions?: TraceCandidateDecision[];
  timing?: { startedAt?: string; durationMs?: number };

  // Compatibility fields from trace V1 / rich intermediate stages.
  candidates?: LegacyTraceCandidate[];
  providerStatus?: 'success' | 'failed';
  degradedReason?: string;
  coverageReport?: unknown;
  semanticRanking?: unknown;
  grounding?: unknown;
  dailyPlanning?: unknown;
  tourCompleteness?: unknown;
  tourFormatCoverage?: unknown;
  resolution?: unknown;
  candidatePool?: unknown;
  placesProvenance?: unknown;
}

interface AuditFinding {
  activityId?: string;
  activityName: string;
  openingHoursCheck: 'ok' | 'possibly_closed' | 'no_data';
  priceLevelCheck: 'ok' | 'possibly_over_budget' | 'no_data';
}

export interface GenerationTrace {
  version?: 1 | 2;
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  auditFindings?: { perActivity: AuditFinding[] };
  executionSummary?: {
    status: 'completed' | 'failed';
    steps: string[];
    acceptedExperiences?: number;
    rejectedProposals?: number;
    selectedExperiences?: number;
    failure?: string;
  };
}

interface GenerationBitacoraProps {
  trace: GenerationTrace;
  tourName?: string;
  totalDays?: number;
  categories?: string[];
}

const COLORS = {
  page: '#08111E',
  shell: '#0C1726',
  panel: '#111D2C',
  panelStrong: '#0C1623',
  panelSoft: '#172435',
  border: '#26374B',
  borderSoft: '#1D2C3E',
  text: '#F4F7FB',
  textMuted: '#A8B5C7',
  textDim: '#7F8EA3',
  blue: '#5B91F5',
  blueSoft: '#16315F',
  green: '#65D891',
  greenBg: '#123B2A',
  amber: '#F5B942',
  amberBg: '#3A2B0B',
  red: '#F06A6A',
  redBg: '#3B1C20',
  slate: '#8290A3',
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
  if (step.providerStatus === 'failed') {
    return {
      status: 'WARN',
      outcome: 'LEGACY_STEP_DEGRADED',
      reason: step.degradedReason || step.summary,
      reasonCodes: step.degradedReason ? [step.degradedReason] : [],
    };
  }
  return {
    status: 'INFO',
    outcome: 'LEGACY_TRACE_STEP',
    reason: step.summary,
    reasonCodes: [],
  };
}

function normalizeCandidates(step: GenerationTraceStep): TraceCandidateDecision[] {
  if (step.candidateDecisions?.length) return step.candidateDecisions;
  return (step.candidates ?? []).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    source: candidate.source,
    status: candidate.chosen
      ? 'SELECTED'
      : candidate.offered
        ? 'ELIGIBLE'
        : 'REJECTED',
    reason: candidate.detail,
    scoreBreakdown: candidate.scoreBreakdown,
  }));
}

function statusVisual(status?: string) {
  switch (status) {
    case 'PASS':
      return { icon: CheckCircle2, color: COLORS.green, bg: COLORS.greenBg, label: 'PASS' };
    case 'FAIL':
      return { icon: XCircle, color: COLORS.red, bg: COLORS.redBg, label: 'FAIL' };
    case 'WARN':
      return { icon: AlertTriangle, color: COLORS.amber, bg: COLORS.amberBg, label: 'WARN' };
    case 'SKIPPED':
      return { icon: CircleHelp, color: COLORS.slate, bg: COLORS.panelSoft, label: 'SKIPPED' };
    default:
      return { icon: CircleHelp, color: COLORS.blue, bg: COLORS.blueSoft, label: status || 'INFO' };
  }
}

function formatClock(value?: string): string {
  if (!value) return '--:--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour12: false });
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined || durationMs === null) return '—';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function compactValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return safeJson(value);
  return String(value);
}

function candidateScore(candidate: TraceCandidateDecision): string {
  const total = candidate.scoreBreakdown?.totalScore;
  if (typeof total === 'number') return total.toFixed(2);
  const semantic = candidate.scoreBreakdown?.semanticSimilarity;
  if (typeof semantic === 'number') return semantic.toFixed(2);
  return '—';
}

function semanticScore(candidate: TraceCandidateDecision): string {
  const semantic = candidate.scoreBreakdown?.semanticSimilarity;
  return typeof semantic === 'number' ? semantic.toFixed(2) : '—';
}

function getLegacyOutput(step: GenerationTraceStep): Record<string, unknown> | undefined {
  const compatibility: Record<string, unknown> = {};
  if (step.coverageReport !== undefined) compatibility.coverageReport = step.coverageReport;
  if (step.semanticRanking !== undefined) compatibility.semanticRanking = step.semanticRanking;
  if (step.grounding !== undefined) compatibility.grounding = step.grounding;
  if (step.dailyPlanning !== undefined) compatibility.dailyPlanning = step.dailyPlanning;
  if (step.tourCompleteness !== undefined) compatibility.tourCompleteness = step.tourCompleteness;
  if (step.tourFormatCoverage !== undefined) compatibility.tourFormatCoverage = step.tourFormatCoverage;
  if (step.resolution !== undefined) compatibility.resolution = step.resolution;
  if (step.candidatePool !== undefined) compatibility.candidatePool = step.candidatePool;
  if (step.placesProvenance !== undefined) compatibility.placesProvenance = step.placesProvenance;
  return Object.keys(compatibility).length ? compatibility : undefined;
}

function TraceBadge({ status }: { status?: string }) {
  const visual = statusVisual(status);
  return (
    <Box px='$2' py='$1' borderRadius='$md' bg={visual.bg as any}>
      <Text size='2xs' fontWeight='$bold' color={visual.color as any}>
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
        p='$3'
        borderRadius='$lg'
        borderWidth={1}
        borderColor={active ? COLORS.blue : 'transparent'}
        bg={active ? '#12243D' : 'transparent'}
        mb='$1'
      >
        <HStack alignItems='flex-start' space='sm'>
          <Box
            mt='$0.5'
            w={22}
            h={22}
            borderRadius='$sm'
            bg={active ? COLORS.blue : visual.bg}
            alignItems='center'
            justifyContent='center'
          >
            <Text size='2xs' fontWeight='$bold' color={active ? '#FFFFFF' : visual.color}>
              {index + 1}
            </Text>
          </Box>
          <VStack flex={1}>
            <HStack justifyContent='space-between' alignItems='center' space='xs'>
              <Text size='xs' fontWeight='$semibold' color={COLORS.text} flex={1}>
                {step.label}
              </Text>
              <Text size='2xs' color={COLORS.textMuted}>
                {formatClock(step.timing?.startedAt)}
              </Text>
              <Icon as={StatusIcon} size='2xs' color={visual.color as any} />
            </HStack>

            <Text size='2xs' color={COLORS.textMuted} mt='$0.5'>
              {step.component || step.stage}
            </Text>
            {secondary ? (
              <Text size='2xs' color={visual.color as any} mt='$1'>
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
      p='$3'
      bg={COLORS.panelSoft as any}
      borderRadius='$lg'
      borderWidth={1}
      borderColor={COLORS.border as any}
    >
      <HStack justifyContent='space-between' alignItems='center' space='sm'>
        <Text size='xs' color={COLORS.text} flex={1}>
          {rule.rule}
        </Text>
        <TraceBadge status={rule.result} />
      </HStack>
      {(rule.actual !== undefined || rule.expected !== undefined) && (
        <Text size='xs' color={COLORS.textMuted} mt='$2'>
          {rule.actual !== undefined ? compactValue(rule.actual) : '—'}
          {rule.expected !== undefined ? ` · esperado ${compactValue(rule.expected)}` : ''}
        </Text>
      )}
      <Text size='2xs' color={COLORS.textDim} mt='$2'>
        {rule.reason}
      </Text>
    </Box>
  );
}

function InputsPanel({ inputs }: { inputs?: Record<string, unknown> }) {
  return (
    <Panel title='Inputs' icon={FileJson}>
      {inputs && Object.keys(inputs).length ? (
        <VStack space='sm'>
          {Object.entries(inputs).map(([key, value]) => (
            <HStack key={key} space='md' alignItems='flex-start'>
              <Text size='xs' color={COLORS.textMuted} width={125}>
                {key}
              </Text>
              <Text size='xs' color={COLORS.text} flex={1}>
                {compactValue(value)}
              </Text>
            </HStack>
          ))}
        </VStack>
      ) : (
        <Text size='xs' color={COLORS.textDim}>Sin inputs registrados para esta etapa.</Text>
      )}
    </Panel>
  );
}

function RulesPanel({ rules }: { rules?: TraceRuleEvaluation[] }) {
  return (
    <Panel title='Reglas Evaluadas' icon={ShieldCheck}>
      {rules?.length ? (
        <VStack>
          {rules.map((rule, index) => (
            <Box
              key={`${rule.ruleId}-${index}`}
              py='$2.5'
              borderBottomWidth={index === rules.length - 1 ? 0 : 1}
              borderBottomColor={COLORS.borderSoft as any}
            >
              <HStack alignItems='center' space='sm'>
                <Text size='2xs' color={COLORS.textMuted} width={118}>
                  {rule.ruleId}
                </Text>
                <Text size='xs' color={COLORS.text} flex={1}>
                  {rule.rule}
                </Text>
                <TraceBadge status={rule.result} />
              </HStack>
              <Text size='2xs' color={COLORS.textDim} mt='$1.5' ml={128}>
                {rule.reason}
              </Text>
            </Box>
          ))}
        </VStack>
      ) : (
        <Text size='xs' color={COLORS.textDim}>Sin reglas registradas para esta etapa.</Text>
      )}
    </Panel>
  );
}

function DecisionPanel({ step }: { step: GenerationTraceStep }) {
  const decision = normalizeDecision(step);
  const visual = statusVisual(step.status ?? decision.status);
  return (
    <Panel title='Decisión' icon={Terminal}>
      <HStack justifyContent='space-between' alignItems='center' mb='$3'>
        <Text size='xs' color={COLORS.textMuted}>outcome</Text>
        <Text size='xs' fontWeight='$bold' color={visual.color as any}>
          {decision.outcome}
        </Text>
      </HStack>
      {decision.reasonCodes?.length ? (
        <VStack space='xs' mb='$3'>
          <Text size='xs' color={COLORS.textMuted}>reasonCodes</Text>
          {decision.reasonCodes.map((code) => (
            <Text key={code} size='xs' color={COLORS.text}>• {code}</Text>
          ))}
        </VStack>
      ) : null}
      {decision.triggeredActions?.length ? (
        <VStack space='xs' mb='$3'>
          <Text size='xs' color={COLORS.textMuted}>triggeredActions</Text>
          {decision.triggeredActions.map((action) => (
            <Text key={action} size='xs' color={COLORS.text}>• {action}</Text>
          ))}
        </VStack>
      ) : null}
      <Text size='xs' color={COLORS.textMuted}>Por qué</Text>
      <Text size='xs' color={COLORS.text} mt='$1.5'>
        {decision.reason || step.summary}
      </Text>
    </Panel>
  );
}

function CandidatePanel({ candidates }: { candidates: TraceCandidateDecision[] }) {
  const visible = candidates.slice(0, 12);
  return (
    <Panel title={`Candidatos Analizados (${candidates.length})`} icon={Search}>
      {visible.length ? (
        <VStack>
          {visible.map((candidate, index) => (
            <Box
              key={`${candidate.id}-${index}`}
              py='$2'
              borderBottomWidth={index === visible.length - 1 ? 0 : 1}
              borderBottomColor={COLORS.borderSoft as any}
            >
              <HStack alignItems='center' space='sm'>
                <Text size='2xs' color={COLORS.textDim} width={18}>{index + 1}</Text>
                <Text size='xs' color={COLORS.text} flex={1}>{candidate.name}</Text>
                <Text size='2xs' color={COLORS.textMuted}>Score: {candidateScore(candidate)}</Text>
                <Text size='2xs' color={COLORS.textMuted}>Sem: {semanticScore(candidate)}</Text>
              </HStack>
              <HStack ml={28} mt='$1' alignItems='center' space='sm'>
                {candidate.source ? (
                  <Box px='$1.5' py='$0.5' borderRadius='$sm' bg={COLORS.panelStrong as any}>
                    <Text size='2xs' color={COLORS.textDim}>{candidate.source}</Text>
                  </Box>
                ) : null}
                <Text size='2xs' color={statusVisual(candidate.status).color as any}>
                  {candidate.status}
                </Text>
                {candidate.reason ? (
                  <Text size='2xs' color={COLORS.textDim} flex={1}>{candidate.reason}</Text>
                ) : null}
              </HStack>
            </Box>
          ))}
          {candidates.length > visible.length ? (
            <Text size='2xs' color={COLORS.blue} mt='$2'>
              + {candidates.length - visible.length} candidatos adicionales en el trace
            </Text>
          ) : null}
        </VStack>
      ) : (
        <Text size='xs' color={COLORS.textDim}>Sin decisiones de candidatos para esta etapa.</Text>
      )}
    </Panel>
  );
}

function OutputPanel({ step }: { step: GenerationTraceStep }) {
  const output = step.outputs || getLegacyOutput(step);
  return (
    <Panel title='Output' icon={FileJson}>
      <Box p='$3' bg={COLORS.panelStrong as any} borderRadius='$md'>
        <Text size='2xs' color='#89D6A6' fontFamily='monospace'>
          {output ? safeJson(output) : '// Sin output estructurado registrado'}
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
      borderRadius='$lg'
      p='$4'
    >
      <HStack alignItems='center' space='sm' mb='$3'>
        <Icon as={icon} size='sm' color={COLORS.blue as any} />
        <Text size='sm' fontWeight='$semibold' color={COLORS.text}>{title}</Text>
      </HStack>
      {children}
    </Box>
  );
}

function StageDetail({ step, index, nextStep }: { step: GenerationTraceStep; index: number; nextStep?: GenerationTraceStep }) {
  const decision = normalizeDecision(step);
  const visual = statusVisual(step.status ?? decision.status);
  const rules = step.rules ?? [];
  const candidates = normalizeCandidates(step);

  return (
    <VStack flex={1}>
      <Box px='$5' pt='$5' pb='$4' borderBottomWidth={1} borderBottomColor={COLORS.border as any}>
        <HStack justifyContent='space-between' alignItems='flex-start' space='lg' flexWrap='wrap'>
          <VStack flex={1} style={{ minWidth: 260 }}>
            <HStack alignItems='center' space='sm' flexWrap='wrap'>
              <Box w={32} h={32} borderRadius='$full' bg={COLORS.blue as any} alignItems='center' justifyContent='center'>
                <Text size='xs' fontWeight='$bold' color='#FFFFFF'>{index + 1}</Text>
              </Box>
              <Text size='lg' fontWeight='$bold' color={COLORS.text}>Paso {index + 1}</Text>
              <Text size='lg' color={COLORS.text}>{step.label}</Text>
            </HStack>
            <HStack mt='$2' ml={42} space='lg' flexWrap='wrap'>
              <Text size='xs' color={COLORS.textMuted}>Responsable: <Text color={COLORS.text}>{step.component || step.stage}</Text></Text>
              <HStack alignItems='center' space='xs'>
                <Icon as={Clock} size='2xs' color={COLORS.textMuted as any} />
                <Text size='xs' color={COLORS.textMuted}>Duración: <Text color={COLORS.text}>{formatDuration(step.timing?.durationMs)}</Text></Text>
              </HStack>
            </HStack>
          </VStack>
          <Box
            style={{ minWidth: 260 }}
            maxW={380}
            p='$3'
            borderRadius='$lg'
            borderWidth={1}
            borderColor={visual.color as any}
            bg={visual.bg as any}
          >
            <Text size='xs' fontWeight='$bold' color={visual.color as any}>ESTADO: {decision.outcome}</Text>
            <Text size='xs' color={COLORS.text} mt='$1'>{decision.reason || step.summary}</Text>
          </Box>
        </HStack>
      </Box>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        {rules.length ? (
          <Box flexDirection='row' flexWrap='wrap' gap={12} mb='$4'>
            {rules.slice(0, 6).map((rule) => <MetricCard key={rule.ruleId} rule={rule} />)}
          </Box>
        ) : null}

        <Box flexDirection='row' flexWrap='wrap' gap={12} mb='$4'>
          <InputsPanel inputs={step.inputs} />
          <RulesPanel rules={rules} />
          <DecisionPanel step={step} />
        </Box>

        <Box flexDirection='row' flexWrap='wrap' gap={12}>
          <CandidatePanel candidates={candidates} />
          <OutputPanel step={step} />
        </Box>
      </ScrollView>

      <HStack
        px='$5'
        py='$3'
        justifyContent='space-between'
        alignItems='center'
        borderTopWidth={1}
        borderTopColor={COLORS.border as any}
        bg={COLORS.panelStrong as any}
      >
        <HStack alignItems='center' space='sm'>
          <Text size='xs' color={COLORS.textMuted}>Siguiente paso:</Text>
          <Text size='xs' fontWeight='$semibold' color={COLORS.blue}>{nextStep?.component || nextStep?.label || 'Fin del pipeline'}</Text>
        </HStack>
        <Text size='xs' color={COLORS.textMuted}>Etapa {index + 1} de {index + 1 + (nextStep ? 1 : 0)}+</Text>
      </HStack>
    </VStack>
  );
}

export function formatGenerationBitacora(trace: GenerationTrace): string {
  const lines = [
    `Generation Trace v${trace.version ?? 1}`,
    `Steps: ${trace.steps.length}`,
    '',
  ];

  trace.steps.forEach((step, index) => {
    const decision = normalizeDecision(step);
    lines.push(
      `${String(index + 1).padStart(2, '0')} · ${step.stage} · ${step.status ?? decision.status}`,
      step.label,
      step.component ? `Component: ${step.component}` : '',
      `Decision: ${decision.outcome}`,
      `Why: ${decision.reason}`,
    );
    if (decision.reasonCodes?.length) lines.push(`Reason codes: ${decision.reasonCodes.join(', ')}`);
    if (decision.triggeredActions?.length) lines.push(`Next: ${decision.triggeredActions.join(' -> ')}`);
    if (step.rules?.length) {
      lines.push('Rules:');
      for (const item of step.rules) {
        lines.push(
          `  [${item.result}] ${item.ruleId} — ${item.rule}`,
          `    ${item.reason}`,
          item.actual !== undefined ? `    actual=${safeJson(item.actual)}` : '',
          item.expected !== undefined ? `    expected=${safeJson(item.expected)}` : '',
        );
      }
    }
    const candidates = normalizeCandidates(step);
    if (candidates.length) {
      lines.push('Candidates:');
      for (const candidate of candidates) {
        lines.push(
          `  [${candidate.status}] ${candidate.name} (${candidate.id})`,
          candidate.reason ? `    ${candidate.reason}` : '',
          candidate.reasonCodes?.length ? `    reasons=${candidate.reasonCodes.join(', ')}` : '',
        );
      }
    }
    lines.push('');
  });

  return lines.filter((line) => line !== '').join('\n');
}

export const GenerationBitacora = ({
  trace,
  tourName,
  totalDays,
  categories,
}: GenerationBitacoraProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedStep, setSelectedStep] = useState(0);
  const [downloadState, setDownloadState] = useState<'idle' | 'done'>('idle');
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const stats = useMemo(() => {
    const rules = trace.steps.flatMap((step) => step.rules ?? []);
    return {
      failures: rules.filter((item) => item.result === 'FAIL').length,
      warnings: rules.filter((item) => item.result === 'WARN').length,
      candidates: trace.steps.reduce((total, step) => total + normalizeCandidates(step).length, 0),
    };
  }, [trace]);

  const completed = !trace.steps.some((step) => (step.status ?? normalizeDecision(step).status) === 'FAIL');
  const selected = trace.steps[Math.min(selectedStep, Math.max(trace.steps.length - 1, 0))];
  const generatedAt = trace.steps.find((step) => step.timing?.startedAt)?.timing?.startedAt;

  const handleDownload = async () => {
    const json = safeJson(trace);
    if (Platform.OS === 'web') {
      try {
        const webDocument = (globalThis as any).document;
        const BlobCtor = (globalThis as any).Blob;
        const webUrl = (globalThis as any).URL;
        if (webDocument && BlobCtor && webUrl) {
          const blob = new BlobCtor([json], { type: 'application/json' });
          const url = webUrl.createObjectURL(blob);
          const anchor = webDocument.createElement('a');
          anchor.href = url;
          anchor.download = 'generation-trace-v2.json';
          anchor.click();
          webUrl.revokeObjectURL(url);
          setDownloadState('done');
          return;
        }
      } catch {
        // Native-style clipboard fallback below.
      }
    }
    await copyTextToClipboard(json);
    setDownloadState('done');
  };

  return (
    <>
      <Pressable onPress={() => setIsOpen(true)} testID='bitacora-toggle'>
        <Box
          my='$3'
          p='$3.5'
          bg={COLORS.panelStrong as any}
          borderRadius='$xl'
          borderWidth={1}
          borderColor={COLORS.border as any}
        >
          <HStack justifyContent='space-between' alignItems='center' space='sm'>
            <HStack alignItems='center' space='sm' flex={1}>
              <Box w={34} h={34} borderRadius='$lg' bg={COLORS.blueSoft as any} alignItems='center' justifyContent='center'>
                <Icon as={Terminal} size='sm' color={COLORS.blue as any} />
              </Box>
              <VStack flex={1}>
                <Text size='sm' fontWeight='$bold' color={COLORS.text}>Bitácora de Generación</Text>
                <Text size='2xs' color={COLORS.textMuted}>
                  v{trace.version ?? 1} · {trace.steps.length} etapas · {stats.failures} fails · {stats.warnings} warnings · {stats.candidates} decisiones
                </Text>
              </VStack>
            </HStack>
            <Text size='xs' color={COLORS.blue}>Abrir</Text>
          </HStack>
        </Box>
      </Pressable>

      <Modal visible={isOpen} animationType='fade' onRequestClose={() => setIsOpen(false)}>
        <Box flex={1} bg={COLORS.page as any}>
          <Box
            px={desktop ? '$5' : '$3'}
            py='$3'
            borderBottomWidth={1}
            borderBottomColor={COLORS.border as any}
            bg={COLORS.panelStrong as any}
          >
            <HStack justifyContent='space-between' alignItems='center' space='lg' flexWrap='wrap'>
              <HStack alignItems='center' space='sm' flex={1} style={{ minWidth: 280 }}>
                <Pressable
                  onPress={() => setIsOpen(false)}
                  w={38}
                  h={38}
                  borderRadius='$lg'
                  borderWidth={1}
                  borderColor={COLORS.border as any}
                  alignItems='center'
                  justifyContent='center'
                  accessibilityLabel='Cerrar bitácora'
                >
                  <Icon as={ArrowLeft} size='sm' color={COLORS.textMuted as any} />
                </Pressable>
                <VStack flex={1}>
                  <HStack alignItems='center' space='sm' flexWrap='wrap'>
                    <Text size='lg' fontWeight='$bold' color={COLORS.text}>Bitácora de Generación</Text>
                    <Box px='$2' py='$1' borderRadius='$full' bg={completed ? COLORS.greenBg as any : COLORS.redBg as any}>
                      <Text size='2xs' fontWeight='$bold' color={completed ? COLORS.green as any : COLORS.red as any}>
                        {completed ? 'COMPLETADO' : 'CON ERRORES'}
                      </Text>
                    </Box>
                  </HStack>
                  <Text size='xs' color={COLORS.textMuted} mt='$0.5'>
                    {tourName || 'Tour'}{totalDays ? ` · ${totalDays} día${totalDays === 1 ? '' : 's'}` : ''}{categories?.length ? ` · ${categories.join(', ')}` : ''}
                  </Text>
                </VStack>
              </HStack>

              <HStack alignItems='center' space='md'>
                <Text size='2xs' color={COLORS.textMuted}>
                  {generatedAt ? `Generado ${new Date(generatedAt).toLocaleString()}` : `Trace v${trace.version ?? 1}`}
                </Text>
                <Pressable
                  onPress={handleDownload}
                  px='$3'
                  py='$2.5'
                  borderRadius='$lg'
                  borderWidth={1}
                  borderColor={COLORS.border as any}
                  bg={COLORS.panel as any}
                >
                  <HStack alignItems='center' space='xs'>
                    <Icon as={Download} size='xs' color={COLORS.text as any} />
                    <Text size='xs' color={COLORS.text}>{downloadState === 'done' ? 'JSON listo' : 'Descargar JSON'}</Text>
                  </HStack>
                </Pressable>
              </HStack>
            </HStack>
            {trace.executionSummary && (
              <Box mt='$3' p='$3' borderRadius='$lg' bg={COLORS.panel as any} borderWidth={1} borderColor={COLORS.borderSoft as any}>
                <Text size='sm' fontWeight='$bold' color={COLORS.text}>Resumen de ejecución</Text>
                <Text size='xs' color={COLORS.textMuted} mt='$1'>
                  {trace.executionSummary.steps.join(' ')}
                </Text>
              </Box>
            )}
          </Box>

          {desktop ? (
            <HStack flex={1}>
              <Box width={326} borderRightWidth={1} borderRightColor={COLORS.border as any} bg={COLORS.shell as any}>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
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
              {selected ? <StageDetail step={selected} index={selectedStep} nextStep={trace.steps[selectedStep + 1]} /> : null}
            </HStack>
          ) : (
            <VStack flex={1}>
              <Box py='$2' borderBottomWidth={1} borderBottomColor={COLORS.border as any} bg={COLORS.shell as any}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8 }}>
                  <HStack space='xs'>
                    {trace.steps.map((step, index) => (
                      <Pressable key={`${step.stage}-${index}`} onPress={() => setSelectedStep(index)}>
                        <Box
                          style={{ minWidth: 150 }}
                          p='$2.5'
                          borderRadius='$lg'
                          borderWidth={1}
                          borderColor={selectedStep === index ? COLORS.blue as any : COLORS.border as any}
                          bg={selectedStep === index ? '#12243D' as any : COLORS.panel as any}
                        >
                          <Text size='2xs' color={COLORS.textDim}>Paso {index + 1}</Text>
                          <Text size='xs' fontWeight='$semibold' color={COLORS.text} numberOfLines={1}>{step.label}</Text>
                          <Text size='2xs' color={statusVisual(step.status ?? normalizeDecision(step).status).color as any} mt='$1'>
                            {normalizeDecision(step).outcome}
                          </Text>
                        </Box>
                      </Pressable>
                    ))}
                  </HStack>
                </ScrollView>
              </Box>
              {selected ? <StageDetail step={selected} index={selectedStep} nextStep={trace.steps[selectedStep + 1]} /> : null}
            </VStack>
          )}
        </Box>
      </Modal>
    </>
  );
};
