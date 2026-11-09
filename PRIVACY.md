# Privacy and contributions

Public source should contain reproducible code and project documentation, not
personal machine records. Keep usernames, home paths, hostnames, device serials,
personal email addresses, credentials, and recordings out of commits and issue
reports. Upstream authors' attribution and public example data retain their
original notices.

Inspect staged changes and Git author metadata before publishing:

```sh
git diff --cached --check
git diff --cached
git status --short
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

Choose a non-identifying author name and an appropriate private or noreply email
before creating public commits. A GitHub noreply address can still associate a
commit with a profile. A repository's public owner, URL, and visible GitHub
activity also remain attributable to that account.

Ignore rules protect against accidental additions; they do not redact output,
comments, release assets, or files deliberately staged with `git add -f`.
Deleting identifying material in a later commit does not erase earlier history.
Use short redacted excerpts when reporting a failure and inspect screenshots
for prompts, open tabs, account names, and local paths.

## Extension diagnostics

The extension extracts the page selected by the reader. Article titles, URLs,
selected text, session storage, and screenshots can reveal browsing activity.
Use synthetic test pages for bug reports instead of private articles, browser
profiles, session exports, or account pages. Automated tests use an isolated
profile and local fixtures; generated test results remain ignored.
The extension's permissions and storage behavior are described in the README.
