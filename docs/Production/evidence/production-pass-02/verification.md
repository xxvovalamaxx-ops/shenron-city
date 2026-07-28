# Production Pass 02 verification record

Date: 2026-07-29 (Asia/Jerusalem)

## Automated gates

- `npm ci`
- `npm run check`
- `npm run audit:production`
- `npm run build`
- `npm audit --audit-level=high`

The final `npm run check` output is the release gate. It includes ESLint, TypeScript,
Vitest, asset licensing/manifest checks, glTF inspection, the visible-primitive audit,
the standalone-network boundary, the Vite production build, and the npm vulnerability
audit.

## Real-browser checks

- Served `dist` with `vite preview` on `127.0.0.1:9123`.
- Loaded the title screen in Chromium at 2560 x 889 CSS pixels.
- Entered the city with the `no-pointer-lock=1` automation validation switch.
- Confirmed the Web Audio context was running at 48 kHz.
- Collected 20 non-zero stereo analyser samples.
- Captured the title, launch frame, and all twelve fixed regression cameras.
- Filtered current-preview console output to the local application origin.

## Fixed regression cameras

- city-entry
- hero-boulevard
- night-market-wide
- night-market-close
- kai-conversation
- hq-exterior
- hq-entrance
- hq-lobby
- secretary-close
- elevator-interior
- floor45-arrival
- agent-workstation

## Gates not completed

- Normal focused pointer-lock traversal through the complete route
- Repeated door and elevator interaction
- Every quality preset traversed end to end
- Stable target-machine frame benchmark
- Texture-memory byte measurement
- Full gameplay video recording
- Recorded-file LUFS and true-peak measurement
- Direct visual comparison to `20260728-2122-08.8564544.mp4` because that file was not
  present locally
