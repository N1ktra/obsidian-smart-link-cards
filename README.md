# Smart Link Cards

Purely visual link cards and inline pills for web links in Obsidian – **your Markdown is never modified**.
No code blocks, no proprietary syntax, no files written into your vault.

## Display modes

| Source | Rendering |
| --- | --- |
| A link alone on its line (`https://…` or `[Title](https://…)`) | **Block card**: favicon · title · description · hostname |
| A link in running text, lists, quotes, headings or tables | **Inline pill**: favicon + link text |

As soon as the cursor/selection touches a link (inline) or its line (block), the original Markdown is shown for editing.
Block-link lines reserve the card height in both states, so toggling causes no layout jumps.
Hover a card in Live Preview and click the ✏️ button to jump into the source.

## Manual overrides (100 % standard Markdown)

```md
[Moodle](https://moodle.uni.example "Course portal | 🎓")
[Intranet](https://intra.example "Internal wiki | https://intra.example/logo.png")
[Vault image](https://example.com "My note | [[attachments/icon.png]]")
[Docs](https://docs.example "Only a description")
```

- `[…]` → title
- title attribute before the pipe → description; after it → icon (vault image `[[image.png]]`, web image URL, or emoji)
- vault images can be referenced using Obsidian wikilinks: `[[Bild.jpg]]` or `![[attachments/logo.png]]` (with or without alias/size)
- without `|` → the whole text is the description (unless it is a vault image like `[[Bild.jpg]]`)
- Manual values always win. If title, description and icon are all given, nothing is fetched at all (ideal for bot-protected pages).

## Caching & Git discipline

- Metadata is stored in `cache.json` inside the plugin folder (settings stay in `data.json`).
- `fetchedAt` is written once per successful fetch and never updated on read.
- Cache hits never cause disk writes. Writes only happen after new or refreshed (expired) fetches, debounced and with sorted keys for minimal diffs.
- Failed fetches are only remembered in memory (10 min cooldown) and never persisted.
- All requests use Obsidian's `requestUrl()` (no CORS issues on iOS/Android). Favicons are referenced by URL only.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # typecheck + production build
npm run test     # Vitest suite
```

### Project layout

| File | Purpose |
| --- | --- |
| `src/parser.ts` | Pure Markdown link parser (block/inline, code skipping, title overrides) |
| `src/fetcher.ts` | `requestUrl()` + DOM-free OpenGraph/HTML parsing |
| `src/cache.ts` | Git-friendly `cache.json` store |
| `src/metadataService.ts` | Deduplicated, rate-limited background fetching + notifications |
| `src/display.ts`, `src/favicon.ts` | Pure view-model & favicon resolution |
| `src/render.ts` | Native DOM rendering of cards/pills (`createEl`) |
| `src/livePreview.ts` | CodeMirror 6 `ViewPlugin` + `WidgetType` decorations |
| `src/readingMode.ts` | `registerMarkdownPostProcessor` integration |
| `src/settings.ts`, `src/settingsTab.ts` | Native declarative settings schema (`getSettingDefinitions()`, `SettingDefinitionItem` from `obsidian`) + Obsidian 1.13+ integration with backward-compatible `display()` fallback |
