# @wren/pipeline: routes

Services: 2.

## Journeys (service)

File: packages/pipeline/src/restate.ts

- **assign** `AssignRequest` → `restate.RestatePromise<{ journey: string; owner: string | null; }>` (serviceHandler)
- **drop** `DropRequest` → `{ journey: string; node: string; }` (serviceHandler)
- **move** `MoveRequest` → `{ journey: string; from: string; to: string; status: "open" | "done" | "dropped"; }` (serviceHandler)
- **open** `OpenRequest` → `{ journey: string; node: string; }` (serviceHandler)
- **rebuild** `RebuildRequest` → `restate.RestatePromise<import("./moves.js").Rebuilt>` (serviceHandler)

## PipelineConsole (service via `portalService`)

File: packages/pipeline/src/console.ts

- **dealsSign** `DealSignRequest` → `{ deal: string; termsVersion: number; changed: boolean; }` (serviceHandler)
- **journeysAssign** `JourneyAssignRequest` → `{ journey: string; owner: string | null; }` (serviceHandler)
- **journeysDrop** `JourneyDropRequest` → `{ journey: string; node: string; }` (serviceHandler)
- **journeysMove** `JourneyMoveRequest` → `{ journey: string; from: string; to: string; status: string; }` (serviceHandler)
- **journeysOpen** `JourneyOpenRequest` → `{ journey: string; node: string; }` (serviceHandler)
- **mapRead** `PortalRequest & { window: MapWindow }` → `MapAnswer` (serviceHandler)
- **offersSync** `PortalRequest` → `import("./store.js").OfferSync` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler)
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler)
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler)
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler)
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler)
- **shapeAttach** `AttachRequest` → `AttachAnswer` (serviceHandler)
- **shapeBlame** `BlameRequest` → `BlameAnswer` (serviceHandler)
- **shapeDiff** `ShapeDiffRequest` → `DiffAnswer` (serviceHandler)
- **shapeDraftApply** `DraftIdRequest` → `DraftApplyAnswer` (serviceHandler)
- **shapeDraftDrop** `DraftDropRequest` → `DraftStateAnswer` (serviceHandler)
- **shapeDraftEdit** `DraftEditRequest` → `DraftEditAnswer` (serviceHandler)
- **shapeDraftNew** `DraftNewRequest` → `DraftNewAnswer` (serviceHandler)
- **shapeDraftPlan** `DraftIdRequest` → `DraftPlanAnswer` (serviceHandler)
- **shapeDraftPropose** `DraftIdRequest` → `DraftStateAnswer` (serviceHandler)
- **shapeDraftUpdate** `DraftUpdateRequest` → `DraftUpdateAnswer` (serviceHandler)
- **shapeExport** `ShapeExportRequest` → `{ text: string; }` (serviceHandler)
- **shapeImport** `ShapeImportRequest` → `{ version: number | null; changed: boolean; terms: { offer: string; plan: string; version: number; }[]; }` (serviceHandler)
- **shapePreview** `ShapePreviewRequest` → `PreviewAnswer` (serviceHandler)
- **shapeStart** `PortalRequest` → `{ version: number; }` (serviceHandler)
- **shapeTag** `TagRequest` → `TagAnswer` (serviceHandler)
- **shapeUndo** `UndoRequest` → `UndoAnswer` (serviceHandler)
- **shapeUndoPreview** `UndoRequest` → `UndoPreviewAnswer` (serviceHandler)
- **shapeVersion** `ShapeVersionRequest` → `{ version: number; }` (serviceHandler)
- **termsAdd** `TermsAddRequest` → `{ offer: string; plan: string; version: number; from: string; }` (serviceHandler)
