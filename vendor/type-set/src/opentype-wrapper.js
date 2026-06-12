/**
 * ESM-friendly wrapper around opentype.js.
 *
 * opentype.js ships as CommonJS/UMD. Node resolves the bare specifier to the
 * CJS entry (which has a default export), while browsers resolve it to the ESM
 * build via an import map. This wrapper normalizes both shapes so the rest of
 * the library can use a single default import.
 */

import * as opentype from 'opentype.js';
export default opentype;
