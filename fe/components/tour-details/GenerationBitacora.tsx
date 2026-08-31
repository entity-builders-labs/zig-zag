import React, { useMemo, useState } from 'react';
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
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Terminal,
  XCircle,
} from 'lucide-react-native';

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

  // Legacy/rich stage fields remain visible through Raw and compatibility UI.
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
}

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

function statusVisual(status: string) {
  switch (status) {
    case 'PASS':
      return { icon: CheckCircle2, text: '$green700', bg: '$green50', border: '$green200' };
    case 'FAIL':
      return { icon: XCircle, text: '$red700', bg: '$red50', border: '$red200' };
    case 'WARN':
      return { icon: AlertTriangle, text: '$amber800', bg: '$amber50', border: '$amber200' };
    default:
      return { icon: CircleHelp, text: '$blue700', bg: '$blue50', border: '$blue200' };
  }
}

function CollapsibleSection({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box borderTopWidth={1} borderTopColor='$borderLight100' pt='$2.5' mt='$2.5'>
      <Pressable onPress={() => setOpen((value) => !value)}>
        <HStack justifyContent='space-between' alignItems='center'>
          <Text size='xs' fontWeight='$bold' color='$textLight800'>
            {title}{count !== undefined ? ` (${count})` : ''}
          </Text>
          <Icon as={open ? ChevronUp : ChevronDown} size='xs' color='$textLight500' />
        </HStack>
      </Pressable>
      {open && <Box mt='$2'>{children}</Box>}
    </Box>
  );
}

function RuleRow({ rule }: { rule: TraceRuleEvaluation }) {
  const visual = statusVisual(rule.result);
  const StatusIcon = visual.icon;
  return (
    <Box
      p='$2.5'
      mb='$2'
      borderRadius='$lg'
      borderWidth={1}
      borderColor={visual.border as any}
      bg={visual.bg as any}
    >
      <HStack alignItems='center' space='xs' flexWrap='wrap'>
        <Icon as={StatusIcon} size='xs' color={visual.text as any} />
        <Text size='2xs' fontWeight='$bold' color={visual.text as any}>
          {rule.result}
        </Text>
        <Text size='2xs' fontWeight='$bold' color='$textLight600'>
          {rule.ruleId}
        </Text>
      </HStack>
      <Text size='xs' fontWeight='$semibold' color='$textLight900' mt='$1'>
        {rule.rule}
      </Text>
      <Text size='2xs' color='$textLight600' mt='$1'>
        {rule.reason}
      </Text>
      {(rule.actual !== undefined || rule.expected !== undefined) && (
        <HStack mt='$1.5' space='md' flexWrap='wrap'>
          {rule.actual !== undefined && (
            <Text size='2xs' color='$textLight700'>
              Actual: {safeJson(rule.actual)}
            </Text>
          )}
          {rule.expected !== undefined && (
            <Text size='2xs' color='$textLight700'>
              Esperado: {safeJson(rule.expected)}
            </Text>
          )}
        </HStack>
      )}
    </Box>
  );
}

function ScoreBreakdown({ score }: { score?: CandidateScoreBreakdown }) {
  if (!score) return null;
  const parts = [
    score.semanticSimilarity !== undefined && score.semanticSimilarity !== null
      ? `sem ${score.semanticSimilarity.toFixed(3)}`
      : null,
    score.qualityBonus !== undefined ? `quality ${score.qualityBonus.toFixed(3)}` : null,
    score.proximityBonus !== undefined ? `prox ${score.proximityBonus.toFixed(3)}` : null,
    score.diversityBonus !== undefined ? `div ${score.diversityBonus.toFixed(3)}` : null,
    score.totalScore !== undefined ? `total ${score.totalScore.toFixed(3)}` : null,
  ].filter(Boolean);
  return parts.length ? (
    <Text size='2xs' color='$textLight500' mt='$1'>
      {parts.join(' · ')}
    </Text>
  ) : null;
}

