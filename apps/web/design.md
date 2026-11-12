# TasksHQ — Style Reference
> Mission control dashboard in a darkroom

**Theme:** dark

This is the visual authority for the TasksHQ web app. PLAN §7 records where the app deliberately deviates from it (light theme, contrast fixes, density).

TasksHQ looks like a midnight control room: a pitch-black canvas hosting dense product interfaces that glow from within. The visual system is nearly monochromatic — no semantic color clutter, no decorative gradients — letting one electric blue do all the emotional heavy lifting on CTAs, active states, and accents. Inter brings quiet authority with tight negative tracking on display sizes, while JetBrains Mono handles the utilitarian UI labels. Components sit on the canvas like instrument panels — dark, lightly elevated by near-invisible inset white borders rather than drop shadows, with pill-shaped interactive elements that feel like physical switches.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Signal Blue | `#0063e1` | `--color-signal-blue` | Primary CTA fill, active nav indicator, accent dots, link highlights — the single chromatic voice in an otherwise silent monochrome system |
| Obsidian | `#000000` | `--color-obsidian` | Page canvas, dominant background, hairline divider color, icon fill — the floor of the entire system |
| Carbon | `#040910` | `--color-carbon` | Card surface base, deep panel backgrounds — first step above the page canvas |
| Graphite | `#0d0d0d` | `--color-graphite` | Elevated card surfaces, section backgrounds, border fills — the mid-surface layer |
| Iron | `#1f1f1f` | `--color-iron` | Input field backgrounds, form controls, tertiary surfaces |
| Steel | `#2b2c2e` | `--color-steel` | Highest card elevation, modal surfaces, hover-state surfaces — the ceiling of the surface stack |
| Ash | `#858585` | `--color-ash` | Body text, muted labels, secondary borders, link underlines — the workhorse neutral for non-heading text |
| Smoke | `#979797` | `--color-smoke` | Icon strokes, tertiary button borders, low-priority text |
| Fog | `#8c8c8c` | `--color-fog` | Link text, subdued navigation labels |
| Paper | `#ffffff` | `--color-paper` | Light neutral action fill for buttons on dark surfaces. |

## Tokens — Typography

### Inter — primary typeface · `--font-sans`
- **Weights:** 400, 600, 700
- **Sizes:** 12, 14, 16, 18, 20, 24, 56, 72, 86
- **Line height:** 1.00–1.67
- **Letter spacing:** Tight: -0.064em at 86px, -0.042em at 72px, -0.040em at 56px, -0.027em at 20px, -0.015em at 18px, -0.007em at 16px, -0.005em at 12px
- **OpenType features:** `"case"`, `"cv11"`
- **Role:** Body text at 16-20px weight 400, headlines at 56-86px weight 400 with negative tracking (as tight as -0.064em at 86px). Headlines stay at regular weight: emphasis comes from size and tracking. Subheadings and navigation at 16-20px weight 400-600. Weight 700 is reserved for small emphasis labels (12-20px).

### JetBrains Mono — utility face · `--font-mono`
- **Weights:** 400
- **Sizes:** 13, 15, 16
- **Line height:** 1.00–1.23
- **Letter spacing:** 0.033em at 13px, 0.038em at 15px
- **Role:** UI labels, status indicators, keys and tabular data. Slight positive letter-spacing (0.033-0.038em) gives it a structured, instrument-label quality.

### Type Scale

| Role | Family | Weight | Size | Line Height | Letter Spacing | Token |
|------|--------|--------|------|-------------|----------------|-------|
| caption | — | — | 12px | 1.2 | -0.005px | `--text-caption` |
| body | — | — | 16px | 1.5 | -0.007px | `--text-body` |
| subheading | — | — | 18px | 1.4 | -0.015px | `--text-subheading` |
| heading-sm | — | — | 20px | 1.33 | -0.027px | `--text-heading-sm` |
| heading | — | — | 24px | 1.33 | -0.027px | `--text-heading` |
| heading-lg | — | — | 56px | 1.25 | -0.04px | `--text-heading-lg` |
| display | — | — | 86px | 1 | -0.064px | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** comfortable

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 44 | 44px | `--spacing-44` |
| 48 | 48px | `--spacing-48` |
| 56 | 56px | `--spacing-56` |
| 60 | 60px | `--spacing-60` |
| 72 | 72px | `--spacing-72` |
| 80 | 80px | `--spacing-80` |
| 120 | 120px | `--spacing-120` |

