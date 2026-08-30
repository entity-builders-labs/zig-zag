import { test, expect } from "@playwright/test";
import { loginViaUI } from "./auth-helper";

test("@interactive Tour generation with rich photos and highlights", async ({
  page,
}) => {
  test.setTimeout(0); // Sin límite de tiempo, queda abierto

  await page.context().grantPermissions(["geolocation"]);
  await page
    .context()
    .setGeolocation({ latitude: -34.6037, longitude: -58.3816 });

  console.log("🔑 Autenticando en la app...");
  await loginViaUI(page);
  console.log("🏠 ¡En pantalla principal! Abriendo Wizard...");
  await page.waitForTimeout(1000);

  // Click en Crear Tour FAB
  await page.getByTestId("create-tour-fab").click();
  await expect(page).toHaveURL(/\/tours\/wizard/);
  console.log("🧙 Paso 1/3: Destino y Fechas...");

  // Paso 1: Destino
  await page.getByPlaceholder("Buscar destino").fill("Caminito La Boca");
  const suggestion = page.getByText(/Caminito.*La Boca.*Buenos Aires/).first();
  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  await suggestion.click();
  console.log("📍 Destino seleccionado: Caminito, La Boca");

  // Fechas
  await page.getByPlaceholder("Seleccionar fechas").click();
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const toDateStr = (d: Date) => d.toISOString().split("T")[0];

  await page.getByTestId(`date-picker-day-${toDateStr(today)}`).click();
  await page.getByTestId(`date-picker-day-${toDateStr(tomorrow)}`).click();
  await page.getByText("Confirmar").first().click();
  await page.waitForTimeout(500);

  await page.getByText("Siguiente →").first().click();

  // Paso 2: Movilidad
  console.log("⚡ Paso 2/3: Movilidad y ritmo...");
  await page.getByText("$$", { exact: true }).first().click();
  await page.getByText("Familia", { exact: true }).first().click();
  await page.getByText("Público", { exact: true }).first().click();
  await page.getByText("Me gusta caminar", { exact: true }).click();
  await page.waitForTimeout(500);

  await page.getByText("Siguiente →").first().click();

  // Paso 3: Intereses
  console.log("🎨 Paso 3/3: Intereses y experiencias...");
  await page.getByText("Caminatas por barrios", { exact: true }).click();
  await page.getByText("Icónicos", { exact: true }).click();
  await page.getByText("Historia", { exact: true }).last().click();
  await page.getByText("Comida", { exact: true }).last().click();
  await page.getByText("Cultura", { exact: true }).last().click();

  const notesInput = page.getByPlaceholder(
    "Ej. Prefiero fotografía urbana y evitar lugares muy concurridos"
  );
  if ((await notesInput.count()) > 0) {
    await notesInput.fill(
      "Me interesa la historia del tango y los lugares emblemáticos"
    );
  }

  // Generar Tour
  console.log("✨ Generando Tour...");
  await page.getByText("Generar ZigZag ✨").first().click();

  await page.waitForURL(/\/tours\/[a-f0-9-]+$/, { timeout: 30_000 });
  console.log("🎉 Tour generado en:", page.url());

  // Esperar a que la generación termine de procesar las actividades
  console.log("⏳ Esperando que carguen las actividades con sus fotos y highlights...");
  let attempts = 0;
  while (attempts < 25) {
    const isGenerating = await page
      .getByText(/Generando|Esto puede tomar unos momentos/)
      .count();
    if (isGenerating === 0) break;
    await page.waitForTimeout(2000);
    attempts++;
  }

  console.log("");
  console.log("================================================================================");
  console.log("🎉 DEMO EN VIVO LISTA: EL NAVEGADOR QUEDA ABIERTO EN TU PANTALLA");
  console.log("👉 Podés usar y navegar el tour en la ventana de Chromium:");
  console.log("   - Hacer click en cualquier actividad para abrir su pantalla de detalle.");
  console.log("   - Ver el carrusel de fotos reales de Wikimedia Commons / Google Maps.");
  console.log("   - Ver los highlights y el tip de curador.");
  console.log("   - Ver las actividades compuestas (Caminatas barriales) y las fotos de sus waypoints.");
  console.log("================================================================================");
  console.log("");

  // Mantener abierto para navegación del usuario
  await new Promise(() => {});
});
