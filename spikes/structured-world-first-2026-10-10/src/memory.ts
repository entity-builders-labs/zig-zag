import { existsSync, readFileSync, writeFileSync } from 'fs';
import { UnofferedMention } from './contracts';
import { EvidenceCapture, FetchedDocument } from './spike1';

interface MemoryState {
  documents: Record<string, { fingerprint: string; retrievedAt: string; title?: string; text: string }>;
  pending: Record<string, { captures: EvidenceCapture[]; reasons: string[]; updatedAt: string }>;
  mentions: UnofferedMention[];
  reuse: Array<{ questionKey: string; captures: number; at: string }>;
}

/**
 * Research Evidence Memory (spec `research-evidence-memory`, design R8).
 * Non-canonical: readiness, composition and planning never read it. Stored
 * in its own file, apart from the catalog.
 */
export class EvidenceMemory {
  private constructor(private state: MemoryState) {}

  static empty(): EvidenceMemory {
    return new EvidenceMemory({ documents: {}, pending: {}, mentions: [], reuse: [] });
  }

  static load(path: string): EvidenceMemory {
    return existsSync(path) ? new EvidenceMemory(JSON.parse(readFileSync(path, 'utf8')) as MemoryState) : EvidenceMemory.empty();
  }

  save(path: string): void {
    writeFileSync(path, JSON.stringify(this.state, null, 2));
  }

  recordDocument(doc: FetchedDocument): void {
    this.state.documents[doc.url] = { fingerprint: doc.fingerprint, retrievedAt: doc.retrievedAt, text: doc.text, ...(doc.title ? { title: doc.title } : {}) };
  }

  /** Retained captures for an evaluation question (exact key); usage is recorded. */
  retrieve(questionKey: string, at: string): EvidenceCapture[] {
    const captures = structuredClone(this.state.pending[questionKey]?.captures ?? []);
    if (captures.length) this.state.reuse.push({ questionKey, captures: captures.length, at });
    return captures;
  }

  addPending(questionKey: string, captures: EvidenceCapture[], reason: string, at: string): void {
    const entry = (this.state.pending[questionKey] ??= { captures: [], reasons: [], updatedAt: at });
    const seen = new Set(entry.captures.map((c) => c.id));
    entry.captures.push(...structuredClone(captures.filter((c) => !seen.has(c.id))));
    entry.reasons.push(reason);
    entry.updatedAt = at;
  }

  /** Authorized questions no longer need pending evidence. */
  clearPending(questionKey: string): void {
    delete this.state.pending[questionKey];
  }

  addMentions(mentions: UnofferedMention[]): void {
    this.state.mentions.push(...structuredClone(mentions));
  }

  stats() {
    return {
      documents: Object.keys(this.state.documents).length,
      pendingQuestions: Object.keys(this.state.pending).length,
      pendingCaptures: Object.values(this.state.pending).reduce((n, p) => n + p.captures.length, 0),
      mentions: this.state.mentions.length,
      reuseEvents: this.state.reuse.length,
    };
  }

  view(): Readonly<MemoryState> {
    return structuredClone(this.state);
  }
}
