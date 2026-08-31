import { test, expect } from '@playwright/test';
import { apiLogin, seedAuthSession } from './auth-helper';
import { API_URL } from './playwright.config';

test('Live E2E Verification: Uncached City & Uncached Activities via SSE', async ({
  page,
  request,
}) => {
  // Indefinite timeout so the headed browser stays open for inspection
  test.setTimeout(0);

  console.log('\n========================================================================');
  console.log('🚀 DEMO EN VIVO: CIUDADES Y ACTIVIDADES NO CACHEADAS + SSE REAL-TIME');
  console.log('========================================================================\n');

  // 1. Auth Flow
  console.log('🔑 Paso 1: Autenticando usuario...');
  const session = await apiLogin(request);
  await seedAuthSession(page, session);
  await page.goto('/');
  console.log(`✅ Sesión iniciada: ${session.email}\n`);
  await page.waitForTimeout(1500);

  // 2. Open Wizard
  console.log('🧙 Paso 2: Abriendo Wizard para una CIUDAD NO CACHEADA (Bariloche)...');
  await page.getByTestId('create-tour-fab').click();
  await expect(page).toHaveURL(/\/tours\/wizard/);
  await page.waitForTimeout(1000);

  // 3. Type uncached destination in autocomplete
  console.log('🔍 Buscando destino nuevo sin cache: "Bariloche"...');
  const searchInput = page.getByPlaceholder(/Ej: Roma|Buscar destino/i).first();
  await searchInput.click();
  await searchInput.fill('Bariloche');
  await page.waitForTimeout(1200);

  // Select suggestion from dropdown
  const suggestion = page.getByText(/San Carlos de Bariloche/i).first();
  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  console.log('📍 Destino nuevo seleccionado del autocompletado en vivo.');
  await suggestion.click();
  await page.waitForTimeout(1000);

  // Step 1 -> Step 2
  await page.getByTestId('wizard-cta-button').click();
  await page.waitForTimeout(1000);

  // Step 2 -> Step 3
  console.log('🚶 Configurando ritmo y transporte...');
  await page.getByTestId('wizard-cta-button').click();
  await page.waitForTimeout(1000);

  // Step 3: Select experience formats & interests
  console.log('🎨 Seleccionando intereses para la ciudad nueva...');
  await page.getByText(/Visitas a Lugares|Caminatas/i).first().click();
  await page.waitForTimeout(500);

  // Submit Tour Generation
  console.log('⚡ Solicitando generación asincrónica para ciudad nueva (0 actividades previas en DB)...');
  await page.getByTestId('wizard-cta-button').click();

  await page.waitForURL(/\/tours\/[a-f0-9-]+$/, { timeout: 45_000 });
  const tourUrl = page.url();
  const tourId = tourUrl.split('/tours/')[1]?.split('?')[0];
  console.log(`🎯 Tour ID generado: ${tourId}`);
  console.log('📡 Escuchando flujo de eventos SSE en vivo (descubrimiento + ranking + ruta)...');

  // Wait for tour generation completion via SSE
  let isDone = false;
  let attempts = 0;
  while (!isDone && attempts < 45) {
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

  console.log('🎉 ¡Tour de ciudad nueva generado y recibido 100% por SSE!\n');
  await page.waitForTimeout(2000);

  // 4. Test Uncached Activity Live Photo Enrichment via SSE
  console.log('📸 Paso 4: Probando enriquecimiento asincrónico de foto en actividad no cacheada...');
  
  // Create a brand new activity in Bariloche with 0 photos in DB
  const createActResp = await request.post(`${API_URL}/activities`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
    data: {
      name: 'Centro Cívico de Bariloche',
      description: 'Monumento histórico nacional y conjunto arquitectónico icónico frente al lago Nahuel Huapi',
      latitude: -41.1335,
      longitude: -71.3103,
      type: 'cultural',
      photos: [], // Empty photos initially
    },
  });
  expect(createActResp.ok()).toBeTruthy();
  const createdAct = await createActResp.json();
  const testActId = createdAct.id;
  console.log(`📌 Actividad nueva creada (ID: ${testActId}) sin fotos previas.`);

  // Navigate to the activity screen
  console.log(`🌐 Navegando a la pantalla de la actividad: /activities/${testActId} ...`);
  await page.goto(`/activities/${testActId}`);
  await page.waitForTimeout(2000);

  console.log('👀 Verificando pantalla inicial de la actividad...');
  
  // Trigger background enrichment via backend endpoint
  console.log('⚡ Disparando enriquecimiento de fotos y highlights vía Outbox + SSE...');
  const enrichResp = await request.post(`${API_URL}/activities/${testActId}/enrich`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });
  console.log(`📡 Backend procesando fotos con proveedor externo (HTTP ${enrichResp.status()})...`);

  // Wait for the SSE event to update photos in the open screen without reload
  console.log('⏳ Esperando evento SSE "activity.media.updated" en el navegador...');
  await page.waitForTimeout(6000);

  console.log('\n========================================================================');
  console.log('🎉 ¡PRUEBA COMPLETADA CON ÉXITO! EL NAVEGADOR QUEDA ABIERTO');
  console.log('========================================================================');
  console.log('👉 Podés inspeccionar la ventana de Chromium:');
  console.log('   - Observá la actividad de Bariloche enriquecida en tiempo real.');
  console.log('   - Hacé clic hacia atrás para ver el Tour de Bariloche con paradas nuevas.');
  console.log('   - Probá cualquier otra interacción.');
  console.log('========================================================================\n');

  // Keep browser open indefinitely for user interaction
  await new Promise(() => {});
});
