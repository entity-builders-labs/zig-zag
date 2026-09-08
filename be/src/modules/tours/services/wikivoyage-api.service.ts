import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  MediaWikiParseResponse,
  WikivoyageArticleResult,
  WikivoyageEntry,
  WikivoyageSectionType,
} from '../interfaces/wikivoyage-api.interface';

const DEFAULT_WIKIVOYAGE_API_URL = 'https://es.wikivoyage.org/w/api.php';
const USER_AGENT = 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)';
const REQUEST_TIMEOUT_MS = 10000;

const TARGET_TEMPLATES = new Set([
  'see',
  'do',
  'eat',
  'listing',
  'listado',
  'ver',
  'hacer',
  'comer',
]);

@Injectable()
export class WikivoyageApiService {
  private readonly logger = new Logger(WikivoyageApiService.name);

  constructor(private readonly configService: ConfigService) {}

  private get apiUrl(): string {
    return (
      this.configService.get<string>('WIKIVOYAGE_API_URL') ||
      DEFAULT_WIKIVOYAGE_API_URL
    );
  }

  async fetchArticle(pageTitle: string): Promise<WikivoyageArticleResult> {
    try {
      const response = await axios.get<MediaWikiParseResponse>(this.apiUrl, {
        params: {
          action: 'parse',
          page: pageTitle,
          prop: 'tocdata|wikitext',
          format: 'json',
          formatversion: 2,
          redirects: 1,
        },
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      });

      const data = response.data;

      if (data.error) {
        if (data.error.code === 'missingtitle') {
          return {
            status: 'not_found',
            entries: [],
          };
        }
        return {
          status: 'failed',
          entries: [],
          failureReason: `MediaWiki error: ${data.error.code} - ${data.error.info}`,
        };
      }

      if (!data.parse) {
        return {
          status: 'failed',
          entries: [],
          failureReason: 'Invalid MediaWiki response: missing parse object',
        };
      }

      const wikitext = data.parse.wikitext || '';
      const entries = this.parseWikitext(wikitext);

      return {
        status: 'found',
        title: data.parse.title,
        pageid: data.parse.pageid,
        entries,
      };
    } catch (error: any) {
      this.logger.warn(
        `Failed to fetch Wikivoyage article "${pageTitle}": ${error.message || error}`,
      );
      return {
        status: 'failed',
        entries: [],
        failureReason: error.message || String(error),
      };
    }
  }

  parseWikitext(wikitext: string): WikivoyageEntry[] {
    const rawTemplates = this.extractBalancedTemplates(wikitext);
    const entries: WikivoyageEntry[] = [];

    for (const raw of rawTemplates) {
      try {
        const entry = this.parseSingleTemplate(raw, wikitext);
        if (entry) {
          entries.push(entry);
        }
      } catch (err: any) {
        this.logger.debug(
          `Skipping malformed Wikivoyage entry in template "${raw.templateName}": ${err.message}`,
        );
      }
    }

    return entries;
  }

  private extractBalancedTemplates(
    wikitext: string,
  ): Array<{ templateName: string; body: string; startIndex: number }> {
    const results: Array<{
      templateName: string;
      body: string;
      startIndex: number;
    }> = [];
    let i = 0;

    while (i < wikitext.length - 1) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
        const start = i;
        i += 2;

        const nameMatch = wikitext
          .slice(i)
          .match(/^([a-zA-ZáéíóúÁÉÍÓÚ_]+)[\s\|\}]/);
        if (!nameMatch) {
          continue;
        }

        const templateName = nameMatch[1].toLowerCase();
        if (!TARGET_TEMPLATES.has(templateName)) {
          continue;
        }

        let depth = 1;
        let pos = i;

        while (pos < wikitext.length - 1 && depth > 0) {
          if (wikitext[pos] === '{' && wikitext[pos + 1] === '{') {
            depth++;
            pos += 2;
          } else if (wikitext[pos] === '}' && wikitext[pos + 1] === '}') {
            depth--;
            pos += 2;
          } else {
            pos++;
          }
        }

