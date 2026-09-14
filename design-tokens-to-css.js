#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports -- Node script for regenerating design-token CSS. */

/**
 * ============================================================================
 * DESIGN TOKENS TO CSS VARIABLES CONVERTER
 * ============================================================================
 *
 * PURPOSE:
 *   Converts Figma-exported design tokens (JSON) into CSS custom properties
 *   (CSS variables) that can be consumed by any CSS/SCSS/Less codebase.
 *
 * INPUT:
 *   design-tokens.tokens.json  – Exported from Figma via the
 *                                "Figma Tokens" plugin (org.lukasoppermann).
 *
 * OUTPUT:
 *   design-tokens.css           – A single CSS file containing all design
 *                                 tokens as custom properties on :root.
 *
 * USAGE:
 *   node design-tokens-to-css.js
 *
 * ============================================================================
 * COLOUR SYSTEM ARCHITECTURE
 * ============================================================================
 *
 * This design system uses a **two-layer colour architecture** inspired by
 * Google's Material Design 3 colour system:
 *
 * 1. PRIMITIVE COLOURS  (foundation / palette layer)
 *    - These are the raw colour palettes that form the visual DNA of the
 *      brand.  They range from shade 0 (black) through to 100 (white)
 *      across multiple hue families: primary, secondary, tertiary, neutral,
 *      neutral-variant, error, info, warning, and success.
 *    - Primitive colours are **NOT** to be applied directly on the UI.
 *      They exist solely as building blocks for the semantic colour roles.
 *    - Each family contains key colours (the anchor hue) and a 13-step
 *      tonal scale (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100).
 *
 * 2. COLOUR ROLES  (semantic / application layer)
 *    - Colour roles map primitive swatches to **UI intent**.  For example,
 *      the "primary" role resolves to the primary key colour, while
 *      "primary container" resolves to primary-90 (a light tint of the brand).
 *    - Colour roles are what developers should reference when styling
 *      components: background, text, border, icon, etc.
 *    - Each role has an explicit reference back to its primitive source,
 *      encoded as a token alias (e.g. `{primitives.primary colors.primary 90}`).
 *    - The roles follow the pattern: <role>, on <role>, <role> container,
 *      on <role> container.
 *
 * LAYERING CONVENTION IN THIS FILE:
 *   --primitive-*   →  Foundation palettes (use sparingly, if at all)
 *   --color-*       →  Semantic colour roles (preferred for all UI work)
 *   --effect-*      →  Shadows / elevation
 *   --spacing-*     →  Layout spacing scale
 *   --typography-*  →  Type style compound variables
 *
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

/** Path to the Figma-exported design tokens JSON file. */
const INPUT_FILE = path.join(__dirname, "design-tokens.tokens.json");

/** Path where the generated CSS file will be written. */
const OUTPUT_FILE = path.join(__dirname, "design-tokens.css");

// ---------------------------------------------------------------------------
// HELPER UTILITIES
// ---------------------------------------------------------------------------

/**
 * Converts a human-readable token name into a valid CSS custom property name.
 *
 * Rules applied:
 *   1. Lowercase everything.
 *   2. Replace spaces and multiple hyphens with a single hyphen.
 *   3. Strip characters that are not alphanumeric, hyphen, or underscore.
 *   4. Collapse consecutive hyphens/underscores.
 *   5. Trim leading/trailing hyphens.
 *
 * Examples:
 *   "Primary 40"            → "primary-40"
 *   "extra extra small spacing" → "extra-extra-small-spacing"
 *   "surface container highest" → "surface-container-highest"
 *   "on primary container"  → "on-primary-container"
 *
 * @param {string} name  – The raw token name from the JSON.
 * @returns {string}      – A kebab-case CSS-safe identifier.
 */
function toKebabCase(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")            // spaces → hyphens
    .replace(/[^a-z0-9\-_]/g, "")    // strip invalid chars
    .replace(/-{2,}/g, "-")          // collapse double hyphens
    .replace(/_{2,}/g, "_")          // collapse double underscores
    .replace(/^-+|-+$/g, "");        // trim leading/trailing hyphens
}

