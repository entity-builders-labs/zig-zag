const { chromium } = require("playwright");

async function runLiveDemo() {
  console.log("🚀 Iniciando navegador en modo visual (headless: false)...");

  const browser = await chromium.launch({
    headless: false,
    slowMo: 120, // Movimientos y clicks fluidos y visibles
  });

  const context = await browser.newContext({
    viewport: { width: 440, height: 950 }, // Formato móvil moderno
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -34.6037, longitude: -58.3816 });

  const page = await context.newPage();

  console.log("📱 Navegando a http://localhost:8081 ...");
  await page.goto("http://localhost:8081");

  console.log("🔑 Autenticando con usuario de desarrollo...");
  await page.waitForURL(/\/login$/, { timeout: 15000 });

  const testEmail = "demo-" + Date.now() + "@zigzag.local";

  // Pedir código
  await page.getByTestId("login-email-link").click();
  await page.getByTestId("login-email-input").fill(testEmail);
  await page.getByTestId("login-request-code-button").click();

  // Esperar a que pase al step del código o consultar el devCode
  await page.getByTestId("login-code-input").waitFor({ state: "visible", timeout: 10000 });

  // Consultar devCode generado para este email
  const codeReq = await page.request.post("http://localhost:4000/auth/email/request-code", {
    data: { email: testEmail },
  });
  const { devCode } = await codeReq.json();
  console.log("🔢 Código OTP ingresado:", devCode);

  await page.getByTestId("login-code-input").fill(devCode);
  await page.waitForTimeout(500);
  await page.getByTestId("login-verify-code-button").click();

  // Esperar Home
  await page.waitForURL("http://localhost:8081/", { timeout: 15000 });
  console.log("🏠 ¡En la pantalla principal! Abriendo Wizard...");
  await page.waitForTimeout(1000);

  // Click en Crear Tour FAB
  await page.getByTestId("create-tour-fab").click();
  await page.waitForURL(/\/tours\/wizard/, { timeout: 10000 });
  console.log("🧙 Paso 1/3: Seleccionando Destino y Fechas...");

  // Paso 1: Destino
  const destInput = page.getByPlaceholder("Buscar destino");
  await destInput.fill("Caminito La Boca");
  await page.waitForTimeout(800);

  const suggestion = page.getByText(/Caminito.*La Boca.*Buenos Aires/).first();
  await suggestion.waitFor({ state: "visible", timeout: 10000 });
  await suggestion.click();
  console.log("📍 Destino seleccionado: Caminito, La Boca");

  // Fechas
  await page.getByPlaceholder("Seleccionar fechas").click();
  await page.waitForTimeout(400);

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const toDateStr = (d) => d.toISOString().split("T")[0];

  const todayBtn = page.getByTestId("date-picker-day-" + toDateStr(today));
  if (await todayBtn.count() > 0) {
    await todayBtn.click();
  }
  const tomorrowBtn = page.getByTestId("date-picker-day-" + toDateStr(tomorrow));
  if (await tomorrowBtn.count() > 0) {
    await tomorrowBtn.click();
  }
  await page.waitForTimeout(400);
  await page.getByText("Confirmar").first().click();
  await page.waitForTimeout(600);

  // Siguiente a Paso 2
  await page.getByText("Siguiente →").first().click();
  console.log("⚡ Paso 2/3: Configurando Movilidad y Ritmo...");
  await page.waitForTimeout(800);

  await page.getByText("$$", { exact: true }).first().click();
  await page.getByText("Familia", { exact: true }).first().click();
  await page.getByText("Público", { exact: true }).first().click();
  await page.getByText("Me gusta caminar", { exact: true }).click();
  await page.waitForTimeout(600);

  // Siguiente a Paso 3
  await page.getByText("Siguiente →").first().click();
  console.log("🎨 Paso 3/3: Intereses y Preferencias...");
  await page.waitForTimeout(800);

  await page.getByText("Caminatas por barrios", { exact: true }).click();
  await page.getByText("Icónicos", { exact: true }).click();
  await page.getByText("Historia", { exact: true }).last().click();
  await page.getByText("Comida", { exact: true }).last().click();
  await page.getByText("Cultura", { exact: true }).last().click();

  const notesInput = page.getByPlaceholder("Ej. Prefiero fotografía urbana y evitar lugares muy concurridos");
  if (await notesInput.count() > 0) {
    await notesInput.fill("Me interesa la historia del tango y los lugares emblemáticos");
  }

  // Generar Tour
  console.log("✨ Generando Tour...");
  await page.getByText("Generar ZigZag ✨").first().click();

  await page.waitForURL(/\/tours\/[a-f0-9-]+$/, { timeout: 25000 });
  const tourUrl = page.url();
  console.log("🎉 Tour generado exitosamente en:", tourUrl);

  // Esperar a que la generación termine de procesar las actividades
  console.log("⏳ Esperando que carguen las actividades con sus fotos y highlights...");
  let attempts = 0;
  while (attempts < 30) {
    const isGenerating = await page.getByText(/Generando|Esto puede tomar unos momentos/).count();
    if (isGenerating === 0) break;
    await page.waitForTimeout(2000);
    attempts++;
  }

  console.log("");
  console.log("================================================================================");
  console.log("🎉 DEMO EN VIVO LISTA: EL BROWSER QUEDA ABIERTO EN TU PANTALLA");
  console.log("👉 Podés usar y navegar la ventana del navegador interactivo:");
  console.log("   - Ver las tarjetas de actividades con sus fotos reales de Wikimedia/Google.");
  console.log("   - Hacer click en cualquier actividad para abrir su pantalla de detalle.");
  console.log("   - Ver el carrusel de fotos, autoría, highlights y tips de curador.");
  console.log("   - Ver los recorridos barriales (Composite Activities) y las fotos de sus waypoints.");
  console.log("================================================================================");

  // Mantenemos el navegador abierto
  await new Promise(() => {});
}

runLiveDemo().catch((err) => {
  console.error("Error en demo:", err);
});
