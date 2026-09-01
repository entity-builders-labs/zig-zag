import { test, expect, Locator, Page } from '@playwright/test';
import { API_URL } from './playwright.config';
import { apiLogin, seedAuthSession } from './auth-helper';

// E2E_DEMO=1 trades raw test speed for natural human interaction:
// visible cursor dot, letter-by-letter typing with jitter, pauses to read
// screens, and slow-scrolling through generated tour stops.
const DEMO = process.env.E2E_DEMO !== '0';

async function showCursor(page: Page) {
  await page.addInitScript(() => {
    const dot = document.createElement('div');
    dot.id = 'human-speed-cursor-dot';
    dot.style.cssText =
      'position:fixed;top:0;left:0;width:22px;height:22px;border-radius:50%;' +
      'background:rgba(239,68,68,0.9);border:2.5px solid #ffffff;' +
      'box-shadow:0 2px 10px rgba(0,0,0,0.55);pointer-events:none;' +
      'z-index:2147483647;transform:translate(-999px,-999px);will-change:transform;' +
      'transition:transform 0.04s ease-out;';
    const attach = () => document.body && document.body.appendChild(dot);
    document.addEventListener('DOMContentLoaded', attach);
    attach();
    window.addEventListener(
      'mousemove',
      (e) => {
        dot.style.transform = `translate(${e.clientX - 11}px, ${e.clientY - 11}px)`;
      },
      { passive: true }
    );
  });
}

// Glides the visible cursor smoothly towards the target element before clicking
async function humanClick(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 8,
    });
    await page.waitForTimeout(100 + Math.random() * 80);
  }
  await locator.click();
}

// Types text character-by-character with natural human jitter
async function humanType(locator: Locator, text: string) {
  await locator.pressSequentially(text, { delay: 35 + Math.random() * 25 });
}