        if (depth === 0) {
          const body = wikitext.slice(start + 2, pos - 2);
          results.push({
            templateName,
            body,
            startIndex: start,
          });
          i = pos;
          continue;
        }
      }
      i++;
    }

    return results;
  }

  private parseSingleTemplate(
    raw: { templateName: string; body: string; startIndex: number },
    fullWikitext: string,
  ): WikivoyageEntry | null {
    const params = this.splitTopLevelParameters(raw.body);
    const kv: Record<string, string> = {};

    for (let p = 1; p < params.length; p++) {
      const param = params[p];
      const eqIdx = param.indexOf('=');
      if (eqIdx !== -1) {
        const key = param.slice(0, eqIdx).trim().toLowerCase();
        const value = param.slice(eqIdx + 1).trim();
        kv[key] = value;
      }
    }

    const rawName = kv['name'] || kv['nombre'];
    if (!rawName) {
      return null;
    }

    const cleanedName = this.cleanWikitextMarkup(rawName);
    if (!cleanedName) {
      return null;
    }

    const rawDescription =
      kv['content'] ||
      kv['description'] ||
      kv['descripción'] ||
      kv['contenido'];
    const cleanedDescription = rawDescription
      ? this.cleanWikitextMarkup(rawDescription)
      : undefined;

    const lat = this.parseLatitude(kv['lat'] || kv['latitude']);
    const long = this.parseLongitude(
      kv['long'] || kv['lon'] || kv['longitude'],
    );
    const wikidata = this.parseWikidata(kv['wikidata']);

    const sectionType = this.resolveSectionType(
      raw.templateName,
      kv['tipo'] || kv['type'],
      raw.startIndex,
      fullWikitext,
    );

    return {
      name: cleanedName,
      description: cleanedDescription || undefined,
      lat,
      long,
      wikidata,
      sectionType,
      templateName: raw.templateName,
    };
  }

  private splitTopLevelParameters(body: string): string[] {
    const params: string[] = [];
    let pStart = 0;
    let pDepth = 0;

    for (let p = 0; p < body.length; p++) {
      if (body[p] === '{' && body[p + 1] === '{') {
        pDepth++;
        p++;
      } else if (body[p] === '}' && body[p + 1] === '}') {
        pDepth--;
        p++;
      } else if (body[p] === '[' && body[p + 1] === '[') {
        pDepth++;
        p++;
      } else if (body[p] === ']' && body[p + 1] === ']') {
        pDepth--;
        p++;
      } else if (body[p] === '|' && pDepth === 0) {
        params.push(body.slice(pStart, p));
        pStart = p + 1;
      }
    }
    params.push(body.slice(pStart));
    return params;
  }

  private parseLatitude(val?: string): number | undefined {
    const num = this.parseStrictNumber(val);
    if (num === undefined) return undefined;
    if (num < -90 || num > 90) return undefined;
    return num;
  }

  private parseLongitude(val?: string): number | undefined {
    const num = this.parseStrictNumber(val);
    if (num === undefined) return undefined;
    if (num < -180 || num > 180) return undefined;
    return num;
  }

  private parseStrictNumber(val?: string): number | undefined {
    if (!val) return undefined;
    const clean = val.trim();
    if (!clean) return undefined;
    if (!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean)) {
      return undefined;
    }
    const num = Number(clean);
    return Number.isFinite(num) ? num : undefined;
  }

  private parseWikidata(val?: string): string | undefined {
    if (!val) return undefined;
    const match = val.trim().match(/Q[0-9]+/i);
    return match ? match[0].toUpperCase() : undefined;
  }

  private resolveSectionType(
    templateName: string,
    tipoParam: string | undefined,
    startIndex: number,
    fullWikitext: string,
  ): WikivoyageSectionType {
    if (templateName === 'see' || templateName === 'ver') {
      return 'SEE';
    }
    if (templateName === 'do' || templateName === 'hacer') {
      return 'DO';
    }
    if (templateName === 'eat' || templateName === 'comer') {
      return 'EAT';
    }

    if (tipoParam) {
      const normalizedTipo = tipoParam.toLowerCase().trim();
      if (normalizedTipo === 'see' || normalizedTipo === 'ver') {
        return 'SEE';
      }
      if (normalizedTipo === 'do' || normalizedTipo === 'hacer') {
        return 'DO';
      }
      if (normalizedTipo === 'eat' || normalizedTipo === 'comer') {
        return 'EAT';
      }
    }

    const precedingHeaders = [
      ...fullWikitext.slice(0, startIndex).matchAll(/==+\s*([^=]+?)\s*==+/g),
    ];
    if (precedingHeaders.length > 0) {
      const lastHeader =
        precedingHeaders[precedingHeaders.length - 1][1].toLowerCase();
      if (lastHeader.includes('ver') || lastHeader.includes('see')) {
        return 'SEE';
      }
      if (lastHeader.includes('hacer') || lastHeader.includes('do')) {
        return 'DO';
      }
      if (lastHeader.includes('comer') || lastHeader.includes('eat')) {
        return 'EAT';
      }
    }

    return 'OTHER';
  }

  private cleanWikitextMarkup(text: string): string {
    return text
      .replace(/\[\[(?:Archivo|File|Image|Imagen):[^\]]+\]\]/gi, '')
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
      .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')
      .replace(/\[https?:\/\/[^\s\]]+\]/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}
