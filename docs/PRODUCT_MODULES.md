# Product modules vs workstream blocks

**Product modules** (`ProductModuleKey` in `@fitgo/shared-types`) — runtime toggles for nav/API. Managed at `/super-admin/modules`. Default ON except `membership_shop` and `wearables`.

**Agent workstream B0–B10** (`.cursor/rules/workstream-blocks.mdc`) — Cursor focus boundaries for developers, not product flags.

Do not hide surfaces via agent rules; use the modules panel.
