/**
 * Prompts for exhaustive source-atom labelling (milestone B).
 *
 * The labelling prompt, its system instruction and its JSON schema are a
 * byte-identical port of the accepted spike contract
 * (`spikes/rw4-atom-labelling-2026-10-06/atom-labelling.cjs`, prompt v4, the
 * text also sent by the v5 representation run). Milestone A froze it: do not
 * tune it here. `source-atom-labelling.prompt.spec.ts` pins its hash.
 *
 * The member-kind prompt is the production integration step decided for B:
 * identity resolution routes on a member's physical kind
 * (`GeoEntityHint.expectedKind`), which the labelling contract does not
 * carry. It is asked after assembly, per candidate segment, keyed by member
 * ID, and can never change membership.
 */
import {
  AtomLabellingBatch,
  ModelAtomClassification,
  ModelEntityRole,
  StructuredSourceAtom,
  TransferMode,
} from '../interfaces/atomized-source-unit.interface';
import { presentAtomText } from '../utils/source-atomization.util';

export const ATOM_LABELLING_PROMPT_VERSION = 'labelling-prompt-v4';
export const MEMBER_KIND_PROMPT_VERSION = 'member-kind-prompt-v1';

export const MODEL_ATOM_CLASSIFICATIONS: readonly ModelAtomClassification[] = [
  'ITINERARY_STOP',
  'ROUTE_LEG',
  'OPTIONAL_STOP',
  'ALTERNATIVE',
  'TRANSFER',
  'PASS_BY',
  'NON_ITINERARY',
];
export const MODEL_ENTITY_ROLES: readonly ModelEntityRole[] = [
  'ITINERARY_STOP',
  'ROUTE_LEG',
  'OPTIONAL_STOP',
  'ALTERNATIVE',
  'PASS_BY',
];
export const TRANSFER_MODES: readonly TransferMode[] = [
  'BUS',
  'TAXI',
  'METRO',
  'TRAIN',
  'TRAM',
  'FERRY',
  'CAR',
  'OTHER_MOTORIZED',
  'UNSPECIFIED',
];

export const ATOM_LABELLING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    atoms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          atomId: { type: 'string' },
          classification: { type: 'string', enum: MODEL_ATOM_CLASSIFICATIONS },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sourceName: { type: 'string' },
                supportSpan: { type: 'string' },
                role: { type: 'string', enum: MODEL_ENTITY_ROLES },
                mentionAtomId: { type: 'string' },
              },
              required: ['sourceName', 'supportSpan', 'role'],
            },
          },
          transferMode: { type: 'string', enum: TRANSFER_MODES },
          reason: { type: 'string' },
        },
        required: ['atomId', 'classification', 'entities'],
      },
    },
  },
  required: ['atoms'],
};

export const ATOM_LABELLING_SYSTEM_PROMPT =
  'You label every atom of one travel source text with its itinerary function. You never skip, merge, split, renumber or invent atoms, and you never invent places.';

