# Shared implementation contract v1

The pack engine has no dependencies and uses Node 24. Trusted catalog source in `frontend/` uses pinned React/Radix Themes dependencies installed from the root lockfile with lifecycle scripts disabled. `scripts/build-ui.mjs` compiles it to `.cache/ui/`, copying only the HTML/favicon/theme bootstrap shell from `site/`. `scripts/build.mjs` then produces static `dist/`; its programmatic `buildLibrary(root, {siteRoot})` defaults to `site/` so pack engine fixtures stay dependency-free. The only alternate siteRoot is `.cache/ui/`. No pack code is imported into the catalog bundle.

The UI output contract is `index.html`, `app.js`, `app.css`, `favicon.svg`, `theme-init.js`, generated `third-party-notices.txt` and optional hashed WOFF2 files under `ui-assets/`. Notices include the licenses of bundled dependencies, not npm configuration or private metadata. Catalog HTML contains one `<meta name="csp-nonce" content="__IMON_CSP_NONCE__">`, replaced by a fresh request nonce by the HTTP server; it is never a fixed authorization value. Scripts remain same-origin-only. This catalog transport exception does not change any preview, raw-file or published-pack contract below.

Catalog inline style elements require the request nonce, except for two exact SHA-256-authorized scrollbar-hiding rules emitted by the pinned Radix Select/ScrollArea viewports. Themes 3.3.0 does not forward a nonce to these internal viewports. Their text, pinned versions and HTTP policy are covered by `tests/radix-csp.test.mjs`; changed library styles require explicit review. There is no broad `unsafe-inline` permission for catalog style elements. Catalog style attributes have a separate narrow `style-src-attr` allowance. Neither exception applies to pack previews or raw downloads.

## Source manifest: packs/<id>/<version>/manifest.json

The following is a hypothetical schema example, not a shipped pack or authorization to create or publish one.

```json
{
  "schemaVersion": 1,
  "id": "example-system",
  "version": "1.0.0",
  "title": "Example system",
  "summary": "Короткое описание пака.",
  "category": "design-system",
  "folder": {"id": "systems", "title": "Systems"},
  "status": "published",
  "visibility": "public",
  "tags": ["css", "tokens"],
  "license": {"id": "LicenseRef-IMON-Proprietary", "file": "LICENSE.txt", "redistribution": true},
  "source": {"type": "original", "author": "I’MON"},
  "review": {"by": "I’MON", "date": "2026-11-04"},
  "preview": "preview/index.html",
  "scripts": false,
  "autoplay": false,
  "files": ["LICENSE.txt", "README.md", "tokens.css", "preview/index.html"],
  "assets": [{"id": "tokens", "title": "Токены", "type": "tokens", "path": "tokens.css", "preview": "preview/index.html", "description": "Токены с собственным префиксом.", "usage": "Подключите tokens.css только в целевом проекте."}]
}
```

- `id` and asset ids are lowercase ASCII slugs, versions are strict numeric `major.minor.patch` without leading zeros.
- Categories: `design-system`, `components`, `motion`, `icons`, `typography`, `guidelines`, `templates`.
- Optional `folder` has exactly `id` (a slug, at most 80 characters) and `title` (trimmed plain text, 1–120 characters). It is a one-level catalog grouping, not a filesystem path or a shared design system. Omitting it leaves the pack ungrouped; it does not alter pack isolation or permissions.
- Status: `draft` or `published`; visibility: `public` or `private`. Only public+published is built. Source git must not contain private material even if a manifest is private.
- Asset types: `component`, `stylesheet`, `script`, `tokens`, `documentation`, `image`, `font`, `template`.
- Optional `asset.preview` is a relative `.html` or `.htm` path listed in this version's `files`. The normal path, resource and script checks apply to it. No traversal, external/absolute URL, query string or fragment is accepted. It is independent of `asset.path`, the file offered for individual download. A pack-level preview is still required for published versions.
- Optional `autoplay` is a boolean, defaulting to `false`. `true` explicitly permits automatic launch of reviewed script previews and requires both `scripts: true` and a valid `review`, including for drafts. Set it only when the owner requested automatic previews; it is not permission inferred from imported code. It applies to the pack and its asset previews and never adds iframe capabilities or weakens CSP. Script previews without this opt-in must not run automatically; the current UI leaves them inactive and offers source downloads.
- Files are explicit, regular non-symlink paths within the pack. All preview resources must be explicitly listed. No parent traversal, absolute paths, URL paths, dotfiles, credentials or executables.
- `source.url` is optional HTTPS provenance, not an import dependency. Third-party sources require URL and explicit permission through `license.redistribution`.
- Original I’MON materials are proprietary unless their specific license says otherwise. The project does not grant an open-source license on the owner's behalf.
- All published packs require a source, license file, explicit redistribution=true, review, preview HTML and at least one asset. The build never executes asset code.
- All export URLs are generated by the builder, not supplied by manifests. Source assets cannot provide `url` or `previewUrl`.

