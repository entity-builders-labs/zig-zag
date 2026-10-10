export interface MediaWikiErrorPayload {
  code: string;
  info: string;
  docref?: string;
}

export interface MediaWikiTocSection {
  tocLevel: number;
  hLevel: number;
  line: string;
  number: string;
  index?: string;
  fromTitle?: string;
  byteoffset?: number;
  anchor: string;
}

export interface MediaWikiParseData {
  title: string;
  pageid: number;
  redirects?: Array<{ from: string; to: string }>;
  tocdata?: {
    sections?: MediaWikiTocSection[];
  };
  wikitext?: string;
}

export interface MediaWikiParseResponse {
  parse?: MediaWikiParseData;
  error?: MediaWikiErrorPayload;
}

export type WikivoyageSectionType = 'SEE' | 'DO' | 'EAT' | 'OTHER';

export interface WikivoyageEntry {
  name: string;
  description?: string;
  lat?: number;
  long?: number;
  wikidata?: string;
  sectionType: WikivoyageSectionType;
  templateName: string;
}

export interface WikivoyageParserDrop {
  templateName: string;
  reason: 'MISSING_NAME' | 'EMPTY_NAME' | 'PARSE_ERROR';
}

export interface WikivoyageParserAudit {
  wikitextCharCount: number;
  wikitextSha256: string;
  tocSections: Array<{
    index?: string;
    level?: number;
    line?: string;
    anchor?: string;
  }>;
  recognizedTemplateCount: number;
  parsedEntryCount: number;
  entryCountBySection: { SEE: number; DO: number; EAT: number; OTHER: number };
  targetTemplateCountByName: Record<string, number>;
  unsupportedTemplateCountByName: Record<string, number>;
  droppedEntries: WikivoyageParserDrop[];
}

export interface WikivoyageArticleResult {
  status: 'found' | 'not_found' | 'failed';
  title?: string;
  pageid?: number;
  entries: WikivoyageEntry[];
  parserAudit?: WikivoyageParserAudit;
  failureReason?: string;
}
