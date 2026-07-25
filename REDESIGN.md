# UI/UX Redesign — AgentPeek

Your task is NOT to redesign the architecture.

Your task is to completely redesign the visual experience of AgentPeek so it feels like a premium native macOS application.

The current UI looks like an internal debug panel.

I want users to immediately think:

"This looks like something Apple or Linear would build."

---

# Design Inspiration

Take inspiration from:

- Apple macOS Control Center
- Apple Music mini player
- Arc Browser
- Linear
- Claude AI desktop app
- Raycast
- Notion (spacing and typography)

DO NOT copy them.

Instead, combine their design principles into something unique.

---

# Overall Design Philosophy

The UI should feel:

- Calm
- Premium
- Modern
- Alive
- Minimal
- Elegant
- Soft
- Intelligent

Never flashy.

Never neon.

Never gaming RGB.

Never look like Electron developer tools.

The overlay should almost disappear until it needs attention.

---

# Visual Language

The entire application should use Apple's design language.

Use:

• Frosted glass
• Layered surfaces
• Soft shadows
• Large corner radius
• Beautiful spacing
• Depth
• Motion
• Blur

Everything should feel native.

---

# Window

Replace the current dark rectangle.

Instead create:

- Frosted glass surface
- Backdrop blur
- Large radius (24-28px)
- Thin translucent border
- Soft shadow
- Slight inner highlight

The window should feel like floating glass.

---

# Color Palette

Background

Very dark charcoal

NOT pure black.

Example:

#171717

Cards

#202124

Text

Almost white

Secondary text

Neutral grey

Accent colors only represent status.

Working

Emerald

Reading

Blue

Permission

Amber

Error

Red

Finished

Green ripple

Never use more colours than necessary.

---

# Typography

Use:

SF Pro Display

Fallback:

Inter

Only use JetBrains Mono for:

- filenames
- terminal commands
- token counts

Hierarchy:

Project Name

Largest

Current Activity

Medium

Metadata

Small

Everything should breathe.

---

# Remove Empty Space

Currently most of the overlay is empty.

Instead create sections.

────────────────────

Project

Status

Activity

Timeline

Progress

────────────────────

The overlay should always feel alive.

---

# Status Orb

Remove the static coloured dot.

Replace it with a living orb.

Each state has its own animation.

Thinking

- breathing
- slow glow

Reading

- rotating particles

Editing

- shimmering

Testing

- rotating ring

Permission

- amber pulse

Error

- soft shake

Finished

- ripple

The orb becomes the application's signature element.

---

# Activity Timeline

Always display recent activity.

Example

✓ Read 42 files

✓ Planned changes

✏ Editing

ColorProcessor.kt

🧪 Running tests

The newest item animates in.

Completed items fade slightly.

---

# File Activity

Show currently active file.

Example

Editing

ExportCoordinator.kt

Use monospace.

Animate filename changes.

---

# Progress

Do NOT use a traditional progress bar.

Instead use a premium capsule progress indicator.

Rounded.

Animated.

Smooth interpolation.

Never jump.

---

# Motion

Motion is critical.

Everything should animate.

Examples

Hover

Expand

Collapse

Status change

Progress updates

Timeline entries

Orb transitions

Opacity

Scale

Use spring animations.

Nothing should snap instantly.

---

# Hover Behaviour

Compact mode

Shows:

Orb

Project

Current activity

Elapsed time

Hover

Expand smoothly.

Reveal:

Timeline

Files

Progress

Statistics

Never open abruptly.

---

# Statistics

Display small metadata chips.

Examples

17s

89%

42 Files

28k Tokens

Small rounded capsules.

---

# Attention State

When permission is required

The overlay transforms.

Amber glow.

Soft pulse.

Subtle border animation.

Display

⚠ Claude needs approval

[Bring Terminal]

This should immediately catch attention without being aggressive.

---

# Completed State

When finished

The overlay should celebrate gently.

Small ripple animation.

Green check.

Display

Completed

8m 31s

12 files modified

Tests passed

Keep visible for 15 seconds before disappearing.

---

# Glass Effects

Use layered blur.

Different opacity levels.

Depth.

Multiple surfaces.

Avoid flat UI.

---

# Icons

Use Lucide icons.

Small.

Elegant.

No emoji.

No colourful icons.

---

# Shadows

Use multiple soft shadows.

Not one large shadow.

Glass should appear floating.

---

# Layout

Everything aligns perfectly.

Generous spacing.

No cramped elements.

No giant empty areas.

---

# Theme

Dark mode first.

Light mode later.

---

# Responsiveness

Support:

Compact

Expanded

Multiple sessions

The layout should adapt gracefully.

---

# Performance

Animations must stay at 60 FPS.

Avoid unnecessary React renders.

Memoize expensive components.

---

# Design Principles

Prioritize:

Motion > Colour

Spacing > Decoration

Typography > Borders

Hierarchy > Density

Subtlety > Flashiness

---

# Overall Feeling

The finished product should feel like:

- Apple's Dynamic Island
- macOS Control Center
- Arc Browser
- Linear

combined into one cohesive desktop utility.

When someone sees AgentPeek for the first time they should think:

"This feels like a real native macOS product."

NOT

"This looks like a React dashboard."

---

# Bonus

If you have ideas that improve the premium feel while keeping the application minimal, implement them.

Do not hesitate to redesign layouts, spacing, hierarchy or interactions if it results in a cleaner and more polished product.

The priority is creating a delightful user experience rather than preserving the current UI.

# Don't stop at making the UI prettier—act as a senior Apple Human Interface designer. Challenge the existing layout. If a section can be removed, merged, or redesigned to improve clarity, do it. Optimize for glanceability first: the user should understand the agent's state in under one second from peripheral vision. Every animation, component, and piece of information should earn its place.