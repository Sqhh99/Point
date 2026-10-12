# Database fixtures

Real workspaces written by old Point code, used by `test/main/migrate-fixture.test.ts`.
Never edit these by hand; regenerate with the scripts here.

| dir | written by | schema |
| --- | --- | --- |
| `v0.1.0/` | v0.1.0 (`fd0cb6a`) `openWorkspace` / `importFile` / `NoteStore` / `settings` / `conversations` | docs + conversations + messages (with `meta`), `user_version` 0, WAL |
| `v0.0-docs-only/` | `8be18b1` (#5, before conversations existed) | docs only, `user_version` 0 |

`workspace/` is the workspace folder (`.point/index.db`, `docs/`, `notes/`); `userData/settings.json`
is the app settings file (API key encrypted by the test safeStorage mock, not a real key).

No shipped build ever had `messages` without `meta`: the column and the table arrived in the same
commit (`db65e5f`, #7). That path stays covered by the synthetic case in `migrate.test.ts`.

Regenerate: see the header of `generate-v010.gen.ts.txt` / `generate-v000-docs-only.gen.ts.txt`
(kept as `.txt` so the current typecheck/lint don't pick up code that only builds on old commits).
