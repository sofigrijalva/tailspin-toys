---
description: 'Tailwind CSS v4 styling patterns and dark theme guidelines'
applyTo: '**/*.{astro,css}'
---

# Tailwind CSS Instructions

## Commenting and TypeScript Style

### Commenting philosophy

Comment the intent, not the mechanics. The code should explain what it does; comments should explain why a decision exists, what trade-off it is balancing, or what invariants matter. Avoid comments that merely restate the line below them or describe obvious operations already visible in the code.

Treat stale comments as a bug: if a comment no longer matches the behavior, update it in the same change or remove it.

### TypeScript formatting and documentation rules

- Prefer explicit types for function parameters and return values in `db/` and `src/lib/`, especially for exported functions and helpers.
- Write self-documenting interfaces and type aliases for component props, data contracts, and database rows.
- Keep formatting consistent with the repo's ESLint defaults: readable multi-line signatures, predictable spacing, and no dead/unused variables.
- When a rule is already enforced by ESLint, follow it consistently; `@typescript-eslint/no-unused-vars` and the recommended TypeScript/JS rules are the baseline for code hygiene.

## Tailwind CSS v4 Configuration

This project uses Tailwind CSS v4.1.14 via the `@tailwindcss/vite` plugin.

### Global CSS Setup

- Import Tailwind in `global.css`: `@import "tailwindcss";`
- No separate `tailwind.config.js` file is used
- Configuration is handled through the Vite plugin

## Dark Theme Styling

ALL UI components MUST use dark theme colors:

### Color Palette

- Background colors: `bg-slate-800`, `bg-slate-900`, `bg-slate-950`
- Text colors: `text-slate-100`, `text-slate-200`, `text-slate-300`
- Border colors: `border-slate-700`, `border-slate-600`
- Accent colors for hover/focus states

### Common Patterns

- Cards and containers: `bg-slate-800 rounded-xl p-6 shadow-lg`
- Hover effects: `hover:bg-slate-700 transition-colors duration-200`
- Borders: `border border-slate-700`
- Gradients for visual interest: `bg-gradient-to-br from-slate-800 to-slate-900`
- Backdrop effects: `backdrop-blur-sm bg-slate-900/50`

### Responsive Design

- Use responsive prefixes: `sm:`, `md:`, `lg:`, `xl:`
- Mobile-first approach
- Ensure readability on all screen sizes

## Utility Classes

- Prefer utility classes over custom CSS when possible
- Use semantic grouping: layout, spacing, colors, typography
- Keep utility combinations readable and maintainable

## Modern UI Patterns

- Rounded corners: `rounded-lg`, `rounded-xl`, `rounded-2xl`
- Smooth transitions: `transition-all duration-200 ease-in-out`
- Shadows for depth: `shadow-md`, `shadow-lg`, `shadow-xl`
- Focus states for accessibility: `focus:ring-2 focus:ring-blue-500`
