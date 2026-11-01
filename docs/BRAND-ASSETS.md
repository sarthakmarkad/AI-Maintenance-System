# Maintenate brand assets

The owner requested a compact icon on the left with the separate wordmark/tagline on the right, then requested removal of the white image backgrounds. Current production assets are transparent PNG cutouts processed with the built-in image generator from the supplied artwork:

- apps/web/public/brand/maintenate-icon-transparent.png: 1274 × 1235, exterior transparent; rounded charcoal tile and internal white/yellow details retained. Also used for browser/Apple icon metadata.
- apps/web/public/brand/maintenate-wordmark-outlined.png: 2170 × 725, transparent background surrounding the lettering and tagline; the yellow i-dot has a charcoal outline for contrast.

Both assets have verified alpha channels and fully transparent exterior pixels. These processed cutouts supersede the earlier byte-for-byte supplied PNG copies and generated emblem. Original user attachments remain unchanged. They are raster derivatives, not vector masters or pixel-identical originals.

BrandLogo renders the separate assets through Next Image optimization, with preserved aspect ratios, responsive sidebar/header sizes and equivalent accessible text. New asset filenames prevent optimized-image caches from retaining the white-backed versions. No CSS color blending or opaque backing is used to hide the original backgrounds.

The shared accent token remains #F5FF81. Semantic/status colors, authentication, permissions and the illustrative video are unchanged.