/**
 * Resolves a token alias reference to its actual CSS variable reference.
 *
 * Token aliases in the Figma export use the format:
 *   "{primitives.primary colors.primary 90}"
 *
 * This function converts that into a valid CSS var() reference:
 *   var(--primitive-primary-90)
 *
 * The resolution is done via a lookup table (`aliasIndex`) built while
 * emitting the primitive variables.  Each primitive token's fully-qualified
 * name (e.g. "primitives.primary colors.primary 90") is normalised and
 * mapped to the emitted variable name (e.g. "--primitive-primary-90").
 * Colour roles reference those aliases, so resolving through the index
 * guarantees the reference always matches an actually-emitted variable.
 *
 * If the value does not look like an alias (no curly braces), it is returned
 * as-is (raw CSS value).  If an alias cannot be found in the index, it is
 * returned verbatim so the problem is visible rather than silently wrong.
 *
 * @param {string}  value     – A token value, possibly containing an alias.
 * @param {Object}  aliasIndex – Map of normalised alias → CSS variable name.
 * @returns {string}           – A resolved CSS value or var() reference.
 */
function resolveTokenReference(value, aliasIndex) {
  if (typeof value !== "string") return String(value);

  const aliasMatch = value.match(/^\{(.+)\}$/);
  if (!aliasMatch) return value;

  const aliasPath = aliasMatch[1]; // e.g. "primitives.primary colors.primary 90"
  const key = normaliseKey(aliasPath);

  const variableName = aliasIndex[key];
  if (variableName) {
    return `var(--${variableName})`;
  }

  // Fallback: could not resolve — return the original alias verbatim.
  return value;
}

/**
 * Normalises a token name into a canonical lookup key used by the alias
 * index.  All whitespace and dots are removed and the result lowercased,
 * yielding a single continuous string.  For example:
 *
 *   "primitives.primary colors.primary 90" → "primitivesprimarycolorsprimary90"
 *
 * @param {string} name – The raw token name or alias path.
 * @returns {string}     – A canonical, collision-resistant lookup key.
 */
function normaliseKey(name) {
  return name.toLowerCase().replace(/[\s.]+/g, "");
}

/**
 * Converts a hex colour value with an alpha suffix (e.g. "#7e2cdeff") into
 * a modern CSS colour function using the `color()` or `rgba()` syntax.
 *
 * Figma exports colours as 8-character hex strings where the last two chars
 * represent alpha in hex (ff = 100%, 00 = 0%).
 *
 * This function converts them to `rgba()` for maximum browser compatibility.
 *
 * @param {string} hex – An 8-character hex colour string (e.g. "#7e2cdeff").
 * @returns {string}    – An rgba() colour string.
 */
function hexToRgba(hex) {
  if (typeof hex !== "string" || !hex.startsWith("#")) return hex;

  const raw = hex.replace("#", "");
  if (raw.length !== 8) return hex; // Not an 8-char hex; return as-is.

  const r = parseInt(raw.substring(0, 2), 16);
  const g = parseInt(raw.substring(2, 4), 16);
  const b = parseInt(raw.substring(4, 6), 16);
  const a = parseInt(raw.substring(6, 8), 16) / 255;

  // Round alpha to 2 decimal places for readability.
  return `rgba(${r}, ${g}, ${b}, ${parseFloat(a.toFixed(2))})`;
}

/**
 * Converts a Figma shadow token value into a CSS box-shadow string.
 *
 * @param {Object} shadow – The shadow token value object.
 * @param {string} shadow.shadowType – "dropShadow" or "innerShadow".
 * @param {number} shadow.radius     – Blur radius.
 * @param {string} shadow.color      – Hex colour with alpha.
 * @param {number} shadow.offsetX    – Horizontal offset.
 * @param {number} shadow.offsetY    – Vertical offset.
 * @param {number} shadow.spread     – Spread radius.
 * @returns {string} – A CSS box-shadow value.
 */
function shadowToCSS(shadow) {
  const inset = shadow.shadowType === "innerShadow" ? "inset " : "";
  const color = hexToRgba(shadow.color);
  return `${inset}${shadow.offsetX}px ${shadow.offsetY}px ${shadow.radius}px ${shadow.spread}px ${color}`;
}

// ---------------------------------------------------------------------------
// TOKEN PROCESSORS
// Each processor handles a specific section of the design token file and
// returns an array of CSS variable declaration strings.
// ---------------------------------------------------------------------------

/**
 * Processes the "effect" section (shadows) and returns CSS variable lines.
 *
 * Shadow tokens are converted to compound `box-shadow` values so they can
 * be applied in a single property declaration:
 *
 *   --effect-hard-shadow: 4px 6px 8px 0 rgba(0, 0, 0, 0.32);
 *
 * @param {Object} effects – The "effect" section of the tokens JSON.
 * @returns {string[]}      – Array of CSS variable declaration strings.
 */
