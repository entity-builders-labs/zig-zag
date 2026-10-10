/**
 * The single semantic contract of source locality recovery (amendment
 * §19.1). Every discovery extractor provider sends exactly this prompt and
 * schema; providers add only transport.
 *
 * The model reads, for each component, the numbered source statements that
 * literally name it, and reports what each statement says about where the
 * component is. It never copies a span: the backend already holds every
 * statement verbatim and decides admission deterministically
 * (`component-locality-recovery.util.ts`). The destination, headings and
 * titles are deliberately absent from the prompt.
 */

export const LOCALITY_RELATIONS = [
  'LOCATED_IN',
  'NEAR',
  'NOT_IN',
  'ALTERNATIVE',
  'SAME_NAME_OTHER_PLACE',
  'OTHER',
] as const;

export type LocalityRelation = (typeof LOCALITY_RELATIONS)[number];

export interface LocalityRecoveryPromptComponent {
  id: string;
  name: string;
  /** The source passage that names the component in its composition. */
  entry: string;
  statements: Array<{ id: string; text: string }>;
}

export function buildLocalityRecoverySystemPrompt(): string {
  return `You read source statements and report what each one literally says about where a named place is.

You never use your own geographic knowledge, the user's destination, page headings or titles.
You never add, translate, transliterate, abbreviate or correct a place name.
The backend verifies every report against the source and discards what it cannot verify.`;
}

export function buildLocalityRecoveryUserPrompt(
  components: readonly LocalityRecoveryPromptComponent[],
): string {
  const blocks = components.map((component) =>
    [
      `${component.id}: ${JSON.stringify(component.name)}`,
      `  entry: ${JSON.stringify(component.entry)}`,
      ...component.statements.map(
        (statement) => `  ${statement.id}: ${JSON.stringify(statement.text)}`,
      ),
    ].join('\n'),
  );
  return [
    'Each component below is a place a source names as part of an experience. Its entry is the source passage that names it in that experience. Its statements are every sentence or caption of the same source that names it.',
    '',
    'For each statement, report every geographic place the statement relates to THIS component, with the relation the statement itself expresses:',
    '- LOCATED_IN: the statement says this component itself is in that place, and the place is a settlement or an administrative area (a town, city, district, department or neighbourhood) — never a property, estate, building, venue or business. Shapes such as "Lunch at X in Shinjuku", "X está ubicado en Palermo", "Visite du X dans le Marais", "XはYにあります".',
    '- NEAR: it says the component is near, close to, outside, or a drive from that place.',
    '- NOT_IN: it says the component is not in that place.',
    '- ALTERNATIVE: it gives that place as one of several possibilities ("in A or B").',
    '- SAME_NAME_OTHER_PLACE: the statement is about a different place, branch or outlet that shares the name, not the one in the entry.',
    '- OTHER: any other relation, such as a place visited before or after, or a place where the component is popular.',
    'Copy each place exactly as the statement writes it, in its own language and script. Report nothing for a statement that relates no geographic place to this component. Never report the component itself, another business, or a place you only know about.',
    '',
    'The subject matters: report a statement only for the component it is about. "They are next to X" says nothing about X\'s location.',
    'Return JSON only: {"reports":[{"component":"c1","statement":"s1","place":"...","relation":"LOCATED_IN"}]}, where component and statement are the ids shown (c1, s1), never names or text. Return {"reports":[]} when no statement relates a place to its component.',
    '',
    ...blocks,
  ].join('\n');
}

/** JSON Schema for providers with schema-enforced output. The ids are
 * enumerated, so a schema-enforcing provider cannot answer with a name. */
export function buildLocalityRecoveryResponseJsonSchema(
  components: readonly LocalityRecoveryPromptComponent[],
): Record<string, unknown> {
  const statementIds = [
    ...new Set(
      components.flatMap((component) =>
        component.statements.map((statement) => statement.id),
      ),
    ),
  ];
  return {
    type: 'object',
    properties: {
      reports: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            component: {
              type: 'string',
              enum: components.map((component) => component.id),
            },
            statement: { type: 'string', enum: statementIds },
            place: { type: 'string' },
            relation: { type: 'string', enum: [...LOCALITY_RELATIONS] },
          },
          required: ['component', 'statement', 'place', 'relation'],
        },
      },
    },
    required: ['reports'],
  };
}