function CandidateRow({ candidate }: { candidate: TraceCandidateDecision }) {
  const rejected = candidate.status === 'REJECTED' || candidate.status === 'UNSELECTED';
  const selected = candidate.status === 'SELECTED';
  return (
    <Box p='$2.5' mb='$2' bg='$backgroundLight50' borderRadius='$lg' borderWidth={1} borderColor='$borderLight100'>
      <HStack justifyContent='space-between' alignItems='center' space='sm'>
        <VStack flex={1}>
          <Text size='xs' fontWeight='$bold' color='$textLight900'>
            {candidate.name}
          </Text>
          <Text size='2xs' color='$textLight500'>
            {candidate.id}{candidate.source ? ` · ${candidate.source}` : ''}
          </Text>
        </VStack>
        <Box
          px='$2'
          py='$0.5'
          borderRadius='$md'
          bg={selected ? '$green50' : rejected ? '$red50' : '$blue50'}
          borderWidth={1}
          borderColor={selected ? '$green200' : rejected ? '$red200' : '$blue200'}
        >
          <Text
            size='2xs'
            fontWeight='$bold'
            color={selected ? '$green700' : rejected ? '$red700' : '$blue700'}
          >
            {candidate.status}
          </Text>
        </Box>
      </HStack>
      {candidate.reason && (
        <Text size='2xs' color='$textLight700' mt='$1.5'>
          {candidate.reason}
        </Text>
      )}
      {candidate.reasonCodes?.length ? (
        <Text size='2xs' color='$textLight500' mt='$1'>
          reasonCodes: {candidate.reasonCodes.join(', ')}
        </Text>
      ) : null}
      {(candidate.dayNumber !== undefined || candidate.order !== undefined) && (
        <Text size='2xs' color='$textLight600' mt='$1'>
          {candidate.dayNumber !== undefined ? `Día ${candidate.dayNumber}` : ''}
          {candidate.order !== undefined ? ` · orden ${candidate.order}` : ''}
        </Text>
      )}
      <ScoreBreakdown score={candidate.scoreBreakdown} />
      {candidate.rules?.length ? (
        <Box mt='$2'>
          {candidate.rules.map((candidateRule) => (
            <RuleRow key={`${candidate.id}-${candidateRule.ruleId}`} rule={candidateRule} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function StepBlock({ step, index }: { step: GenerationTraceStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const decision = normalizeDecision(step);
  const candidates = normalizeCandidates(step);
  const visual = statusVisual(step.status ?? decision.status);
  const StatusIcon = visual.icon;
  const failedRules = (step.rules ?? []).filter((item) => item.result === 'FAIL');
  const warningRules = (step.rules ?? []).filter((item) => item.result === 'WARN');

  return (
    <Box
      mb='$3'
      bg='$white'
      borderRadius='$xl'
      borderWidth={1}
      borderColor={visual.border as any}
      overflow='hidden'
    >
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        p='$3.5'
        testID={`bitacora-step-${step.stage}`}
      >
        <HStack justifyContent='space-between' alignItems='flex-start' space='sm'>
          <VStack flex={1}>
            <HStack alignItems='center' space='xs' flexWrap='wrap'>
              <Icon as={StatusIcon} size='xs' color={visual.text as any} />
              <Text size='2xs' fontWeight='$bold' color={visual.text as any}>
                {step.status ?? decision.status}
              </Text>
              <Text size='2xs' fontWeight='$bold' color='$textLight400'>
                PASO {index + 1} · {step.stage}
              </Text>
            </HStack>

            <Text size='sm' fontWeight='$bold' color='$textLight900' mt='$1'>
              {step.label}
            </Text>
            {step.component && (
              <Text size='2xs' color='$textLight500' mt='$0.5'>
                Responsable: {step.component}
              </Text>
            )}

            <Box mt='$2' p='$2.5' bg={visual.bg as any} borderRadius='$lg'>
              <Text size='2xs' fontWeight='$bold' color={visual.text as any}>
                DECISIÓN · {decision.outcome}
              </Text>
              <Text size='xs' color='$textLight800' mt='$1'>
                {decision.reason}
              </Text>
              {decision.reasonCodes?.length ? (
                <Text size='2xs' color='$textLight600' mt='$1'>
                  WHY: {decision.reasonCodes.join(', ')}
                </Text>
              ) : null}
              {decision.triggeredActions?.length ? (
                <Text size='2xs' color='$textLight600' mt='$1'>
                  NEXT: {decision.triggeredActions.join(' → ')}
                </Text>
              ) : null}
            </Box>

            <Text size='xs' color='$textLight600' mt='$2'>
              {step.summary}
            </Text>

            {(failedRules.length > 0 || warningRules.length > 0) && (
              <Text size='2xs' color='$textLight500' mt='$1'>
                {failedRules.length} regla(s) fallida(s) · {warningRules.length} warning(s)
              </Text>
            )}
          </VStack>
          <Icon as={expanded ? ChevronUp : ChevronDown} size='xs' color='$textLight500' />
        </HStack>
      </Pressable>

      {expanded && (
        <Box px='$3.5' pb='$3.5'>
          {step.inputs && Object.keys(step.inputs).length > 0 && (
            <CollapsibleSection title='Inputs' defaultOpen>
              <Text size='2xs' color='$textLight700' fontFamily='monospace'>
                {safeJson(step.inputs)}
              </Text>
            </CollapsibleSection>
          )}

          {(step.rules?.length ?? 0) > 0 && (
            <CollapsibleSection title='Rules evaluated' count={step.rules!.length} defaultOpen>
              {step.rules!.map((item) => (
                <RuleRow key={`${step.stage}-${item.ruleId}`} rule={item} />
              ))}
            </CollapsibleSection>
          )}

          {candidates.length > 0 && (
            <CollapsibleSection title='Candidates' count={candidates.length}>
              {candidates.map((candidate, candidateIndex) => (
                <CandidateRow key={`${candidate.id}-${candidateIndex}`} candidate={candidate} />
              ))}
            </CollapsibleSection>
          )}

          {step.outputs && Object.keys(step.outputs).length > 0 && (
            <CollapsibleSection title='Output'>
              <Text size='2xs' color='$textLight700' fontFamily='monospace'>
                {safeJson(step.outputs)}
              </Text>
            </CollapsibleSection>
          )}

          <CollapsibleSection title='Raw'>
            <Text size='2xs' color='$textLight600' fontFamily='monospace'>
              {safeJson(step)}
            </Text>
          </CollapsibleSection>
        </Box>
      )}
    </Box>
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

export const GenerationBitacora = ({ trace }: { trace: GenerationTrace }) => {
  const [isOpen, setIsOpen] = useState(false);

  const stats = useMemo(() => {
    const rules = trace.steps.flatMap((step) => step.rules ?? []);
    return {
      failures: rules.filter((item) => item.result === 'FAIL').length,
      warnings: rules.filter((item) => item.result === 'WARN').length,
      candidates: trace.steps.reduce(
        (total, step) => total + normalizeCandidates(step).length,
        0,
      ),
    };
  }, [trace]);

  return (
    <Box
      my='$3'
      bg='$coolGray50'
      borderRadius='$2xl'
      borderWidth={1}
      borderColor='$coolGray200'
      overflow='hidden'
    >
      <Pressable onPress={() => setIsOpen((value) => !value)} testID='bitacora-toggle' p='$3.5' bg='$white'>
        <HStack justifyContent='space-between' alignItems='center'>
          <HStack space='sm' alignItems='center' flex={1}>
            <Box w={32} h={32} borderRadius='$xl' bg='$purple100' alignItems='center' justifyContent='center'>
              <Icon as={Terminal} size='sm' color='$purple700' />
            </Box>
            <VStack flex={1}>
              <Text size='sm' fontWeight='$bold' color='$textLight900'>
                Bitácora auditable del motor
              </Text>
              <Text size='xs' color='$textLight500'>
                v{trace.version ?? 1} · {trace.steps.length} etapas · {stats.failures} fails · {stats.warnings} warnings · {stats.candidates} decisiones de candidatos
              </Text>
            </VStack>
          </HStack>
          <Icon as={isOpen ? ChevronUp : ChevronDown} size='xs' color='$primary600' />
        </HStack>
      </Pressable>

      {isOpen && (
        <VStack p='$3.5' space='sm'>
          <Box p='$2.5' bg='$blue50' borderRadius='$lg' borderWidth={1} borderColor='$blue200'>
            <Text size='2xs' color='$blue800'>
              Esta vista muestra decisiones registradas por el backend. En traces V1 se usa compatibilidad legacy y se marca explícitamente como tal; la UI no inventa reglas del motor.
            </Text>
          </Box>

          {trace.steps.map((step, index) => (
            <StepBlock key={`${step.stage}-${index}`} step={step} index={index} />
          ))}

          <HStack space='sm'>
            <Box flex={1} p='$2.5' bg='$white' borderRadius='$lg' borderWidth={1} borderColor='$borderLight100'>
              <Text size='2xs' color='$textLight500'>Alucinaciones</Text>
              <Text size='sm' fontWeight='$bold' color={trace.hallucinatedCount ? '$red700' : '$green700'}>
                {trace.hallucinatedCount ?? 0}
              </Text>
            </Box>
            <Box flex={1} p='$2.5' bg='$white' borderRadius='$lg' borderWidth={1} borderColor='$borderLight100'>
              <Text size='2xs' color='$textLight500'>Duplicados</Text>
              <Text size='sm' fontWeight='$bold' color={trace.duplicateCount ? '$red700' : '$green700'}>
                {trace.duplicateCount ?? 0}
              </Text>
            </Box>
          </HStack>
        </VStack>
      )}
    </Box>
  );
};
