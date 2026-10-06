# Design system

## Principles

- Make the agent's work visible and auditable.
- Chunky borders and offset shadows for a tactile feel.

## Typography

| Role | Typeface |
|---|---|
| Display | Syne |
| Text | Onest |
| Code | JetBrains Mono |

Fonts are loaded with `next/font` and exposed as CSS variables in `app/layout.tsx`.

## Color tokens

Defined as CSS variables in `app/globals.css` and mapped into Tailwind's theme.

| Token | Value | Use |
|---|---|---|
| `cream` | `#fff9e8` | Page background |
| `ink` | `#17130a` | Text and ruling card |
| `tangerine` | `#ff6a2b` | Primary action |
| `lemon` | `#ffe45e` | Highlights |
| `mint` | `#19b47a` | Positive |
| `rose` | `#ef4565` | Errors and bugs |

## Motion

- The title underline draws itself.
- Tool calls pop onto a growing timeline.
- Priority chips and a confidence meter animate in the ruling.

All animation respects `prefers-reduced-motion`.

## Components

| Component | Purpose |
|---|---|
| Ledger | Timeline of tool calls |
| Ruling | Decision card with a copyable reply |

## Rules

- Color carries meaning; it is never the only signal.
- Interactive elements have visible focus and accessible names.
- New tokens are added to `globals.css` and this document together.
