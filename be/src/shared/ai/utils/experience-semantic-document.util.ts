import { EXPERIENCE_EMBEDDING_DOCUMENT_VERSION } from '../interfaces/embedding-index.interface';

export const EXPERIENCE_SEMANTIC_DOCUMENT_VERSION =
  EXPERIENCE_EMBEDDING_DOCUMENT_VERSION;

export interface ExperienceSemanticDocumentInput {
  canonicalName: string;
  description?: string | null;
  durationMinutes?: number | null;
  price?: number | null;
  themes?: string[];
  traits?: Array<
    | { dimension?: string | null; key?: string | null; label?: string | null }
    | string
  >;
  intents?: string[];
  components?: Array<{
    role?: string | null;
    geoEntity?: {
      name: string;
      kind?: string | null;
      address?: string | null;
    } | null;
  }>;
}

function clean(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => !!value),
    ),
  ];
}

export function buildExperienceSemanticDocument(
  input: ExperienceSemanticDocumentInput,
): string {
  const traits = clean(
    (input.traits ?? []).flatMap((trait) => {
      if (typeof trait === 'string') return [trait];
      return [
        trait.label,
        trait.key,
        trait.dimension && trait.key
          ? `${trait.dimension}:${trait.key}`
          : undefined,
      ];
    }),
  );

  const components = (input.components ?? [])
    .filter((component) => component.geoEntity?.name)
    .map((component) => {
      const entity = component.geoEntity!;
      return clean([
        component.role ? `role=${component.role}` : undefined,
        entity.kind ? `kind=${entity.kind}` : undefined,
        entity.name,
        entity.address,
      ]).join(' | ');
    });

  const lines = [
    `name: ${input.canonicalName.trim()}`,
    input.description?.trim()
      ? `description: ${input.description.trim()}`
      : undefined,
    clean(input.themes ?? []).length
      ? `themes: ${clean(input.themes ?? []).join(', ')}`
      : undefined,
    traits.length ? `traits: ${traits.join(', ')}` : undefined,
    clean(input.intents ?? []).length
      ? `intents: ${clean(input.intents ?? []).join(', ')}`
      : undefined,
    Number.isFinite(input.durationMinutes)
      ? `duration_minutes: ${input.durationMinutes}`
      : undefined,
    Number.isFinite(input.price) ? `price: ${input.price}` : undefined,
    ...components.map((component) => `component: ${component}`),
  ].filter((line): line is string => !!line);

  return lines.join('\n');
}
