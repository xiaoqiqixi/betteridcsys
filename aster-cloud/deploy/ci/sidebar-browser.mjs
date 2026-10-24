// Read-only shell acceptance. No application state, DOM, API response or CSS is
// replaced here: only real viewport, scroll, focus and visible navigation input.
import assert from 'node:assert/strict';
import path from 'node:path';

export const SIDEBAR_SCREENSHOTS = Object.freeze([
  'sidebar-320-top.png', 'sidebar-320-drawer.png',
  'sidebar-390-bottom.png', 'sidebar-390-drawer.png',
  'sidebar-768-drawer.png', 'sidebar-1024-drawer.png',
  'sidebar-1025-middle.png', 'sidebar-1440-bottom.png',
  'sidebar-1440-short-nav-bottom.png', 'sidebar-1025-short-nav-bottom.png',
  'sidebar-zoom-720-drawer.png', 'sidebar-zoom-512-drawer.png',
]);

const tolerance = 2;
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function scrollPage(page, position) {
  await page.evaluate(position => {
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo({ top: position === 'middle' ? max / 2 : position === 'bottom' ? max : 0, behavior: 'instant' });
  }, position);
  await settle(page);
}

// Exported for a before-only probe against the unmodified bundle. This function
// does not mark a run passed; the mandatory assertions below remain fail-fast.
export async function sidebarLayout(page) {
  return page.evaluate(() => {
    const rect = el => {
      if (!el) return null;
      const b = el.getBoundingClientRect(), s = getComputedStyle(el);
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom,
        width: b.width, height: b.height, display: s.display, position: s.position,
        client_height: el.clientHeight, scroll_height: el.scrollHeight,
        client_width: el.clientWidth, scroll_width: el.scrollWidth,
        scroll_top: el.scrollTop, overflow_y: s.overflowY };
    };
    const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const sidebar = document.querySelector('.sidebar'), panel = sidebar?.querySelector('.sidebar-panel');
    return { width: innerWidth, height: innerHeight, scroll_y: scrollY,
      document_height: document.documentElement.scrollHeight,
      document_width: document.documentElement.scrollWidth,
      sidebar_visible: visible(sidebar), menu_visible: visible(document.querySelector('.mobile-menu')),
      shell: rect(document.querySelector('.console-shell')), track: rect(sidebar), panel: rect(panel),
      navigation: rect(sidebar?.querySelector('.sidebar-navigation')),
      brand: rect(sidebar?.querySelector('.brand')), account: rect(sidebar?.querySelector('.sidebar-account')),
      workspace: rect(document.querySelector('.console-workspace')),
      main: rect(document.querySelector('#main-content')), topbar: rect(document.querySelector('.topbar')),
      footer: rect(document.querySelector('.workspace-footer')) };
  });
}

async function hitAndFocus(page, locator, bounds) {
  await locator.focus();
  await settle(page);
  const result = await locator.evaluate((el, bounds) => {
    const r = el.getBoundingClientRect(), clip = bounds ? document.querySelector(bounds)?.getBoundingClientRect() : null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { focused: document.activeElement === el, visible: r.width > 0 && r.height > 0,
      in_viewport: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
      in_clip: !clip || r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1 && r.left >= clip.left - 1 && r.right <= clip.right + 1,
      hit: !!top && (top === el || el.contains(top)) };
  }, bounds);
  assert(Object.values(result).every(Boolean), `Shell control is clipped, obscured or unreachable: ${JSON.stringify(result)}`);
  return result;
}

