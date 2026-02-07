# Release Note (2026-02-07)

## Highlights

- Refactored handler flow into smaller modules:
  - `incoming.flow.ts`
  - `event.flow.ts`
  - `execution.flow.ts`
  - `message.delivery.ts`
  - `command.ts`
- Improved execution/tool-step message aggregation behavior to reduce message spam and keep final answer separated.
- Added stronger runtime/state typing in handler and bridge paths, reducing `any` usage and aligning with SDK event shapes.
- Improved slash-command support and routing consistency.

## Slash Command Updates

- Added/updated bridge commands:
  - `/status`
  - `/reset` (alias: `/restart`) for runtime reset + new session
  - `/sessions delete 1,2,3` (batch delete)
  - `/sessions delete all` (delete all except current)
  - `/agent` (list)
  - `/agent <index|name>` (switch)
  - `/models <providerIndex.modelIndex>` (switch)
- Improved command help text and command feedback formatting.

## Session / Agent / Model State

- Session/agent/model state handling is now clearer in status output.
- Model display in status/footer was simplified to reduce noise.

## Feishu Rendering / UX

- Iterative improvements to execution panel rendering and status rendering.
- Reduced noisy debug logging while retaining key diagnostic logs.


## Documentation

- Updated `README.md` command section to include new/extended command behaviors and examples.