export function buildAtomLabellingPrompt(
  batch: AtomLabellingBatch,
  atomsById: ReadonlyMap<string, StructuredSourceAtom>,
): string {
  const line = (id: string) =>
    `[${id}] ${presentAtomText(atomsById.get(id).text).text}`;
  return [
    'The source text below is one editorial unit split into atoms, in source order. Return exactly one entry in "atoms" for EVERY atom listed under LABEL, in the same order, using each atomId exactly as written (for example "a-007"). Headings, captions, fragments and ads are atoms too. An answer that skips, repeats or adds an atom is rejected.',
    batch.contextAtomIds.length
      ? 'Atoms under CONTEXT precede this part of the text. Read them for context only; do not label them.'
      : '',
    '',
    'classification (what the atom does in the itinerary):',
    '- ITINERARY_STOP: directs the traveller to a place that is a destination of the itinerary: start at, visit, stop at, enter, go and see, arrive at, experience, or a numbered stop.',
    '- ROUTE_LEG: tells the traveller to follow, walk or ride along, cross, traverse or use a real street, avenue, path, bridge or area as the route, when that path is not itself a place to visit.',
    '- OPTIONAL_STOP: presents a named place as optional or extra ("if you have time", "you can also"), outside the main sequence.',
    '- ALTERNATIVE: offers a choice among places ("A or B", "if you prefer X, go to Y"), or recommends one of several options, such as where to eat or drink.',
    '- TRANSFER: describes or announces moving to the next part of the itinerary by motorized or public transport (bus, taxi, metro, train, ferry, car), including a heading that announces that move. Walking from place to place is never a TRANSFER.',
    '- PASS_BY: only mentions places seen, passed, referenced or used for orientation along the way, without directing a visit and without telling the traveller to use them as the route.',
    '- NON_ITINERARY: everything else: description, history, tips, prices, opening hours, navigation, captions, ads, author notes. Also an atom that only describes a place labelled in another atom.',
    '',
    'Guidance:',
    '- A place to look at or enter that the text points out as a sight of the route ("you will see X", "in front is X", "X is on your left", then describing it) is an ITINERARY_STOP. A street, avenue or area is never an ITINERARY_STOP only because the traveller sees it. PASS_BY is for places only passed, glimpsed or used for orientation.',
    '- A street or corridor walked to get between stops is a ROUTE_LEG, including when the text says to go to, head to, reach or return to that street and then follow it. A street, promenade or corridor that is itself the attraction or the experience (the source presents walking it as the thing to do) is an ITINERARY_STOP.',
    '- A neighbourhood or district that is only entered, crossed, named as context, or named as the direction or arrival area of a transfer is not membership: label it ROUTE_LEG or PASS_BY. It is an ITINERARY_STOP only in an atom that separately tells the traveller to visit or explore that area as a destination.',
    '- An overview that lists what the whole itinerary covers, or a title, is NON_ITINERARY; label each place where the text actually directs the traveller to it.',
    '- A heading or sentence that announces going to the next part of the itinerary is a TRANSFER when the text says that part is reached by transport, even if the transport is named in the next atom.',
    '- A transfer back to the start, home or the hotel at the end is a TRANSFER whose destination is PASS_BY.',
    '',
    'entities: every real place the atom refers to, with its role; zero, one or several per atom. A place counts when it has a proper name or a description that identifies one specific place (for example "the city museum"). An unnamed generic option ("two bakeries") or a generic description without its own identity ("a big building", "the oldest part of town") is not an entity.',
    '- sourceName: the name or description exactly as the source writes it. Do not translate, expand or complete it.',
    '- supportSpan: a short phrase copied verbatim from this atom that shows the role. It contains sourceName unless mentionAtomId is set.',
    '- role: ITINERARY_STOP, ROUTE_LEG, OPTIONAL_STOP, ALTERNATIVE or PASS_BY, with the meanings above.',
    '- mentionAtomId: only when this atom refers back to a place that is named in an EARLIER atom (for example "Jump inside." or "enjoy the park"): the atomId of the earlier atom whose text contains sourceName.',
    'Consistency: a NON_ITINERARY atom has no entities. Any other non-TRANSFER atom has at least one entity, and its classification equals its strongest entity role (ITINERARY_STOP > ROUTE_LEG > OPTIONAL_STOP > ALTERNATIVE > PASS_BY). A TRANSFER atom may list the place it travels to: role ITINERARY_STOP only for a specific place the traveller is told to visit next; an area or direction named by the transfer is ROUTE_LEG or PASS_BY.',
    'transferMode (TRANSFER atoms only): BUS, TAXI, METRO, TRAIN, TRAM, FERRY, CAR, OTHER_MOTORIZED or UNSPECIFIED; the first one the source offers.',
    'reason: at most 12 words; audit only.',
    '',
    ...(batch.contextAtomIds.length
      ? ['CONTEXT:', ...batch.contextAtomIds.map(line), '']
      : []),
    'LABEL:',
    ...batch.atomIds.map(line),
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

/** Relabel prompt: the rejected atoms with the validator's issue codes. */
export function buildAtomRelabellingPrompt(
  batch: AtomLabellingBatch,
  atomsById: ReadonlyMap<string, StructuredSourceAtom>,
  issues: ReadonlyArray<{ code: string; atomId?: string; detail?: string }>,
): string {
  const rejected = issues
    .filter((x) => batch.atomIds.includes(x.atomId))
    .map((x) => `- [${x.atomId}] ${x.code}${x.detail ? `: ${x.detail}` : ''}`);
  return [
    'Your previous labels for the atoms under LABEL were rejected by a deterministic validator:',
    ...rejected,
    'Label these atoms again under the same rules. Atoms under CONTEXT are earlier atoms you may cite with mentionAtomId; do not label them.',
    '',
    buildAtomLabellingPrompt(batch, atomsById),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Member physical kind
// ---------------------------------------------------------------------------

export const MEMBER_PHYSICAL_KINDS = ['PLACE', 'AREA', 'ROUTE'] as const;

export const MEMBER_KIND_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    members: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          memberId: { type: 'string' },
          physicalKind: { type: 'string', enum: MEMBER_PHYSICAL_KINDS },
          reason: { type: 'string' },
        },
        required: ['memberId', 'physicalKind'],
      },
    },
  },
  required: ['members'],
};

export const MEMBER_KIND_SYSTEM_PROMPT =
  'You state the physical geographic kind of places already identified in a travel source text. You never add, remove, rename, merge or reorder places.';

export interface MemberKindPromptMember {
  memberId: string;
  sourceName: string;
  /** Presented text of the atoms that mention the member, in source order. */
  sourceText: string[];
}

export function buildMemberKindPrompt(
  members: readonly MemberKindPromptMember[],
): string {
  return [
    'Each MEMBER below is a place a travel source tells the traveller to visit, with its memberId, its exact source wording, and the source text that mentions it. Return exactly one entry in "members" for EVERY memberId listed, using each memberId exactly as written. An answer that skips, repeats or adds a member is rejected.',
    '',
    'physicalKind: the geographic nature of the place itself, never the kind of experience:',
    '- PLACE: a single venue, building, monument, landmark, square, park, market or other site.',
    '- AREA: a neighbourhood, district, quarter, town or other named area.',
    '- ROUTE: a street, avenue, promenade, trail, path or other linear way.',
    'reason: at most 12 words; audit only.',
    '',
    'MEMBERS:',
    ...members.map(
      (m) =>
        `[${m.memberId}] ${JSON.stringify(m.sourceName)}: ${m.sourceText.join(' / ')}`,
    ),
  ].join('\n');
}
