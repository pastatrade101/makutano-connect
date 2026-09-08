# Rotating the legacy tracker identifier

The live tracker's identifier was minted before the enrollment flow existed, as
operator-typed free text. On the OsmAnd ingest path **the identifier is the
entire credential** — `/osmand?id=…` has no shared secret, no token and no
session — so anyone holding it can post positions as that vehicle. It also
appears in the `makutano-traccar` git history, which is why that repository has
no remote yet.

Rotating it is therefore a credential rotation, not a rename.

## Rules

- **Do not rename the Traccar `uniqueId`.** A rename leaves the same row, the
  same history and no ledger record; it also leaves the vehicle pointing at a
  reference the ledger never minted.
- **Do not fake the first fix with protocol POSTs.** That is what made Phase 2
  "one step short of verified" in the first place. A posted fix proves the server
  accepts a fix; it proves nothing about the phone.
- **Do not press "Remove tracking".** Remove is not replace: it closes the
  enrollment, clears the vehicle and tells the worker to delete the device
  immediately — production tracking stops there and then.
- Needs **physical access to the existing phone**, because the same handset must
  be pointed at the new identity.

## Why this is safe to do on the live vehicle

Replacement is built into the lifecycle. `bindEnrollment` closes the outgoing
enrollment **in the same transaction** that activates its replacement, and it is
only reached once the new configuration has already reported a genuine fix. The
old device is handed to cleanup for deletion afterwards.

So the order is: old tracker keeps working → new one proves itself → old one is
retired → old identifier stops being accepted. There is no window where the
vehicle is untracked, and nothing is deleted on the strength of an intention.

## Operator steps

1. **Vehicles → the tracked vehicle → GPS Tracking.**
   It shows _Tracking is set up · Connected_.
2. Press **"Replace tracking device"**.
   This starts a second enrollment beside the live one. The current tracker keeps
   reporting — the screen says so.
3. Wait for `PENDING → PROVISIONED`. The page updates itself; the worker mints a
   fresh 15-character identifier and creates the provider device. **The
   identifier is never displayed** — the QR is its only delivery.
4. The **setup code (QR)** appears, with an expiry. Keep the screen open.

## Phone steps — the same handset that runs the live tracker

5. Open **Traccar Client** on that phone.
6. **Scan the QR from the operator's screen.** The app should take its server URL
   and identifier from the code.
   **If the app asks you to type an identifier, stop and record it.** That is the
   finding this test exists to produce, not something to work around.
7. Confirm the app's server URL reads exactly
   `https://tracking.makutano.co.tz/osmand` with no query string.
8. Start tracking, and take the phone outdoors long enough for a real GPS fix.
   The fix must come from the phone; do not simulate a location.

## What happens next, by itself

9. The worker sees the first genuine fix, activates the new enrollment, closes
   the old one in the same transaction, and schedules the old device for
   deletion. The page flips to _Tracking is set up_ against the new tracker.

## Verify before calling the old credential revoked

| Check                             | How                                                                       |
| --------------------------------- | ------------------------------------------------------------------------- |
| Vehicle points at the new tracker | Vehicles → the vehicle shows Connected; one ACTIVE enrollment for it      |
| Latest position advances          | `tc_positions` max `fixtime` moves after the phone reports                |
| Web tracking works                | The vehicle appears on the fleet list and Live Map with a recent position |
| Mobile read path works            | The vehicle shows in the app's tracking view                              |
| Old device deleted                | `tc_devices` no longer contains the legacy identifier                     |
| Old identifier no longer accepted | See below                                                                 |
| Exactly one new provider device   | `tc_devices` count unchanged overall — one added, one removed             |
| No identifier displayed anywhere  | It appeared only inside the QR image                                      |

**Proving the old identifier is dead.** Traccar caches device sessions, so a POST
immediately after deletion can still be attributed. Wait for the cache to settle,
then post once with the OLD identifier and confirm **no row is stored** — the
HTTP status is not the answer, the row count is:

```bash
# BEFORE
docker exec traccar-db psql -U traccar -d traccar -t -A -c "select count(*) from tc_positions"
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://tracking.makutano.co.tz/osmand?id=<legacy-device-reference>&lat=-3.4&lon=36.7&timestamp=$(date +%s)"
# AFTER — must be identical to BEFORE
docker exec traccar-db psql -U traccar -d traccar -t -A -c "select count(*) from tc_positions"
```

Only when that count does not move is the old credential revoked, and only then
may the git history be scrubbed and the repository given a remote.

## What this does NOT prove

Rotation exercises the replace path with a real handset, which is worth having.
It does **not** close the Phase 2 gate: that requires the full operator flow on a
**controlled test vehicle with a second handset**, driven by someone who did not
build the integration. See `PHASE2-HANDSET-TEST.md`. Phase 2 stays
_operational proof still limited_ until that happens.
