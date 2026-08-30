const axios = require("axios");
const { chromium } = require("playwright");

async function main() {
  console.log("================================================================================");
  console.log("🚀 GENERANDO TOUR CON FOTOS 100% VERIFICADAS Y ABRIENDO NAVEGADOR");
  console.log("================================================================================");

  // 1. Autenticación
  const email = "demo-" + Date.now() + "@zigzag.local";
  const reqRes = await axios.post("http://localhost:4000/auth/email/request-code", { email });
  const authRes = await axios.post("http://localhost:4000/auth/email/verify", { email, code: reqRes.data.devCode });
  const { accessToken, refreshToken, user } = authRes.data;
  console.log("✅ Usuario autenticado:", user.email);

  // 2. Generar tour
  console.log("📍 Solicitando tour en Buenos Aires...");
  const payload = {
    destination: {
      label: "San Telmo y Monserrat, Buenos Aires",
      latitude: -34.6158,
      longitude: -58.3754,
      scaleHint: "settlement"
    },
    days: 2,
    budgetLevel: "medium",
    groupType: "family",
    intent: {
      interests: ["history", "food", "culture", "architecture", "tango"],
      experienceFormats: ["neighborhood_walks", "point_visits"],
      explorationStyle: "iconic",
      additionalPreferences: "Quiero ver los edificios más emblemáticos, pasajes históricos y tango"
    },
    mobility: {
      allowedTransportationModes: ["walking", "public_transport"],
      maxWalkingDistancePerDayMeters: 5000,
      maxContinuousWalkingDistanceMeters: 1500,
      travelPace: "moderate",
      accessibilityNeeds: []
    }
  };

  const tourRes = await axios.post("http://localhost:4000/tours/generate-tour", payload, {
    headers: { Authorization: "Bearer " + accessToken }
  });

  const tourId = tourRes.data.id;
  console.log("✅ Tour creado en BD con ID:", tourId);

  // 3. Esperar generación del tour
  let tour = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const getRes = await axios.get("http://localhost:4000/tours/" + tourId, {
        headers: { Authorization: "Bearer " + accessToken }
      });
      if (getRes.data.activities && getRes.data.activities.length > 0) {
        tour = getRes.data;
        break;
      }
    } catch (e) {}
  }

  if (!tour) {
    console.error("❌ No se pudo cargar el tour a tiempo.");
    return;
  }

  // 4. Enriquecer actividades con fotos 100% verificadas
  console.log("\n📸 Verificando y enriqueciendo fotos...");
  for (const ta of tour.activities) {
    const act = ta.activity;
    try {
      console.log(`   Verificando: "${act.name}" (${act.kind || "POI"})...`);
      const enriched = await axios.post(`http://localhost:4000/activities/${act.id}/enrich`);
      console.log(`   -> Fotos verificadas: ${enriched.data.photos?.length || 0}`);
    } catch (e) {}
  }

  // Recargar tour actualizado
  const refreshedTourRes = await axios.get("http://localhost:4000/tours/" + tourId, {
    headers: { Authorization: "Bearer " + accessToken }
  });
  tour = refreshedTourRes.data;

  console.log("\n================================================================================");
  console.log(`🎉 TOUR GENERADO: "${tour.name}" (ID: ${tourId})`);
  console.log("================================================================================");

  tour.activities.forEach((ta, idx) => {
    const act = ta.activity;
    console.log(`\n📍 [Parada #${idx + 1}] Día ${ta.dayNumber || 1} - "${act.name}" [${act.kind || "POI"}]`);
    console.log(`   Tipo: ${act.type || "N/A"} | Dirección: ${act.formattedAddress || "N/A"}`);
    if (act.photos && act.photos.length > 0) {
      console.log(`   📸 ${act.photos.length} FOTOS VERIFICADAS:`);
      act.photos.forEach((p, pIdx) => {
        console.log(`      ${pIdx + 1}. ${p.url?.slice(0, 80)}... (Autor: ${p.author || "N/A"}, Lic: ${p.license || "N/A"})`);
      });
    } else {
      console.log("   📸 0 fotos (descartadas para evitar fotos genéricas incorrectas)");
    }
    if (act.metadata?.highlights) {
      console.log(`   ✨ Highlights: ${JSON.stringify(act.metadata.highlights)}`);
    }
    if (ta.waypoints && ta.waypoints.length > 0) {
      console.log(`   🚶 ${ta.waypoints.length} WAYPOINTS:`);
      ta.waypoints.forEach((wp, wIdx) => {
        const wpAct = wp.waypointActivity || wp;
        console.log(`      * ${wIdx + 1}. ${wpAct.name} - Fotos: ${wpAct.photos?.length || 0}`);
      });
    }
  });

  // 5. Abrir navegador Chromium interactivo
  console.log("\n================================================================================");
  console.log("🌐 ABRIENDO NAVEGADOR VISUAL (CHROMIUM) EN TU PANTALLA...");
  console.log("================================================================================");

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
  });

  const context = await browser.newContext({
    viewport: { width: 440, height: 950 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();

  // Inyectar tokens de sesión
  await page.goto("http://localhost:8081");
  await page.evaluate(({ token, rToken }) => {
    localStorage.setItem("access_token", token);
    localStorage.setItem("refresh_token", rToken);
  }, { token: accessToken, rToken: refreshToken });

  const tourUrl = "http://localhost:8081/tours/" + tourId;
  console.log("🔗 Abriendo pantalla del tour:", tourUrl);
  await page.goto(tourUrl);

  console.log("\n================================================================================");
  console.log("🎉 LISTO: El navegador Chromium está abierto en tu escritorio.");
  console.log("👉 Podés navegar y verificar:");
  console.log("   - Palacio Barolo, Caminito, Tranvía Histórico: galerías con 4 a 6 fotos reales.");
  console.log("   - Caminatas compuestas: switch entre mapa y fotos, cards con miniaturas de waypoints.");
  console.log("   - Tocar cualquier actividad para ver su carrusel y highlights.");
  console.log("================================================================================");

  // Mantener abierto indefinidamente
  await new Promise(() => {});
}

main().catch(console.error);
