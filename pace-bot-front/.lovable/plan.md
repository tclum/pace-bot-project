
# PACE AI Avatar Landing Page

A premium single-page site for the Pacific Asian Center for Entrepreneurship at UH Mānoa, designed as the launchpad for two HeyGen-powered AI avatar experiences.

## Design system
- **Colors**: Deep navy `#003366`, vibrant green `#00A550`, gold accent `#FFB300`, white + light gray neutrals — wired into `index.css` as HSL tokens and exposed via Tailwind config.
- **Typography**: Inter from Google Fonts, bold display weights for headings, comfortable body sizes.
- **Motif**: Subtle wave SVG dividers between sections, faint geometric island-inspired pattern as a low-opacity background texture in the hero. Premium and restrained — no kitsch.
- **Motion**: Fade-in on hero text and cards, gentle pulse/glow on the headline, hover-lift + glowing CTA on the avatar cards.

## Sections

### 1. Hero
- Full-bleed navy → dark teal gradient background with a faint geometric overlay pattern.
- Centered: PACE logo placeholder (`<img id="pace-logo">` ready to swap), large white headline "Your Entrepreneurial Journey Starts Here" with a soft animated glow, light-gray subheadline introducing the AI advisors.
- Wave SVG divider transitioning into the next section.

### 2. "Choose Your Experience" — Avatar cards
Two responsive side-by-side cards (stack on mobile), each with an SVG icon, title, description, and CTA. Hover lifts the card and adds a colored glow to the button.

- **Card 1 — Meet Kai: Your PACE Guide**
  - Chat-bubble/robot SVG icon
  - Green CTA "Talk to Kai →"
  - Opens Modal 1
- **Card 2 — Meet Your Business Coach**
  - Briefcase/handshake SVG icon
  - Navy CTA with gold border "Start Coaching Session →"
  - Opens Modal 2

**Modals**: Custom React modal (no UI library), 80vw × 80vh, dark semi-transparent overlay, ✕ close button top-right, ESC-to-close and click-outside-to-close. Embeds an `<iframe>` at 100% × 100% with `allow="camera; microphone"` and a clearly commented placeholder `src` (`YOUR_HEYGEN_EMBED_LINK_1` / `_2`).

### 3. About PACE strip
Light-gray full-width band, two-column layout:
- Left: Mission paragraph about PACE / Shidler / 10 UH campuses.
- Right: Three bold stat highlights with icons — "10 UH Campuses Served", "Programs for Every Stage", "Real Mentors, Real Results".

### 4. Footer
Dark navy footer with white text:
- Left: PACE logo placeholder
- Center: Full org name + contact (`pace@hawaii.edu` · `(808) 956-5083`)
- Right: "Visit PACE Website" link + Instagram (@pacehawaii) and YouTube icons
- Bottom: © 2025 Shidler College of Business line

## Technical notes
- React + Tailwind only; modal state via `useState`; smooth scroll enabled globally.
- Semantic `<header>`, `<main>`, `<section>`, `<footer>` structure.
- Fully responsive across mobile / tablet / desktop.
- Clearly commented swap points for: (1) PACE logo image URL, (2) HeyGen embed link 1, (3) HeyGen embed link 2.
- Inter loaded via Google Fonts in `index.html`; design tokens centralized in `index.css` + `tailwind.config.ts`.
