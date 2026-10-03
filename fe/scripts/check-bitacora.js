const { chromium } = require('playwright');

async function testBitacora() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    permissions: ['geolocation'],
    geolocation: { latitude: -34.6037, longitude: -58.3816 },
  });
  const page = await context.newPage();

  console.log('🌐 Opening http://localhost:19006...');
  await page.goto('http://localhost:19006');
  await page.waitForTimeout(1500);

  // Click email button if on login screen
  const emailLink = page.getByTestId('login-email-link');
  if (await emailLink.count() > 0) {
    console.log('🔑 Logging in as owner...');
    await emailLink.click();
    await page.waitForTimeout(800);

    const testEmail = 'tango-1787960317464@zigzag.travel';
    const emailInput = page.getByTestId('login-email-input');
    await emailInput.fill(testEmail);
    await page.getByTestId('login-request-code-button').click();
    await page.waitForTimeout(1200);

    const devCodeBox = page.getByText(/Modo desarrollo — código: \d{6}/);
    await devCodeBox.waitFor({ state: 'visible', timeout: 10000 });
    const codeText = await devCodeBox.textContent();
    const code = codeText?.match(/\d{6}/)?.[0] || '123456';

    const codeInput = page.getByTestId('login-code-input');
    await codeInput.fill(code);
    await page.getByTestId('login-verify-code-button').click();
    await page.waitForTimeout(2000);
  }

  console.log('📍 Navigating to tour detail...');
  await page.goto('http://localhost:19006/tours/d8b71db3-38f2-43c8-8b58-f9427a8a77f3');
  await page.waitForTimeout(2500);

  console.log('👉 Expanding Bitácora...');
  const bitacoraToggle = page.getByTestId('bitacora-toggle');
  await bitacoraToggle.waitFor({ state: 'visible', timeout: 10000 });
  await bitacoraToggle.click();
  await page.waitForTimeout(1000);

  // Expand Step 1 candidates
  const stepBtn = page.getByText(/13 candidatos/i).first();
  if (await stepBtn.count() > 0) {
    await stepBtn.click();
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: 'scripts/bitacora-actors-preview.png', fullPage: false });
  console.log('📸 Screenshot saved: scripts/bitacora-actors-preview.png');
  await browser.close();
}

testBitacora().catch(console.error);
