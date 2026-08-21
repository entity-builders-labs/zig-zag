import React, { useState } from 'react';
import { VStack, HStack, Text, Badge, BadgeText, Pressable, Icon } from '@gluestack-ui/themed';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

// Mirrors be/src/modules/tours/interfaces/generation-trace.interface.ts —
// kept as a local, loosely-typed shape rather than a shared package, same
// pattern as fe/features/activities/composite.ts.
interface TraceCandidate {
  source: 'db' | 'google_places' | 'osm' | 'wikidata';
  id: string;
  name: string;
  detail?: string;
  offered: boolean;
  chosen: boolean;
}

interface GenerationTraceStep {
  stage: string;
  label: string;
  summary: string;
  candidates?: TraceCandidate[];
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

function StepBlock({
  step,
  auditByActivityId,
}: {
  step: GenerationTraceStep;
  auditByActivityId: Map<string, AuditFinding>;
}) {
  const [expanded, setExpanded] = useState(false);
  const candidates = step.candidates ?? [];
  const hasCandidates = candidates.length > 0;

  return (
    <VStack space='xs' mb='$4'>
      <Pressable
        onPress={() => hasCandidates && setExpanded((e) => !e)}
        testID={`bitacora-step-${step.stage}`}
      >
        <HStack justifyContent='space-between' alignItems='flex-start' space='sm'>
          <VStack flex={1}>
            <Text size='xs' color='$tertiary600' fontWeight='$bold'>
              {step.label}
            </Text>
            <Text size='sm' color='$textLight800' mt='$1'>
              {step.summary}
            </Text>
          </VStack>
          {hasCandidates && (
            <Icon
              as={expanded ? ChevronUp : ChevronDown}
              color='$textLight500'
              mt='$1'
            />
          )}
        </HStack>
      </Pressable>

      {expanded && hasCandidates && (
        <VStack space='xs' mt='$2' pl='$3' borderLeftWidth={2} borderLeftColor='$borderLight200'>
          {candidates.map((c) => {
            const audit = auditByActivityId.get(c.id);
            return (
              <HStack key={`${c.source}-${c.id}`} space='xs' alignItems='center' flexWrap='wrap'>
                <Text size='xs' color='$textLight800' fontWeight='$medium'>
                  {c.name}
                </Text>
                {c.detail && (
                  <Text size='2xs' color='$textLight500'>
                    ({c.detail})
                  </Text>
                )}
                {c.offered && (
                  <Badge size='sm' variant='outline' borderRadius='$sm'>
                    <BadgeText fontSize='$2xs'>Ofrecido</BadgeText>
                  </Badge>
                )}
                {c.chosen && (
                  <Badge size='sm' action='success' variant='solid' borderRadius='$sm'>
                    <BadgeText fontSize='$2xs' color='$white'>
                      Elegido
                    </BadgeText>
                  </Badge>
                )}
                {audit && (
                  <Text size='2xs' color='$textLight500'>
                    {AUDIT_LABELS[audit.openingHoursCheck]} · {AUDIT_LABELS[audit.priceLevelCheck]}
                  </Text>
                )}
              </HStack>
            );
          })}
        </VStack>
      )}
    </VStack>
  );
}

export const GenerationBitacora = ({ trace }: { trace: GenerationTrace }) => {
  const auditByActivityId = new Map<string, AuditFinding>(
    (trace.auditFindings?.perActivity ?? [])
      .filter((f) => !!f.activityId)
      .map((f) => [f.activityId as string, f])
  );

  return (
    <VStack mt='$2'>
      {trace.steps.map((step) => (
        <StepBlock key={step.stage} step={step} auditByActivityId={auditByActivityId} />
      ))}
    </VStack>
  );
};