### Border Radius

| Element | Value |
|---------|-------|
| nav | 2px |
| cards | 16px |
| images | 24px |
| inputs | 8px |
| buttons | 59px |
| largeCards | 30px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| subtle | `rgba(255, 255, 255, 0.12) 0px 0px 0px 1px inset` | `--shadow-subtle` |
| subtle-2 | `rgba(255, 255, 255, 0.2) 0px 0px 1px 0px` | `--shadow-subtle-2` |

### Layout

- **Page max-width:** 1200px
- **Section gap:** 80px
- **Card padding:** 24px
- **Element gap:** 20px

## Components

### Primary CTA Button
**Role:** The singular conversion action

Pill-shaped button (59px border-radius), Signal Blue #0063e1 fill, white #ffffff text at 16px Inter weight 400-600 with -0.007em letter-spacing. Padding 20px vertical, 32px horizontal. No drop shadow — the saturated blue against the black canvas is sufficient visual weight.

### Navigation Header Button
**Role:** Compact header action

Smaller pill button (59px radius), Signal Blue #0063e1 fill, white text at 12-14px. Dense horizontal padding (14-20px). Sits in the top-right of the header.

### Nav Link
**Role:** Primary navigation text

Plain text link, no underline, Ash #858585 or Paper #ffffff color, Inter 16px weight 400 at -0.007em tracking. Inactive links use #858585; the active/current page uses Paper #ffffff. No background, no border.

### Hero Display Heading
**Role:** Page-level headline

Inter 86px weight 400, Paper #ffffff, -0.064em letter-spacing, line-height 1.0. The negative tracking at this size is signature — it makes the type feel architectural rather than editorial. No bold, no italic, just precise geometry.

### Section Heading
**Role:** Subsection headline

Inter 56px weight 400, Paper #ffffff, -0.040em letter-spacing, line-height 1.25. Same whisper-weight philosophy as display, scaled down for sub-sections.

### Product UI Panel Card
**Role:** Embedded product screenshot container

