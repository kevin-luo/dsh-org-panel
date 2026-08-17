## Visual direction

- Style: dark pixel-office operations dashboard
- Density: 8/10
- Motion: 5/10, state-machine movement only
- Layout variance: 6/10
- Signature: office and company chat remain visible together while employees follow explainable routines

## Token spine

- Canvas: `--org-bg`
- Raised surfaces: `--org-panel`, `--org-panel-raised`, `--org-panel-soft`
- Primary text: `--org-ink`; secondary: `--org-muted`; tertiary: `--org-dim`
- Single brand accent: `--org-pink`; emphasis: `--org-yellow`
- Semantic status: `--org-blue`, `--org-green`, `--org-red`
- Motion: `--org-motion-fast`, `--org-motion-base`, `--org-motion-walk`
- Easing: `--org-ease-out`, `--org-ease-walk`

## Component metrics

- Workbench: roster `clamp(230px, 15vw, 300px)`, conversation flexible, office status sidebar `clamp(280px, 24vw, 440px)`
- Main hierarchy: directory → conversation/thinking/tool trace → compact office status sidebar
- Live stage: conversation and office share the current viewport and scroll independently; no overlay inspector covers the conversation
- Office/chat split: wide containers use `minmax(0, 1fr) + clamp(280px, 24vw, 440px)`; narrow screens stack conversation above a 260–300px office preview
- Interactive target: minimum `44px` on compact/mobile controls
- Pixel furniture: hard edges, 3px outlines, 4px offset shadows
- Reduced motion: employee travel and decorative animation collapse to instant state changes
