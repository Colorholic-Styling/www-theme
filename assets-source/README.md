# Asset sources

| Source | Built by | Output |
|---|---|---|
| `site.css` | `npm run build:css` (Tailwind v4) | `../assets/site.css` |

`assets/site.css` is a **build artifact**. Edit `assets-source/site.css` and
rebuild — an edit made directly to the output is lost on the next build, and
because the output is what gets pushed to the theme bucket, it will look like
it worked until someone rebuilds.

```bash
npm install
npm run build:css          # minified, what ships
npm run build:css:debug    # readable output, for diffing a change
npm run watch:css          # rebuild on save
```

The output is committed rather than ignored: the Worker reads the theme from
the `cms-themes` R2 bucket, and the push is a straight file copy out of this
repo, so the compiled stylesheet has to exist here.

## Why Tailwind is imported without preflight

```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities) source(none);
```

The plain `@import "tailwindcss"` would also pull in preflight, whose reset
zeroes heading and list margins. The component rules in this file were written
against browser defaults and do their own normalising, so preflight would
restyle every page for no benefit. Importing the two layers by hand is the
documented way to opt out.

## Tokens

The brand palette lives in `@theme`, so Tailwind emits the custom properties on
`:root` *and* generates matching utilities — `bg-cream`, `text-accent`,
`border-line`, `font-display`. The short aliases under it (`--ink`, `--accent`,
…) exist so the component rules keep reading as they always have.

Watch for collisions with Tailwind's own namespaces when adding a token.
`--radius-*` is one of Tailwind's, so `--radius-lg` is declared inside `@theme`
rather than in the `:root` alias block; two definitions would leave the theme's
value winning only by the unlayered-beats-layered cascade rule.

## Class detection

`@source` lists the Liquid directories explicitly. The default scanner would
also walk `assets/`, feeding the build its own output — every class name in the
compiled stylesheet would count as "used" and nothing would ever prune.

Markup currently uses semantic classes (`.hero__title`, `.card`, `.price-list__item`)
rather than utilities, so the utilities layer compiles to almost nothing today.
Utilities are available for new markup without any further setup.

## Pushing

```bash
npm run push                 # build, then upload the whole theme
npm run push -- --dry-run    # list what would be uploaded
npm run push -- --only hero  # upload just the paths matching "hero"
npm run push -- --no-build   # upload without rebuilding first
```

Target defaults to `cms-themes/t/85b4297c328c3117/www-theme`; override with the
`THEME_BUCKET` / `THEME_PREFIX` environment variables.

Every file is uploaded each time rather than diffed against the bucket.
Wrangler has no HEAD for objects, so working out what changed would mean
downloading each one first — the same number of round trips as just writing
them. A full push is about 15 seconds.

Two things that will mislead you when checking a push landed:

- `wrangler r2 object get` serves a **cached** copy and can report the previous
  version for a while after a successful write. Verify against the site
  (`curl -s <site>/assets/site.css | md5`), not against wrangler.
- Warm Worker isolates cache theme files for their lifetime, so a push reaches
  requests gradually rather than all at once.

### Cache invalidation

A full push also writes a `theme-version` object holding a hash of every file
uploaded. colorholic-www folds that into its rendered-page cache key, so a
theme push selects a new cache entry instead of waiting out the CDN.

`--only` deliberately does **not** update it: a partial push would advertise a
hash that does not describe the bucket. The script warns when it skips the
bump — run a full push to make the change take effect.
