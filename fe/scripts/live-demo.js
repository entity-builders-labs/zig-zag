const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function glideTo(page, locator) {
  try {
    const box = await locator.boundingBox();
    if (box) {
      const targetX = box.x + box.width / 2;
      const targetY = box.y + box.height / 2;
      await page.mouse.move(targetX, targetY, { steps: 20 });
      await sleep(200);
    }
  } catch (e) {}
}

async function humanClick(page, locator) {
  await glideTo(page, locator);
  await locator.click();
  await sleep(500);
}

async function humanType(page, locator, text) {
  await glideTo(page, locator);
  await locator.click();
  await sleep(150);
  await locator.pressSequentially(text, { delay: 65 });
  await sleep(350);
}

async function main() {
  console.log('🚀 Launching Chrome in headed mode...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 45,
    args: ['--window-size=1280,920', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    permissions: ['geolocation'],
    geolocation: { latitude: -34.6037, longitude: -58.3816 }, // Buenos Aires
  });

  const page = await context.newPage();

  // Inject a visible red cursor to follow along
  await page.addInitScript(() => {
    const dot = document.createElement('div');
    dot.id = 'demo-cursor';
    dot.style.cssText =
      'position:fixed;top:0;left:0;width:24px;height:24px;border-radius:50%;' +
      'background:rgba(220,38,38,0.9);border:2px solid #ffffff;' +
      'box-shadow:0 3px 12px rgba(0,0,0,0.5);pointer-events:none;' +
      'z-index:2147483647;transform:translate(-999px,-999px);transition:transform 0.04s ease;';
    
    const label = document.createElement('div');
    label.innerText = 'ZigZag Bot';
    label.style.cssText =
      'position:absolute;left:28px;top:2px;background:#0f172a;color:#fbbf24;font-size:11px;font-weight:bold;' +
      'padding:2px 8px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);';
    dot.appendChild(label);

    const attach = () => document.body && document.body.appendChild(dot);
    document.addEventListener('DOMContentLoaded', attach);
    attach();
    window.addEventListener(
      'mousemove',
      (e) => {
        dot.style.transform = `translate(${e.clientX - 12}px, ${e.clientY - 12}px)`;
      },
      { passive: true }
    );
  });

  const BASE_URL = 'http://localhost:19006';
  console.log(`🌐 Navigating to ${BASE_URL}...`);
  await page.goto(BASE_URL);
  await sleep(2000);

  // If on login page, authenticate via email OTP
  if (page.url().includes('/login') || (await page.getByTestId('login-email-link').count()) > 0) {
    console.log('🔑 Performing smooth demo login...');
    const emailLink = page.getByTestId('login-email-link');
    if (await emailLink.isVisible()) {
      await humanClick(page, emailLink);
    }

    const testEmail = `demo-${Date.now()}@zigzag.travel`;
    const emailInput = page.getByTestId('login-email-input');
    await humanType(page, emailInput, testEmail);

    const requestCodeBtn = page.getByTestId('login-request-code-button');
    await humanClick(page, requestCodeBtn);
    await sleep(1500);

    // Look for devCode in UI
    const devCodeBox = page.getByText(/Modo desarrollo — código: \d{6}/);
    await devCodeBox.waitFor({ state: 'visible', timeout: 10000 });
    const codeText = await devCodeBox.textContent();
    const code = codeText?.match(/\d{6}/)?.[0] || '123456';
    console.log(`📥 Received OTP Code: ${code}`);

    const codeInput = page.getByTestId('login-code-input');
    await humanType(page, codeInput, code);

    const verifyBtn = page.getByTestId('login-verify-code-button');
    await humanClick(page, verifyBtn);
    await sleep(2500);
  }

  // Navigate to wizard
  console.log('📍 Navigating to Tour Creation Wizard...');
  await page.goto(`${BASE_URL}/tours/wizard`);
  await sleep(2000);

  // --- STEP 1: Destination & Dates (Argentina OSM Area: San Telmo) ---
  console.log('📝 Step 1: Destination in Argentina (San Telmo, Buenos Aires)...');
  const destinationInput = page.getByPlaceholder(/Roma, Italia o Barcelona|Buscar destino/i).first();
  await humanType(page, destinationInput, 'San Telmo');
  await sleep(1200);

  // Pick San Telmo suggestion
  const suggestion = page.getByText(/San Telmo.*Buenos Aires|San Telmo/i).first();
  try {
    await suggestion.waitFor({ state: 'visible', timeout: 8000 });
    console.log('👉 Selecting San Telmo suggestion...');
    await humanClick(page, suggestion);
  } catch (e) {
    console.log('Suggestion click skipped, continuing...');
  }
  await sleep(1000);

  // Select dates
  console.log('📅 Selecting travel dates...');
  const dateTrigger = page.getByText(/Seleccionar fechas/i).first();
  if (await dateTrigger.isVisible()) {
    await humanClick(page, dateTrigger);
    await sleep(800);

    const preset2Days = page.getByText(/Fin de Semana|2 Días|3 Días/i).first();
    if (await preset2Days.isVisible()) {
      await humanClick(page, preset2Days);
    } else {
      const confirmBtn = page.getByText(/Confirmar/i).first();
      if (await confirmBtn.isVisible()) await humanClick(page, confirmBtn);
    }
  }
  await sleep(1200);

  // Step 1 -> Step 2 ("Continuar")
  console.log('➡️ Proceeding to Step 2 (Estilo, Ritmo y Movilidad)...');
  const continueBtn1 = page.getByText('Continuar', { exact: true }).first();
  await humanClick(page, continueBtn1);
  await sleep(1500);

  // --- STEP 2: Estilo, Ritmo y Movilidad ---
  console.log('👥 Step 2: Selecting Company (Pareja)...');
  const companyOption = page.getByText('Pareja', { exact: true }).first();
  if (await companyOption.isVisible()) await humanClick(page, companyOption);
  await sleep(600);

  console.log('💰 Step 2: Selecting Budget ($$ Moderado)...');
  const budgetOption = page.getByText('$$ Moderado', { exact: false }).first();
  if (await budgetOption.isVisible()) await humanClick(page, budgetOption);
  await sleep(600);

  console.log('⚡ Step 2: Selecting Pace (Equilibrado)...');
  const paceOption = page.getByText('Equilibrado', { exact: true }).first();
  if (await paceOption.isVisible()) await humanClick(page, paceOption);
  await sleep(600);

  console.log('🚶 Step 2: Selecting Max Distance (5 km)...');
  const distanceOption = page.getByText('5 km', { exact: true }).first();
  if (await distanceOption.isVisible()) await humanClick(page, distanceOption);
  await sleep(600);

  console.log('🚌 Step 2: Selecting Transport (Transporte público)...');
  const transportOption = page.getByText('Transporte público', { exact: true }).first();
  if (await transportOption.isVisible()) await humanClick(page, transportOption);
  await sleep(600);

  // Step 2 -> Step 3 ("Continuar")
  console.log('➡️ Proceeding to Step 3 (Experiencias, Intereses y Notas)...');
  const continueBtn2 = page.getByText('Continuar', { exact: true }).first();
  await humanClick(page, continueBtn2);
  await sleep(1500);

  // --- STEP 3: Experiencias, Intereses y Notas ---
  console.log('✨ Step 3: Selecting Experience Formats (Caminatas por barrios & Rutas temáticas)...');
  const walkFormat = page.getByText('Caminatas por barrios', { exact: false }).first();
  if (await walkFormat.isVisible()) await humanClick(page, walkFormat);
  await sleep(600);

  const routeFormat = page.getByText('Rutas temáticas', { exact: false }).first();
  if (await routeFormat.isVisible()) await humanClick(page, routeFormat);
  await sleep(600);

  console.log('🏛️ Step 3: Selecting Interests (Historia & Gastronomía)...');
  const historyInterest = page.getByText('Historia', { exact: true }).first();
  if (await historyInterest.isVisible()) await humanClick(page, historyInterest);
  await sleep(500);

  const foodInterest = page.getByText('Gastronomía', { exact: true }).first();
  if (await foodInterest.isVisible()) await humanClick(page, foodInterest);
  await sleep(500);

  console.log('📝 Step 3: Adding special prompt for AI...');
  const notesTextarea = page.getByPlaceholder(/Buscamos opciones pet friendly/i).first();
  if (await notesTextarea.isVisible()) {
    await humanType(page, notesTextarea, 'Priorizar pasajes antiguos, bares notables y arquitectura colonial.');
  }
  await sleep(800);

  // Generate Tour CTA!
  console.log('🚀 Clicking "Generar Itinerario Inteligente"...');
  const generateBtn = page.getByText(/Generar Itinerario Inteligente/i).first();
  await humanClick(page, generateBtn);

  console.log('⏳ Generation initiated! Watching real-time progress in San Telmo...');
  await page.waitForURL(/\/tours\/[a-f0-9-]+/, { timeout: 30000 });
  const tourUrl = page.url();
  console.log(`🎉 Landed on Tour Page: ${tourUrl}`);

  // Wait for generation to finish
  try {
    await page.waitForSelector('text=Generando', { state: 'detached', timeout: 90000 });
    console.log('✅ San Telmo itinerary generation completed successfully!');
  } catch (e) {
    console.log('Generation completed or status updated.');
  }

  await sleep(3000);

  console.log('👀 Exploring tour details and map view...');
  const mapToggle = page.getByText(/Mapa|Ver Mapa/i).first();
  if (await mapToggle.isVisible()) {
    await humanClick(page, mapToggle);
    await sleep(3000);
  }

  console.log('🌟 Demo execution completed! Chrome is staying open on your screen.');
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Demo error:', err);
});