export async function sidebarBrowserAcceptance({ page, output, report, capture = true, english = false }) {
  const originalURL = page.url(), originalViewport = page.viewportSize();
  const writeCount = () => report.requests.filter(r => r.method === 'POST').length;
  const writes = writeCount(), ingressWrites = report.public_ingress_write_attempts.length,
    publicWrites = report.public_ip_write_attempts.length;
  report.sidebar_checks ??= [];
  report.sidebar_screenshots ??= [];
  function passed(name, evidence = {}) {
    report.sidebar_checks.push({ name, mode: english ? 'english-dark' : 'chinese-light', ...evidence });
    console.log(`PASS sidebar ${name}`);
  }
  async function image(name) {
    if (!capture) return;
    assert(SIDEBAR_SCREENSHOTS.includes(name));
    assert(!report.sidebar_screenshots.includes(name), 'Sidebar evidence names must be unique');
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    await page.screenshot({ path: path.join(output, name), fullPage: false, animations: 'disabled' });
    report.sidebar_screenshots.push(name);
  }
  async function size(width, height) {
    await page.setViewportSize({ width, height });
    await settle(page);
  }
  async function closed({ menuFocus = true } = {}) {
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !history.state?.asterOverlay && !document.querySelector('#app')?.inert && document.body.style.overflow !== 'hidden');
    if (menuFocus) assert.equal(await page.locator('.mobile-menu').evaluate(el => document.activeElement === el), true, 'Closing navigation restores its visible menu trigger');
  }
  async function geometry(width, position) {
    await scrollPage(page, position);
    const m = await sidebarLayout(page);
    assert.equal(m.width, width);
    assert(m.document_height - m.height >= 250, 'Use the real long business page, not a DOM spacer or a viewport-only page');
    if (position !== 'top') assert(m.scroll_y > 0, 'The long-page scroll must actually happen');
    assert(m.document_width <= m.width, 'Shell must not create document horizontal scrolling');
    assert(m.main && m.workspace && m.topbar && m.footer);
    assert(m.main.left >= m.workspace.left - tolerance && m.main.right <= m.workspace.right + tolerance);
    assert(Math.abs(m.topbar.top) <= tolerance, 'The actual menu/header must remain reachable at mid/end of a long page');
    if (width <= 1024) {
      assert.equal(m.sidebar_visible, false, 'Compact width must not keep a fixed rail consuming the workspace');
      assert.equal(m.menu_visible, true);
      assert(Math.abs(m.workspace.left) <= tolerance);
    } else {
      assert.equal(m.sidebar_visible, true);
      assert.equal(m.menu_visible, false);
      assert(m.track && m.panel && m.navigation && m.brand && m.account);
      assert(m.brand.height > 0 && m.brand.width > 0 && m.account.height > 0 && m.account.width > 0, 'The brand and account must actually render');
      assert.equal(m.track.position, 'static', 'The background track belongs to the document grid, not a fixed overlay');
      assert.equal(m.panel.position, 'sticky');
      assert(Math.abs(m.track.width - Math.min(232, Math.max(216, width * .18))) <= tolerance);
      assert(Math.abs(m.track.height - m.shell.height) <= tolerance, 'Sidebar backdrop must fill the entire document-height shell');
      assert(Math.abs(m.panel.top) <= tolerance && Math.abs(m.panel.height - m.height) <= tolerance, 'The sticky navigation panel must remain viewport-height, not document-height');
      assert(m.workspace.left >= m.track.right - tolerance && m.main.left >= m.track.right - tolerance, 'The rail must have its own grid column and never cover the main content');
      assert(m.brand.top >= m.panel.top - tolerance && m.account.bottom <= m.panel.bottom + tolerance);
      assert(m.navigation.top >= m.brand.bottom - tolerance && m.navigation.bottom <= m.account.top + tolerance, 'Brand, navigation and account may not overlap');
      assert(m.navigation.scroll_width <= m.navigation.client_width + tolerance);
    }
    if (position === 'bottom') assert(Math.abs(m.footer.bottom - m.height) <= tolerance, 'The actual document footer must be visible at page bottom');
    passed(`${english ? 'English dark ' : ''}${width}px ${position} shell geometry`, m);
    return m;
  }
  async function drawer(name, closeBy = 'escape') {
    const menu = page.locator('.mobile-menu');
    await menu.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await settle(page);
    const evidence = await dialog.evaluate(el => {
      const r = el.getBoundingClientRect(), header = el.querySelector('.overlay-header')?.getBoundingClientRect(), footer = el.querySelector('.overlay-footer')?.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scroll_y: scrollY,
        in_viewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        header_footer_visible: !!header && !!footer && header.top >= r.top && footer.bottom <= r.bottom + 1,
        no_horizontal_scroll: el.scrollWidth <= el.clientWidth + 1,
        focus_inside: el.contains(document.activeElement), background_inert: document.querySelector('#app')?.inert === true,
        background_locked: document.body.style.overflow === 'hidden' };
    });
    for (const key of ['in_viewport','header_footer_visible','no_horizontal_scroll','focus_inside','background_inert','background_locked']) assert.equal(evidence[key], true, `${name}: ${key}`);
    await dialog.locator('.overlay-header button').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement) && document.activeElement?.closest('.overlay-footer') !== null), true, 'Reverse tab wraps to the real navigation footer, not the background');
    await page.keyboard.press('Tab');
    assert.equal(await dialog.locator('.overlay-header button').evaluate(el => document.activeElement === el), true);
    await page.mouse.move(2, Math.round(evidence.height / 2));
    await page.mouse.wheel(0, 320);
    await settle(page);
    assert(Math.abs(await page.evaluate(() => scrollY) - evidence.scroll_y) <= 1, 'Drawer must lock background scrolling');
    await image(name);
    if (closeBy === 'back') await page.goBack();
    else if (closeBy === 'backdrop') await page.mouse.click(2, Math.round(evidence.height / 2));
    else await page.keyboard.press('Escape');
    await closed();
    passed(`${name} focus trap, background lock and ${closeBy} close`, evidence);
  }
  async function shortDesktop(width, name) {
    await size(width, 360);
    await geometry(width, 'middle');
    const before = await sidebarLayout(page);
    assert(before.navigation.scroll_height > before.navigation.client_height + 1, 'The short-screen fixture must really overflow navigation');
    assert(before.panel.scroll_height <= before.panel.client_height + tolerance, 'At 360px only navigation should scroll; brand and account stay pinned');
    const nav = page.locator('.sidebar-navigation'), box = await nav.boundingBox();
    assert(box && box.height > 0);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => { const el = document.querySelector('.sidebar-navigation'); return !!el && el.scrollTop >= el.scrollHeight - el.clientHeight - 2; });
    const after = await sidebarLayout(page);
    assert(Math.abs(after.scroll_y - before.scroll_y) <= 1, 'Scrolling sidebar navigation must not scroll the business document');
    assert(Math.abs(after.brand.top - before.brand.top) <= 1 && Math.abs(after.account.bottom - before.account.bottom) <= 1);
    await hitAndFocus(page, page.locator('.sidebar-logout'), '.sidebar-panel');
    await image(name);
    await page.locator('.sidebar .brand').focus();
    const links = page.locator('.sidebar-navigation a');
    const count = await links.count();
    assert(count >= 6, 'Use the signed-in administrator navigation, not a reduced test menu');
    for (let i = 0; i < count; i++) {
      await page.keyboard.press('Tab');
      const link = links.nth(i);
      const focused = await link.evaluate(el => document.activeElement === el);
      if (!focused) {
        const identity = await page.evaluate(() => {
          const active = document.activeElement;
          return { tag: active?.tagName || '', navigation: active === document.querySelector('.sidebar-navigation'),
            panel: active === document.querySelector('.sidebar-panel'), body: active === document.body,
            main: active === document.querySelector('#main-content'), skip: active === document.querySelector('.skip-link'),
            brand: active === document.querySelector('.sidebar .brand'), logout: active === document.querySelector('.sidebar-logout'),
            link_index: [...document.querySelectorAll('.sidebar-navigation a')].indexOf(active) };
        });
        report.sidebar_focus_failure = { width, expected_link_index: i, ...identity };
        assert.fail(`Tab must follow every real sidebar link: expected=${i}, actual=${JSON.stringify(identity)}`);
      }
      await hitAndFocus(page, link, '.sidebar-navigation');
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.sidebar-logout').evaluate(el => document.activeElement === el),true, 'The real tab sequence must reach sign-out without activating it');
    await hitAndFocus(page, page.locator('.sidebar-logout'), '.sidebar-panel');
    passed(`${width}px 360px short-screen independent scroll and keyboard access`, { links: count, before, after });
  }

  try {
    const matrix = english ? [[1024,768],[1025,768]] : [[320,740],[390,844],[768,900],[1024,768],[1025,768],[1440,1000]];
    for (const [width,height] of matrix) {
      await size(width,height);
      for (const position of ['top','middle','bottom']) {
        await geometry(width,position);
        if (!english && width === 320 && position === 'top') await image('sidebar-320-top.png');
        if (!english && width === 390 && position === 'bottom') await image('sidebar-390-bottom.png');
        if (!english && width === 1025 && position === 'middle') await image('sidebar-1025-middle.png');
        if (!english && width === 1440 && position === 'bottom') await image('sidebar-1440-bottom.png');
      }
      if (width <= 1024) await drawer(`sidebar-${width}-drawer.png`, width === 390 ? 'backdrop' : width === 768 ? 'back' : 'escape');
    }
    for (const width of [1440,1025]) await shortDesktop(width, `sidebar-${width}-short-nav-bottom.png`);
    if (!english) {
      // Equivalent CSS viewports for 1440x900 and 1024x768 at 200% zoom. DPR
      // changes screenshot resolution only and is not used as fake zoom proof.
      for (const [width,height] of [[720,450],[512,384]]) {
        await size(width,height);
        await geometry(width,'bottom');
        await drawer(`sidebar-zoom-${width}-drawer.png`);
        passed(`200 percent equivalent ${width}x${height} CSS viewport reflow`);
      }
    }
    await size(1025,768);
    await scrollPage(page,'middle');
    await page.locator('.sidebar-navigation a').last().focus();
    await size(1024,768);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.mobile-menu')).catch(() => {
      throw new Error('1025 to 1024 must transfer the focused sidebar link to the visible compact menu; CSS hiding must not strand focus on body');
    });
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.evaluate(() => document.querySelector('#app')?.inert),false);
    passed('focused desktop sidebar becomes a reachable compact menu at 1024px');
    await page.locator('.mobile-menu').click();
    await page.getByRole('dialog').waitFor();
    await size(1025,768);
    await closed({ menuFocus: false });
    assert.equal(await page.locator('#main-content').evaluate(el => document.activeElement === el),true, 'Crossing to desktop must not leave focus on the now-hidden menu or removed drawer');
    passed('1024 to 1025 closes drawer, clears inert/history and focuses main');
    await size(390,844);
    await page.locator('.mobile-menu').click();
    await page.getByRole('dialog').locator('.nav-links a[href="#/instances"]').click();
    await page.waitForURL(/#\/instances(?:\?|$)/);
    await closed();
    await page.goto(originalURL,{ waitUntil:'networkidle' });
    await page.locator('.network-tabs').waitFor();
    passed('visible drawer navigation closes the overlay and reaches the actual route');
    const beforeSkipURL = page.url();
    await page.locator('.skip-link').focus();
    await page.locator('.skip-link').click();
    await settle(page);
    assert.equal(page.url(),beforeSkipURL,'Skip-to-content must not replace the hash-router URL with #main-content');
    assert.equal(await page.locator('#main-content').evaluate(el => document.activeElement === el),true,'The visible skip link must really focus the main landmark');
    passed('visible skip-link click focuses main without changing the hash route or making a write', { route_unchanged: true, main_focused: true });
    assert.equal(writeCount(),writes,'Shell acceptance must not add business POSTs');
    assert.equal(report.public_ingress_write_attempts.length,ingressWrites);
    assert.equal(report.public_ip_write_attempts.length,publicWrites);
    if (capture) assert.deepEqual([...report.sidebar_screenshots].sort(),[...SIDEBAR_SCREENSHOTS].sort());
  } finally {
    await size(originalViewport.width,originalViewport.height);
    if (page.url() === originalURL && await page.getByRole('dialog').count() === 0) await scrollPage(page,'top');
  }
}
