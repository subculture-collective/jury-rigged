# JuryRigged Neubrutal HUD UI Style Guide

**Target format:** 16:9 single-screen layout, 2560×1440  
**Aesthetic:** clean Neubrutalism + sci-fi HUD + terminal discipline  
**Core rules:** flat colors only, no gradients, no glassmorphism, no glow-heavy cyberpunk, no green-on-black terminal cliché.

---

## 1. Design Direction

The interface should feel like a high-contrast broadcast control panel: bold, readable, technical, and theatrical without becoming cluttered.

Use hard outlines, flat color blocks, solid offset shadows, monospace metadata, large readable text, deliberate asymmetry, and clear instrument-panel grouping.

Avoid gradients, glassmorphism, neon glow, tiny decorative HUD text, green terminal tropes, and overlapping noisy widgets.

**Priority order:** readability → information hierarchy → stream-safe layout → visual impact → decorative detail.

---

## 2. Semantic Color Tokens

### Core tokens

| Token | Hex | Usage |
|---|---:|---|
| `bg.base` | `#09090B` | Main canvas/background |
| `bg.raised` | `#18181B` | Primary panels, large surfaces |
| `bg.panel` | `#27272A` | Active modules, transcript zones, cards |
| `border.default` | `#3F3F46` | Panel outlines, separators, inactive controls |
| `text.primary` | `#FAFAFA` | Main readable text |
| `text.secondary` | `#A1A1AA` | Metadata, timestamps, helper text |
| `accent.primary` | `#A855F7` | Major events, objections, premium Twitch events |
| `accent.secondary` | `#6366F1` | Info states, live sync, phase markers |

### Extended state tokens

| Token | Hex | Usage |
|---|---:|---|
| `state.info` | `#6366F1` | Sync, stream status, neutral notices |
| `state.success` | `#14B8A6` | Confirmed actions, completed events, accepted prompts |
| `state.warning` | `#F59E0B` | Queue delays, pending checks, attention states |
| `state.error` | `#F43F5E` | Failed API calls, disconnected state, rejected prompts |
| `state.live` | `#A855F7` | Broadcast live state, active stingers |
| `state.neutral` | `#A1A1AA` | Idle, waiting, unknown |

Use success sparingly so the UI does not drift into green-terminal cliché.

### Color usage rules

- Use `#09090B`, `#18181B`, and `#27272A` for 70–80% of the screen.
- Use purple/indigo accents as signal colors, not as broad fills.
- Borders should be visible: 2px for major panels, 1px for minor separators.
- Use accent strips, corner ticks, badges, and labels instead of glow.
- Never place small `text.secondary` on `bg.panel`; bump size or use `text.primary`.
- Pair color with text labels so meaning survives compression and low-contrast streams.

---

## 3. Typography

**Primary UI font:** `Space Grotesk`, `Inter`, `system-ui`, sans-serif  
**Technical/terminal font:** `JetBrains Mono`, `IBM Plex Mono`, monospace

| Role | Size @ 1440p | Style |
|---|---:|---|
| Case title | 44–56px | Sans, semibold, tight tracking |
| Section title | 30–38px | Sans, semibold |
| Chat/dialogue body | 28–34px | Sans, regular/medium |
| Speaker name | 24–30px | Sans or mono, bold |
| Role label | 18–22px | Mono, uppercase, tracked |
| Metadata | 18–22px | Mono, uppercase |
| Tiny decorative labels | 16px minimum | Only if nonessential |

If it matters to the stream viewer, it must remain readable at 720p downscale.

---

## 4. Layout System

- Canvas: `2560×1440`.
- Safe margin: `96px`.
- Internal panel gap: `24–32px`.
- Keep center clear enough for the stream subject or game/camera feed.

Recommended screen structure:

```text
┌────────────────────────────────────────────────────────┐
│ Header: case title, live status, runtime               │
├───────────────────────────────┬────────────────────────┤
│ Main transcript / chat feed   │ Sidebar status modules │
│ Alternating speaker rows      │ Twitch social cards    │
├───────────────────────────────┴────────────────────────┤
│ Phase, evidence, objections, prompt/queue summaries     │
└────────────────────────────────────────────────────────┘
```

