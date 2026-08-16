# Roomary

## Inspiration

Writers often lose track of spatial details: where a window is, which wall holds a desk, or how a room changes between scenes. Roomary was inspired by the idea of turning those written descriptions into a visual source of truth: a spatial memory that evolves with the story.

![Roomary demo](https://raw.githubusercontent.com/migarci2/roomary/main/page/habitacion.gif)

## What it does

Roomary compiles English or Spanish room descriptions into a validated scene graph and an editable 3D environment. Writers can move and recolour furniture, apply later passages as incremental changes, preserve spatial relationships, restore previous versions, manage multiple rooms, and export a scene as an image.

Unlike a text-to-image generator, Roomary keeps an editable spatial truth. A change such as “the chair is gone; add a plant beside the desk” becomes a semantic patch (`− Chair · + Plant · beside Desk`) while unrelated objects and earlier versions remain intact.

## How we built it

The interface uses HTML, CSS, JavaScript, Three.js, and WebGL. Behind the existing editor flow, `scene-core.mjs` acts as a versioned spatial compiler: it extracts entities, colours, removals, and relations; applies add/remove/recolour operations; solves `beneath`, `beside`, and `facing` constraints; resolves collisions; validates bounds and referential integrity; and produces a stable scene hash.

An optional Node server sends prose to OpenAI Structured Outputs for schema-constrained semantic canonicalisation. The model never supplies trusted coordinates: its output passes through the same deterministic compiler and validator. Requests have size limits and timeouts, provider failures fall back locally, and every result reports honest provenance (`openai` or `local`), latency, warnings, and cache status.

Validated plans are cached by a canonical SHA-256 request hash in SQLite with prepared statements and bounded retention. The browser validates saved state, keeps recoverable scene versions in Web Storage, preserves drafts during cross-tab synchronisation, and rejects stale asynchronous results before they can overwrite a newer edit.

We used Codex as an implementation assistant for parts of the compiler, API hardening, automated tests, and browser QA.

## Challenges we ran into

The hardest problem was turning ambiguous prose into useful spatial constraints without letting probabilistic model output corrupt the scene. We also had to make patches preserve unrelated furniture and existing relationships, prevent collisions, keep 3D editing approachable, and make destructive or concurrent changes recoverable without adding friction to the writing workflow.

## Accomplishments that we're proud of

We built a complete prose-to-3D workflow with direct object manipulation, bilingual interpretation, semantic scene patches, multiple rooms, persistent version history, restoration, image export, validated AI integration, deterministic fallback, and cache provenance. The same product remains fully usable without an account, installation, or API key.

## What we learned

Visualization makes continuity errors visible in a way prose alone often does not. We also learned that the strongest architecture for this problem is hybrid: AI handles language ambiguity, while deterministic code owns geometry, validation, persistence, and safety.

## What's next for Roomary

Next, we want to expand the object and architecture ontology, flag continuity contradictions across chapters, support richer procedural assets, and add shareable stories and collaborative editing. The scene graph also creates a foundation for floor plans, accessibility checks, and consistent visual references across an entire novel.

## Run locally

Node 22.13 or newer is required. There are no package dependencies to install.

```bash
npm start
```

Open <http://localhost:4173> or <http://localhost:4173/editor.html>. Without an API key, the same UI uses the deterministic local compiler. To enable Structured Outputs:

```bash
OPENAI_API_KEY=your_key npm start
```

`OPENAI_MODEL`, `PORT`, `ROOMARY_DB_PATH`, and `ROOMARY_CACHE_MAX_ENTRIES` are optional. The server binds to `127.0.0.1`; for a trusted remote environment, set `HOST` and list its public hostnames in `ROOMARY_ALLOWED_HOSTS` (comma-separated). A static fallback also works with `python3 -m http.server 4173`.

## Verification

```bash
npm test
```

The dependency-free Node suite covers bilingual compilation, relation-preserving patches, recolour/remove/add operations, deterministic hashes, invalid scene rejection, HTTP limits, local fallback, Structured Outputs, referential integrity, and bounded SQLite caching.

## Project structure

- `index.html` — product landing page.
- `editor.html` — Three.js editor, persistence, and unchanged demo flow.
- `scene-core.mjs` — scene compiler, graph, geometry, patches, and validation.
- `server.mjs` — static server, compile API, optional OpenAI adapter, and SQLite cache.
- `test/` — dependency-free Node tests.
- `assets/` and `page/` — product imagery and demo media.
