# Cascadia Mono

`CascadiaMono.woff2` is vendored from the Cascadia Code project.

- Source: https://github.com/microsoft/cascadia-code (v2404.23)
- License: SIL Open Font License 1.1 — https://github.com/microsoft/cascadia-code/blob/main/LICENSE
- Copyright (c) Microsoft Corporation

**Why the Mono variant rather than Cascadia Code:** Cascadia Code ships programming ligatures, which
would rewrite sequences inside the filenames and shell commands this app displays — `--hard` becoming
a single long dash, for instance. Mono is the same typeface without them.

**Why vendored at all:** it is the only font verified to carry the braille patterns used by the status
spinner. Menlo, Monaco and JetBrains Mono were each checked and none of them have the U+2800 block;
macOS falls back to Apple Braille, which renders as faint specks at this size.
