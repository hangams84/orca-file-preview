// UTIF.js 3.1.0 (MIT, https://github.com/photopea/UTIF.js): TIFF decoder (LZW, PackBits, Deflate,
// JPEG-in-TIFF, CCITT), used for TIFF pictures that browsers other than Safari cannot show.
import UTIF from 'utif'
export const decode = UTIF.decode
export const decodeImage = UTIF.decodeImage
export const toRGBA8 = UTIF.toRGBA8