These fields are backward-compatible extensions of manifest v1, not a reason to edit previously published versions. Add a new version for changes to grouping, autoplay or asset previews. The builder keeps every public published version; the catalog chooses the latest per pack id for its default view.

## Generated /api/catalog.json

Hypothetical output for the same example; file arrays and hashes are abbreviated.

```json
{
  "schemaVersion": 1,
  "packs": [{
    "id": "example-system", "version": "1.0.0", "title": "Example system", "summary": "...",
    "category": "design-system", "tags": ["css"], "license": {"id": "LicenseRef-IMON-Proprietary", "redistribution": true},
    "folder": {"id": "systems", "title": "Systems"},
    "source": {"type": "original", "author": "I’MON"}, "review": {"by": "I’MON", "date": "2026-11-04"},
    "previewUrl": "/previews/example-system/1.0.0/preview/index.html", "scripts": false, "autoplay": false,
    "downloadUrl": "/downloads/example-system-1.0.0.zip", "manifestUrl": "/api/packs/example-system/1.0.0.json",
    "files": [{"path": "tokens.css", "url": "/raw/example-system/1.0.0/tokens.css", "size": 123, "sha256": "..."}],
    "assets": [{"id": "tokens", "title": "Токены", "type": "tokens", "path": "tokens.css", "url": "/raw/example-system/1.0.0/tokens.css", "previewUrl": "/previews/example-system/1.0.0/preview/index.html", "description": "...", "usage": "..."}]
  }]
}
```

The builder preserves `folder` when provided and always emits a boolean `autoplay`, including `false` for older manifests. It generates `asset.url` as `/raw/<id>/<version>/<asset.path>` for every asset. When source `asset.preview` is present, it becomes `asset.previewUrl` under `/previews/<id>/<version>/`; the source-only `preview` field is not copied into the generated asset record. Individual downloads contain only that file, not its dependencies; the full ZIP remains available through `downloadUrl`.

The browser boundary accepts older catalog records without `folder`, `autoplay`, `asset.url` or `asset.previewUrl`. Missing autoplay always means false. When these fields are supplied, their types, script/review requirements and exact pack/version/file URLs are checked. Asset preview URLs must reference listed HTML/HTM files. Full same-origin URLs, external origins, alternative paths, query strings and fragments are not interchangeable with the generated canonical routes.

The builder publishes allowlisted files to `/raw/<id>/<version>/` for reading/downloading and `/previews/<id>/<version>/` for isolated rendering. Raw files must be served as plain text or attachments, never executable HTML. Previews get HTTP CSP sandbox with no same-origin permission, blocked network, form actions, popups and framing of other pages. Catalog iframes also have sandbox (empty or only `allow-scripts` when scripts=true). Automatic preview startup changes only when the frame is mounted; it never adds `allow-same-origin`, top navigation, forms, popups or downloads. Pack styles and scripts remain outside the catalog document.

The app fetches `/api/catalog.json`; show the latest version per id by default, group collections by optional folder metadata, and keep exact-version deep links `#pack=<id>@<version>`. Collections and their asset previews can be browsed inline without a pack popup. Metadata is rendered as text, never HTML. Search combines title, summary, tags and asset descriptions. No user upload endpoints or writable server API in v1.
