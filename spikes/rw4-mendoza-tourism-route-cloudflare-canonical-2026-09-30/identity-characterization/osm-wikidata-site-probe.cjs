#!/usr/bin/env node
// RW4 identity characterization -- read-only probes of facts the production
// resolver audit does not expose:
//  1. local Overpass (the production OSM backend): OSM objects + tags whose
//     name matches the source components, within Mendoza province;
//  2. Wikidata entity search for the source names (public API, read-only);
//  3. the official websites the SOURCE hyperlinks to (one GET each):
//     final URL after redirects, <title>, og:site_name, canonical link,
//     schema.org JSON-LD name/address/telephone.
// Writes osm-wikidata-site-probe.json next to this script.
//   node osm-wikidata-site-probe.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const OVERPASS = process.env.OVERPASS_API_URL || 'http://localhost:12345/api/interpreter';
// Mendoza province bounding box (S, W, N, E).
const BBOX = '-37.6,-70.6,-32.0,-66.5';
const NAME_PATTERN = 'Alfa Crux|SuperUco|Super Uco|Azul|A16|Agostino|The Vines|Solo Contigo|Coraz';
const WIKIDATA_QUERIES = [
  'Alfa Crux',
  'SuperUco',
  'Bodega Azul',
  'Bodega La Azul',
  'A16 winery',
];
// Exactly the hyperlink targets SolSalute (ev-1) attached to each component.
const SOURCE_LINKS = {
  'Alfa Crux': 'https://www.agostinowinegroup.com/alfa-crux-wines',
  SuperUco: 'https://superuco.com/',
  'Bodega Azul': 'https://bodegalaazul.com/',
  A16: 'http://a16sa.com/en/',
  'Ojo de Agua': 'https://ojodeagua.ch/',
};
const UA = 'zig-zag-rw4-identity-characterization/1.0 (diagnostic, read-only)';

async function overpass() {
  const query = `[out:json][timeout:60];(nwr["name"~"${NAME_PATTERN}",i](${BBOX}););out tags center;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(query)}` });
  const body = await res.json();
  return {
    query,
    status: res.status,
    elements: (body.elements ?? []).map((e) => ({
      osm: `${e.type}/${e.id}`,
      lat: e.lat ?? e.center?.lat,
      lon: e.lon ?? e.center?.lon,
      tags: e.tags,
    })),
  };
}

async function wikidata() {
  const out = {};
  for (const q of WIKIDATA_QUERIES) {
    const results = [];
    for (const language of ['es', 'en']) {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&limit=10&language=${language}&search=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const body = await res.json();
      for (const r of body.search ?? []) {
        if (!results.some((x) => x.id === r.id))
          results.push({ id: r.id, label: r.label, description: r.description, language });
      }
    }
    out[q] = results;
  }
  return out;
}

function jsonLdFacts(html) {
  const facts = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = [].concat(parsed['@graph'] ?? parsed);
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        facts.push({
          type: n['@type'],
          name: n.name,
          url: n.url,
          telephone: n.telephone,
          address: n.address,
          sameAs: n.sameAs,
        });
      }
    } catch {
      facts.push({ parseError: true });
    }
  }
  return facts;
}

const pick = (html, re) => {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 200) : undefined;
};

async function sites() {
  const out = {};
  for (const [component, url] of Object.entries(SOURCE_LINKS)) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(20000),
      });
      const html = await res.text();
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const addressLike = [...new Set(
        (text.match(/[^.|]{0,80}(Ruta|Route|Calle|Km|Tupungato|Tunuy[aá]n|San Carlos|Gualtallary|Vista Flores|Agrelo|Luj[aá]n de Cuyo|Maip[uú])[^.|]{0,80}/gi) ?? [])
          .map((s) => s.trim()),
      )].slice(0, 8);
      out[component] = {
        sourceLink: url,
        status: res.status,
        finalUrl: res.url,
        finalHost: new URL(res.url).host,
        title: pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
        ogSiteName: pick(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i),
        canonical: pick(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
        jsonLd: jsonLdFacts(html),
        addressLikeText: addressLike,
        phoneLikeText: [...new Set(text.match(/\+?54[\s\d()-]{8,}/g) ?? [])].slice(0, 4),
      };
    } catch (error) {
      out[component] = { sourceLink: url, error: String(error.message || error) };
    }
  }
  return out;
}

(async () => {
  const result = {
    generatedAt: new Date().toISOString(),
    overpass: await overpass(),
    wikidata: await wikidata(),
    officialSites: await sites(),
  };
  fs.writeFileSync(
    path.join(__dirname, 'osm-wikidata-site-probe.json'),
    JSON.stringify(result, null, 2),
  );
  console.log('written osm-wikidata-site-probe.json');
})();