Large surface (Carbon #040910 or Graphite #0d0d0d background), 16px border-radius, 1px inset white border at rgba(255,255,255,0.12) for definition against the black canvas. 24px internal padding. Contains dense tabular data with JetBrains Mono labels.

### Standard Card
**Role:** Content grouping surface

Graphite #0d0d0d or Steel #2b2c2 background, 8-16px border-radius, subtle 1px inset border rgba(255,255,255,0.12) for edge definition. 16-24px internal padding. No drop shadow — elevation is communicated through surface color and the inset border only.

### Feature Card with Image
**Role:** Public-page card with visual

Larger radius (24-30px), dark background, image area with 24px radius and overflow hidden. Title at 20-24px Inter, body text at 16px Ash #858585.

### Text Input
**Role:** Form input field

Iron #1f1f1f background, 8px border-radius, subtle outer glow via rgba(255,255,255,0.2) 0px 0px 1px 0px. White text, Ash placeholder. 12-16px Inter for the field text.

### Status Pill / Tag
**Role:** State indicator or category label

Small pill-shaped element, dark background with white or muted text, JetBrains Mono 12-13px. Used for task statuses, types and other compact labels.

### Logo Mark
**Role:** App identity

The TasksHQ app mark: angular and geometric, in foreground white #ffffff on the dark canvas. Sits top-left of every page.

## Do's and Don'ts

### Do
- Use #0063e1 exclusively for the single primary CTA per viewport — never for decorative elements, illustrations, or non-action accents
- Apply -0.064em letter-spacing on display type (72px+) and scale proportionally down to -0.005em at body sizes (12px)
- Use Inter weight 400 for all headlines — no bold weights for display type; authority comes from size and tracking, not weight
- Communicate card elevation through the rgba(255,255,255,0.12) 1px inset border, never through drop shadows
- Maintain the 5-level surface stack (Obsidian → Carbon → Graphite → Iron → Steel) with clear 3-5% luminance steps between each level
- Use 59px border-radius for all pill-shaped buttons and 16px radius for content cards — never mix the two radii on the same element type
- Let product UI screenshots be the visual focal point of public pages rather than stock photography or lifestyle imagery

### Don't
- Never use multiple chromatic accent colors — the system is monochromatic + one blue; introducing green, red, or purple breaks the entire visual language
- Never apply drop shadows to cards or panels; the inset white border IS the elevation system
- Never set body text below #858585 contrast against the black canvas; use Paper #ffffff for any text that needs to be read at a glance
- Never use bold (700) weights for headlines; Inter weight 400 at large sizes with tight tracking is the signature — bolding destroys it
- Never use letter-spacing greater than 0em on display type; the negative tracking is what makes the headlines feel architectural
- Never place white or light-colored cards on the dark canvas; all surfaces must stay in the black-to-charcoal range
- Never use rounded images or organic shapes for the logo or app mark — the geometry is angular and precise

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Obsidian Canvas | `#000000` | Page background, infinite floor |
| 1 | Carbon Panel | `#040910` | First card elevation, product UI containers |
| 2 | Graphite Card | `#0d0d0d` | Standard card surfaces, content blocks |
| 3 | Iron Form | `#1f1f1f` | Input fields, interactive form surfaces |
| 4 | Steel Overlay | `#2b2c2` | Top elevation, hover states, prominent overlays |

## Elevation

- **Cards:** `rgba(255, 255, 255, 0.12) 0px 0px 0px 1px inset`
- **Input fields:** `rgba(255, 255, 255, 0.2) 0px 0px 1px 0px`

## Imagery

Public pages use product UI screenshots as the primary visual — not lifestyle photography, not illustrations. Screenshots are full-bleed within their card containers and show boards, tables, statuses and task details with synthetic data. The strategy is "show the product" — the interface is the hero.

## Layout

Full-bleed dark canvas with max-width 1200px centered content. The hero is a centered stack: floating status badges in the upper third, large display headline centered below, subtext, then a single CTA — no split-screen, no side image. Below the hero, sections alternate between centered text blocks and embedded product UI screenshots in 16px-radius cards. The rhythm is: centered headline → product screenshot → feature grid (2-3 columns) → footer. Navigation is a minimal top bar: logo left, 4-5 text links center, CTA button right. No sidebar, no mega-menu. Section gaps are generous (80px) creating breathing room in the dark space.

## Agent Prompt Guide

**Quick Color Reference**
- text: #ffffff (headings, primary), #858585 (body, secondary)
- background: #000000 (page), #0d0d0d (cards), #2b2c2e (elevated)
- border: rgba(255,255,255,0.12) 1px inset (cards), #858585 (hairline dividers)
- accent: #0063e1 (the one blue: status dots, highlights)
- primary action: #0063e1 (filled action)

**Example Component Prompts**

1. **Hero Section**: Full-bleed #000000 background. Centered Inter display headline at 86px weight 400, #ffffff, letter-spacing -0.064em, line-height 1.0. Subtext at 18px weight 400, #858585. Primary CTA: pill button, #0063e1 fill, white text at 16px, 59px border-radius, 20px 32px padding.

2. **Product Feature Card**: 16px border-radius, #0d0d0d background, 1px inset border rgba(255,255,255,0.12). 24px internal padding. Heading at 20px Inter weight 400, #ffffff, -0.027em tracking. Body text at 16px #858585. Embedded product screenshot fills the lower half with 8px radius.

3. **Navigation Header**: 80px tall, transparent over #000000. Logo (TasksHQ app mark) in #ffffff, left-aligned. Four nav links in Inter 16px weight 400, #858585, centered. Pill CTA button right-aligned: #0063e1 fill, 59px radius, white text at 12-14px.

4. **Dark Form Input**: 48px tall, #1f1f1f background, 8px border-radius, outer glow rgba(255,255,255,0.2) 0px 0px 1px 0px. Inter 16px, #ffffff text, #858585 placeholder. 16px horizontal padding.

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-signal-blue: #0063e1;
  --color-obsidian: #000000;
  --color-carbon: #040910;
  --color-graphite: #0d0d0d;
  --color-iron: #1f1f1f;
  --color-steel: #2b2c2e;
  --color-ash: #858585;
  --color-smoke: #979797;
  --color-fog: #8c8c8c;
  --color-paper: #ffffff;

  /* Typography — Font Families */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.2;
  --tracking-caption: -0.005px;
  --text-body: 16px;
  --leading-body: 1.5;
  --tracking-body: -0.007px;
  --text-subheading: 18px;
  --leading-subheading: 1.4;
  --tracking-subheading: -0.015px;
  --text-heading-sm: 20px;
  --leading-heading-sm: 1.33;
  --tracking-heading-sm: -0.027px;
  --text-heading: 24px;
  --leading-heading: 1.33;
  --tracking-heading: -0.027px;
  --text-heading-lg: 56px;
  --leading-heading-lg: 1.25;
  --tracking-heading-lg: -0.04px;
  --text-display: 86px;
  --leading-display: 1;
  --tracking-display: -0.064px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-44: 44px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-60: 60px;
  --spacing-72: 72px;
  --spacing-80: 80px;
  --spacing-120: 120px;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 80px;
  --card-padding: 24px;
  --element-gap: 20px;

  /* Border Radius */
  --radius-sm: 2px;
  --radius-lg: 8px;
  --radius-2xl: 16px;
  --radius-3xl: 24px;
  --radius-3xl-2: 30px;
  --radius-3xl-3: 38px;
  --radius-full: 59px;
  --radius-full-2: 90px;
  --radius-full-3: 100px;

  /* Named Radii */
  --radius-nav: 2px;
  --radius-cards: 16px;
  --radius-images: 24px;
  --radius-inputs: 8px;
  --radius-buttons: 59px;
  --radius-largecards: 30px;

  /* Shadows */
  --shadow-subtle: rgba(255, 255, 255, 0.12) 0px 0px 0px 1px inset;
  --shadow-subtle-2: rgba(255, 255, 255, 0.2) 0px 0px 1px 0px;

  /* Surfaces */
  --surface-obsidian-canvas: #000000;
  --surface-carbon-panel: #040910;
  --surface-graphite-card: #0d0d0d;
  --surface-iron-form: #1f1f1f;
  --surface-steel-overlay: #2b2c2;
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-signal-blue: #0063e1;
  --color-obsidian: #000000;
  --color-carbon: #040910;
  --color-graphite: #0d0d0d;
  --color-iron: #1f1f1f;
  --color-steel: #2b2c2e;
  --color-ash: #858585;
  --color-smoke: #979797;
  --color-fog: #8c8c8c;
  --color-paper: #ffffff;

  /* Typography */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.2;
  --tracking-caption: -0.005px;
  --text-body: 16px;
  --leading-body: 1.5;
  --tracking-body: -0.007px;
  --text-subheading: 18px;
  --leading-subheading: 1.4;
  --tracking-subheading: -0.015px;
  --text-heading-sm: 20px;
  --leading-heading-sm: 1.33;
  --tracking-heading-sm: -0.027px;
  --text-heading: 24px;
  --leading-heading: 1.33;
  --tracking-heading: -0.027px;
  --text-heading-lg: 56px;
  --leading-heading-lg: 1.25;
  --tracking-heading-lg: -0.04px;
  --text-display: 86px;
  --leading-display: 1;
  --tracking-display: -0.064px;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-44: 44px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-60: 60px;
  --spacing-72: 72px;
  --spacing-80: 80px;
  --spacing-120: 120px;

  /* Border Radius */
  --radius-sm: 2px;
  --radius-lg: 8px;
  --radius-2xl: 16px;
  --radius-3xl: 24px;
  --radius-3xl-2: 30px;
  --radius-3xl-3: 38px;
  --radius-full: 59px;
  --radius-full-2: 90px;
  --radius-full-3: 100px;

  /* Shadows */
  --shadow-subtle: rgba(255, 255, 255, 0.12) 0px 0px 0px 1px inset;
  --shadow-subtle-2: rgba(255, 255, 255, 0.2) 0px 0px 1px 0px;
}
```