The transcript owns the largest area. Sidebar modules should be stacked, grouped, and scannable. Alerts/stingers may temporarily overlay but should not permanently steal layout space.

---

## 5. Component Style

### Panels

- Background: `bg.raised` or `bg.panel`.
- Border: `2px solid border.default` for primary panels.
- Radius: `8–16px`; avoid pill-shaped panels except for badges.
- Depth: hard offset shadow only, such as `8px 8px 0 #000`.
- No blur, gradients, or soft shadows.

### Chat / transcript rows

- No boxed card around every message.
- Alternate left/right justification.
- Use flat accent edge or top divider.
- Speaker name and role color reflect role.
- Dialogue body remains large and high-contrast.

Role color mapping:

| Role | Token |
|---|---|
| Judge | `state.warning` |
| Prosecutor | `accent.secondary` |
| Defense | `accent.primary` |
| Witness | `state.success` |
| Bailiff | `text.secondary` |
| Jury | `state.info` |

### HUD labels

- Monospace.
- Uppercase.
- Tracking: `0.14em–0.24em`.
- Use as anchors, not decoration noise.

Examples: `CURRENT PHASE`, `EVIDENCE LOCKED`, `LATEST FOLLOWER`, `SYNCED 01:42:09`.

---

## 6. Twitch Integration

Twitch data should feel like part of the courtroom HUD, not bolted-on stream clutter.

Recommended persistent cards:

- Latest follower
- Latest subscriber
- Latest gifter
- Most gifted
- Queue count
- Active prompt source

Twitch card rules:

- One line for label.
- One large username.
- One small metadata line.
- No avatars unless the visual system later standardizes them.
- Reserve purple for high-value or high-drama events.

Event priority:

1. Major gift / raid / sub streak
2. Latest subscriber
3. Latest gifter
4. Latest follower
5. Queue/chat metadata

Low-priority events update cards; high-priority events may trigger stingers.

---

## 7. Motion and Stingers

Motion should feel mechanical and precise.

| Motion | Duration |
|---|---:|
| Hover/focus | 120–160ms |
| Panel reveal | 180–260ms |
| Stinger entry | 240–360ms |
| Stinger exit | 180–240ms |
| Count-up | 300–500ms |

Allowed motion: snap-in slide, hard wipe, terminal cursor blink, step reveal, count-up numbers, frame-lock stinger, brief shake for objection/high-impact alerts.

Avoid elastic bounce, particle spam, constant flicker, long cinematic transitions, and glowing trails.

---

## 8. Interaction States

| State | Treatment |
|---|---|
| Default | Dark panel, neutral border |
| Hover | Brighter border, slight hard-offset shift |
| Active | Accent border + accent label |
| Focus | 2–3px solid `accent.secondary` outline |
| Disabled | `bg.panel`, `text.secondary`, reduced opacity |
| Error | `state.error` border/label |
| Warning | `state.warning` label/edge |
| Success | `state.success` label/edge |

No color-only feedback. Pair color with labels, icons, or motion.

---

## 9. Spacing

Use this scale consistently:

```text
4px   micro alignment
8px   compact internal gap
12px  label-to-content gap
16px  small component padding
24px  panel padding
32px  major layout gap
48px  section separation
96px  screen safe margin
```

Neubrutalism works best when spacing is disciplined. HUD density should never become clutter.

---

## 10. Implementation Notes

- Build tokens first, then components.
- Keep colors semantic; avoid one-off hardcoded component colors.
- Prefer CSS variables and Tailwind theme tokens.
- Use reusable primitives: `Panel`, `HudLabel`, `MetricCard`, `TranscriptRow`, `TwitchSignalCard`, `Stinger`.
- Test readability at 2560×1440, 1920×1080, 1280×720, and Twitch mobile preview scale.

Final feel: a precision courtroom broadcast console designed by someone who likes terminals, sci-fi instrumentation, and brutalist editorial layouts, but cares more about legibility than decoration.
