import { test, expect, Locator, Page } from '@playwright/test';
import { apiLogin, seedAuthSession } from './auth-helper';

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

async function humanClick(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 8,
    });
    await page.waitForTimeout(120 + Math.random() * 80);
  }
  await locator.click();
}

async function humanType(locator: Locator, text: string) {
  await locator.pressSequentially(text, { delay: 40 + Math.random() * 20 });
}

async function readingPause(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

test.describe('E2E Live: Gualeguaychú con Experiencias (Headed Demo)', () => {
  // Sin timeout para mantener la ventana abierta indefinidamente para el usuario
  test.setTimeout(0);

  test('@live Gualeguaychú, Entre Ríos: Experiencias, caminatas, carnaval, solver y bitácora en vivo', async ({
    page,
    request,
  }) => {
    await page.context().grantPermissions(['geolocation']);
    await page
      .context()
      .setGeolocation({ latitude: -33.0094, longitude: -58.5172 }); // Gualeguaychú, Entre Ríos
    await showCursor(page);

    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    // ==========================================
    // 1. Iniciar sesión / Seed Auth
    // ==========================================
    console.log('\n🔑 Paso 1: Autenticación de usuario...');
    const session = await apiLogin(request);
    await seedAuthSession(page, session);
    await page.goto('/');
    console.log(`✅ Usuario autenticado: ${session.email}`);
    await readingPause(page, 1500);

    // ==========================================
    // 2. Abrir el Wizard de Creación de Tour
    // ==========================================
    console.log('🧙 Paso 2: Abriendo Wizard de Creación...');
    await humanClick(page, page.getByTestId('create-tour-fab'));
    await expect(page).toHaveURL(/\/tours\/wizard/);
    await expect(page.getByText('Paso 1 de 3')).toBeVisible();
    await expect(page.getByText('Destino y Fechas')).toBeVisible();
    await readingPause(page, 1000);

    // ==========================================
    // 3. Paso 1: Destino Gualeguaychú + Fechas (2 Días)
    // ==========================================
    console.log('📍 Paso 3: Buscando destino "Gualeguaychú, Entre Ríos"...');
    const destInput = page.getByPlaceholder(/Ej: Roma|Buscar destino/i);
    await humanType(destInput, 'Gualeguaychú, Entre Ríos');

    const suggestion = page.getByText(/Gualeguaychú.*Argentina/i).or(page.getByText(/Gualeguaychú/i)).first();
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await readingPause(page, 800);
    await humanClick(page, suggestion);

    await expect(
      page.getByText('Elegí una opción de la lista para confirmar el destino')
    ).toHaveCount(0);
    await readingPause(page, 800);

    console.log('📅 Seleccionando 2 días de itinerario...');
    await humanClick(page, page.getByText(/Seleccionar fechas del viaje/i));
    await readingPause(page, 600);

    const twoDaysChip = page.getByText('2 Días');
    if (await twoDaysChip.isVisible()) {
      await humanClick(page, twoDaysChip);
    } else {
      await humanClick(page, page.getByText('1 Día'));
    }
    await readingPause(page, 900);

    await humanClick(page, page.getByText('Siguiente: Movilidad & Ritmo →'));

    // ==========================================
    // 4. Paso 2: Movilidad, Presupuesto y Ritmo
    // ==========================================
    console.log('🚶 Paso 4: Configurando movilidad y ritmo...');
    await expect(page.getByText('Paso 2 de 3')).toBeVisible();
    await expect(page.getByText('Movilidad y Ritmo')).toBeVisible();
    await readingPause(page, 1000);

    await humanClick(page, page.getByText('$$', { exact: true }).first());
    await readingPause(page, 400);

    const parejaOption = page.getByText('Pareja', { exact: true }).first();
    if (await parejaOption.isVisible()) {
      await humanClick(page, parejaOption);
    } else {
      await humanClick(page, page.getByText('Familia', { exact: true }).first());
    }
    await readingPause(page, 500);

    await humanClick(page, page.getByText('A Pie', { exact: true }).first());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Me gusta caminar', { exact: true }));
    await readingPause(page, 900);

    await humanClick(page, page.getByText('Siguiente: Intereses & Estilo →'));

    // ==========================================
    // 5. Paso 3: Formatos, Intereses y Notas
    // ==========================================
    console.log('🎨 Paso 5: Configurando formatos de experiencia e intereses...');
    await expect(page.getByText('Paso 3 de 3')).toBeVisible();
    await expect(page.getByText('Intereses y Estilo')).toBeVisible();
    await readingPause(page, 1000);

    // Seleccionamos múltiples formatos incluyendo Experiencias
    const expChip = page.getByText(/Experiencias/i).first();
    if (await expChip.isVisible()) {
      await humanClick(page, expChip);
      await readingPause(page, 350);
    }
    const walkChip = page.getByText(/Caminatas Barriales/i).first();
    if (await walkChip.isVisible()) {
      await humanClick(page, walkChip);
      await readingPause(page, 350);
    }
    const routeChip = page.getByText(/Rutas Temáticas/i).first();
    if (await routeChip.isVisible()) {
      await humanClick(page, routeChip);
      await readingPause(page, 350);
    }
    const visitChip = page.getByText(/Visitas a Lugares/i).first();
    if (await visitChip.isVisible()) {
      await humanClick(page, visitChip);
      await readingPause(page, 350);
    }

    // Intereses
    await humanClick(page, page.getByText('Naturaleza', { exact: true }).last());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Cultura', { exact: true }).last());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Comida', { exact: true }).last());
    await readingPause(page, 300);
    await humanClick(page, page.getByText('Icónicos', { exact: true }));
    await readingPause(page, 500);

    console.log('✍️ Ingresando notas de preferencias para Gualeguaychú...');
    await humanType(
      page.getByPlaceholder(/fotografía urbana/i),
      'Costanera sobre el río Gualeguaychú, corsódromo / carnaval del país, termas y gastronomía entrerriana'
    );
    await readingPause(page, 1200);

    // ==========================================
    // 6. Generación del Tour en Vivo con SSE
    // ==========================================
    console.log('✨ Paso 6: Lanzando generación del tour...');
    await humanClick(page, page.getByText('Generar Zig-Zag ✨'));

    await page.waitForURL(/\/tours\/[a-f0-9-]+/, { timeout: 35_000 });
    const match = page.url().match(/\/tours\/([a-f0-9-]+)/);
    const tourId = match ? match[1] : '';
    console.log(`🎯 Tour ID creado: ${tourId}`);

    console.log('⏳ Esperando que el backend complete la generación asíncrona y sincronice via SSE...');
    const confirmButton = page.getByTestId('confirm-tour-button').or(page.getByRole('button', { name: /Confirmar Recorrido/i }));
    const listToggle = page.getByTestId('view-toggle-list');

    await expect(confirmButton.or(listToggle)).toBeVisible({ timeout: 120_000 });
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
    // 7. Modo Lista: Inspección Visual y Scroll Suave
    // ==========================================
    console.log('📋 Paso 7: Inspeccionando itinerario en Modo Lista...');
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
    console.log('🔍 Paso 8: Desplegando Bitácora de Auditoría técnica...');
    const bitacoraToggle = page.getByTestId('bitacora-toggle');
    if (await bitacoraToggle.count()) {
      await humanClick(page, bitacoraToggle);
      console.log('📋 Bitácora desplegada — mostrando etapas del pipeline.');
      await readingPause(page, 5000);
    }

    // ==========================================
    // 9. Modo Mapa: Verificación de Polilíneas y Pines
    // ==========================================
    console.log('🗺️ Paso 9: Cambiando a Modo Mapa interactivo...');
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
    console.log('\n================================================================');
    console.log('🎉 Generación de Gualeguaychú completa.');
    console.log('🖥️ El navegador permanecerá abierto para que puedas interactuar libremente.');
    console.log('================================================================\n');

    // Espera prolongada (30 min) para que el usuario explore la UI sin que se cierre
    await page.waitForTimeout(1_800_000);

    expect(consoleErrors).toEqual([]);
  });
});
