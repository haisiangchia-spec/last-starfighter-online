# Automated fidelity verification

## Running the tests

- `node --test tests/combat.test.cjs`: deterministic online combat regression tests.
- `npm install` and `npx playwright install chromium`, then `npx firebase emulators:exec --project starfighter-online --only auth,firestore "npm run test:browser"`: real Chromium UI tests against isolated Auth/Firestore emulators.
- Both suites run automatically on GitHub Actions; browser failure screenshots, traces and HTML reports are uploaded as `browser-e2e-report`.
- The emulator test path activates only on `127.0.0.1` with `?emulator=1`; normal GitHub Pages uses production Firebase.
- The local game exposes a read-only state snapshot only on `127.0.0.1`.

## Browser tests implemented

| Mode | Automated checks |
| --- | --- |
| Local AI 1v1 | Launch, ship deployment, full turn |
| Local AI 1v14 clear space | Launch, 15 ships, wave rows and facing |
| Local AI 1v14 asteroid | Launch, 15 ships, wave rows and facing |
| Local human hot-seat | Launch, separate sealed orders, full turn |
| Online human 1v1 | Separate anonymous identities, room joining, shared seed/asteroids, ready, sealed orders, remote acknowledgement, turn resolution |
| Online human 2v2 | Four anonymous identities, two pilots per team, same end-to-end workflow |

## Not yet proven by these tests

1. Exhaustive FASA rulebook fidelity (every movement restriction, damage result, weapon arc, Death Blossom sequence and victory edge case).
2. Long campaigns of consecutive turns, reconnection/reload, rematches and simultaneous conflicting submissions.
3. Every asteroid collision, missile blast and crew-damage outcome in both engines.
4. Production Firebase security rules until the current `firestore.rules` is published to Firebase; the emulator always tests the committed version.
5. Browser compatibility beyond Chromium and realistic network latency.
6. Visual pixel parity between local and online interfaces.

**A green browser run establishes the listed scenarios, not total fidelity.** Expand tests whenever a new rule is implemented or a bug is fixed.
