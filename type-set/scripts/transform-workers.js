/**
 * Web Worker Inline Loader for Webpack
 * 
 * This loader transforms web worker imports into inline Blob-based workers.
 * It detects patterns like:
 *   new Worker(new URL('./worker.js', import.meta.url))
 * 
 * And transforms them to:
 *   (function() {
 *     const __workerCode = `[bundled worker code]`;
 *     const blob = new Blob([__workerCode], { type: 'application/javascript' });
 *     const url = URL.createObjectURL(blob);
 *     const worker = new Worker(url);
 *     URL.revokeObjectURL(url);
 *     return worker;
 *   })()
 * 
 * This allows workers to be bundled into a single file for CDN deployment.
 * 
 * @module worker-inline-loader
 */

import fs from 'fs';
import path from 'path';

/**
 * Webpack loader function
 * 
 * @param {string} source - The source code of the file being processed
 * @returns {string} Transformed source code
 */
export default function workerInlineLoader(source) {
  const callback = this.async();
  const resourcePath = this.resourcePath;
  const resourceDir = path.dirname(resourcePath);
  
  // Match new Worker(new URL(...)) patterns
  const workerRegex = /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)\s*\)/g;
  
  let matches = [];
  let match;
  while ((match = workerRegex.exec(source)) !== null) {
    matches.push({
      full: match[0],
      workerPath: match[1],
      index: match.index
    });
  }
  
  if (matches.length === 0) {
    callback(null, source);
    return;
  }
  
  // Process all worker imports
  Promise.all(
    matches.map(async ({ workerPath }) => {
      const resolvedPath = path.resolve(resourceDir, workerPath);
      
      // Add the worker file as a dependency so webpack watches it
      this.addDependency(resolvedPath);
      
      try {
        const workerCode = fs.readFileSync(resolvedPath, 'utf-8');
        return { workerPath, workerCode, resolvedPath };
      } catch (error) {
        this.emitError(new Error(`Failed to read worker file: ${resolvedPath}`));
        return null;
      }
    })
  ).then((workerData) => {
    let transformedSource = source;
    
    // Replace each worker import with inline code
    matches.forEach(({ full, workerPath }, index) => {
      const data = workerData[index];
      if (!data || !data.workerCode) return;
      
      // Escape backticks and backslashes in worker code
      const escapedCode = data.workerCode
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');
      
      // Generate the inline worker creation
      const inlineWorker = `(function() {
  const __workerCode = \`${escapedCode}\`;
  const blob = new Blob([__workerCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
})()`;
      
      transformedSource = transformedSource.replace(full, inlineWorker);
    });
    
    callback(null, transformedSource);
  }).catch((error) => {
    callback(error);
  });
}
