# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts` boots the Mastra MCP server and wires registered tools. Keep new entry points small and delegate to modules.
- `src/mastra/agents` holds orchestrators; `src/mastra/tools` contains callable tools (food search, meals, audit, goals). Export through `src/mastra/index.ts`.
- `src/db` manages LanceDB schemas, embeddings, and the USDA import pipeline; default path is `./data/lance` but can be overridden with `LANCE_DB_PATH`. Avoid coupling business logic to storage paths.
- `src/api/usda-fdc.ts` wraps the USDA FoodData Central API and handles nutrient normalization.
- `tests/unit/db.test.ts` is the main suite; `tests/debug*.ts` are ad-hoc scripts. `data/` stores LanceDB snapshots and USDA artifacts—treat as generated state.

## Build, Test, and Development Commands
- Install: `bun install`.
- Run once: `bun start` (runs `bun run src/index.ts`). Watch mode: `bun dev`.
- Type check only: `bun run typecheck`.
- Tests: `bun test` or `bun test tests/unit/db.test.ts`. Requires `OPENAI_API_KEY` for embedding-dependent cases; those specs are skipped otherwise.
- USDA ingest: `bun run src/db/usda-import.ts` (needs `USDA_FDC_API_KEY`; writes to `data/lance`).

## Coding Style & Naming Conventions
- TypeScript + ES modules; follow existing 2-space indentation and keep imports ordered by path clarity.
- Prefer explicit types and reuse shapes from `src/types.ts` and `src/db/schemas.ts`. Functions and variables are `camelCase`; classes/types/interfaces are `PascalCase`; file names use `kebab-case`.
- Use async/await and return plain objects for tool I/O; keep side effects isolated in `db` layer. No repo-level linter is configured—match the current style and run `tsc` before submitting.

## Testing Guidelines
- Primary framework is `bun:test`; tests create a disposable DB at `./data/lance-test` (see `tests/setup.ts`). Do not point tests at real data directories.
- Embedding and semantic-search tests call OpenAI; set `OPENAI_API_KEY` to run them, or expect them to skip via `describe.skipIf`.
- Add focused unit tests alongside existing suites when changing database, embedding, or tool behavior. Integration tests can live under `tests/integration` if expanded.

## Commit & Pull Request Guidelines
- Use concise, imperative commit subjects (e.g., “Add meal search pagination”). Include why a change is needed when it is not obvious.
- In PRs, link related issues or research notes, list key commands run (`bun test`, `bun run typecheck`), and note any data migrations or new env vars. Add screenshots or sample tool outputs when altering agent or USDA flows.

## Configuration & Security Tips
- Required secrets: `OPENAI_API_KEY` for embeddings; `USDA_FDC_API_KEY` for imports; optional `LANCE_DB_PATH` for custom storage. Keep them in local `.env` files and never commit.
- Generated LanceDB or USDA exports can be large—avoid committing new binaries unless explicitly requested and document any dataset refresh steps.