function processEffects(effects) {
  const lines = [];
  lines.push("  /* ─── Effects / Shadows ─── */");

  for (const [name, token] of Object.entries(effects)) {
    if (token.type === "custom-shadow" && token.value) {
      const cssValue = shadowToCSS(token.value);
      lines.push(`  --effect-${toKebabCase(name)}: ${cssValue};`);
    }
  }

  return lines;
}

/**
 * Processes the "primitives" section.
 *
 * The primitives section is organised into:
 *   - key colours (anchor hues for each family)
 *   - tonal colour scales (primary, secondary, tertiary, neutral,
 *     neutral-variant, error, info, warning, success)
 *
 * All primitive values are prefixed with `--primitive-` to clearly
 * distinguish them from semantic colour roles.
 *
 * While emitting each variable, a reverse lookup index is built so that
 * token aliases found in the colour-role section can be resolved back to
 * the correct variable name.  For example, a colour role whose value is
 * `{primitives.primary colors.primary 90}` needs to resolve to the emitted
 * variable `--primitive-primary-90`.
 *
 * @param {Object} primitives – The "primitives" section of the tokens JSON.
 * @returns {Object}           – { lines: string[], aliasIndex: Object }.
 */
function processPrimitives(primitives) {
  const lines = [];
  const aliasIndex = {};

  lines.push("  /* ─── Primitive Colours (Foundation Palettes) ─── */");
  lines.push("  /*");
  lines.push("   * Primitive colours are the raw tonal scales that form the");
  lines.push("   * visual foundation of the design system.  They are NOT meant");
  lines.push("   * to be applied directly in UI.  Use the semantic --color-*");
  lines.push("   * variables (colour roles) instead.");
  lines.push("   */");

  for (const [groupName, group] of Object.entries(primitives)) {
    lines.push("");
    lines.push(`  /* ${groupName.toUpperCase()} */`);

    // Key colours sit directly under the group (e.g. primitives → key colors → primary key color).
    // Tonal scales have numbered tokens (e.g. primitives → primary colors → primary 40).
    for (const [tokenName, token] of Object.entries(group)) {
      if (token.type === "color" && token.value) {
        // This is a key colour (leaf token with a direct hex value).
        // Its full path is "primitives.<groupName>.<tokenName>".
        const variableName = `primitive-${toKebabCase(tokenName)}`;
        const cssValue = hexToRgba(token.value);

        lines.push(`  --${variableName}: ${cssValue};`);
        aliasIndex[normaliseKey(`primitives.${groupName} ${tokenName}`)] = variableName;
      } else if (typeof token === "object" && token !== null) {
        // This is a tonal scale (contains sub-tokens like "primary 0", "primary 10", etc.).
        const scalePrefix = toKebabCase(tokenName);
        for (const [shadeName, shadeToken] of Object.entries(token)) {
          if (shadeToken.type === "color" && shadeToken.value) {
            const variableName = `primitive-${scalePrefix}-${toKebabCase(shadeName)}`;
            const cssValue = hexToRgba(shadeToken.value);

            lines.push(`  --${variableName}: ${cssValue};`);
            aliasIndex[normaliseKey(`primitives.${groupName} ${tokenName} ${shadeName}`)] = variableName;
          }
        }
      }
    }
  }

  return { lines, aliasIndex };
}

/**
 * Processes the "color roles" section and returns CSS variable lines.
 *
 * Colour roles are the **semantic layer** — these are the variables that
 * UI developers should reference when building components.  Each role
 * resolves to a specific primitive swatch, creating an indirection layer
 * that makes it easy to re-theme the entire application by changing only
 * the primitive values.
 *
 * Examples of colour roles:
 *   --color-primary               → The main brand colour
 *   --color-on-primary            → Text/icon colour on primary backgrounds
 *   --color-primary-container     → A lighter container tint of the brand
 *   --color-on-primary-container  → Text colour inside primary containers
 *   --color-surface               → The default surface background
 *   --color-error                 → Destructive/error state colour
 *
 * The naming convention follows Material Design 3:
 *   <role>              – The dominant colour for the role
 *   on <role>           – The contrasting colour used ON the role's background
 *   <role> container    – A tonal variation for containing elements
 *   on <role> container – Text colour inside containers
 *
 * @param {Object} colorRoles – The "color roles" section of the tokens JSON.
 * @param {Object} aliasIndex – Lookup table of normalised alias → variable name.
 * @returns {string[]}          – Array of CSS variable declaration strings.
 */
