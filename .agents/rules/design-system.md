---
trigger: always_on
---

# Design System Rule

## Purpose

All UI work MUST use the project's existing design system.

The design system is defined by the generated CSS custom properties and the component primitives built around them. Do not invent a separate visual system inside individual pages or components.

The CSS token file is generated from `design-tokens.tokens.json`.

Do NOT manually edit the generated CSS token file. Changes to design tokens MUST be made in the source token file and regenerated.

---

## 1. Colour Tokens

Use semantic `--color-*` variables for application UI styling.

Do NOT use `--primitive-*` variables directly in component styles.

### Required colour pattern

Use semantic roles such as:

- `--color-primary`
- `--color-on-primary`
- `--color-primary-container`
- `--color-on-primary-container`
- `--color-secondary`
- `--color-on-secondary`
- `--color-secondary-container`
- `--color-on-secondary-container`
- `--color-tertiary`
- `--color-on-tertiary`
- `--color-tertiary-container`
- `--color-on-tertiary-container`
- `--color-neutral`
- `--color-on-neutral`
- `--color-neutral-container`
- `--color-on-neutral-container`
- `--color-neutral-variant`
- `--color-on-neutral-variant`
- `--color-neutral-variant-container`
- `--color-on-neutral-variant-container`
- `--color-error`
- `--color-on-error`
- `--color-error-container`
- `--color-on-error-container`
- `--color-info`
- `--color-on-info`
- `--color-info-container`
- `--color-on-info-container`
- `--color-warning`
- `--color-on-warning`
- `--color-warning-container`
- `--color-on-warning-container`
- `--color-success`
- `--color-on-success`
- `--color-success-container`
- `--color-on-success-container`
- `--color-surface`
- `--color-on-surface`
- `--color-surface-varaint`
- `--color-on-surface-varaint`
- `--color-surface-container`
- `--color-surface-container-high`
- `--color-surface-container-highest`
- `--color-surface-container-low`
- `--color-surface-container-lowest`
- `--color-inverse-surface`
- `--color-inverse-on-surface`
- `--color-surface-tint`

Use the existing token names exactly as defined.

Do not create arbitrary colour values in component CSS when an existing semantic token provides the required role.

Do not replace semantic tokens with raw `rgba()`, hex, RGB, HSL, or other colour values.

---

## 2. Colour Role Rules

Choose colours by semantic purpose, not by palette preference.

Examples:

- Primary actions use the primary colour roles.
- Text placed on a primary background uses `--color-on-primary`.
- Error states use error roles.
- Informational states use info roles.
- Warning states use warning roles.
- Success states use success roles.
- Main application surfaces use surface roles.
- Text on the main surface uses `--color-on-surface`.
- Tonal containers use the corresponding `*-container` roles.
- Text and icons inside a container use the corresponding `--color-on-*-container` role.

Do not use a darker or lighter primitive colour merely because it appears visually convenient.

---

## 3. Typography

Use the existing typography tokens.

The design system uses:

- `Lora` for display styles.
- `DM Sans` for headline, title, body, and label styles.

Available display styles:

- `--typography-display-large`
- `--typography-display-medium`
- `--typography-display-small`

Available headline styles:

- `--typography-headline-large`
- `--typography-headline-medium`
- `--typography-headline-small`

Available title styles:

- `--typography-title-large`
- `--typography-title-medium`
- `--typography-title-small`

Available body styles:

- `--typography-body-large`
- `--typography-body-medium`
- `--typography-body-small`

Available label styles:

- `--typography-label-large`
- `--typography-label-medium`
- `--typography-label-small`

Prefer the compound typography token when the complete typographic style is required.

Example:

```css
.heading {
  font: var(--typography-headline-medium);
}