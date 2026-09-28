import React, { useMemo, useState } from "react";
import { Modal, Platform, ScrollView, Share } from "react-native";
import { File, Paths } from "expo-file-system";
import { Box, HStack, Pressable, Text, VStack } from "@gluestack-ui/themed";
import { copyTextToClipboard } from "@/utils/copy-to-clipboard";
import type {
  GenerationTrace,
  GenerationTraceStep,
  TraceJsonValue,
  TraceDecisionStatus,
} from "@/api/generation-trace-contract";
export type { GenerationTrace } from "@/api/generation-trace-contract";
export { isGenerationTraceV5 } from "@/api/generation-trace-contract";

const C = {
  page: "#08111E",
  panel: "#111D2C",
  border: "#26374B",
  text: "#F4F7FB",
  muted: "#A8B5C7",
  blue: "#5B91F5",
  green: "#65D891",
  amber: "#F5B942",
  red: "#F06A6A",
};
const color = (s?: TraceDecisionStatus) =>
  s === "FAIL"
    ? C.red
    : s === "WARN"
      ? C.amber
      : s === "PASS"
        ? C.green
        : C.blue;
const json = (v: unknown) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

function JsonBlock({
  title,
  value,
}: {
  title: string;
  value?: TraceJsonValue;
}) {
  const [open, setOpen] = useState(false);
  if (value === undefined) return null;
  return (
    <Box
      borderWidth={1}
      borderColor={C.border as any}
      borderRadius="$md"
      p="$2"
      mt="$2"
    >
      <Pressable onPress={() => setOpen(!open)}>
        <Text color={C.blue} size="xs">
          {open ? "▾" : "▸"} {title}
        </Text>
      </Pressable>
      {open ? (
        <Text
          color={C.muted}
          size="2xs"
          mt="$2"
          style={{ fontFamily: "monospace" }}
        >
          {json(value)}
        </Text>
      ) : null}
    </Box>
  );
}
function Refs({
  title,
  values,
}: {
  title: string;
  values?: Array<{ kind: string; id: string; label?: string }>;
}) {
  if (!values?.length) return null;
  return (
    <VStack mt="$2">
      <Text color={C.muted} size="2xs">
        {title}
      </Text>
      <HStack flexWrap="wrap" gap={4}>
        {values.map((v, i) => (
          <Text key={`${v.kind}-${v.id}-${i}`} color={C.text} size="2xs">
            {v.kind}: {v.label ?? v.id} ({v.id})
          </Text>
        ))}
      </HStack>
    </VStack>
  );
}
function Step({ step, depth }: { step: GenerationTraceStep; depth: number }) {
  const d = step.decision;
  return (
    <Box
      bg={C.panel as any}
      borderWidth={1}
      borderColor={C.border as any}
      borderLeftWidth={4}
      borderLeftColor={color(d?.status) as any}
      borderRadius="$md"
      p="$3"
      mt="$2"
      ml={`$${Math.min(depth, 4)}` as any}
    >
      <HStack justifyContent="space-between" flexWrap="wrap">
        <VStack flex={1}>
          <Text color={C.text} fontWeight="$bold">
            {step.sequence}. {step.name}
          </Text>
          <Text color={C.muted} size="2xs">
            {step.description}
            {step.component ? ` · ${step.component}` : ""}
            {step.timing?.durationMs != null
              ? ` · ${step.timing.durationMs} ms`
              : ""}
          </Text>
        </VStack>
        {d ? (
          <Text color={color(d.status)} size="xs" fontWeight="$bold">
            {d.status} / {d.outcome}
          </Text>
        ) : null}
      </HStack>
      {d?.reason ? (
        <Text color={C.text} size="xs" mt="$2">
          {d.reason}
        </Text>
      ) : null}
      {d?.reasonCodes?.length ? (
        <Text color={C.amber} size="2xs">
          {d.reasonCodes.join(", ")}
        </Text>
      ) : null}
      {step.rules?.map((r, i) => (
        <Box key={`${r.id}-${i}`} mt="$1">
          <Text color={color(r.status)} size="2xs">
            [{r.status}] {r.name}
            {r.reason ? ` — ${r.reason}` : ""}
          </Text>
          <JsonBlock title="Rule facts" value={r.facts} />
        </Box>
      ))}
      <Refs title="References" values={step.references} />
      {step.subjects?.map((s, i) => (
        <Box key={`${s.subject.kind}-${s.subject.id}-${i}`} mt="$2">
          <Text color={C.text} size="2xs">
            {s.subject.kind}: {s.subject.label ?? s.subject.id} ({s.subject.id})
            {s.decision ? ` · ${s.decision.status}/${s.decision.outcome}` : ""}
          </Text>
          <Refs title="Related" values={s.references} />
          <JsonBlock title="Subject facts" value={s.facts} />
        </Box>
      ))}
      <JsonBlock title="Input" value={step.input} />
      <JsonBlock title="Output" value={step.output} />
      <JsonBlock title="Facts" value={step.facts} />
    </Box>
  );
}
export function formatGenerationBitacora(trace: GenerationTrace) {
  return trace.steps
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(
      (s) =>
        `${s.sequence}. ${s.name}\n${s.decision ? `[${s.decision.status}] ${s.decision.outcome}${s.decision.reason ? `: ${s.decision.reason}` : ""}` : ""}`,
    )
    .join("\n\n");
}
export const GenerationBitacora = ({
  trace,
}: {
  trace: GenerationTrace;
  tourName?: string;
  totalDays?: number;
  categories?: string[];
}) => {
  const [open, setOpen] = useState(false);
  const steps = useMemo(
    () => trace.steps.slice().sort((a, b) => a.sequence - b.sequence),
    [trace.steps],
  );
  const depth = useMemo(() => {
    const m = new Map<string, number>();
    steps.forEach((s) =>
      m.set(s.id, s.parentId ? (m.get(s.parentId) ?? 0) + 1 : 0),
    );
    return m;
  }, [steps]);
  const download = async () => {
    const value = json(trace);
    if (Platform.OS === "web") return copyTextToClipboard(value);
    const file = new File(Paths.cache, "generation-trace-v5.json");
    file.write(value);
    return Share.share({ url: file.uri, title: "generation-trace-v5.json" });
  };
  return (
    <>
      <Pressable onPress={() => setOpen(true)} testID="bitacora-toggle">
        <Box
          my="$3"
          p="$3"
          bg={C.panel as any}
          borderWidth={1}
          borderColor={C.border as any}
          borderRadius="$lg"
        >
          <Text color={C.text} fontWeight="$bold">
            Bitácora de Generación
          </Text>
          <Text color={C.muted} size="2xs">
            v{trace.version} · {steps.length} steps ·{" "}
            {trace.result?.status ?? "IN PROGRESS"}
          </Text>
        </Box>
      </Pressable>
      <Modal
        visible={open}
        onRequestClose={() => setOpen(false)}
        animationType="slide"
      >
        <Box flex={1} bg={C.page as any} p="$4">
          <HStack justifyContent="space-between">
            <Pressable onPress={() => setOpen(false)}>
              <Text color={C.blue}>Cerrar</Text>
            </Pressable>
            <Pressable onPress={download}>
              <Text color={C.blue}>Exportar JSON</Text>
            </Pressable>
          </HStack>
          <Text color={C.text} size="lg" fontWeight="$bold" mt="$3">
            Generation Trace v5
          </Text>
          {trace.result ? (
            <>
              <Text
                color={color(
                  trace.result.status === "FAILED" ? "FAIL" : "PASS",
                )}
                size="xs"
              >
                {trace.result.status} · {trace.result.outcome}{" "}
                {trace.result.reason ? `— ${trace.result.reason}` : ""}
              </Text>
              {trace.result.reasonCodes?.length ? (
                <Text color={C.amber} size="2xs">
                  {trace.result.reasonCodes.join(", ")}
                </Text>
              ) : null}
              <JsonBlock title="Result facts" value={trace.result.facts} />
            </>
          ) : null}
          <ScrollView>
            <JsonBlock title="Runtime" value={trace.runtime} />
            <JsonBlock
              title="Canonical request"
              value={trace.canonicalRequest}
            />
            {steps.map((s) => (
              <Step key={s.id} step={s} depth={depth.get(s.id) ?? 0} />
            ))}
          </ScrollView>
        </Box>
      </Modal>
    </>
  );
};