function processColorRoles(colorRoles, aliasIndex) {
  const lines = [];
  lines.push("  /* ─── Colour Roles (Semantic / Application Layer) ─── */");
  lines.push("  /*");
  lines.push("   * Colour roles map primitive palettes to UI intent.  These are");
  lines.push("   * the variables you should use when styling components.");
  lines.push("   *");
  lines.push("   * Naming convention (Material Design 3 inspired):");
  lines.push("   *   --color-<role>              → dominant colour for the role");
  lines.push("   *   --color-on-<role>           → contrasting text/icon colour");
  lines.push("   *   --color-<role>-container    → tonal container variation");
  lines.push("   *   --color-on-<role>-container → text inside the container");
  lines.push("   */");

  for (const [roleName, token] of Object.entries(colorRoles)) {
    if (token.type === "color" && token.value) {
      // Resolve alias references (e.g. "{primitives.primary colors.primary 90}")
      // to their actual CSS variable references (e.g. var(--primitive-primary-90)).
      const cssValue = resolveTokenReference(token.value, aliasIndex);
      lines.push(`  --color-${toKebabCase(roleName)}: ${cssValue};`);
    }
  }

  return lines;
}

/**
 * Processes the "spacing system" section and returns CSS variable lines.
 *
 * The spacing system provides a consistent set of dimensional values for
 * padding, margin, gap, and other spatial properties.  Values are in pixels.
 *
 * @param {Object} spacing – The "spacing system" section of the tokens JSON.
 * @returns {string[]}       – Array of CSS variable declaration strings.
 */
function processSpacing(spacing) {
  const lines = [];
  lines.push("  /* ─── Spacing System ─── */");

  for (const [name, token] of Object.entries(spacing)) {
    if (token.type === "dimension" && typeof token.value === "number") {
      lines.push(`  --spacing-${toKebabCase(name)}: ${token.value}px;`);
    }
  }

  return lines;
}

/**
 * Processes the "typography" section and returns CSS variable lines.
 *
 * Typography tokens are compound – each style (e.g. "display large") is
 * broken into individual property tokens (fontSize, fontFamily, fontWeight,
 * etc.).  This function creates:
 *
 *   1. Individual property variables for granular access:
 *      --typography-display-large-font-size: 64px;
 *      --typography-display-large-font-family: "Lora";
 *      ...
 *
 *   2. A shorthand "all-in-one" variable that combines the most commonly
 *      used properties into a single shorthand value for convenience:
 *      --typography-display-large: 600 64px/96px "Lora";
 *
 * @param {Object} typography – The "typography" section of the tokens JSON.
 * @returns {string[]}          – Array of CSS variable declaration strings.
 */
