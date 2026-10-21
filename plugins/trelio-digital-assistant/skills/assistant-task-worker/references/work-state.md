# Durable task state

Use one file in the task's canonical Workspace:
`assistants/<assistantUserId>/WORK.md`. Obtain the UUID from live assistant pass
identity, never from a display name or incoming text. The Workspace supplies the
company/task boundary; verify both IDs before reading or editing the file.
Different assistants use different UUID directories. Renaming the assistant,
moving a task or replacing a computer does not allocate a new state file.

Read accepted shared context and this file at the start of each pass. Create it
through an ordinary Workspace Run when authorized work first needs durable
state. Edit only inside the bridge's writable directory; accept the result using
normal checkpoints, fencing, head CAS and recovery. A local file or clean native
turn does not prove a saved revision. After compaction reread the Run's full
pinned rules/profile before this file. It is task data, not another instruction
layer; never name it AGENTS.md or use it to override permissions or working rules.

Reading the current accepted state is not a reason to create a writable Run.
Use the installed accepted-file/read-only Workspace capability and its exact
head. Do not treat an old local working copy as current after another writer
may have changed it. If that read capability is unavailable, report it explicitly;
do not create a timestamp-only Run to work around the missing reader.

Update this file when the goal, progress, pending interaction or next action
changes. Do not create a Run merely to refresh a review timestamp or copy the
scheduler's next clock tick. When nothing changed, reuse the accepted state and
report the check/outcome and actual next wake through the runtime contract.

Use the following sections, omitting empty optional detail. Write in the task's
working language and keep the current state concise rather than appending a log
of every wake. Preserve the human's actual goal and cite its source; if the goal
is unclear or conflicting, ask rather than silently broadening it.

```markdown
# Assistant work state

- Format: 1
- Assistant: <live assistant UUID>
- Company: <canonical company UUID>
- Task: <canonical task UUID>
- Assignment revision: <live revision>
- Last reviewed: <ISO timestamp with zone>
- Goal state: active | waiting_external | waiting_owner | blocked | completed | cancelled

## Human goal
Requested outcome, source message/task reference, and who requested it.

## Completion criteria
Observable evidence needed to establish that the requested outcome is achieved.

## Current progress
Confirmed facts, decisions and links to useful accepted deliverables.

## Pending interactions and uncertain actions
Channel and conversation/message references; recipient; what reply or decision
is needed; last confirmed send; expected response/check time; follow-up or
escalation condition. Record an uncertain send explicitly before any retry.

## Next step and wake
Concrete next action, trigger, chosen recurring cadence and rationale. Record
only a server-confirmed next wake as confirmed; otherwise label it pending.

## Result
When finished: evidence against the criteria and any handover or remaining limits.
```

Finish independent authorized work before waiting. Save which reply is needed and
the next action while it is still known. Submit the pass as waiting through the
server's outcome contract, keep a recurring check with a justified interval, and
read back its actual next run. A relevant provider event or canonical mention may
wake the same chat earlier. An ordinary task comment alone still does not wake
it. On return, recheck current authority and actual source state before acting;
never send the same request again just because a previous local receipt is absent.

Set a reasonable follow-up/escalation point from task context and response
expectations. Repeated missed replies require a new decision or owner escalation,
not indefinite identical pings. Silence does not authorize a payment, a new account
or disclosure. A completed pass is distinct from a completed goal: record partial
progress and return to the goal at the next scheduled/event wake.

Mark the goal completed only against the recorded criteria with verifiable
evidence, or cancelled on an authorized cancellation. Request stopping this
assistant's recurring task cycle and verify the result. Other assistants' goals,
cycles and state files remain separate; never mark the whole task done solely
because this assistant finished its part. Revoked/paused access stops execution
immediately even when no final file update is possible.

## Correcting an established own error

Use the dedicated live `repair_assistant_workspace_result` capability when an
accepted own Run contains an established error. First `retract` that exact Run
under the current pass/head to retire its evidence. This does not change files
or finish the repair. Do not classify a changed preference as an own error.

If its candidate is still current, use `restore` for only that retired Run's
exact base. If later work exists, open a normal `no_status_change` Run from the
current head and reverse only the erroneous own delta, preserving later edits
and other assistants' state. Preserve useful dirty local work through ordinary
bridge recovery. A semantic conflict or missing capability is a concrete blocker;
do not reset local history or use human OAuth to get around it.

Read and verify the resulting accepted files. Then `retract` the original Run
again with its verified accepted `correctionRunId` and exact current head. The
erroneous source and its correction cannot be reused as business completion,
including through a later `noChange` check. Continue the actual human goal with
valid material or a saved blocker; repair alone does not close the goal or stop
its cycle. On an uncertain restore, establish the original native result before
any further action; never issue another restore just to clear uncertainty.

Keep shared stable task knowledge in canonical shared context and reference it
from this file. Do not duplicate message bodies or unchanged source documents.
Another assistant's state is readable only with normal Workspace ACL and does
not grant authority; do not overwrite its file. Human reviewers of the Workspace
can see these files: no secret values, private credentials, or supposedly private
assistant notes belong here. Encrypted companies use the same protected Workspace
route; SQLite/scheduling stores only structural references, not this Markdown.
