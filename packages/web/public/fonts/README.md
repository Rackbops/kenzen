# Self-hosted fonts

kenzen#96 (brand epic #88): the kanji wordmark 健全性 needs Shippori Mincho, but the app is
behind Access, so it never calls the Google Fonts CDN -- these are subset woff2s built once,
at commit time, and served from `packages/web/public/fonts/` alongside the app.

## shippori-mincho-kenzen.woff2

- **Source**: [google/fonts](https://github.com/google/fonts), path
  `ofl/shipporimincho/ShipporiMincho-Regular.ttf`, at commit
  [`01fe2d3`](https://github.com/google/fonts/commit/01fe2d31ea04a7d2d294f0698c16544b63bbc87d)
  (2021-07-09), itself mirroring the upstream
  [fontdasu/ShipporiMincho](https://github.com/fontdasu/ShipporiMincho) project.
- **License**: SIL Open Font License, Version 1.1. Full text in `OFL.txt` in this directory
  (copied from the same commit above). Copyright 2021 The Shippori Mincho Project Authors.
- **Subset**: exactly the three code points the wordmark and empty-state heading use --
  U+5065 (健), U+5168 (全), U+6027 (性) -- nothing else. Built with:
  ```
  pip install fonttools brotli
  pyftsubset ShipporiMincho-Regular.ttf --text="健全性" --flavor=woff2 --output-file=shippori-mincho-kenzen.woff2
  ```
  Regular weight only -- no header usage needs Bold. Result: 1448 bytes.

To refresh (a new code point is needed, or the upstream font is revised): re-download the
Regular TTF from the source commit above (or a newer one), re-run the subset command with the
updated `--text`, and update this file's commit reference and byte count.
