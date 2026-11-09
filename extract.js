(() => {
  const selected = window.getSelection()?.toString().trim();
  let article;
  if (selected) {
    const wrapper = document.createElement('div');
    for (const paragraph of selected.split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.textContent = paragraph;
      wrapper.append(p);
    }
    article = { title: document.title, content: wrapper.innerHTML, textContent: selected, byline: 'Selected text' };
  } else {
    // Readability changes its input. The live page is never passed to it.
    article = new Readability(document.cloneNode(true), { maxElemsToParse: 75000 }).parse();
  }
  if (!article) return null;
  // Segment rather than split on spaces, which Chinese, Japanese, and Thai text doesn't use between words.
  const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(article.textContent || '');
  const words = [...segments].filter((segment) => segment.isWordLike).length;
  return {
    title: article.title || document.title,
    byline: article.byline || '',
    content: article.content,
    url: location.href,
    base: document.baseURI,
    lang: document.documentElement.lang || 'en',
    dir: article.dir || document.documentElement.dir || 'auto',
    minutes: Math.max(1, Math.ceil(words / 220))
  };
})();
