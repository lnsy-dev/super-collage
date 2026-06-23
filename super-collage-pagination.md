# super collage pagination

Project document for super collage pagination

## Goals

We are updating http://supercollage.art/ to have page imposition tools. We want to be able to  create booklets that let us output to pages. For instance, we should be able to generate a 12 page zine with pages that are 5.5" x 8.5". It should give us an output, per layer of "cover", "front-cover-layer", etc. We should be able to switch between pages. It should give us pages we can move between, have special layouts for the spread, etc.  When we export plates it should export per page, per layer. 

We want to generate a detailed product specification for this feature, with edge cases, etc.

## Critical Facts

_Record important facts that agents should remember._

## Research & Findings

Codebase audited from the attached source (super-collage-main, ~4,350 lines of app JS).

- Stack: vanilla ES modules, no framework. Rust→WASM is only for color blend / color separation. 600 DPI document pixels (5.5"×8.5" = 3300×5100). CANVAS_W/CANVAS_H are mutable module globals in constants.js (setCanvasSize).
- Real entry point: the inline module in index.html (~lines 705–778) — imports all src/app modules, exposes them on window for e2e, calls init(). NOTE: src/main.js is dead code (imports a nonexistent components/ folder); do not use it.
- State (state.js): single object with project + layers[] (bottom→top) + selection + zoom + undo/redo. selectedLayer() helper.
- Layer (layer.js): rich class; toRecord()/fromRecord() define persistence; runtime canvases (_originalCanvas, _processedCanvas, _maskCanvas) are not persisted; image-mask relations via imageMaskIds / isMaskFor.
- DB (db.js): IndexedDB "superCollage" v2; stores projects, layers (index by-project), imageBlobs, maskBlobs. Dominant pattern (~12 sites): DB.put('projects', {...State.project, layerOrder: State.layers.map(l=>l.id)}).
- Renderer (renderer.js) and ExportEngine (export-engine.js) read State.layers + the CANVAS_W/H globals directly. Export = one greyscale PNG per riso color (white skipped); composite = subtractive WASM blend. Existing _tileCanvas N-up only repeats the SAME page (not real imposition).
- Undo (undo.js): global stacks on State; per-layer and whole-state snapshots.
- UI/DOM (index.html): menu-bar, left toolbar, center canvas-scroll/wrapper, right-panel (layers + properties), status-bar; new-project dialog uses radios name="new-page-size" + custom-size-row.
- Tests: Playwright e2e under e2e/ with helpers.js (createProject supports pageSize/orientation). Tests read global State.
- No existing page / spread / booklet / signature / imposition concept anywhere.

## Decisions

Proposed architecture decisions for the pagination feature (pending user approval of the plan):

1. Active-page-mirrors-State.layers: State.layers always reflects the ACTIVE page; a new PageManager swaps layer sets on page switch. Lowest blast radius — renderer, image processor, mask engine, events, properties, layer list keep working unchanged.
2. Pages are first-class IndexedDB records: new "pages" store, layer gains pageId, project gains pageOrder[] + booklet metadata. DB version 2→3 with a migration wrapping each existing project's layers into one default page.
3. Centralize persistence: replace the ~12 "DB.put projects with layerOrder" sites with one helper that writes the ACTIVE PAGE's order.
4. Parameterize Renderer and ExportEngine to accept an explicit (layers, width, height) instead of reading State.layers + CANVAS_W/H globals — prerequisite for multi-page export, spreads, and imposition.
5. Separate reader pages from printer sheets; imposition (saddle-stitch) is a pure, unit-testable transform in its own module (imposition.js).
6. Memory: only the active page is fully hydrated with bitmaps; other pages are lazy-hydrated on switch/export.

## Tasks

### Todo

### In Progress

### Done

- [x] DB migration v2 → v3: add `pages` store, `by-page` index, wrap existing projects into one default page.
- [x] Data model: `Layer.pageId`, `Project.pageOrder` + `booklet`, lightweight `State.pages` cache.
- [x] `PageManager` module: create/load/save/reorder/duplicate/delete pages; lazy hydration.
- [x] Project creation dialog: page-count presets (1 / 4 / 8 / 12 / 16).
- [x] Pages panel in right sidebar with list, rename, drag reorder, add/duplicate/delete.
- [x] Centralize persistence: all layer/page writes route through `PageManager.saveActivePage()`.
- [x] Parameterize `Renderer.drawLayers(layers, width, height)` and `ExportEngine.exportLayers()`.
- [x] `imposition.js`: layout calculation for any source page + target paper; saddle-stitch ordering.
- [x] Export dialog: current/all pages, binding, target paper size with auto pages-per-sheet info.
- [x] Multi-page export: per-page plates or imposed sheets (N-up / saddle-stitch).
- [x] E2E coverage: `e2e/pagination.spec.js`.

## Notes

- Spread view is not implemented in this first pass; pages are edited and exported individually.
- Mixed page sizes within a project are not supported; all pages share the project's base page size.
- Saddle-stitch output emits one PNG per printer spread (two pages side-by-side); duplex printing handles front/back registration.
- Existing e2e suite passes (one pre-existing screentone count assertion updated to match current asset count).
