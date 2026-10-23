# Report fonts

Bundled unmodified Noto Sans Regular and Noto Sans Devanagari Regular for private PDF exports. The Latin font uses OFL.txt; the Devanagari font uses OFL-Devanagari.txt (both SIL Open Font License 1.1). The Devanagari file is the unmodified variable font with default regular weight, including Latin glyphs for mixed-language text. Their embedded copyright/license notices are retained in the original TTF files.

Sources (downloaded 23 October 2026):
- https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf
- https://github.com/google/fonts/blob/main/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf
- https://github.com/notofonts/noto-fonts/blob/main/LICENSE

Keep this assets directory with the compiled API in any packaged deployment. PDF generation reads bundled fonts only; no user-provided paths or external font requests are supported.

Copyright notices: Noto Sans - Copyright 2015-2021 Google LLC. All Rights Reserved. Noto Sans Devanagari - Copyright 2022 The Noto Project Authors (https://github.com/notofonts/devanagari).
