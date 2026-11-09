# Terminal Reader

A Chrome Manifest V3 extension with bright green text (`#00ff00`) on black
(`#000000`), a terminal-style layout, and keyboard navigation. It opens its own reading
tab. It does not change Chrome's built-in Reading mode.

## Install

Clone or download this repository first:

```sh
git clone https://github.com/tbols2721/terminal-reader.git
cd terminal-reader
```

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project directory.
4. Pin **Terminal Reader** from Chrome's Extensions menu.
5. Open a web article and click the extension, or press **Alt+Shift+R**.

There is no build step. All runtime code is bundled. To update after a checkout,
click **Reload** on the extension card. Keyboard conflicts can be changed at
`chrome://extensions/shortcuts`.

## Reading and keyboard controls

The reader extracts the current article with Mozilla Readability. Select text
before opening the extension to read that selection instead. Appearance controls
save font, size, width, line spacing, foreground, and background locally.
**Reset to terminal** restores the original palette and defaults.

| Key | Action |
| --- | --- |
| `j`, `k` | Scroll down, up |
| `h`, `l` | Scroll left, right |
| `d`, `u` | Half page down, up |
| `Space`, `Shift+Space` | Page down, up |
| `gg`, `G` | Top, bottom |
| `f`, `F` | Link hints; follow here or open in a new tab |
| `]`, `[` | Next, previous heading |
| `t` | Show the contents |
| `/` | Search article text |
| `Enter` in search | Keep matches and return to reading |
| `n`, `N` | Next, previous search match |
| `+`, `-` | Increase, decrease text size |
| `o` | Open original article in a new tab |
| `x` | Close reading tab |
| `?` | Show shortcuts |
| `Esc` | Cancel hints, clear search, or close a panel |

These controls apply inside Terminal Reader. This extension is not a full Vimium
replacement for browser tab management or ordinary websites. If Vimium is also
installed, exclude Terminal Reader if the two extensions compete for keys.
Normal typing in fields and browser shortcuts remain available. Search is
case-insensitive and finds phrases across inline formatting such as links and bold
text, but not across paragraphs or other blocks. Highlights are limited to 2,000
matches. The toolbar shows how far you've read and the estimated time left.

## Data and permissions

- `activeTab`: access the page only when you invoke the extension.
- `scripting`: run the bundled extractor on that page.
- `storage`: save appearance locally and keep extracted articles in session memory.

No all-sites permissions, analytics, remote scripts, accounts, or outbound article
requests. Articles are removed when their last reader tab closes; session data
expires when the browser restarts. The extension refuses to read Incognito tabs,
even if allowed in Incognito, so private articles never reach a normal window.
The original page stays open. The text-only view keeps headings, paragraphs, lists, links, tables, captions, and code. Publisher scripts,
forms, embeds, styles, and images are excluded. External links request a page only
when followed. Extraction does not bypass logins or paywalls. Some dynamic pages
do not extract well; selecting text is the fallback. Chrome internal pages, PDF
viewer pages, the Chrome Web Store, and other protected pages cannot be extracted.

## Development

Node 20 or newer:

```sh
npm ci
npx playwright install chromium
npm test
```

Tests load the unpacked extension in an isolated headless Chromium profile
and exercise article extraction, palette, Vim navigation, search, link hints,
headings, reading progress, appearance persistence, restricted pages, selection, and safe content rendering.
The disposable test copy adds permission for its localhost fixture and a function
hook to simulate the toolbar action. The delivered manifest has no host permissions.
The actual toolbar click and `Alt+Shift+R` require a manual Chrome smoke check.
Set `CHROMIUM_EXECUTABLE` to a compatible Chrome for Testing binary to use it instead.
Chrome's standard distribution may refuse command-line extension loading; use
Playwright's Chromium for the automated tests. No user Chrome profile is changed.

`vendor/Readability.js` is Mozilla Readability 0.6.0 under the Apache 2.0 license.
Its license is included in `vendor/Readability-LICENSE`. Original project code is available under [MIT](LICENSE). Readability retains
its Apache 2.0 license and existing notices. See [NOTICE.md](NOTICE.md) for
attribution and [PRIVACY.md](PRIVACY.md) before sharing diagnostics.
