# CineOps Guard — UI/UX Brief

## 1. Design Direction

This is a professional production tool, not a consumer app — the
aesthetic reference is a **mission-control / observability dashboard**
(think Grafana, Linear, Vercel's dashboard) with a few cinematic accents,
not a "movie magic" theme with clapperboards and film-reel icons. The
people using this are under real time pressure on a shoot day; the UI's
job is fast scanning and unambiguous status, not decoration.

- **Dark mode as default** — matches the control-room framing and is
  easier to read on-set/on-location on a laptop.
- **Status color language, used consistently everywhere:** green =
  approved/clear, red = blocked/violation, amber = pending/generating,
  gray = not yet checked. Same palette on cards, the schedule view, and
  the embedded Grafana panel — no separate color language per screen.
- **Typography:** one clean sans for UI text (e.g. Inter), one monospace
  for scene IDs, timestamps, and violation codes — makes the audit trail
  feel precise rather than chatty.
- **Density over whitespace.** A production lead scanning 40 scenes needs
  a dense table/grid, not a card-per-scene layout with lots of air.

## 2. Information Architecture

```
├── Dashboard (default landing)
│   ├── Live compliance status (embedded Grafana panel or native chart)
│   ├── Today's scenes — quick approve/blocked list
│   └── Recent agent activity feed
├── Production
│   ├── Schedule (scene list/calendar, filterable by status/date/stunt type)
│   ├── Scene Detail
│   │   ├── Compliance tab (check history, override control)
│   │   ├── Storyboard tab (generated panels, regenerate/approve)
│   │   ├── Audio tab (mood music, dialogue reads)
│   │   └── Script tab (grounded script excerpt for this scene)
│   └── Script Intake (PDF upload, parsing status)
├── Rehearsal Room
│   ├── Session list (past rehearsals)
│   └── Live session (voice UI, waveform indicator, live transcript)
├── Dailies
│   ├── Upload/queue
│   └── Review (transcript, captions, sentiment flags vs. script)
└── Admin
    ├── Users & roles
    ├── Safety rules editor
    └── Audit log
```

## 3. Key Screens — Behavior Notes

**Dashboard:** the single screen a production lead should be able to
glance at each morning. Scene status counts front and center (X
approved, Y blocked, Z pending), not buried in a table.

**Scene Detail → Compliance tab:** this is the highest-stakes screen —
show the full violation list in plain language (already the tone the
agent writes in), a clear APPROVED/BLOCKED badge, and — critically — an
explicit, logged **override control** for a human safety lead, since the
agent's block is a strong recommendation, not an unoverridable law. The
override action requires a typed reason; never a silent one-click
bypass.

**Storyboard/Audio tabs:** generation is async (Imagen/Lyria calls take
real seconds) — show a generating state with the loading messages
pattern already used elsewhere in this build, not a blank spinner.
Generated assets need an explicit **Approve** action before they count
as "locked in" for the scene — someone has to look at it.

**Rehearsal Room live session:** this is the one screen that isn't
request/response — needs a persistent WebSocket connection, a visible
"listening / speaking" state indicator (simple waveform or pulse), and
a live-updating transcript panel so the actor can see what the agent
understood, catching misfires immediately rather than after the session.

**Dailies review:** sentiment mismatches should be visually flagged
inline against the transcript, not in a separate report — the reviewer
needs to see "script said X, delivery read as Y" at the exact timestamp.

## 4. Accessibility & Practical Notes

- Color is never the only signal — pair every status color with a text
  label or icon (colorblind safety, and it photographs/screenshots
  better for reports).
- This will often be used on a laptop on a loud, bright film set —
  favor high contrast over subtle grays.
- Mobile isn't a primary target for the main dashboard, but the
  Rehearsal Room voice UI should work on a phone, since that's plausibly
  used handheld on set.

## 5. Recommended Tech Stack (for the web dev team)

Hand this section directly to whoever builds the frontend:

| Layer | Recommendation | Why |
|---|---|---|
| Framework | **Next.js 14+ (App Router) + TypeScript** | Server components suit a data-dense dashboard; TS matters given how many typed entities (scenes, checks, assets) flow through the UI |
| Styling | **Tailwind CSS** | Fast to build dense, consistent layouts; pairs with the design-token approach below |
| Component library | **shadcn/ui** | Unstyled, composable primitives (not a heavy pre-themed kit) — lets you actually hit the "control room, not generic SaaS" look instead of looking like every other Tailwind template |
| Charts (non-Grafana) | **Recharts** or **Tremor** | For any in-app chart that isn't just the embedded Grafana panel |
| Grafana embedding | **Grafana's public dashboard embed / iframe panel** | Reuse the same live compliance panel from v1 rather than rebuilding charts natively |
| State/data fetching | **TanStack Query (React Query)** | Handles the async generation-job polling pattern (storyboard/music) cleanly |
| Realtime/WebSocket | **native WebSocket client + a small reconnect wrapper**, or **socket.io** if the backend already speaks it | For the Rehearsal Room's Live API voice session |
| Forms | **React Hook Form + Zod** | Script upload, safety-rule editing, override-reason forms all need real validation |
| Auth (client side) | **Firebase Auth SDK** (matches TRD's Identity Platform choice) | |
| Icons | **Lucide** | Matches shadcn's default, keeps icon language consistent |
| Deployment | **Cloud Run** (containerized Next.js) to stay in the same GCP project as everything else, or **Vercel** if the team prefers zero-config frontend hosting and doesn't mind splitting infra across two providers | |
| Design tokens | Define color/spacing/type scale once in `tailwind.config.ts`, referenced everywhere — don't let individual screens invent their own status colors |

This stack deliberately mirrors the backend's Python/FastAPI world with
a clean TypeScript boundary at the API layer — the frontend never talks
to Postgres, BigQuery, or the MCP server directly, only to the FastAPI
gateway's REST/WebSocket endpoints.
