## Visual direction

- Style: dark pixel-office operations dashboard
- Density: 8/10
- Motion: 5/10, state-machine movement only
- Layout variance: 6/10
- Signature: office and company chat remain visible together while employees follow explainable routines
- Office theme (v3): cyber-noir pixel office — neon accents, night city window, glow from ceiling lamps, blinking rack LEDs, patrolling floor-sweeping robot
- Decoration budget: static furniture and ambience only; never attached to status logic, hidden ≤620px, animations off under reduced motion

## Token spine

- Canvas: `--org-bg`
- Raised surfaces: `--org-panel`, `--org-panel-raised`, `--org-panel-soft`
- Primary text: `--org-ink`; secondary: `--org-muted`; tertiary: `--org-dim`
- Single brand accent: `--org-pink`; emphasis: `--org-yellow`
- Semantic status: `--org-blue`, `--org-green`, `--org-red`
- Motion: `--org-motion-fast`, `--org-motion-base`, `--org-motion-walk`
- Easing: `--org-ease-out`, `--org-ease-walk`

## Office v3 ambience tokens

- Neon rail: `--office-cyan #6ee7f5`, `--office-pink #ef5b91`, `--office-amber #ffd76a`
- Glow: `0 0 10px` for neon, `radial-gradient` pools under lamps and floor lamp
- Blink cadence: `steps(2, end)` at 1.6–4s for LEDs, neon strip and OPEN sign
- Robot patrol: `steps(1, end)` keyframes, 13s loop across the floor band (top 89.5% ↔ 93.8%)
- Decor pixel furniture: hard edges, 1px borders, `2px 2px 0` offset shadows, `z-index: 2` (below avatars)

## Component metrics

- Workbench: roster `clamp(230px, 15vw, 300px)`, conversation flexible, office status sidebar `clamp(280px, 24vw, 440px)`
- Main hierarchy: directory → conversation/thinking/tool trace → compact office status sidebar
- Live stage: conversation and office share the current viewport and scroll independently; no overlay inspector covers the conversation
- Office/chat split: wide containers use `minmax(0, 1fr) + clamp(280px, 24vw, 440px)`; narrow screens stack conversation above a 260–300px office preview
- Interactive target: minimum `44px` on compact/mobile controls
- Pixel furniture: hard edges, 3px outlines, 4px offset shadows
- Reduced motion: employee travel and decorative animation collapse to instant state changes
