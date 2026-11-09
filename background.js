/* Articles stay in browser-session storage, never sync or persistent storage. */
export async function openReader(tab) {
  let id;
  try {
    // Extension pages can't open in an Incognito window here, so the article would land in a normal one.
    if (tab.incognito) throw new Error('Terminal Reader does not run in Incognito, so private articles never reach a normal window.');
    if (!tab.id || !/^https?:\/\//i.test(tab.url || '')) {
      throw new Error('Open a normal web article first. Chrome internal pages, PDFs, and other extensions cannot be read.');
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['vendor/Readability.js'] });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] });
    const article = result?.result;
    if (!article?.content) throw new Error('No readable article was found. Select the text you want to read, then try again.');
    id = crypto.randomUUID();
    await chrome.storage.session.set({ [`article:${id}`]: article });
    const reader = await chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?id=${id}`), index: tab.index + 1 });
    await chrome.storage.session.set({ [`reader:${reader.id}`]: [id] });
    // A tab closed before that write fired onRemoved too early to release anything.
    await chrome.tabs.get(reader.id).catch(() => releaseTab(reader.id));
  } catch (error) {
    if (id) await chrome.storage.session.remove(`article:${id}`);
    await chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?error=${encodeURIComponent(error.message)}`) });
  }
}
chrome.action.onClicked.addListener(openReader);

async function releaseTab(tabId) {
  const key = `reader:${tabId}`;
  const { [key]: ids } = await chrome.storage.session.get(key);
  if (!ids) return;
  await chrome.storage.session.remove(key);
  const stored = await chrome.storage.session.get(null);
  const claimed = Object.entries(stored).filter(([other]) => other.startsWith('reader:')).flatMap(([, value]) => value);
  await chrome.storage.session.remove(ids.filter((id) => !claimed.includes(id)).map((id) => `article:${id}`));
}
chrome.tabs.onRemoved.addListener(releaseTab);
