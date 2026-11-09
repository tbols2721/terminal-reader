import { cleanArticle, safeURL } from './sanitize.js';
import { clearHighlights, highlightText } from './search.js';

const $ = (id) => document.getElementById(id);
const defaults = { size: 19, width: 75, spacing: '1.7', font: 'mono', foreground: '#00ff00', background: '#000000' };
const fonts = { mono: 'ui-monospace, "DejaVu Sans Mono", monospace', sans: 'system-ui, sans-serif', serif: 'Georgia, serif' };
let settings = { ...defaults };
let matches = [];
let matchIndex = -1;
let truncatedMatches = false;
let headings = [];
let readingMinutes = 0;
let hintState = null;
let lastG = 0;
let saveTimer;
const writer = crypto.randomUUID();
let revision = 0;

function validSettings(saved = {}) {
  const result = { ...defaults };
  for (const [key, min, max] of [['size', 14, 32], ['width', 45, 100]]) {
    if (Number.isFinite(saved[key])) result[key] = Math.min(max, Math.max(min, saved[key]));
  }
  if (['1.4', '1.7', '2'].includes(saved.spacing)) result.spacing = saved.spacing;
  if (Object.hasOwn(fonts, saved.font)) result.font = saved.font;
  for (const key of ['foreground', 'background']) if (/^#[0-9a-f]{6}$/i.test(saved[key] || '')) result[key] = saved[key];
  return result;
}

function applySettings() {
  const style = document.documentElement.style;
  style.setProperty('--foreground', settings.foreground);
  style.setProperty('--background', settings.background);
  style.setProperty('--font-size', `${settings.size}px`);
  style.setProperty('--column-width', `${settings.width}ch`);
  style.setProperty('--line-spacing', settings.spacing);
  style.setProperty('--reading-font', fonts[settings.font]);
  for (const key of Object.keys(defaults)) $(key).value = settings[key];
  $('size-value').textContent = `${settings.size}px`;
  $('width-value').textContent = `${settings.width}ch`;
}

function updateSettings() {
  const saved = {};
  for (const key of Object.keys(defaults)) saved[key] = $(key).value;
  saved.size = Number(saved.size);
  saved.width = Number(saved.width);
  settings = validSettings(saved);
  applySettings();
  revision++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 150);
}

async function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try { await chrome.storage.local.set({ settings: { ...settings, writer, revision } }); $('appearance-status').textContent = ''; }
  catch { $('appearance-status').textContent = 'Could not save appearance. Changes apply to this tab only.'; }
}

// window.close() drops a storage write started during its pagehide, so finish saving first.
async function closeReader() {
  if (saveTimer) await saveSettings();
  window.close();
}

function clearMatches() {
  clearHighlights($('article'), matches);
  matches = [];
  matchIndex = -1;
  truncatedMatches = false;
  $('match-count').textContent = '';
}

function moveMatch(direction) {
  if (!matches.length) return;
  for (const part of matches[matchIndex]?.parts || []) part.classList.remove('current');
  matchIndex = (matchIndex + direction + matches.length) % matches.length;
  for (const part of matches[matchIndex].parts) part.classList.add('current');
  matches[matchIndex].parts[0].scrollIntoView({ block: 'center' });
  $('match-count').textContent = `${matchIndex + 1} / ${matches.length}${truncatedMatches ? '+' : ''}`;
}

function findMatches() {
  clearMatches();
  if (!$('query').value.trim()) return;
  ({ matches, truncated: truncatedMatches } = highlightText($('article'), $('query').value));
  if (matches.length) moveMatch(1);
  else $('match-count').textContent = 'No matches';
}

function openSearch() {
  cancelHints();
  $('search').hidden = false;
  $('query').focus();
  $('query').select();
}

function closeSearch() {
  $('search').hidden = true;
  $('query').value = '';
  clearMatches();
  $('article').focus({ preventScroll: true });
}

function cancelHints() {
  hintState = null;
  $('hints').replaceChildren();
  $('hint-status').hidden = true;
}

function showStatus(text) {
  $('hint-status').textContent = text;
  $('hint-status').hidden = false;
}