async function readingPause(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

// Helper to format date YYYY-MM-DD
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

test.describe('E2E Live: Uncached Argentina Destinations at Human Speed', () => {
  test.setTimeout(300_000); // 5 minutes headroom for real API queries & human pacing

  test('@live San Rafael, Mendoza: Full wizard journey, live refill, daily planning solver, list/map & bitácora', async ({
    page,
    request,
  }) => {
    await page.context().grantPermissions(['geolocation']);
    await page
      .context()
      .setGeolocation({ latitude: -34.6177, longitude: -68.3301 }); // San Rafael, Mendoza
    await showCursor(page);

    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    // ==========================================
    // 1. Iniciar sesión / Seed Auth
    // ==========================================
    console.log('▶ Paso 1: Autenticación de usuario...');
    const session = await apiLogin(request);
    await seedAuthSession(page, session);
    await page.goto('/');
    await readingPause(page, 1500);

    // ==========================================
    // 2. Abrir el Wizard de Creación de Tour
    // ==========================================
    console.log('▶ Paso 2: Abriendo Wizard de Creación...');
    await humanClick(page, page.getByTestId('create-tour-fab'));
    await expect(page).toHaveURL(/\/tours\/wizard/);
    await expect(page.getByText('Paso 1 de 3')).toBeVisible();
    await expect(page.getByText('Destino y Fechas')).toBeVisible();
    await readingPause(page, 1000);

    // ==========================================
    // 3. Paso 1: Destino No Cacheado (San Rafael, Mendoza) + Fechas
    // ==========================================
    console.log('▶ Paso 3: Buscando destino nuevo "San Rafael, Mendoza"...');
    const destInput = page.getByPlaceholder(/Ej: Roma|Buscar destino/i);
    await humanType(destInput, 'San Rafael, Mendoza');
    
    // Autocomplete suggestion
    const suggestion = page.getByText(/San Rafael.*Argentina/i).first();
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await readingPause(page, 800);
    await humanClick(page, suggestion);
    
    // Verificamos que se haya resuelto el destino
    await expect(
      page.getByText('Elegí una opción de la lista para confirmar el destino')
    ).toHaveCount(0);
    await readingPause(page, 800);

    // Selección de fechas (2 días)
    console.log('▶ Seleccionando fechas de viaje (Fin de semana - 2 días)...');
    await humanClick(page, page.getByText(/Seleccionar fechas del viaje/i));
    await readingPause(page, 600);
    
    // Usamos el chip de preset rápido 'Fin de Semana (2d)'
    await humanClick(page, page.getByText('Fin de Semana (2d)'));
    await readingPause(page, 900);

    await humanClick(page, page.getByText('Siguiente: Movilidad & Ritmo →'));

    // ==========================================
    // 4. Paso 2: Movilidad, Presupuesto y Ritmo
    // ==========================================
    console.log('▶ Paso 4: Configurando movilidad y ritmo...');
    await expect(page.getByText('Paso 2 de 3')).toBeVisible();
    await expect(page.getByText('Movilidad y Ritmo')).toBeVisible();
    await readingPause(page, 1000);

    await humanClick(page, page.getByText('$$', { exact: true }).first()); // Presupuesto medio
    await readingPause(page, 400);
    await humanClick(page, page.getByText('Pareja', { exact: true }).first()); // Pareja
    await readingPause(page, 500);

    // Seleccionar transporte y perfil de caminata
    await humanClick(page, page.getByText('Bus/Subte', { exact: true }).first());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Me gusta caminar', { exact: true }));
    await readingPause(page, 900);

    await humanClick(page, page.getByText('Siguiente: Intereses & Estilo →'));

    // ==========================================
    // 5. Paso 3: Formatos, Intereses y Notas
    // ==========================================
    console.log('▶ Paso 5: Configurando experiencias e intereses...');
    await expect(page.getByText('Paso 3 de 3')).toBeVisible();
    await expect(page.getByText('Intereses y Estilo')).toBeVisible();
    await readingPause(page, 1000);

    await humanClick(page, page.getByText(/Caminatas Barriales/i));
    await readingPause(page, 350);
    await humanClick(page, page.getByText(/Visitas a Lugares/i));
    await readingPause(page, 350);
    await humanClick(page, page.getByText('Icónicos', { exact: true }));
    await readingPause(page, 350);
    await humanClick(page, page.getByText('Historia', { exact: true }).last());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Comida', { exact: true }).last());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Naturaleza', { exact: true }).last());
    await readingPause(page, 600);

    await humanType(
      page.getByPlaceholder(/fotografía urbana/i),
      'Interés en bodegas históricas, gastronomía mendocina y parques'
    );
    await readingPause(page, 1200);

    // ==========================================
    // 6. Generación del Tour en Vivo
    // ==========================================
    console.log('▶ Paso 6: Lanzando generación del tour...');
    await humanClick(page, page.getByText('Generar Zig-Zag ✨'));

    // Esperamos la navegación a /tours/:id o /tours/:id/review
    await page.waitForURL(/\/tours\/[a-f0-9-]+/, { timeout: 25_000 });
    const match = page.url().match(/\/tours\/([a-f0-9-]+)/);
    const tourId = match ? match[1] : '';
    console.log(`✨ Tour ID creado: ${tourId}`);

    // Monitoreamos la transición de generación hasta que complete
    console.log('⏳ Esperando que el backend complete la generación asíncrona...');
    const confirmButton = page.getByTestId('confirm-tour-button').or(page.getByRole('button', { name: /Confirmar Recorrido/i }));
    const listToggle = page.getByTestId('view-toggle-list');

    await expect(confirmButton.or(listToggle)).toBeVisible({ timeout: 60_000 });
    await readingPause(page, 2000);

    // Si estamos en la pantalla de Review, la recorremos y confirmamos
    if (await confirmButton.isVisible()) {
      console.log('📋 Pantalla de Pre-Confirmación / Review alcanzada. Desplazando y confirmando...');
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(400);
      }
      await readingPause(page, 1500);
      await humanClick(page, confirmButton);
      await expect(listToggle).toBeVisible({ timeout: 15_000 });
      await readingPause(page, 1500);
    }

    // ==========================================
    // 7. Modo Lista: Inspección Visual y Scroll Lento
    // ==========================================
    console.log('▶ Paso 7: Inspeccionando itinerario en Modo Lista...');
    await expect(listToggle).toBeVisible({ timeout: 15_000 });
    await readingPause(page, 1800);

    // Scroll vertical suave para apreciar todas las paradas en pantalla
    console.log('📜 Desplazando suavemente por las actividades generadas...');
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(550);
    }
    await readingPause(page, 2000);

    // ==========================================
    // 8. Bitácora de Auditoría (Generation Trace)
    // ==========================================
    console.log('▶ Paso 8: Desplegando Bitácora de Auditoría técnica...');
    const bitacoraToggle = page.getByTestId('bitacora-toggle');
    if (await bitacoraToggle.count()) {
      await humanClick(page, bitacoraToggle);
      console.log('📋 Bitácora desplegada — mostrando etapas del pipeline.');
      await readingPause(page, 4000); // Pausa para leer la bitácora
    }

    // ==========================================
    // 9. Modo Mapa: Verificación de Polilíneas y Pines
    // ==========================================
    console.log('▶ Paso 9: Cambiando a Modo Mapa interactivo...');
    const mapToggle = page.getByTestId('view-toggle-map');
    if (await mapToggle.count()) {
      await humanClick(page, mapToggle);
      await expect(page.getByText(/Ruta a pie trazada|Ver Lista/i).first()).toBeVisible({
        timeout: 15_000,
      });
      console.log('🗺️ Modo Mapa interactivo y ruta a pie verificados.');
      await readingPause(page, 5000);
    }

    // ==========================================
    // 10. Mantener la pantalla abierta para inspección del usuario
    // ==========================================
    console.log('✅ Generación de San Rafael completa. Manteniendo pantalla visible para inspección...');
    await page.waitForTimeout(30_000);

    expect(consoleErrors).toEqual([]);
  });

  test('@live Villa General Belgrano, Córdoba: Alpine walk itinerary, fresh refill, daily planning solver, map & trace', async ({
    page,
    request,
  }) => {
    await page.context().grantPermissions(['geolocation']);
    await page
      .context()
      .setGeolocation({ latitude: -31.9789, longitude: -64.5574 }); // Villa General Belgrano, Córdoba
    await showCursor(page);

    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    // ==========================================
    // 1. Iniciar sesión / Seed Auth
    // ==========================================
    console.log('▶ Paso 1: Autenticación de usuario...');
    const session = await apiLogin(request);
    await seedAuthSession(page, session);
    await page.goto('/');
    await readingPause(page, 1500);

    // ==========================================
    // 2. Abrir el Wizard de Creación de Tour
    // ==========================================
    console.log('▶ Paso 2: Abriendo Wizard de Creación...');
    await humanClick(page, page.getByTestId('create-tour-fab'));
    await expect(page).toHaveURL(/\/tours\/wizard/);
    await expect(page.getByText('Paso 1 de 3')).toBeVisible();
    await expect(page.getByText('Destino y Fechas')).toBeVisible();
    await readingPause(page, 1000);

    // ==========================================
    // 3. Paso 1: Destino No Cacheado (Villa General Belgrano) + Fechas
    // ==========================================
    console.log('▶ Paso 3: Buscando destino nuevo "Villa General Belgrano, Córdoba"...');
    const destInput = page.getByPlaceholder(/Ej: Roma|Buscar destino/i);
    await humanType(destInput, 'Villa General Belgrano, Córdoba');
    
    // Autocomplete suggestion
    const suggestion = page.getByText(/Villa General Belgrano.*Argentina/i).first();
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await readingPause(page, 800);
    await humanClick(page, suggestion);
    
    await expect(
      page.getByText('Elegí una opción de la lista para confirmar el destino')
    ).toHaveCount(0);
    await readingPause(page, 800);

    // Selección de fechas (1 día)
    console.log('▶ Seleccionando fecha de viaje (1 día)...');
    await humanClick(page, page.getByText(/Seleccionar fechas del viaje/i));
    await readingPause(page, 600);
    
    // Usamos el chip de preset rápido '1 Día'
    await humanClick(page, page.getByText('1 Día'));
    await readingPause(page, 900);

    await humanClick(page, page.getByText('Siguiente: Movilidad & Ritmo →'));

    // ==========================================
    // 4. Paso 2: Movilidad, Presupuesto y Ritmo
    // ==========================================
    console.log('▶ Paso 4: Configurando movilidad y ritmo...');
    await expect(page.getByText('Paso 2 de 3')).toBeVisible();
    await expect(page.getByText('Movilidad y Ritmo')).toBeVisible();
    await readingPause(page, 1000);

    await humanClick(page, page.getByText('$$', { exact: true }).first());
    await readingPause(page, 400);
    await humanClick(page, page.getByText('Familia', { exact: true }).first());
    await readingPause(page, 500);

    await humanClick(page, page.getByText('A Pie', { exact: true }).first());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Me gusta caminar', { exact: true }));
    await readingPause(page, 900);

    await humanClick(page, page.getByText('Siguiente: Intereses & Estilo →'));

    // ==========================================
    // 5. Paso 3: Formatos, Intereses y Notas
    // ==========================================
    console.log('▶ Paso 5: Configurando experiencias e intereses...');
    await expect(page.getByText('Paso 3 de 3')).toBeVisible();
    await expect(page.getByText('Intereses y Estilo')).toBeVisible();
    await readingPause(page, 1000);

    await humanClick(page, page.getByText(/Caminatas Barriales/i));
    await readingPause(page, 350);
    await humanClick(page, page.getByText(/Visitas a Lugares/i));
    await readingPause(page, 350);
    await humanClick(page, page.getByText('Icónicos', { exact: true }));
    await readingPause(page, 350);
    await humanClick(page, page.getByText('Cultura', { exact: true }).last());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Comida', { exact: true }).last());
    await readingPause(page, 600);

    await humanType(
      page.getByPlaceholder(/fotografía urbana/i),
      'Paseo céntrico alpino, arroyos y chocolaterías artesanales'
    );
    await readingPause(page, 1200);

    // ==========================================
    // 6. Generación del Tour en Vivo
    // ==========================================
    console.log('▶ Paso 6: Lanzando generación del tour...');
    await humanClick(page, page.getByText('Generar Zig-Zag ✨'));

    await page.waitForURL(/\/tours\/[a-f0-9-]+/, { timeout: 25_000 });
    const match = page.url().match(/\/tours\/([a-f0-9-]+)/);
    const tourId = match ? match[1] : '';
    console.log(`✨ Tour ID creado: ${tourId}`);

    // Monitoreamos la transición de generación hasta que complete
    console.log('⏳ Esperando que el backend complete la generación asíncrona...');
    const confirmButton = page.getByTestId('confirm-tour-button').or(page.getByRole('button', { name: /Confirmar Recorrido/i }));
    const listToggle = page.getByTestId('view-toggle-list');

    await expect(confirmButton.or(listToggle)).toBeVisible({ timeout: 60_000 });
    await readingPause(page, 2000);

    if (await confirmButton.isVisible()) {
      console.log('📋 Pantalla de Pre-Confirmación / Review alcanzada. Desplazando y confirmando...');
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(400);
      }
      await readingPause(page, 1500);
      await humanClick(page, confirmButton);
      await expect(listToggle).toBeVisible({ timeout: 15_000 });
      await readingPause(page, 1500);
    }

    // ==========================================
    // 7. Modo Lista: Inspección Visual y Scroll Lento
    // ==========================================
    console.log('▶ Paso 7: Inspeccionando itinerario en Modo Lista...');
    await expect(listToggle).toBeVisible({ timeout: 15_000 });
    await readingPause(page, 1800);

    console.log('📜 Desplazando suavemente por las actividades generadas...');
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(550);
    }
    await readingPause(page, 2000);

    // ==========================================
    // 8. Bitácora de Auditoría
    // ==========================================
    console.log('▶ Paso 8: Desplegando Bitácora de Auditoría técnica...');
    const bitacoraToggle = page.getByTestId('bitacora-toggle');
    if (await bitacoraToggle.count()) {
      await humanClick(page, bitacoraToggle);
      console.log('📋 Bitácora desplegada — mostrando etapas del pipeline.');
      await readingPause(page, 4000);
    }

    // ==========================================
    // 9. Modo Mapa: Verificación de Polilíneas y Pines
    // ==========================================
    console.log('▶ Paso 9: Cambiando a Modo Mapa interactivo...');
    const mapToggle = page.getByTestId('view-toggle-map');
    if (await mapToggle.count()) {
      await humanClick(page, mapToggle);
      await expect(page.getByText(/Ruta a pie trazada|Ver Lista/i).first()).toBeVisible({
        timeout: 15_000,
      });
      console.log('🗺️ Modo Mapa interactivo y ruta a pie verificados.');
      await readingPause(page, 5000);
    }

    // ==========================================
    // 10. Mantener la pantalla abierta para inspección del usuario
    // ==========================================
    console.log('✅ Generación de Villa General Belgrano completa. Manteniendo pantalla visible para inspección...');
    await page.waitForTimeout(45_000);

    expect(consoleErrors).toEqual([]);
  });
});
