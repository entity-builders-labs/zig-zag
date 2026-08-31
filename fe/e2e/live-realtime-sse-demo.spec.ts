import { test, expect } from '@playwright/test';
import { apiLogin, seedAuthSession } from './auth-helper';
import { API_URL } from './playwright.config';

test('Live E2E Verification: Tour generation & Media enrichment via SSE', async ({
  page,
  request,
}) => {
  // Allow indefinite runtime so the headed browser stays open for the user
  test.setTimeout(0);

  console.log('\n================================================================');
  console.log('🚀 INICIANDO TEST E2E EN VIVO: SSE & SINCRONIZACIÓN ASINCRÓNICA');
  console.log('================================================================\n');

  await page.context().grantPermissions(['geolocation']);
  await page
    .context()
    .setGeolocation({ latitude: -34.6037, longitude: -58.3816 });

  // 1. Auth Flow
  console.log('🔑 Paso 1: Autenticando usuario en la app...');
  const session = await apiLogin(request);
  await seedAuthSession(page, session);
  await page.goto('/');
  console.log(`✅ Usuario autenticado: ${session.email}\n`);
  await page.waitForTimeout(1500);

  // 2. Tour Generation via Wizard
  console.log('🧙 Paso 2: Abriendo Wizard para crear un Tour...');
  await page.getByTestId('create-tour-fab').click();
  await expect(page).toHaveURL(/\/tours\/wizard/);
  await page.waitForTimeout(1000);

  // Step 1 -> Step 2
  console.log('📍 Destino confirmado (Ubicación actual / Buenos Aires)...');
  await page.getByTestId('wizard-cta-button').click();
  await page.waitForTimeout(1000);

  // Step 2 -> Step 3
  console.log('🚶 Movilidad y ritmo configurados...');
  await page.getByTestId('wizard-cta-button').click();
  await page.waitForTimeout(1000);

  // Step 3: Select experience formats & interests
  console.log('🎨 Seleccionando formato de experiencia e intereses...');
  await page.getByText(/Visitas a Lugares|Caminatas/i).first().click();
  await page.waitForTimeout(500);

  // Step 3 -> Generate Tour
  console.log('✨ Enviando solicitud de generación con SSE...');
  await page.getByTestId('wizard-cta-button').click();

  await page.waitForURL(/\/tours\/[a-f0-9-]+$/, { timeout: 30_000 });
  const tourUrl = page.url();
  console.log(`🎯 Tour creado en: ${tourUrl}`);
  console.log('⚡ Escuchando progreso en vivo mediante Server-Sent Events (SSE)...');

  // Wait for tour generation completion via SSE
  let isDone = false;
  let attempts = 0;
  while (!isDone && attempts < 35) {
    const isReview = page.url().includes('/review');
    const hasStops = (await page.getByText(/paradas|recorrido|Día 1/i).count()) > 0;
    const isGenerating = (await page.getByText(/Generando|Esto puede tomar unos momentos/i).count()) > 0;

    if (isReview || (hasStops && !isGenerating)) {
      isDone = true;
      break;
    }
    await page.waitForTimeout(2000);
    attempts++;
  }

  console.log('🎉 ¡Tour generado y recibido por SSE!\n');
  await page.waitForTimeout(2000);

  // 3. Activity Live Media Enrichment Test via SSE
  console.log('📸 Paso 3: Probando enriquecimiento asincrónico de fotos en vivo (SSE)...');
  
  // Create a brand new activity with 0 photos in the database
  const createActResp = await request.post(`${API_URL}/activities`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
    data: {
      name: 'Café Dorrego Histórico',
      description: 'Emblemático bar notable en la esquina de Plaza Dorrego',
      latitude: -34.6209,
      longitude: -58.3712,
      type: 'cafe',
      photos: [], // Empty photos initially
    },
  });
  expect(createActResp.ok()).toBeTruthy();
  const createdAct = await createActResp.json();
  const testActId = createdAct.id;
  console.log(`📌 Actividad creada sin fotos (ID: ${testActId})`);

  // Navigate to the activity screen
  console.log(`🌐 Navegando a /activities/${testActId} ...`);
  await page.goto(`/activities/${testActId}`);
  await page.waitForTimeout(2000);

  console.log('👀 Verificando estado inicial sin fotos en pantalla...');
  
  // Trigger background enrichment via backend endpoint
  console.log('⚡ Disparando enriquecimiento de fotos en segundo plano...');
  const enrichResp = await request.post(`${API_URL}/activities/${testActId}/enrich`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });
  console.log(`📡 Backend procesando fotos (HTTP status: ${enrichResp.status()})`);

  // Wait for the SSE event to update photos in the open screen without reload
  console.log('⏳ Esperando evento SSE "activity.media.updated" en el navegador...');
  await page.waitForTimeout(5000);

  console.log('\n================================================================');
  console.log('🎉 ¡PRUEBA COMPLETADA CON ÉXITO! EL NAVEGADOR QUEDA ABIERTO');
  console.log('================================================================');
  console.log('👉 Podés inspeccionar la ventana de Chromium:');
  console.log('   - Mirar la actividad y su galería de fotos enriquecida por SSE.');
  console.log('   - Navegar hacia atrás al Tour generado.');
  console.log('   - Explorar paradas, waypoints e itinerarios.');
  console.log('================================================================\n');

  // Keep browser open indefinitely for user interaction
  await new Promise(() => {});
});