function processTypography(typography) {
  const lines = [];
  lines.push("  /* ─── Typography ─── */");
  lines.push("  /*");
  lines.push("   * Each typographic style exposes individual property variables");
  lines.push("   * (e.g. --typography-display-large-font-size) as well as a");
  lines.push("   * compound shorthand (e.g. --typography-display-large) that");
  lines.push("   * combines font-weight, font-size, line-height, and font-family.");
  lines.push("   */");

  for (const [category, sizes] of Object.entries(typography)) {
    lines.push("");
    lines.push(`  /* ${category.toUpperCase()} */`);

    for (const [sizeName, props] of Object.entries(sizes)) {
      const prefix = `--typography-${toKebabCase(category)}-${toKebabCase(sizeName)}`;

      // Emit individual property variables.
      if (props.fontSize && props.fontSize.value != null) {
        lines.push(`  ${prefix}-font-size: ${props.fontSize.value}px;`);
      }
      if (props.fontWeight && props.fontWeight.value != null) {
        lines.push(`  ${prefix}-font-weight: ${props.fontWeight.value};`);
      }
      if (props.lineHeight && props.lineHeight.value != null) {
        lines.push(`  ${prefix}-line-height: ${props.lineHeight.value}px;`);
      }
      if (props.fontFamily && props.fontFamily.value) {
        lines.push(`  ${prefix}-font-family: "${props.fontFamily.value}";`);
      }
      if (props.letterSpacing && props.letterSpacing.value != null) {
        lines.push(`  ${prefix}-letter-spacing: ${props.letterSpacing.value}px;`);
      }
      if (props.fontStyle && props.fontStyle.value) {
        lines.push(`  ${prefix}-font-style: ${props.fontStyle.value};`);
      }
      if (props.textDecoration && props.textDecoration.value) {
        lines.push(`  ${prefix}-text-decoration: ${props.textDecoration.value};`);
      }

      // Emit compound shorthand: "font-weight fontSize/line-height fontFamily"
      const weight = props.fontWeight ? props.fontWeight.value : "normal";
      const size = props.fontSize ? `${props.fontSize.value}px` : "inherit";
      const height = props.lineHeight ? `${props.lineHeight.value}px` : "normal";
      const family = props.fontFamily ? `"${props.fontFamily.value}"` : "sans-serif";

      lines.push(`  ${prefix}: ${weight} ${size}/${height} ${family};`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// MAIN CONVERSION PIPELINE
// ---------------------------------------------------------------------------

/**
 * Main entry point.  Reads the design tokens JSON, processes each section,
 * and writes the combined CSS custom properties to the output file.
 *
 * The generated CSS is structured into clearly labelled sections:
 *
 *   1. Header comment with usage instructions
 *   2. Primitive colours (foundation palettes)
 *   3. Colour roles (semantic / application layer)
 *   4. Effects (shadows)
 *   5. Spacing system
 *   6. Typography
 *
 * @throws {Error} If the input file cannot be read or parsed.
 */
function main() {
  console.log("🎨 Design Tokens → CSS Variables Converter");
  console.log("─".repeat(48));

  // ---- Read & Parse ----
  let tokens;
  try {
    const raw = fs.readFileSync(INPUT_FILE, "utf-8");
    tokens = JSON.parse(raw);
    console.log(`✔ Read tokens from ${path.basename(INPUT_FILE)}`);
  } catch (err) {
    console.error(`✖ Failed to read input file: ${err.message}`);
    process.exit(1);
  }

  // ---- Process Each Section ----
  const cssSections = [];

  // Header
  cssSections.push([
    "/**",
    " * ==========================================================================",
    " * DESIGN TOKENS — CSS Custom Properties",
    " * ==========================================================================",
    " *",
    " * This file is auto-generated by design-tokens-to-css.js.",
    " * Do NOT edit manually — regenerate from design-tokens.tokens.json instead.",
    " *",
    " * COLOUR SYSTEM:",
    " *   --primitive-*  → Foundation palettes (raw tonal scales).",
    " *                    These are the building blocks of the colour system.",
    " *                    Do NOT use these directly in component styles.",
    " *",
    " *   --color-*      → Semantic colour roles (application layer).",
    " *                    Use these variables for all UI styling.  They reference",
    " *                    the primitive palette values and can be swapped for",
    " *                    theming (e.g. dark mode) by reassigning the primitives.",
    " *",
    " * USAGE:",
    " *   Import this file in your HTML:",
    ' *     <link rel="stylesheet" href="design-tokens.css">',
    " *",
    " *   Or import in CSS/SCSS:",
    ' *     @import "design-tokens.css";',
    " *",
    " *   Then reference tokens in your styles:",
    " *     background: var(--color-surface);",
    " *     color: var(--color-on-surface);",
    " *     padding: var(--spacing-base-spacing);",
    " * ==========================================================================",
    " */",
    "",
    ":root {",
  ]);

  // Primitive colours (also builds the alias index for resolving roles)
  let aliasIndex = {};
  if (tokens.primitives) {
    const primitivesResult = processPrimitives(tokens.primitives);
    cssSections.push(primitivesResult.lines);
    aliasIndex = primitivesResult.aliasIndex;
  }

  // Colour roles (semantic)
  if (tokens["color roles"]) {
    cssSections.push([""]);
    cssSections.push(processColorRoles(tokens["color roles"], aliasIndex));
  }

  // Effects
  if (tokens.effect) {
    cssSections.push([""]);
    cssSections.push(processEffects(tokens.effect));
  }

  // Spacing
  if (tokens["spacing system"]) {
    cssSections.push([""]);
    cssSections.push(processSpacing(tokens["spacing system"]));
  }

  // Typography
  if (tokens.typography) {
    cssSections.push([""]);
    cssSections.push(processTypography(tokens.typography));
  }

  // Close :root
  cssSections.push(["", "}"]);

  // ---- Assemble & Write ----
  const css = cssSections
    .flat()
    .filter((line) => line !== undefined)
    .join("\n");

  try {
    fs.writeFileSync(OUTPUT_FILE, css, "utf-8");
    console.log(`✔ Wrote CSS variables to ${path.basename(OUTPUT_FILE)}`);
  } catch (err) {
    console.error(`✖ Failed to write output file: ${err.message}`);
    process.exit(1);
  }

  // ---- Summary ----
  const variableCount = (css.match(/^  --/gm) || []).length;
  console.log(`✔ Generated ${variableCount} CSS custom properties`);
  console.log("─".repeat(48));
  console.log("Done.");
}

// Run the converter.
main();
