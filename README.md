# www-theme

The 0xCMS theme for **Colorholic Styling 析色生妝學院** — the Liquid views and the
Tailwind-built stylesheet that [`colorholic-www`](../website) renders published
CMS pages through. The Worker reads these files from the `cms-themes` R2 bucket,
so a push here changes the live site with no redeploy.

```
www-theme ──push──▶ cms-themes (R2) ──read──▶ colorholic-www ──HTML──▶ visitor
```

| Directory | Holds |
|---|---|
| `layout/` | the HTML document, head, header and footer |
| `templates/` | JSON route templates — which sections a route renders, in what order |
| `sections/` | the markup for one route section or one CMS block type |
| `snippets/` | markup shared between layouts and sections |
| `assets/` | the built stylesheet and the logo (see `assets-source/README.md`) |

## Templates

| Template | Route |
|---|---|
| `page.json` | `/` — the homepage, one declared section per homepage block |
| `content-page.json` | `/<slug>` — a generic page, blocks in editor-defined order |
| `news-index.json` | `/news` |
| `news-article.json` | `/news/<slug>` |
| `team-member.json` | `/<slug>` for a `team_member` page |
| `service.json` | `/<slug>` for a `service` page |
| `message.json` | 404 / 500 |

A JSON template composes **trusted** section files only. Editor content never
reaches a template path: CMS blocks are projected in `src/blocks.ts` and fixed
through its `BLOCK_TYPES` allowlist.

## The section contract

Sections read `section.settings`, never `block`. A JSON-declared section gets
its declared settings; a CMS block is projected into a section-shaped object so
the same contract holds either way. Every section declares its inputs in a
Shopify-style `{% schema %}` block — documentation for editors, not defaults:
the renderer does not apply a schema `"default"`.

Repeatable rows are read with the same two lines everywhere:

```liquid
{% assign features = section.settings.features | default: section.blocks %}
{% for row in features %}{% assign feature = row.settings | default: row %}
```

### The three page-backed lists

`news-list`, `team` and `services` list **published pages**, not rows typed into
the block, so adding an analyst or a service is one CMS page rather than an edit
to the homepage. Those sections take one extra fallback:

```liquid
{% assign news = section.settings.news | default: latestNews | default: section.blocks %}
```

- `section.settings.*` — a CMS block, projected by the Worker.
- `latestNews` / `teamMembers` / `serviceList` — route globals. **This middle
  step exists because a JSON section setting cannot hold a list**: its values are
  strings evaluated as Liquid, so `page.json` can hand a section a title but not
  an array. Before this, `page.json` declared three news cards and three team
  members by hand, and the homepage showed exactly three of each forever.
- `section.blocks` — rows written into a JSON template by hand.

`default` treats an empty array as absent, which is what makes the chain fall
through rather than render an empty grid.

`teamMembers` rows carry an `href` and `serviceList` rows a `detailHref`, both
pointing at that item's own page. Hand-written rows have neither and simply
render without the link, so guard on `!= blank` rather than assuming it is set.

### The escaping rule

Every value is printed with `| escape`. The **only** exception is a key ending
in `Html` (`bodyHtml`, `answerHtml`), which holds rich text already sanitised by
the Worker. Keep that convention: it and the site's strict CSP are the
stored-XSS boundary. The CSP also forbids inline `<style>`/`<script>`, which is
why the mobile menu and the FAQ are CSS-only.

## Working on it

```bash
npm install
npm run watch:css            # rebuild assets/site.css on save
npm run push -- --dry-run    # list what a push would upload
npm run push                 # build, then upload the whole theme
```

`assets/site.css` is a build artifact — edit `assets-source/site.css`. See
[`assets-source/README.md`](assets-source/README.md) for the Tailwind setup, the
push targets, and why `--only` skips the cache-busting version bump.
