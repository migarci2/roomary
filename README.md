# Roomary

A spatial notebook for fiction writers. Turn a written room description into a persistent, editable 3D place, then revise it as the story changes.

![Roomary bedroom scene](assets/roomary-bedroom.png)

## What it does

- Builds a furnished 3D room from a short English or Spanish description.
- Lets you select, move, rotate, recolour, add, and remove objects.
- Keeps multiple rooms and restorable scene versions in the browser.
- Exports the current room as a PNG.

## Run locally

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173> for the landing page or <http://localhost:4173/editor.html> for the editor. No install, account, or API key is required.

A modern browser with WebGL is required. The first load needs internet access for Three.js and the web fonts served from CDNs.

## Demo flow

1. Build the prefilled bedroom from text.
2. Select and move furniture in the 3D room.
3. Click the suggested scene change, then **Apply as change**.
4. Restore an earlier version or export the room as an image.
5. Add another room from the story sidebar.

## How it works

Roomary is a dependency-free static site built with HTML, CSS, JavaScript, and Three.js. Stories, rooms, and versions are stored in browser `localStorage` under `roomary-state-v1`.

The text interpreter is intentionally local and deterministic: it recognises a small furniture catalogue and a few spatial or removal instructions. This keeps the demo reliable without a backend; it is not a general-purpose language model.

## Project structure

- `index.html` — product landing page.
- `editor.html` — complete 3D editor and local state logic.
- `assets/` — landing and social preview images.
