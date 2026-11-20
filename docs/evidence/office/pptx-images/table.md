| Case | Deck · slide | before | after | Side by side |
| --- | --- | --- | --- | --- |
| PNG RGB | formats · 1 | ✅ PASS (0.0) | ✅ PASS (0.0) | [before](formats-png-rgb.before.jpg) [after](formats-png-rgb.after.jpg) |
| PNG RGBA (transparent quadrant over magenta) | formats · 2 | ✅ PASS (0.4) | ✅ PASS (0.4) | [before](formats-png-rgba.before.jpg) [after](formats-png-rgba.after.jpg) |
| PNG 16-bit grayscale gradient | formats · 3 | ✅ PASS (0.4) | ✅ PASS (0.4) | [before](formats-png-16bit.before.jpg) [after](formats-png-16bit.after.jpg) |
| PNG palette (16 colours) | formats · 4 | ✅ PASS (0.1) | ✅ PASS (0.1) | [before](formats-png-palette.before.jpg) [after](formats-png-palette.after.jpg) |
| JPEG baseline | formats · 5 | ✅ PASS (0.2) | ✅ PASS (0.2) | [before](formats-jpg-baseline.before.jpg) [after](formats-jpg-baseline.after.jpg) |
| JPEG progressive | formats · 6 | ✅ PASS (0.4) | ✅ PASS (0.4) | [before](formats-jpg-progressive.before.jpg) [after](formats-jpg-progressive.after.jpg) |
| JPEG CMYK ¹ | formats · 7 | 🟡 CLOSE (18.6) | 🟡 CLOSE (18.6) | [before](formats-jpg-cmyk.before.jpg) [after](formats-jpg-cmyk.after.jpg) |
| JPEG grayscale | formats · 8 | ✅ PASS (0.5) | ✅ PASS (0.5) | [before](formats-jpg-gray.before.jpg) [after](formats-jpg-gray.after.jpg) |
| JPEG EXIF orientation 6 (arrow must point up) | formats · 9 | 🟠 DIFFERENT (37.4) | ✅ PASS (0.6) | [before](formats-jpg-exif6.before.jpg) [after](formats-jpg-exif6.after.jpg) |
| GIF static | formats · 10 | ✅ PASS (0.1) | ✅ PASS (0.1) | [before](formats-gif-static.before.jpg) [after](formats-gif-static.after.jpg) |
| GIF animated (3 frames) | formats · 11 | ✅ PASS (0.3) | ✅ PASS (0.3) | [before](formats-gif-animated.before.jpg) [after](formats-gif-animated.after.jpg) |
| BMP 24-bit | formats · 12 | ✅ PASS (0.3) | ✅ PASS (0.3) | [before](formats-bmp-24.before.jpg) [after](formats-bmp-24.after.jpg) |
| BMP 32-bit with alpha (over magenta) | formats · 13 | ✅ PASS (0.4) | ✅ PASS (0.4) | [before](formats-bmp-32.before.jpg) [after](formats-bmp-32.after.jpg) |
| TIFF LZW | formats · 14 | ❌ MISSING (90.8) | ✅ PASS (0.1) | [before](formats-tif-lzw.before.jpg) [after](formats-tif-lzw.after.jpg) |
| TIFF multipage (page 1) | formats · 15 | ❌ MISSING (90.9) | ✅ PASS (0.3) | [before](formats-tif-multipage.before.jpg) [after](formats-tif-multipage.after.jpg) |
| ICO ¹ | formats · 16 | ✅ PASS (3.8) | 🟠 DIFFERENT (58.7) | [before](formats-ico.before.jpg) [after](formats-ico.after.jpg) |
| WebP | formats · 17 | ✅ PASS (0.3) | ✅ PASS (0.3) | [before](formats-webp.before.jpg) [after](formats-webp.after.jpg) |
| AVIF | formats · 18 | ✅ PASS (0.3) | ✅ PASS (0.3) | [before](formats-avif.before.jpg) [after](formats-avif.after.jpg) |
| SVG (svgBlip + PNG fallback) | formats · 19 | ✅ PASS (0.1) | ✅ PASS (0.1) | [before](formats-svg.before.jpg) [after](formats-svg.after.jpg) |
| EMF: shapes and text (pasted as enhanced metafile) | formats · 20 | ❌ MISSING (74.7) | ✅ PASS (0.4) | [before](formats-emf-shapes.before.jpg) [after](formats-emf-shapes.after.jpg) |
| EMF: bitmap inside a metafile | formats · 21 | ❌ MISSING (85.8) | ✅ PASS (0.5) | [before](formats-emf-bitmap.before.jpg) [after](formats-emf-bitmap.after.jpg) |
| WMF: rectangle, ellipse, polygon and text | formats · 22 | ❌ MISSING (50.2) | ✅ PASS (4.6) | [before](formats-wmf-shapes.before.jpg) [after](formats-wmf-shapes.after.jpg) |
| WMF: bitmap (META_STRETCHDIB) | formats · 23 | ❌ MISSING (84.7) | ✅ PASS (1.4) | [before](formats-wmf-bitmap.before.jpg) [after](formats-wmf-bitmap.after.jpg) |
| Tiny 8x8 PNG scaled up | specs · 1 | ✅ PASS (1.7) | ✅ PASS (1.7) | [before](specs-tiny-8x8.before.jpg) [after](specs-tiny-8x8.after.jpg) |
| Extreme aspect 50:1 | specs · 2 | ✅ PASS (0.2) | ✅ PASS (0.2) | [before](specs-aspect-wide.before.jpg) [after](specs-aspect-wide.after.jpg) |
| Extreme aspect 1:30 | specs · 3 | ✅ PASS (0.0) | ✅ PASS (0.0) | [before](specs-aspect-tall.before.jpg) [after](specs-aspect-tall.after.jpg) |
| Cropped 25% left and top (srcRect) | specs · 4 | ✅ PASS (0.1) | ✅ PASS (0.1) | [before](specs-crop-25.before.jpg) [after](specs-crop-25.after.jpg) |
| Negative crop (picture smaller than its frame) | specs · 5 | ✅ PASS (0.5) | ✅ PASS (0.5) | [before](specs-crop-negative.before.jpg) [after](specs-crop-negative.after.jpg) |
| Rotated 30 degrees | specs · 6 | ✅ PASS (0.2) | ✅ PASS (0.2) | [before](specs-rotate-30.before.jpg) [after](specs-rotate-30.after.jpg) |
| Flipped horizontally | specs · 7 | ✅ PASS (0.6) | ✅ PASS (0.6) | [before](specs-flip-h.before.jpg) [after](specs-flip-h.after.jpg) |
| Flipped vertically | specs · 8 | ✅ PASS (0.4) | ✅ PASS (0.4) | [before](specs-flip-v.before.jpg) [after](specs-flip-v.after.jpg) |
| Recolour: grayscale | specs · 9 | 🟠 DIFFERENT (42.2) | ✅ PASS (0.5) | [before](specs-grayscale.before.jpg) [after](specs-grayscale.after.jpg) |
| Recolour: black and white | specs · 10 | 🟠 DIFFERENT (74.8) | ✅ PASS (0.0) | [before](specs-black-white.before.jpg) [after](specs-black-white.after.jpg) |
| Recolour: washout | specs · 11 | 🟠 DIFFERENT (77.4) | ✅ PASS (0.1) | [before](specs-washout.before.jpg) [after](specs-washout.after.jpg) |
| Brightness 70% / contrast 30% | specs · 12 | 🟠 DIFFERENT (53.7) | ✅ PASS (0.1) | [before](specs-bright-contrast.before.jpg) [after](specs-bright-contrast.after.jpg) |
| Set transparent colour (red quadrant) | specs · 13 | ✅ PASS (11.1) | ✅ PASS (0.4) | [before](specs-transparent-color.before.jpg) [after](specs-transparent-color.after.jpg) |
| Recolour: duotone (blue) | specs · 14 | 🟠 DIFFERENT (50.8) | ✅ PASS (4.1) | [before](specs-duotone.before.jpg) [after](specs-duotone.after.jpg) |
| Picture transparency 50% (over magenta) | specs · 15 | 🟠 DIFFERENT (39.7) | ✅ PASS (0.3) | [before](specs-alpha-50.before.jpg) [after](specs-alpha-50.after.jpg) |
| Picture placeholder | placements · 1 | ✅ PASS (0.0) | ✅ PASS (0.0) | [before](placements-placeholder.before.jpg) [after](placements-placeholder.after.jpg) |
| Shape picture fill (stretch) | placements · 2 | 🟠 DIFFERENT (55.7) | ✅ PASS (0.6) | [before](placements-fill-stretch.before.jpg) [after](placements-fill-stretch.after.jpg) |
| Shape picture fill (tile) | placements · 3 | 🟠 DIFFERENT (75.2) | ✅ PASS (0.8) | [before](placements-fill-tile.before.jpg) [after](placements-fill-tile.after.jpg) |
| Slide background picture | placements · 4 | ✅ PASS (3.6) | ✅ PASS (0.4) | [before](placements-background.before.jpg) [after](placements-background.after.jpg) |
| Picture in a table cell | placements · 5 | 🟡 CLOSE (14.1) | ✅ PASS (5.6) | [before](placements-table-cell.before.jpg) [after](placements-table-cell.after.jpg) |
| Pictures inside a group | placements · 6 | ✅ PASS (0.4) | ✅ PASS (0.4) | [before](placements-group.before.jpg) [after](placements-group.after.jpg) |
| Picture on the layout | placements · 7 | ✅ PASS (0.1) | ✅ PASS (0.1) | [before](placements-layout-picture.before.jpg) [after](placements-layout-picture.after.jpg) |
| Picture on the master | placements · 8 | ✅ PASS (0.1) | ✅ PASS (0.1) | [before](placements-master-picture.before.jpg) [after](placements-master-picture.after.jpg) |
| Linked (external) picture ¹ | placements · 9 | 🟡 CLOSE (16.0) | 🟡 CLOSE (16.3) | [before](placements-linked.before.jpg) [after](placements-linked.after.jpg) |
| Very large JPEG 8000x6000 (48 MP) | large · 1 | ✅ PASS (0.1) | ✅ PASS (0.1) | [before](large-huge-jpg.before.jpg) [after](large-huge-jpg.after.jpg) |
| Very large PNG 8000x6000 (48 MP) | large · 2 | ✅ PASS (0.3) | ✅ PASS (0.3) | [before](large-huge-png.before.jpg) [after](large-huge-png.after.jpg) |

¹ ICO: PowerPoint stores the .ico but cannot display it (its export shows a 'picture can't be displayed' box); the preview shows the icon.  
¹ Linked (external) picture: A linked picture is not inside the file; PowerPoint's export shows its broken-link graphic here, the preview shows a placeholder with the linked path (it has no file access).  
¹ JPEG CMYK: PowerPoint applies a press (SWOP-like) profile to untagged CMYK JPEGs, so its colours are muted; browsers convert CMYK naively.  
