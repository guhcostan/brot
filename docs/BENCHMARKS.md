# Benchmarks

## 2026-10-20: Brot vs guhbot on the use-case suite

The same cases and checks from `apps/evals` (docs/USE-CASES.md) ran against two projects, both on
`opencode-go/deepseek-v4.1-flash` with the same approval policies:

- **Brot**, through its own runner (DSH in a per-bot Docker computer on Colima).
- **guhbot**, an earlier sibling project, through an adapter that re-implemented the case context on
  its RPC API. One fresh host ran per case. guhbot has no rooms, so a room message went to the lead
  or the mentioned bot, with the team as context.

The suite was written for Brot, so it favors Brot's semantics (rooms, `http_request`, per-bot
computers). The failures it found in guhbot are still real product gaps:

- No send/POST tool behind an approval.
- `run_command` takes no working directory.
- No rooms.
- Egress could be bypassed with `curl` because there is no sandbox.
- No retry on provider 5xx.
- A DeepSeek thinking-mode bug: `reasoning_content` was not echoed back.

Brot run stopped after B7, when the OpenCode Go usage limit was reached. B8 and the C cases are to be
re-run.

| Case | Brot | guhbot |
|---|---|---|
| A1 | fail 6/7 ($0.011) | fail 6/7 ($0.036) |
| A2 | pass 5/5 ($0.064) | fail 3/5 ($0.000) |
| A3 | pass 3/3 ($0.271) | pass 3/3 ($0.191) |
| A4 | pass 3/3 ($0.117) | fail 2/3 ($0.033) |
| A5 | pass 2/2 ($0.049) | pass 2/2 ($0.013) |
| A6 | fail 5/6 ($0.009) | fail 5/6 ($0.008) |
| A7 | pass 6/6 ($0.011) | pass 6/6 ($0.013) |
| A8 | fail 1/3 ($0.017) | fail 1/3 ($0.010) |
| A9 | fail 7/8 ($0.010) | fail 7/8 ($0.015) |
| A10 | pass 6/6 ($0.017) | pass 6/6 ($0.017) |
| A11 | skipped | skipped |
| A12 | pass 4/4 ($0.040) | fail 2/4 ($0.048) |
| A13 | pass 3/3 ($0.007) | pass 3/3 ($0.009) |
| A14 | fail 3/5 ($0.011) | fail 3/5 ($0.009) |
| A15 | pass 3/3 ($0.051) | pass 3/3 ($0.078) |
| B1 | error 5/6 ($0.232) | fail 1/6 ($0.100) |
| B2 | pass 4/4 ($0.040) | fail 3/4 ($0.016) |
| B3 | pass 3/3 ($0.007) | fail 1/3 ($0.013) |
| B4 | fail 5/6 ($0.031) | fail 2/6 ($0.070) |
| B5 | fail 4/5 ($0.010) | fail 1/5 ($0.009) |
| B6 | fail 2/4 ($0.012) | fail 3/4 ($0.007) |
| B7 | error 6/13 ($0.879) | fail 3/13 ($1.197) |

**Passed (A1–B7, 21 runnable cases): Brot 11, guhbot 6.**

Brot's failures from this run, to fix:

- A1: repro check.
- A6, A8 and A14: approvals and fake API sends.
- A9: a missed policy exception.
- B1 and B7: long team chains timed out at 10 min.
- B4: two chains.
- B5: the delegated send.
- B6: the workspace isolation check.

Note: these results predate commit cfcabab (reads no longer ask for approval) and the fixes in 7fe5542; re-run before comparing.

Decision: continue Brot. Retire guhbot.