function showHints(newTab) {
  cancelHints();
  const top = document.querySelector('.toolbar').getBoundingClientRect().bottom;
  const bottom = $('search').hidden ? innerHeight : $('search').getBoundingClientRect().top;
  const links = [...document.querySelectorAll('#article a[href]')].filter((link) => {
    const rect = link.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > top && rect.top < bottom && rect.right > 0 && rect.left < innerWidth;
  });
  if (!links.length) {
    showStatus('No visible article links. Scroll to a link and press f.');
    return;
  }
  const alphabet = 'asdfghjkl';
  const length = Math.max(1, Math.ceil(Math.log(links.length) / Math.log(alphabet.length)));
  const entries = links.map((link, index) => {
    let label = '';
    let value = index;
    for (let i = 0; i < length; i++) { label = alphabet[value % alphabet.length] + label; value = Math.floor(value / alphabet.length); }
    const badge = document.createElement('span');
    badge.className = 'link-hint';
    badge.textContent = label.toUpperCase();
    const rect = link.getBoundingClientRect();
    badge.style.left = `${Math.max(0, Math.min(innerWidth - 40, rect.left))}px`;
    badge.style.top = `${Math.max(top, rect.top)}px`;
    $('hints').append(badge);
    return { link, label, badge };
  });
  hintState = { entries, prefix: '', newTab };
  showStatus(`${newTab ? 'Open in new tab' : 'Follow link'}: type a hint · Esc cancels`);
}

function hintKey(key) {
  hintState.prefix += key.toLowerCase();
  const eligible = hintState.entries.filter((entry) => entry.label.startsWith(hintState.prefix));
  if (!eligible.length) { cancelHints(); return; }
  for (const entry of hintState.entries) entry.badge.hidden = !eligible.includes(entry);
  const exact = eligible.find((entry) => entry.label === hintState.prefix);
  if (exact) {
    const newTab = hintState.newTab;
    const link = exact.link;
    cancelHints();
    if (newTab) window.open(link.href, '_blank', 'noopener,noreferrer');
    else link.click();
  }
}

// Headings land just below the toolbar, whose height changes with the Appearance panel.
// On narrow screens the toolbar scrolls away, so they land at the top of the viewport.
function readingLine() {
  const toolbar = document.querySelector('.toolbar');
  return (getComputedStyle(toolbar).position === 'sticky' ? toolbar.getBoundingClientRect().bottom : 0) + 16;
}

function scrollToHeading(heading) {
  window.scrollBy(0, heading.getBoundingClientRect().top - readingLine());
}

function moveHeading(direction) {
  if (!headings.length) { showStatus('This article has no section headings.'); return; }
  const line = readingLine();
  const isAhead = (heading) => heading.getBoundingClientRect().top > line + 2;
  const isBehind = (heading) => heading.getBoundingClientRect().top < line - 2;
  const target = direction > 0 ? headings.find(isAhead) : headings.findLast(isBehind);
  if (target) scrollToHeading(target);
}

function buildContents() {
  // Readability can keep a heading that repeats the article title, which isn't a section.
  headings = [...$('article').querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((heading) => heading.textContent.trim() && heading.textContent.trim() !== $('title').textContent.trim());
  $('contents-toggle').hidden = !headings.length;
  const topLevel = Math.min(...headings.map((heading) => Number(heading.localName[1])));
  $('contents-list').dir = $('article').dir;
  for (const heading of headings) {
    const item = document.createElement('li');
    item.style.marginInlineStart = `${Number(heading.localName[1]) - topLevel}rem`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = heading.textContent.trim();
    button.addEventListener('click', () => {
      $('contents').close();
      scrollToHeading(heading);
      $('article').focus({ preventScroll: true });
    });
    item.append(button);
    $('contents-list').append(item);
  }
}

function showContents() {
  cancelHints();
  if (headings.length) $('contents').showModal();
  else showStatus('This article has no section headings.');
}

function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - innerHeight;
  $('progress').hidden = !readingMinutes || scrollable <= 0;
  if ($('progress').hidden) return;
  const read = Math.min(1, Math.max(0, scrollY / scrollable));
  const percent = Math.round(read * 100);
  $('progress').textContent = percent === 100 ? '100%' : `${percent}% · ${Math.ceil(readingMinutes * (1 - read))} min left`;
}

function toggleAppearance() {
  const expanded = $('appearance').hidden;
  $('appearance').hidden = !expanded;
  $('appearance-toggle').setAttribute('aria-expanded', String(expanded));
}

