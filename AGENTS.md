# Agent instructions

Read `docs/USERNAME-CONTRACT.md`, `docs/WAKE-CONTRACT.md`, `README.md`, and `tasks.md` before changes.
This is a technical Android/iOS P2P messenger prototype for Russian networks.
The product is LastCall. Registration uses server-confirmed usernames, not phones.
Bots, channels, and backups are excluded. Earlier V1/V2/services contracts are historical.

## Tracking and collaboration

Use `bd prime`, `bd ready`, and `bd show <id>`. Claim tasks before starting.
Gather code, documentation, dependencies, and history before implementing.
Delegate nontrivial implementation to an agent with explicit file ownership,
then independently read changes and verify them. Never edit other projects in
the parent workspace or inspect their secrets.

## Quality and security

- Prefer maintained libraries and primary documentation over new implementations.
- `npm run check` and `npm run test:e2e` must pass before accepting changes.
- Build Android when the local SDK/JDK is available; report iOS verification
  accurately when full Xcode or signing is unavailable.
- Never commit invitation secrets, `.env`, TURN secrets, device keys, or recordings.
- Never represent prototype invitation encryption as a production identity/ratchet.
- Preserve the relay-only policy and clean up camera/microphone tracks.
- Do not claim DPI invisibility, guaranteed availability, or untested mobile behavior.

## Session completion

Record follow-up work as beads; close only independently verified tasks.
Update `tasks.md` with artifact links. Commit changes, pull with rebase, run
`bd sync`, push, and confirm the branch is up to date with its origin.
Do not leave completed changes only on this machine. Do not delete user stashes.
