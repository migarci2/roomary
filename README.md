# Roomary

Turn a written room description into a persistent, editable 3D place for a story.

## Run locally

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173>. No install, account, or API key is required.

## Demo flow

1. Build the prefilled bedroom from text.
2. Select and move furniture in the 3D room.
3. Click the suggested scene change, then **Apply as change**.
4. Restore an earlier version or export the room as an image.
5. Add another room from the story sidebar.

Roomary stores stories, rooms, and versions in browser `localStorage`. The current text interpreter is intentionally local and deterministic so the demo remains reliable; its structured output can later be replaced by an LLM call.
