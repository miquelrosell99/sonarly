// Bridge fixture spec — proves the shadcn bridge COMPUTED-BEHAVIORALLY, not
// just by token reference (rosellramos-design-system components/shadcn-bridge.md
// "CI fixture"). Adapted from the skill's assets/templates/bridge-fixture.spec.ts
// template to sonarly's canonical seam and registers:
//   - the appearance seam is the data-attribute trio (data-theme /
//     data-accent / data-oled), and 'green' is one of the curated accents
//   - sonarly's role tokens are HSL triplets (e.g. "26 69% 36%"), so token
//     reads convert to rgb before comparison with computed styles
//   - sonarly's hover register is the solid surface step
//     (--md-sys-color-surface-container-high), not the overlay ink
//   - the scrim is black at 60% (bg-black/60 convention; --md-sys-color-scrim
//     carries the hue at full alpha)
// The spec needs the dev server (baseURL below); the fixture page is
// auth-free by design (web/src/pages/DesignBridgeFixture.tsx).
import { test, expect } from '@playwright/test';

const FIXTURE = '/__design-bridge-fixture';

function normalize(color: string) {
  // rgb(r, g, b) → r,g,b for cross-format comparison
  return color.replace(/rgba?\(|\)|\s/g, '');
}

async function token(page, name: string): Promise<string> {
  // Role tokens are HSL triplets that may chain through var() (on-primary →
  // the background role); let the BROWSER resolve the full chain via a probe
  // element instead of converting in the spec (avoids rounding drift).
  return page.evaluate((n) => {
    const probe = document.createElement('span');
    probe.style.color = `hsl(var(${n}))`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, name);
}

async function contrast(page, fg: string, bg: string): Promise<number | null> {
  return page.evaluate(([f, b]) => {
    const parse = (s: string) => {
      const m = s.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const A = parse(f);
    const B = parse(b);
    if (!A || !B) return null;
    const [l1, l2] = [lum(A), lum(B)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }, [fg, bg]);
}

async function themeMatrix(page) {
  const themes = [
    { theme: 'dark', accent: null, label: 'dark' },
    { theme: 'light', accent: null, label: 'light' },
    { theme: 'dark', accent: 'green', label: 'dark+accent-switch' },
  ];
  for (const t of themes) {
    await page.evaluate(([theme, accent]) => {
      document.documentElement.setAttribute('data-theme', theme);
      if (accent) document.documentElement.setAttribute('data-accent', accent);
      else document.documentElement.removeAttribute('data-accent');
    }, [t.theme, t.accent]);
    await page.waitForTimeout(400); // let the 150ms theme transition fully settle
    await runAssertions(page, t.label);
  }
}

async function runAssertions(page, label: string) {
  const primary = await token(page, '--md-sys-color-primary');
  const onPrimary = await token(page, '--md-sys-color-on-primary');
  const hoverSurface = await token(page, '--md-sys-color-surface-container-high');

  // 1. computed values resolve to tokens — a library default fails here
  const btnBg = await page
    .locator('[data-fix="btn-primary"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(normalize(btnBg), `${label}: primary button bg resolves to the seed`).toBe(normalize(primary));

  const btnColor = await page
    .locator('[data-fix="btn-primary"]')
    .evaluate((el) => getComputedStyle(el).color);
  expect(normalize(btnColor), `${label}: primary button fg resolves to on-primary`).toBe(normalize(onPrimary));

  // 2. contrast of the designed pair >= 4.5:1 in every theme
  const ratio = await contrast(page, btnColor, btnBg);
  expect(ratio, `${label}: primary/on-primary contrast >= 4.5 (got ${ratio?.toFixed(2)})`).toBeGreaterThanOrEqual(4.5);

  // 3. interaction states
  await page.locator('[data-fix="btn-outline"]').hover();
  await page.waitForTimeout(300); // the 150ms hover transition must fully settle
  const outlineHover = await page
    .locator('[data-fix="btn-outline"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(normalize(outlineHover), `${label}: hover is the app hover register (surface-container-high)`).toBe(normalize(hoverSurface));

  await page.locator('[data-fix="btn-primary"]').focus();
  const ring = await page.locator('[data-fix="btn-primary"]').evaluate((el) => {
    const s = getComputedStyle(el);
    return s.boxShadow || s.outline;
  });
  expect(ring, `${label}: focus ring present (never suppressed)`).not.toBe('none');

  const disabledOpacity = await page
    .locator('[data-fix="btn-disabled"]')
    .evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(disabledOpacity), `${label}: disabled visibly dimmed`).toBeLessThan(0.75);

  const busy = await page.locator('[data-fix="btn-loading"]').getAttribute('aria-busy');
  expect(busy, `${label}: loading state announces aria-busy`).toBe('true');

  // 4. dialog elevation + scrim. The dialog mounts closed (a modal overlay
  //    would block the button interactions above); open it for the probe.
  //    The backdrop is the overlay element that precedes the content inside
  //    the Radix portal.
  await page.locator('[data-fix="dialog-open"]').click();
  await page.locator('[data-fix="dialog"]').waitFor();
  const dialogShadow = await page
    .locator('[data-fix="dialog"]')
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(dialogShadow, `${label}: dialog shadow present (elevation)`).not.toBe('none');
  const backdropEl = await page.$('[data-fix="dialog"] >> xpath=preceding-sibling::*[1]');
  expect(backdropEl, `${label}: dialog backdrop renders`).toBeTruthy();
  const backdrop = await backdropEl!.evaluate((el) => getComputedStyle(el).backgroundColor);
  const backdropRgb = backdrop.replace(/rgba?\(([^,]+),([^,]+),([^,]+).*/, 'rgb($1,$2,$3)');
  const backdropAlpha = Number(backdrop.match(/\/\s*([\d.]+)\)|,\s*([\d.]+)\)$/)?.[1] ?? backdrop.match(/,\s*([\d.]+)\)$/)?.[1] ?? 1);
  expect(normalize(backdropRgb), `${label}: backdrop resolves to the scrim hue (black)`).toBe('0,0,0');
  expect(backdropAlpha, `${label}: backdrop is a translucent scrim (~60%)`).toBeGreaterThan(0.4);
  expect(backdropAlpha, `${label}: backdrop is a translucent scrim (~60%)`).toBeLessThan(0.8);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300); // exit animation, then the content unmounts
}

test('bridge: computed behavior across themes, accent switch, and states', async ({ page }) => {
  await page.goto(FIXTURE);
  await themeMatrix(page);
});

test('bridge: accent seam drives catalog components', async ({ page }) => {
  await page.goto(FIXTURE);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const before = normalize(
    await page
      .locator('[data-fix="btn-primary"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await page.evaluate(() => document.documentElement.setAttribute('data-accent', 'green'));
  await page.waitForTimeout(400);
  const after = normalize(
    await page
      .locator('[data-fix="btn-primary"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  expect(after, 'accent switch re-themes the catalog component through the alias layer').not.toBe(before);
});
