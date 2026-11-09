// Search the rendered text stream while retaining node offsets for safe highlights.
// Blocks are separated by a non-whitespace character, so a phrase can't match across them.
const BLOCK_BREAK = '\0';
const blocks = new Set('p div section article h1 h2 h3 h4 h5 h6 ul ol li dl dt dd blockquote pre figure figcaption table caption thead tbody tfoot tr td th br hr'.split(' '));

export function highlightText(root, query, limit = 2000) {
  const words = query.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return { matches: [], truncated: false };
  let text = '';
  const segments = [];
  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      segments.push({ node, start: text.length, end: text.length + node.length });
      text += node.data;
      return;
    }
    const boundary = blocks.has(node.localName);
    if (boundary) text += BLOCK_BREAK;
    for (const child of node.childNodes) visit(child);
    if (boundary) text += BLOCK_BREAK;
  }
  visit(root);
  const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(words.map(escape).join('\\s+'), 'giu');
  const found = [];
  let truncated = false;
  for (const match of text.matchAll(pattern)) {
    if (found.length === limit) { truncated = true; break; }
    found.push({ start: match.index, end: match.index + match[0].length, parts: [] });
  }
  // Work backwards so splitting a text node cannot invalidate earlier offsets.
  let cursor = segments.length - 1;
  for (const match of [...found].reverse()) {
    while (cursor >= 0 && segments[cursor].start >= match.end) cursor--;
    for (let i = cursor; i >= 0 && segments[i].end > match.start; i--) {
      const segment = segments[i];
      const start = Math.max(0, match.start - segment.start);
      const end = Math.min(segment.node.length, match.end - segment.start);
      if (end <= start) continue;
      const range = document.createRange();
      range.setStart(segment.node, start);
      range.setEnd(segment.node, end);
      const mark = document.createElement('mark');
      range.surroundContents(mark);
      match.parts.unshift(mark);
    }
  }
  return { matches: found.filter((match) => match.parts.length), truncated };
}

export function clearHighlights(root, matches) {
  for (const match of matches) for (const mark of match.parts) mark.replaceWith(document.createTextNode(mark.textContent));
  root.normalize();
}
