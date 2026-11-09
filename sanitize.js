// Rebuild a restricted tree rather than inserting publisher HTML into the page.
const ALLOWED = new Set('p div section article span h1 h2 h3 h4 h5 h6 a em strong b i u s del ins small sub sup blockquote pre code ul ol li dl dt dd br hr figure figcaption table thead tbody tfoot tr td th caption abbr time kbd samp mark'.split(' '));
const DROP = new Set('script style iframe frame object embed form input button select textarea svg math video audio source link meta base noscript template'.split(' '));
export function safeURL(raw, base) {
  try {
    const url = new URL(raw, base);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
// Browsers treat an empty fragment, or "top" with no matching target, as the top of the page.
function fragmentHref(name, parsed) {
  const isTop = name.toLowerCase() === 'top' && !parsed.querySelector(`[id="${name}"], a[name="${name}"]`);
  return !name || isTop ? '#' : `#article-${name}`;
}
export function cleanArticle(html, base) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  const append = (node, parent) => {
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.localName;
    if (DROP.has(tag)) return;
    if (tag === 'img') return; // Text-only view: no new publisher image requests.
    const element = ALLOWED.has(tag) ? document.createElement(tag) : document.createDocumentFragment();
    if (element.nodeType === Node.ELEMENT_NODE) {
      if (node.id) element.id = `article-${node.id}`;
      if (node.getAttribute('dir') === 'rtl' || node.getAttribute('dir') === 'ltr') element.dir = node.getAttribute('dir');
      if (tag === 'a') {
        if (node.getAttribute('name')) element.name = `article-${node.getAttribute('name')}`;
        const raw = node.getAttribute('href');
        const url = raw && safeURL(raw, base);
        if (url) {
          element.href = raw.startsWith('#') ? fragmentHref(raw.slice(1), parsed) : url;
          element.rel = 'noopener noreferrer';
        }
      }
      if (tag === 'td' || tag === 'th') {
        for (const attr of ['colspan', 'rowspan']) {
          const value = Number(node.getAttribute(attr));
          if (Number.isInteger(value) && value > 0 && value <= 100) element.setAttribute(attr, value);
        }
      }
      if (tag === 'ol' && /^-?\d+$/.test(node.getAttribute('start') || '')) element.start = Number(node.getAttribute('start'));
    }
    for (const child of node.childNodes) append(child, element);
    parent.append(element);
  };
  for (const child of parsed.body.childNodes) append(child, fragment);
  return fragment;
}
