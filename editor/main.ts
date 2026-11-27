/** Entry of the bytes editors: Orca sends binary files as bytes with their manifest suffix in fileType.
 *  Text files go through editor/text/<ext>.ts (contentKind "text"), which pass the suffix themselves. */
import { boot } from './app.ts'

export { RENDERERS, sameBytes } from './app.ts'

boot()
