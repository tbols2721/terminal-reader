import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('unpacked extension: extraction, theme, Vim controls, and safe rendering', { timeout: 120000 }, async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'terminal-reader-test-'));
  const extension = path.join(temp, 'extension');
  await cp(root, extension, { recursive: true, filter: (source) => !['node_modules', '.git'].includes(path.basename(source)) });
  const background = path.join(extension, 'background.js');
  await writeFile(background, (await readFile(background, 'utf8')) + '\nglobalThis.testOpenReader = openReader;\n');
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json')));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  // Headless automation cannot click Chrome's toolbar action to grant activeTab.
  // Grant only the local fixture origin in this disposable test copy.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const paragraphs = Array.from({ length: 45 }, (_, i) => `${i % 15 === 0 ? `<h2>Part ${i / 15 + 1}</h2>` : ''}<p>Section ${i + 1}: The terminal reader preserves readable article text. Navigation helps a reader move through a long document. This paragraph provides enough continuous prose for reliable article extraction and search verification. <a href="/destination?part=${i}">Reference ${i + 1}</a>.</p>`).join('');
  const fixtureEnd = '<p id="sec2">Section two heading text for the terminal reader, with enough prose to survive article extraction. See <a href="#fn1">note one</a>, <a href="#sec2">section two</a>, <a href="#">page start</a>, and <a href="#top">page top</a>.</p><p>İİ offsetcheck follows a character whose lowercase form is longer, and the literal term (c++) also appears in this closing paragraph of the article.</p><p>This sentence spans <strong>inline</strong> <em>formatting</em> so search has a phrase to find across several elements.</p><p>One paragraph ends here</p><p>next begins here, and the search should not join the two blocks together.</p><p><a name="fn1"></a>Footnote one explains the reference in enough words to remain part of the extracted article text.</p>';
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url.startsWith('/destination')) { response.end('<h1>Link destination</h1>'); return; }
    if (request.url.startsWith('/cjk')) { response.end(`<!doctype html><html lang="zh"><head><title>中文文章</title></head><body><article><h1>中文文章</h1>${'<p>这是一段用于测试阅读时间估算的中文文章内容,它没有使用空格来分隔词语,因此需要专门的分词方法才能得到合理的结果。</p>'.repeat(100)}</article></body></html>`); return; }
    response.end(`<!doctype html><html lang="en"><head><title>A terminal reading test</title></head><body><nav>Unrelated site navigation</nav><main><article><h1>A terminal reading test</h1><p class="byline">By Test Author</p>${paragraphs}${fixtureEnd}<pre>const value = 42;</pre></article></main><aside>Unrelated sidebar</aside></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let context;
  t.after(async () => {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    channel: 'chromium', headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 }
  });
  const errors = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source = await context.newPage();
  await source.goto(`${origin}/article`);
  async function openFromSource(page = source) {
    const newPage = context.waitForEvent('page');
    await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      await globalThis.testOpenReader(tab);
    }, page.url());
    const reader = await newPage;
    await reader.locator('#article p').first().waitFor();
    return reader;
  }
  const reader = await openFromSource();
  const storedKeys = (prefix) => worker.evaluate(async (prefix) => Object.keys(await chrome.storage.session.get(null)).filter((key) => key.startsWith(prefix)), prefix);
  async function until(check, message) {
    for (let i = 0; i < 40; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(message);
  }
  await t.test('extracts article into a separate green-on-black reading tab', async () => {
    assert.match(reader.url(), /chrome-extension:.*reader.html\?id=/);
    assert.match(await reader.title(), /A terminal reading test/);
    assert.ok((await reader.locator('#article').innerText()).includes('Section 45'));
    assert.ok(!(await reader.locator('#article').innerText()).includes('Unrelated sidebar'));
    assert.equal(await reader.locator('#source').getAttribute('href'), source.url());
    assert.equal(await reader.evaluate(() => getComputedStyle(document.body).color), 'rgb(0, 255, 0)');
    assert.equal(await reader.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(0, 0, 0)');
    assert.match(await reader.locator('#article').evaluate((e) => getComputedStyle(e).fontFamily), /monospace/);
  });
  await t.test('j/k, d/u, gg/G and help work', async () => {
    await reader.keyboard.press('j');
    assert.equal(await reader.evaluate(() => scrollY), 70);
    await reader.keyboard.press('k');
    assert.equal(await reader.evaluate(() => scrollY), 0);
    await reader.keyboard.press('d');
    assert.equal(await reader.evaluate(() => scrollY), 450);
    await reader.keyboard.press('u');
    assert.equal(await reader.evaluate(() => scrollY), 0);
    await reader.keyboard.press('G');
    assert.ok(await reader.evaluate(() => scrollY > 2000));
    await reader.keyboard.press('g'); await reader.keyboard.press('g');
    assert.equal(await reader.evaluate(() => scrollY), 0);
    await reader.keyboard.press('?');
    assert.equal(await reader.locator('#help').evaluate((e) => e.open), true);
    await reader.keyboard.press('Escape');
    assert.equal(await reader.locator('#help').evaluate((e) => e.open), false);
  });
  await t.test('search, n/N, no matches, and typing isolation work', async () => {
    await reader.keyboard.press('/');
    await reader.locator('#query').fill('terminal');
    assert.ok(await reader.locator('mark').count() >= 45);
    await reader.keyboard.press('Enter');
    const before = await reader.locator('#match-count').textContent();
    await reader.keyboard.press('n');
    assert.notEqual(await reader.locator('#match-count').textContent(), before);
    await reader.keyboard.press('N');
    assert.equal(await reader.locator('#match-count').textContent(), before);
    await reader.keyboard.press('/');
    await reader.locator('#query').fill('jjkkggxff');
    assert.equal(await reader.locator('#query').inputValue(), 'jjkkggxff');
    assert.equal(await reader.locator('#match-count').textContent(), 'No matches');
    await reader.keyboard.press('Escape');
    assert.equal(await reader.locator('mark').count(), 0);
    assert.equal(await reader.locator('#search').isVisible(), false);
  });
  await t.test('closing search clears the query, and IME Enter stays in the field', async () => {
    assert.equal(await reader.locator('#next').getAttribute('title'), 'Next match (n)');
    assert.equal(await reader.locator('#previous').getAttribute('title'), 'Previous match (N)');
    await reader.keyboard.press('/');
    await reader.locator('#query').fill('terminal');
    const composingFocus = await reader.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      document.getElementById('query').dispatchEvent(event);
      return { active: document.activeElement.id, prevented: event.defaultPrevented };
    });
    assert.deepEqual(composingFocus, { active: 'query', prevented: false });
    await reader.keyboard.press('Escape');
    await reader.keyboard.press('/');
    assert.equal(await reader.locator('#query').inputValue(), '');
    assert.equal(await reader.locator('#match-count').textContent(), '');
    await reader.keyboard.press('Escape');
  });
  await t.test('search marks the matched text and treats the query literally', async () => {
    await reader.keyboard.press('/');
    await reader.locator('#query').fill('OFFSETCHECK');
    assert.deepEqual(await reader.locator('mark').allTextContents(), ['offsetcheck']);
    await reader.locator('#query').fill('(C++)');
    assert.deepEqual(await reader.locator('mark').allTextContents(), ['(c++)']);
    await reader.keyboard.press('Escape');
  });
  await t.test('search finds phrases across inline formatting but not across blocks', async () => {
    const before = await reader.locator('#article').innerHTML();
    await reader.keyboard.press('/');
    await reader.locator('#query').fill('SPANS inline   formatting');
    assert.equal(await reader.locator('#match-count').textContent(), '1 / 1');
    assert.equal((await reader.locator('mark').allTextContents()).join(''), 'spans inline formatting');
    assert.equal(await reader.locator('mark:not(.current)').count(), 0);
    await reader.locator('#query').fill('ends here next begins');
    assert.equal(await reader.locator('#match-count').textContent(), 'No matches');
    await reader.locator('#query').fill('   ');
    assert.equal(await reader.locator('#match-count').textContent(), '');
    await reader.keyboard.press('Escape');
    assert.equal(await reader.locator('#article').innerHTML(), before);
    const blocks = ['<blockquote>one <figure>two</figure></blockquote>', '<table><caption>one</caption><tr><td>two</td></tr></table>', '<div>one <ul><li>two</li></ul></div>', '<div>one <ol><li>two</li></ol></div>', '<div>one <dl><dt>two</dt></dl></div>', '<table><thead><tr><th>one</th></tr></thead><tbody><tr><td>two</td></tr></tbody></table>'];
    const found = await reader.evaluate(async (blocks) => {
      const { highlightText } = await import('./search.js');
      return blocks.map((html) => {
        const box = document.createElement('div');
        box.innerHTML = html;
        return highlightText(box, 'one two').matches.length;
      });
    }, blocks);
    assert.deepEqual(found, blocks.map(() => 0));
  });
  await t.test('] and [ move between headings, and t opens the contents', async () => {
    const offset = (name) => reader.getByRole('heading', { name, exact: true }).first().evaluate((heading) => heading.getBoundingClientRect().top - document.querySelector('.toolbar').getBoundingClientRect().bottom);
    const atLine = async (name) => assert.ok(Math.abs(await offset(name) - 16) <= 2, `${name} should sit below the toolbar`);
    await reader.keyboard.press('g'); await reader.keyboard.press('g');
    await reader.keyboard.press(']');
    await atLine('Part 1');
    await reader.keyboard.press(']');
    await atLine('Part 2');
    await reader.keyboard.press('[');
    await atLine('Part 1');
    await reader.keyboard.press('[');
    await atLine('Part 1');
    await reader.keyboard.press('t');
    assert.equal(await reader.locator('#contents').evaluate((e) => e.open), true);
    assert.deepEqual(await reader.locator('#contents-list button').allTextContents(), ['Part 1', 'Part 2', 'Part 3']);
    await reader.keyboard.press(']');
    await atLine('Part 1');
    await reader.getByRole('button', { name: 'Part 3' }).click();
    assert.equal(await reader.locator('#contents').evaluate((e) => e.open), false);
    await atLine('Part 3');
    await reader.keyboard.press('t');
    await reader.keyboard.press('Escape');
    assert.equal(await reader.locator('#contents').evaluate((e) => e.open), false);
    await reader.locator('#contents-toggle').click();
    await reader.getByRole('button', { name: 'Close contents' }).click();
    assert.equal(await reader.locator('#contents').evaluate((e) => e.open), false);
    await reader.locator('#article').focus();
  });
  await t.test('the toolbar shows reading progress and time left', async () => {
    const progress = () => reader.locator('#progress').textContent();
    await reader.keyboard.press('g'); await reader.keyboard.press('g');
    await until(async () => /^0% · \d+ min left$/.test(await progress()), 'the top should show 0% and the time left');
    const total = Number((await reader.locator('#metadata').textContent()).match(/(\d+) min read/)[1]);
    assert.equal(await progress(), `0% · ${total} min left`);
    await reader.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
    await until(async () => (await progress()).startsWith('50% · '), 'halfway should show 50%');
    await reader.keyboard.press('G');
    await until(async () => await progress() === '100%', 'the bottom should show 100%');
    await reader.keyboard.press('g'); await reader.keyboard.press('g');
  });
  await t.test('in-page links reach ids and named anchors, and # and #top reach the page top', async () => {
    const target = () => reader.evaluate(() => { const e = document.querySelector(':target'); return e && (e.id || e.name); });
    await reader.getByRole('link', { name: 'note one' }).click();
    assert.equal(await target(), 'article-fn1');
    await reader.getByRole('link', { name: 'section two' }).click();
    assert.equal(await target(), 'article-sec2');
    for (const name of ['page start', 'page top']) {
      await reader.keyboard.press('G');
      assert.ok(await reader.evaluate(() => scrollY > 0));
      await reader.getByRole('link', { name }).click();
      await until(() => reader.evaluate(() => scrollY === 0), `${name} should scroll to the top`);
    }
    const claimed = await reader.evaluate(async () => {
      const { cleanArticle } = await import('./sanitize.js');
      const box = document.createElement('div');
      box.append(cleanArticle('<p id="top">Named top</p><a href="#top">Up</a>', 'https://example.org/story'));
      return box.querySelector('a').getAttribute('href');
    });
    assert.equal(claimed, '#article-top');
  });
  await t.test('link hints open the selected link in a new tab', async () => {
    await reader.keyboard.press('g'); await reader.keyboard.press('g');
    await reader.keyboard.press('F');
    assert.ok(await reader.locator('.link-hint').count() > 0);
    const hint = await reader.locator('.link-hint').first().textContent();
    const destinationEvent = context.waitForEvent('page');
    await reader.keyboard.type(hint.toLowerCase());
    const destination = await destinationEvent;
    await destination.waitForLoadState();
    assert.match(destination.url(), /destination\?part=/);
    assert.equal(await reader.locator('.link-hint').count(), 0);
    await destination.close();
    await reader.keyboard.press('f');
    await reader.keyboard.press('Escape');
    assert.equal(await reader.locator('.link-hint').count(), 0);
  });
  await t.test('font controls persist across reloads and reset to terminal colors', async () => {
    await reader.keyboard.press('+');
    await reader.getByRole('button', { name: 'Appearance', exact: true }).click();
    assert.equal(await reader.locator('#size-value').textContent(), '20px');
    await reader.locator('#font').selectOption('serif');
    await reader.waitForTimeout(250);
    await reader.reload();
    await reader.locator('#article p').first().waitFor();
    assert.match(await reader.locator('#article').evaluate((e) => getComputedStyle(e).fontFamily), /Georgia/);
    assert.equal(await reader.locator('#article').evaluate((e) => getComputedStyle(e).fontSize), '20px');
    await reader.getByRole('button', { name: 'Appearance', exact: true }).click();
    await reader.getByRole('button', { name: 'Reset to terminal' }).click();
    assert.equal(await reader.locator('#foreground').inputValue(), '#00ff00');
    assert.equal(await reader.locator('#background').inputValue(), '#000000');
    assert.equal(await reader.locator('#font').inputValue(), 'mono');
    await reader.keyboard.press('Escape');
  });
  await t.test('appearance syncs between tabs and saves when a tab closes straight away', async () => {
    const savedSize = () => worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.size);
    await until(async () => await savedSize() === 19, 'the previous test should finish saving its reset');
    const first = await openFromSource();
    const second = await openFromSource();
    await first.getByRole('button', { name: 'Appearance', exact: true }).click();
    await first.locator('#font').selectOption('serif');
    await until(async () => await second.locator('#font').inputValue() === 'serif', 'font change should reach the other tab');
    await second.keyboard.press('+');
    await until(async () => await first.locator('#size-value').textContent() === '20px', 'size change should reach the other tab');
    await second.reload();
    await second.locator('#article p').first().waitFor();
    assert.equal(await second.locator('#font').inputValue(), 'serif');
    assert.equal(await second.locator('#size').inputValue(), '20');
    const closed = second.waitForEvent('close');
    await second.keyboard.press('+');
    await second.keyboard.press('x').catch(() => {}); // The tab can close before the key press returns.
    await closed;
    await until(async () => await savedSize() === 21, 'size change should be saved when x closes the tab');
    await first.reload();
    await first.locator('#article p').first().waitFor();
    await first.keyboard.press('+');
    await first.close();
    await until(async () => await savedSize() === 22, 'size change should be saved when the browser closes the tab');
    const slow = await openFromSource();
    await slow.evaluate(() => {
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      let queue = Promise.resolve();
      chrome.storage.local.set = (items) => (queue = queue.then(() => new Promise((resolve) => setTimeout(resolve, 600))).then(() => set(items)));
    });
    await slow.keyboard.press('+');
    await slow.waitForTimeout(200);
    await slow.keyboard.press('+');
    // The first save has landed and the second is still in flight, with no edit waiting.
    await slow.waitForTimeout(700);
    assert.equal(await slow.locator('#size').inputValue(), '24');
    await slow.keyboard.press('+');
    await until(async () => await savedSize() === 25, 'slow saves should not undo newer edits');
    assert.equal(await slow.locator('#size').inputValue(), '25');
    await slow.keyboard.press('+');
    await slow.waitForTimeout(300);
    await worker.evaluate(async () => { await chrome.storage.local.set({ settings: { size: 14 } }); });
    await until(async () => await slow.locator('#size').inputValue() === '14', 'another tab\'s save should arrive');
    await until(async () => await savedSize() === 26 && await slow.locator('#size').inputValue() === '26', 'the latest save should win in the tab that made it');
    await slow.close();
    await worker.evaluate(() => chrome.storage.local.remove('settings'));
  });
  await t.test('an article stays available until its last reader tab closes', async () => {
    const first = await openFromSource();
    const id = new URL(first.url()).searchParams.get('id');
    const opened = context.waitForEvent('page');
    await first.evaluate(() => { window.open(`${location.href}#article-fn1`, '_blank', 'noopener,noreferrer'); });
    const second = await opened;
    await second.locator('#article p').first().waitFor();
    await first.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await second.reload();
    await second.locator('#article p').first().waitFor();
    assert.equal((await storedKeys('article:')).includes(`article:${id}`), true);
    await second.close();
    await until(async () => !(await storedKeys('article:')).includes(`article:${id}`), 'article should be removed with its last tab');
  });
  await t.test('a tab moved to another article keeps its claim on both', async () => {
    const first = await openFromSource();
    const second = await openFromSource();
    const ids = [first, second].map((page) => `article:${new URL(page.url()).searchParams.get('id')}`);
    await second.evaluate((url) => { location.href = url; }, first.url());
    await second.waitForURL(first.url());
    await second.locator('#article p').first().waitFor();
    await first.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await storedKeys('article:')).includes(ids[0]), true);
    await second.close();
    await until(async () => { const keys = await storedKeys('article:'); return !keys.includes(ids[0]) && !keys.includes(ids[1]); }, 'both articles should be removed with the tab');
  });
  await t.test('a reader tab closed while it opens leaves nothing behind', async () => {
    const before = [await storedKeys('article:'), await storedKeys('reader:')];
    await worker.evaluate(async (url) => {
      const create = chrome.tabs.create;
      chrome.tabs.create = async (options) => {
        const tab = await create(options);
        await chrome.tabs.remove(tab.id);
        return tab;
      };
      try {
        const tabs = await chrome.tabs.query({});
        await globalThis.testOpenReader(tabs.find((item) => item.url === url));
      } finally { chrome.tabs.create = create; }
    }, source.url());
    await until(async () => (await storedKeys('article:')).length === before[0].length && (await storedKeys('reader:')).length === before[1].length, 'closed reader should leave no session data');
  });
  await t.test('mobile layout stays within viewport', async () => {
    await reader.setViewportSize({ width: 390, height: 844 });
    assert.ok(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await reader.screenshot({ path: '/tmp/terminal-reader-mobile.png' });
    // The toolbar scrolls away at this width, so headings land at the top of the viewport.
    const top = (name) => reader.getByRole('heading', { name, exact: true }).first().evaluate((heading) => heading.getBoundingClientRect().top);
    await reader.keyboard.press('g'); await reader.keyboard.press('g');
    for (const [key, name] of [[']', 'Part 1'], [']', 'Part 2'], [']', 'Part 3'], ['[', 'Part 2']]) {
      await reader.keyboard.press(key);
      assert.ok(Math.abs(await top(name) - 16) <= 2, `${key} should move to ${name}`);
    }
    await reader.keyboard.press('t');
    await reader.getByRole('button', { name: 'Part 1' }).click();
    assert.ok(Math.abs(await top('Part 1') - 16) <= 2, 'contents should reach Part 1');
    await reader.locator('#article').focus();
    await reader.setViewportSize({ width: 1280, height: 900 });
    await reader.keyboard.press('g'); await reader.keyboard.press('g');
    await reader.screenshot({ path: '/tmp/terminal-reader-desktop.png' });
  });
  await t.test('publisher HTML cannot inject scripts, forms, styles or unsafe links', async () => {
    const result = await reader.evaluate(async () => {
      const { cleanArticle } = await import('./sanitize.js');
      const fragment = cleanArticle('<p onclick="alert(1)">Kept text <a href="javascript:alert(1)">Bad link</a><a href="/safe" style="color:red">Good link</a></p><script>window.pwned=1</script><img src="https://example.com/tracker"><iframe src="https://example.com"></iframe><form><input></form><svg onload="alert(1)"></svg>', 'https://example.org/story');
      const box = document.createElement('div'); box.append(fragment);
      return { html: box.innerHTML, text: box.textContent, injected: window.pwned || false };
    });
    assert.match(result.text, /Kept text/);
    assert.ok(!/script|onclick|style=|<img|<iframe|<form|<input|<svg/.test(result.html));
    assert.match(result.html, /https:\/\/example.org\/safe/);
    assert.equal(result.injected, false);
  });
  await t.test('selected text is used instead of full-page extraction', async () => {
    await source.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('article p:not(.byline)'));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    const selected = await openFromSource();
    const text = await selected.locator('#article').innerText();
    assert.match(text, /Section 1:/);
    assert.ok(!text.includes('Section 2:'));
    await selected.keyboard.press('f');
    assert.equal(await selected.locator('#hint-status').isVisible(), true);
    await selected.evaluate(() => window.dispatchEvent(new Event('scroll')));
    assert.equal(await selected.locator('#hint-status').isVisible(), false);
    assert.equal(await selected.locator('#progress').isVisible(), false);
    assert.equal(await selected.locator('#contents-toggle').isVisible(), false);
    for (const key of [']', 't']) {
      await selected.keyboard.press(key);
      await selected.locator('#hint-status').filter({ hasText: 'no section headings' }).waitFor();
      await selected.keyboard.press('Escape');
    }
    assert.equal(await selected.locator('#contents').evaluate((e) => e.open), false);
    const id = new URL(selected.url()).searchParams.get('id');
    await selected.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(await worker.evaluate(async (id) => (await chrome.storage.session.get(`article:${id}`))[`article:${id}`], id), undefined);
  });
  await t.test('reading time counts words in text without spaces', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/cjk`);
    const article = await openFromSource(page);
    const minutes = Number((await article.locator('#metadata').textContent()).match(/(\d+) min read/)[1]);
    assert.ok(minutes >= 10, `expected at least 10 minutes, got ${minutes}`);
    assert.equal(await article.locator('#contents-toggle').isVisible(), false);
    await article.close();
    await page.close();
  });
  await t.test('Incognito tabs are refused without extracting or storing the article', async () => {
    const before = await storedKeys('article:');
    const pageEvent = context.waitForEvent('page');
    await worker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
      await globalThis.testOpenReader({ ...tab, incognito: true });
    }, source.url());
    const error = await pageEvent;
    await error.locator('#message').filter({ hasText: 'does not run in Incognito' }).waitFor();
    assert.equal(await error.locator('#article p').count(), 0);
    assert.deepEqual((await storedKeys('article:')).filter((key) => !before.includes(key)), []);
    await error.close();
  });
  await t.test('protected pages show an actionable error', async () => {
    const pageEvent = context.waitForEvent('page');
    await worker.evaluate(async () => { await globalThis.testOpenReader({ id: 123, url: 'chrome://settings' }); });
    const error = await pageEvent;
    await error.locator('#message').filter({ hasText: 'Open a normal web article first' }).waitFor();
    await error.close();
  });
  assert.deepEqual(errors, []);
});
