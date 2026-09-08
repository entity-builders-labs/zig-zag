import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { WikivoyageApiService } from './wikivoyage-api.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function loadFixture(filename: string): any {
  const filePath = path.join(
    __dirname,
    '../../../../test/fixtures/wikivoyage',
    filename,
  );
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('WikivoyageApiService', () => {
  let service: WikivoyageApiService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WikivoyageApiService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'WIKIVOYAGE_API_URL') {
                return 'https://es.wikivoyage.org/w/api.php';
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WikivoyageApiService>(WikivoyageApiService);
  });

  describe('fetchArticle', () => {
    it('successfully parses San Telmo fixture with see and do entries', async () => {
      const fixture = loadFixture('san-telmo.json');
      mockedAxios.get.mockResolvedValueOnce({ data: fixture });

      const result = await service.fetchArticle('San Telmo');

      expect(result.status).toBe('found');
      expect(result.title).toBe('San Telmo');
      expect(result.pageid).toBe(10791);
      expect(result.entries.length).toBeGreaterThan(0);

      // Verify Manzana de las Luces
      const manzana = result.entries.find((e) =>
        e.name.includes('Manzana de las Luces'),
      );
      expect(manzana).toBeDefined();
      expect(manzana?.lat).toBeCloseTo(-34.610556);
      expect(manzana?.long).toBeCloseTo(-58.374444);
      expect(manzana?.wikidata).toBe('Q263127');
      expect(manzana?.sectionType).toBe('SEE');
      expect(manzana?.description).toContain('Este bloque');

      // Verify Mercado San Telmo
      const mercado = result.entries.find((e) =>
        e.name.includes('Mercado San Telmo'),
      );
      expect(mercado).toBeDefined();
      expect(mercado?.wikidata).toBe('Q6010497');

      // Verify Do / Hacer entries
      const tango = result.entries.find((e) =>
        e.name.toLowerCase().includes('tango'),
      );
      expect(tango).toBeDefined();
      expect(tango?.sectionType).toBe('DO');
    });

    it('successfully parses La Boca fixture with listado templates', async () => {
      const fixture = loadFixture('la-boca.json');
      mockedAxios.get.mockResolvedValueOnce({ data: fixture });

      const result = await service.fetchArticle('La Boca');

      expect(result.status).toBe('found');
      expect(result.title).toBe('La Boca');
      expect(result.entries.length).toBeGreaterThan(0);

      const caminito = result.entries.find((e) => e.name === 'Caminito');
      expect(caminito).toBeDefined();
      expect(caminito?.wikidata).toBe('Q1029566');
      expect(caminito?.sectionType).toBe('SEE');
      expect(caminito?.description).toContain('callejuela peatonal');
    });

    it('successfully parses Recoleta fixture', async () => {
      const fixture = loadFixture('recoleta.json');
      mockedAxios.get.mockResolvedValueOnce({ data: fixture });

      const result = await service.fetchArticle('Buenos Aires/Recoleta');

      expect(result.status).toBe('found');
      expect(result.entries.length).toBeGreaterThan(0);
      const cementerio = result.entries.find((e) =>
        e.name.toLowerCase().includes('cementerio'),
      );
      expect(cementerio).toBeDefined();
      expect(cementerio?.sectionType).toBe('SEE');
    });

    it('successfully parses Palermo fixture', async () => {
      const fixture = loadFixture('palermo.json');
      mockedAxios.get.mockResolvedValueOnce({ data: fixture });

      const result = await service.fetchArticle('Palermo (Buenos Aires)');

      expect(result.status).toBe('found');
      expect(result.entries.length).toBeGreaterThan(0);
      const palermoViejo = result.entries.find((e) =>
        e.name.includes('Palermo Viejo'),
      );
      expect(palermoViejo).toBeDefined();
      expect(palermoViejo?.wikidata).toBe('Q6058876');
    });

    it('isolates malformed entries without failing valid siblings', async () => {
      const fixture = loadFixture('malformed-entry.json');
      mockedAxios.get.mockResolvedValueOnce({ data: fixture });

      const result = await service.fetchArticle('Malformed Entry Neighborhood');

      expect(result.status).toBe('found');
      expect(result.entries).toHaveLength(3);
      expect(result.entries.map((e) => e.name)).toEqual([
        'Valid Attraction One',
        'Valid Attraction Two',
        'Valid Do Experience',
      ]);
      expect(result.entries[0].wikidata).toBe('Q11111');
      expect(result.entries[1].wikidata).toBe('Q22222');
      expect(result.entries[2].sectionType).toBe('DO');
    });

    it('returns not_found when article does not exist in MediaWiki', async () => {
      const fixture = loadFixture('missing-article.json');
      mockedAxios.get.mockResolvedValueOnce({ data: fixture });

      const result = await service.fetchArticle('NonExistentArticle');

      expect(result.status).toBe('not_found');
      expect(result.entries).toEqual([]);
      expect(result.failureReason).toBeUndefined();
    });

    it('returns failed when MediaWiki returns a non-missing error payload', async () => {
      const fixture = loadFixture('mediawiki-error.json');
      mockedAxios.get.mockResolvedValueOnce({ data: fixture });

      const result = await service.fetchArticle('[[]]');

      expect(result.status).toBe('failed');
      expect(result.entries).toEqual([]);
      expect(result.failureReason).toContain('MediaWiki error: badtitle');
    });

    it('handles HTTP 500 error gracefully via transport failure', async () => {
      mockedAxios.get.mockRejectedValueOnce(
        new Error('Request failed with status code 500'),
      );

      const result = await service.fetchArticle('San Telmo');

      expect(result.status).toBe('failed');
      expect(result.entries).toEqual([]);
      expect(result.failureReason).toContain('status code 500');
    });

    it('handles network timeout gracefully via transport failure', async () => {
      mockedAxios.get.mockRejectedValueOnce(
        new Error('timeout of 10000ms exceeded'),
      );

      const result = await service.fetchArticle('San Telmo');

      expect(result.status).toBe('failed');
      expect(result.entries).toEqual([]);
      expect(result.failureReason).toContain('timeout of 10000ms exceeded');
    });

    it('handles malformed payload missing parse object', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: {} });

      const result = await service.fetchArticle('San Telmo');

      expect(result.status).toBe('failed');
      expect(result.entries).toEqual([]);
      expect(result.failureReason).toContain('missing parse object');
    });
  });

  describe('parseWikitext unit behavior', () => {
    it('handles nested wiki links and cleans markup in name and description', () => {
      const wikitext = `
        == Ver ==
        {{see
        | name=[[Museo de Arte Moderno|MAMBA]]
        | lat=-34.62
        | long=-58.37
        | content=Excelente museo en [[San Telmo]], con obras de [[Arte contemporáneo|arte moderno]].
        }}
      `;

      const entries = service.parseWikitext(wikitext);

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('MAMBA');
      expect(entries[0].description).toBe(
        'Excelente museo en San Telmo, con obras de arte moderno.',
      );
      expect(entries[0].lat).toBe(-34.62);
      expect(entries[0].long).toBe(-58.37);
      expect(entries[0].sectionType).toBe('SEE');
    });

    it('correctly handles entries without coordinates or wikidata', () => {
      const wikitext = `
        == Ver ==
        {{see
        | name=Rincón Pintoresco
        | content=Lugar agradable sin coordenadas.
        }}
      `;

      const entries = service.parseWikitext(wikitext);

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Rincón Pintoresco');
      expect(entries[0].lat).toBeUndefined();
      expect(entries[0].long).toBeUndefined();
      expect(entries[0].wikidata).toBeUndefined();
    });
  });
});
