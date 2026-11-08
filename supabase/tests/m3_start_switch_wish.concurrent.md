# RP-M3-04 — two-connection acceptance (NOT EXECUTED)

Use a disposable database with the reviewed migrations. Use two independent SQL
connections and fresh fixture-owner IDs only. These are bounded transaction
scripts, not a new runner. Do not install failure hooks in shared Dev. Do not
substitute concurrent Mock calls for these checks. Preserve all errors and
session IDs/wait timing. Stop and roll back on timeout; no automatic retry.

## Setup per scenario

As fixture administrator, create a NEW auth user and record its UUID as `<owner>`;
the existing trigger creates its profile. Create two Wishlist rows under it and
record IDs `<a>` and `<b>`. No existing account may be reused. Set both targets
to 10 for the first scenario. For Pending scenarios, create committed Daily Plans
with completed Items on two distinct dates belonging only to this new owner;
the normal qualification/reward triggers must produce two genuine +1 sources.
Never insert +8 into the Daily ledger or relax its constraints.

Commit setup before opening the competing transactions. Supply UUIDs as literal
UUID strings in the following scripts; keep passwords in the existing local
interactive TLS connection setup, never in SQL/files/chat.

## A: hold an actual uncommitted Start

Connection A (replace placeholders first):

```sql
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local role authenticated;
select set_config('request.jwt.claim.sub', '<owner>', true);
select pg_backend_pid(), clock_timestamp();
select public.start_wish('<a>');
select pg_sleep(8);
commit;
```

While A sleeps, connection B:

```sql
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local role authenticated;
select set_config('request.jwt.claim.sub', '<owner>', true);
select pg_backend_pid(), clock_timestamp();
select public.start_wish('<b>');
commit;
```

Distinct backend PIDs and overlapping time windows are required. With no Pending,
B waits and receives WISH_ALREADY_UNLOCKING after A commits. In a NEW isolated
fixture, have A end ROLLBACK instead: B waits then succeeds. A's failed/rolled-back
status, time, marker and allocation changes must be absent. If a query fails,
explicitly ROLLBACK that connection before inspection/cleanup.

## B: immediate unlock is a valid serial outcome

New owner, two genuine Pending +1 sources, target A=1 and B=1. Repeat the two
scripts. Both Starts may succeed: A consumes one source and unlocks, B then
consumes the remaining source and unlocks. Final current Wish is NULL; Pending=0;
each Event net remains exactly 1. With only one source, B may instead remain
Unlocking at 0. Do not require one success/one conflict in these cases.

## C: Switch / Switch and Start / Switch

New owner with A already Unlocking, and targets B/C in Wishlist. In A's script
replace the call with switch_wish(B); in B's script use switch_wish(C). Inspect
the final state as one legal serial order: exactly one current Wish; the two
paused Wishes retain their original started_at and each source's contribution.
Also repeat with a Start caller competing against Switch. State conflicts/no-ops
must agree with the committed order. Repeat same-target calls: no duplicate
transfer or timestamp rewrite after the first command.

## D: Daily grant/reverse/reactivate vs Start/Switch

New owner with timezone UTC and a committed current-UTC-date Plan containing a
pending Task. In connection A replace Start with:

```sql
select public.set_task_completion('<current UTC date>', '<task>', true);
```

Keep its transaction open while B calls Start, then commit. Repeat with B holding
Start first and A completing while B sleeps. Repeat after setting up a completed
Task with `false` (reverse), then `true` (reactivate), and a Switch competitor.
Verify unchanged Event ID/amount/created_at, exactly one grant, no negative
Event/target net and no extra spendable amount from terminal-protected credit.
The expected result must match serialization at the profile mutex, not request
arrival order. The Daily path may already hold Plan/Task/Item locks; the Wish
path must never wait back on those objects while holding the user mutex.

## E: cover association vs Switch

Create a real JPEG cover through the EXISTING approved upload gateway on a fresh
Wish, or prepare a fresh valid object through Storage API as an isolated fixture.
Never fabricate storage.objects metadata. Hold its association RPC in connection
A using the service role/claims in an approved SQL fixture connection. Connection
B Switches that Wish while A holds its row, then reverse the acquisition order
on another fresh Wish. Each call must preserve the other's fields: correct
cover_path, lifecycle status and first started_at. Never grant authenticated
EXECUTE on attach_wish_cover for this test. If a Storage fixture cannot be
prepared, retain this scenario as NOT TESTED instead of weakening the RPC.

## Final inspection / cleanup

After both connections finish, verify one or zero Unlocking, nonnegative net per
Event/target, Active net=amount, Reversed nonterminal/Pending net=0, and unchanged
terminal contributions. Check old Wish progress and started_at and paired
Pending -x / Wish +x by the same Event. Test another owner concurrently to
confirm no shared per-user mutex row.

Remove ONLY fresh-owner Storage paths through Storage API, verify empty prefixes,
then delete ONLY the recorded auth users. Independently check auth 404 and zero
rows in profiles, user_settings, tasks, planning_items, daily_plans,
daily_plan_items, reward_events, wishes, reward_allocations AND wish_reward_state.
These procedures and their outcomes are NOT TESTED until actually executed.
