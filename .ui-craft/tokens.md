## Visual direction

- Style: premium cyber-noir AI company operations dashboard
- Density: 7/10
- Motion: 4/10, state-machine movement only
- Layout variance: 6/10
- Signature: one illustrated 1200×720 headquarters remains the dominant live surface while real chat stays visible

## Token spine

- Canvas: `--bg #050914`
- Panels: `--panel #09111f`, `--panel2 #0d1727`, `--panel3 #111d31`
- Text: `--text #edf4ff`, `--muted #8c9bb5`, `--dim #586780`
- Accent: `--cyan #43d9ff`, `--violet #a36bff`
- Semantic: `--green #4de2a1`, `--amber #f0b55e`, `--red #ff6f86`
- Radius: `--r 10px`

## Component metrics

- Header: 58px
- >=1600: roster 250px, center minmax(720px, 1fr), rail 300px, gap 10px
- 1280–1600: roster 220px, center minmax(660px, 1fr), rail 270px
- <=1220: rail drawer
- <=1000: roster and rail drawers; office remains a fixed 1200×720 panning world
- Office/chat: office flexes to remaining height; chat defaults 300px, resizable 240–420px
- Chat channels: 150px; thread: 260px when open
- Roster avatar: 42px; office sprite: 74px container using 128px source
- Focus: 2px cyan ring; all image failures fall back to initials
