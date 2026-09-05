# The second-handset test

The one Phase 2 gate that cannot be automated, and the one that has never been
run: a **real** phone, scanning a **real** QR, through the operator UI.

Everything server-side already passed on 4 Sep — provision, activate, worker
restart mid-flight, cancel, expire, replace, revoke — but activation was proven
by POSTing protocol-identical OsmAnd fixes. What that cannot prove is the link
before it: that Traccar Client parses our QR, stores exactly
`https://tracking.makutano.co.tz/osmand` with no query string, and asks the
driver for nothing else.

## Rules for the walk

- A **controlled test vehicle** and a **second handset** — not the live tracker.
- Do **not** create the Traccar device by hand.
- Do **not** insert `tracker_enrollments` by hand.
- Do **not** type an identifier anywhere. If any screen asks for one, that is a
  finding, not something to work around.
- **Give the phone to someone who did not build this.** Do not coach unless they
  are stuck. Where they hesitate IS the result — comprehension is what is being
  tested, not the protocol.

## The walk

Vehicles → the test vehicle → GPS Tracking → **Use Driver's Phone** → generate →
`PENDING` → worker provisions → `PROVISIONED` → QR shown → second handset scans →
handset reports → worker sees the first genuine fix → `ACTIVE` → the vehicle
appears in Connect.

## What to record, at each step

Run this before starting, after the QR appears, and after the phone reports. It
prints the ledger and the provider side by side, and writes nothing.

```bash
ssh -p 2807 -i ~/.ssh/makutano_connect_deploy makutano@194.163.139.108 '
  echo "── ledger ──"
  docker exec -i makutano-connect sh -lc "cat > /tmp/e.mjs && node /tmp/e.mjs; rm -f /tmp/e.mjs" <<EOF
import { createRequire } from "node:module";
const require = createRequire("/app/");
const sql = require("postgres")(process.env.DATABASE_URL, { max: 1 });
const rows = await sql\`select e.status, e.kind, e.identifier_source, e.attempts,
    e.provider_device_id, e.first_fix_at, e.bound_at, e.expires_at, v.name as vehicle, t.name as tenant
  from tracker_enrollments e join vehicles v on v.id = e.vehicle_id
  join tenants t on t.id = e.tenant_id order by e.created_at desc limit 5\`;
console.table(rows);
await sql.end();
EOF
  echo "── provider ──"
  docker exec traccar-db psql -U traccar -d traccar -c \
    "select id, uniqueid, name, to_char(lastupdate,\"YYYY-MM-DD HH24:MI\") as last from tc_devices order by id"
  docker exec traccar-db psql -U traccar -d traccar -c "select count(*) from tc_positions"
'
```

## What must be true at the end

| Check | Why it matters |
| --- | --- |
| Exactly **one** new enrollment row | A retry that duplicated the ledger would break the one-in-flight invariant |
| Exactly **one** new `tc_devices` row | Two devices means the worker provisioned twice |
| `identifier_source = 'MINTED'` | An operator-typed identifier is the attack the design removed |
| `first_fix_at` is set, and matches a real position | `te_evid_chk` allows ACTIVE without it only for LEGACY rows |
| The device is granted to the tenant's read-only user, not the admin | Isolation stops depending on Connect's filtering |
| `attempts` = 1 | More than one means provisioning retried; worth knowing why |
| Web tracking, Live Map and the mobile read path all show it | Three read paths, one device |
| Nothing rendered the reference anywhere but the QR | It is credential material |

## What to write down about the person

Not "did it work" — where they paused. Specifically: did they know what "Use
Driver's Phone" would do before pressing it; did they know what app the driver
needed; did they know whether to keep the screen open; did they understand that
the code expires; and did they know the setup had finished without being told.