document.addEventListener('keydown', (event) => {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  if (document.querySelector('dialog[open]')) return; // Native dialog keeps focus and handles Escape.
  if (event.key === 'Escape') {
    event.preventDefault();
    lastG = 0;
    if (hintState || !$('hint-status').hidden) cancelHints();
    else if (!$('search').hidden || matches.length) closeSearch();
    else if (!$('appearance').hidden) { toggleAppearance(); $('article').focus({ preventScroll: true }); }
    return;
  }
  const editable = event.target.closest('input, textarea, select, [contenteditable="true"]');
  if (editable) return;
  if (hintState) {
    event.preventDefault();
    if (event.key.length === 1) hintKey(event.key);
    return;
  }
  const key = event.key;
  const previousG = lastG;
  lastG = key === 'g' ? Date.now() : 0;
  const scrolling = { j: [0, 70], k: [0, -70], h: [-70, 0], l: [70, 0], d: [0, innerHeight / 2], u: [0, -innerHeight / 2] };
  if (Object.hasOwn(scrolling, key)) window.scrollBy(...scrolling[key]);
  else if (key === 'g') { if (previousG && Date.now() - previousG < 800) { window.scrollTo(0, 0); lastG = 0; } }
  else if (key === 'G') window.scrollTo(0, document.documentElement.scrollHeight);
  else if (key === 'f' || key === 'F') showHints(key === 'F');
  else if (key === ']' || key === '[') moveHeading(key === ']' ? 1 : -1);
  else if (key === 't') showContents();
  else if (key === '/') openSearch();
  else if (key === 'n' || key === 'N') moveMatch(key === 'n' ? 1 : -1);
  else if (key === '?') { cancelHints(); $('help').showModal(); }
  else if (key === 'o' && !$('source').hidden) $('source').click();
  else if (key === 'x') closeReader();
  else if (['+', '=', '-', '_'].includes(key)) {
    $('size').value = Math.min(32, Math.max(14, settings.size + (['+', '='].includes(key) ? 1 : -1)));
    updateSettings();
  } else return;
  event.preventDefault();
});

$('appearance-toggle').addEventListener('click', toggleAppearance);
$('appearance').addEventListener('submit', (event) => event.preventDefault());
for (const key of Object.keys(defaults)) $(key).addEventListener('input', updateSettings);
$('reset').addEventListener('click', () => { settings = { ...defaults }; applySettings(); updateSettings(); });
$('close').addEventListener('click', closeReader);
$('contents-toggle').addEventListener('click', showContents);
$('contents-close').addEventListener('click', () => $('contents').close());
$('find-toggle').addEventListener('click', openSearch);
$('help-toggle').addEventListener('click', () => $('help').showModal());
$('help-close').addEventListener('click', () => $('help').close());
$('query').addEventListener('input', findMatches);
$('query').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    if (event.shiftKey) moveMatch(-1);
    $('article').focus({ preventScroll: true });
  }
});
$('search').addEventListener('submit', (event) => event.preventDefault());
$('previous').addEventListener('click', () => moveMatch(-1));
$('next').addEventListener('click', () => moveMatch(1));
$('search-close').addEventListener('click', closeSearch);
window.addEventListener('resize', cancelHints);
window.addEventListener('resize', updateProgress);
window.addEventListener('scroll', () => { if (hintState || !$('hint-status').hidden) cancelHints(); updateProgress(); }, { passive: true });
new ResizeObserver(updateProgress).observe($('article'));
window.addEventListener('pagehide', () => { if (saveTimer) saveSettings(); });
// An unsaved edit in this tab wins; its save then reaches the other tabs.
// An older save from this tab is skipped because it would undo a newer edit.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings || saveTimer) return;
  const saved = changes.settings.newValue;
  if (saved?.writer === writer && saved.revision !== revision) return;
  settings = validSettings(saved);
  applySettings();
});

async function load() {
  try {
    settings = validSettings((await chrome.storage.local.get('settings')).settings);
    applySettings();
    const params = new URLSearchParams(location.search);
    if (params.has('error')) throw new Error(params.get('error'));
    const id = params.get('id');
    if (!id) throw new Error('Open a web article, then click the Terminal Reader extension icon or press Alt+Shift+R.');
    // Duplicated tabs and F-opened in-page links share the article, so each tab holds its own claim on it.
    const tab = await chrome.tabs.getCurrent();
    if (tab) {
      const key = `reader:${tab.id}`;
      const { [key]: claims = [] } = await chrome.storage.session.get(key);
      if (!claims.includes(id)) await chrome.storage.session.set({ [key]: [...claims, id] });
    }
    const article = (await chrome.storage.session.get(`article:${id}`))[`article:${id}`];
    if (!article) throw new Error('This reading session has expired. Open the original article and click Terminal Reader again.');
    document.title = `${article.title} — Terminal Reader`;
    document.documentElement.lang = article.lang;
    $('title').textContent = article.title;
    $('article').dir = article.dir;
    $('article').append(cleanArticle(article.content, article.base || article.url));
    buildContents();
    readingMinutes = article.minutes;
    updateProgress();
    const url = safeURL(article.url);
    if (url) { $('source').href = url; $('source').hidden = false; }
    $('metadata').textContent = [url ? new URL(url).hostname : '', article.byline, `${article.minutes} min read`].filter(Boolean).join(' · ');
    $('article').focus({ preventScroll: true });
  } catch (error) {
    $('title').textContent = 'Terminal Reader';
    $('message').textContent = error.message;
  }
}
load();
