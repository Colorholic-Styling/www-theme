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
