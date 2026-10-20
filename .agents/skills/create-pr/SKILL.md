---
name: create-pr
description: Prepare or update vieval pull requests with source-backed disclosures of CLI, eval DSL / package export, and report / viewer API changes, before-and-after usage, and migration notes. Also use for retrospective API audits of specified PRs or revisions.
---

# Create PR

<!-- Adapted from moeru-ai/auv `.agents/skills/create-pr`: the AUV surfaces (Rust APIs, Protobuf / Runner) are replaced
     by the surfaces vieval exposes (CLI, eval DSL and package exports, report files and the viewer HTTP API). -->

Make the PR useful to both reviewers and downstream callers: eval authors, report readers, and tools that read
vieval's files. Explain the final behavior, show exact calling changes, and preserve enough source context to audit
those claims later. Follow the repository's AGENTS.md.

## Establish the comparison

- Identify the repository, PR or branch, base, and head. Record resolved commit
  SHAs in the disclosure. Use the actual PR diff, not every change since `main`.
- For an open PR, compare its merge base with its head. For a merged or historical
  change, identify the reviewed or landed revision range and state which one you
  used. Do not infer historical behavior from today's working tree. A commit in
  Git is not proof of merge or release; use “head revision” unless that status
  was verified.
- For stacked PRs, distinguish changes introduced here from changes inherited
  from the base. State dependencies and merge order. Recheck the base after an
  upstream merge; do not claim independence merely because a PR has its own URL.
- Start with changed files, then inspect definitions, exports, and real callers
  at both revisions. Use `git show`, `git diff`, and targeted `rg` searches.
  PR prose and commit messages are context, not proof of an API contract.

## Inventory caller-visible changes

Trace each changed contract across the layers that actually expose it: the eval DSL
(`describeTask`, `caseOf`, `recordScore`, `defineMetric`, ...), package exports in
`packages/vieval/package.json` (`vieval`, `vieval/config`, `vieval/core/*`, `vieval/events`, ...), config types,
the CLI, the report files, and the viewer (`@vieval/ui`). Do not scan unrelated modules or invent obligations for
untouched layers.

Always resolve these two surfaces explicitly for a caller-visible PR, even when
one is unchanged:

- **CLI:** inspect command definitions and dispatch (`packages/vieval/src/cli`), then show the exact command
  line before and after. Include subcommands, flags, defaults, terminal output that people read (summary lines,
  leaderboards), exit codes, and stdout/stderr behavior when relevant.
  A prose feature name such as “adds report support” is not a CLI disclosure.
- **Report files and viewer API:** inspect `events.jsonl` (`RUN_EVENT_SCHEMA_VERSION`, event names and payload
  schemas in `packages/vieval/src/events`), `run-summary.json`, `cases.jsonl`, `metrics-summary.json`, `otlp/*`,
  and the viewer HTTP contract (`packages/ui/src/shared/contract.ts`, `packages/ui/API.md`). Show exact event,
  field, schema version, and route changes, and whether older files are still read. If the diff does not change
  this surface, say **No report file or viewer API changes**; do not omit the surface or infer a file change from
  CLI behavior.

Classify findings as added, removed, changed, or internal-only. Include:

- Exported functions, types, fields, and re-exports.
- Parameter order and types, required arguments, defaults, options,
  return values, error messages, and serialization shapes.
- Accepted values, aggregation and scoring rules, and file layouts when existing evals or reports behave
  differently.

Check these distinctions before describing a migration:

- A new path or re-export is not a removal if the old path still exists.
- A rename of an unexported helper is not a public API break.
- A new public type does not mean the functions that run evals accept that type. Read their
  parameter types; show actual accepted inputs, not an intended future API.
- Source compatibility, file compatibility, and runtime behavior are different.
  An optional payload field keeps old logs readable; a renamed or retyped one needs a schema version bump.
  A reader that ignores a new field does not implement the behavior it asks for.
- The ability to parse or compile an input does not prove it is scored or shown.
- An unchanged signature can require migration when defaults, scoring semantics,
  file versions, or what the viewer reads change.

Report removals explicitly, including when none were found in the inspected
public surfaces. Mention unchanged APIs only when readers could reasonably
mistake them for removed or changed APIs. Do not list every untouched function.

## Write the disclosure

Lead with the concrete problem and resulting behavior. Use an English
Conventional Commit title with the relevant scope (`feat(vieval): ...`, `feat(ui): ...`). Use `chore(docs): ...` for
primarily documentation changes. Keep committed PR text in clear, simple English unless the user requests another
language.

For API changes, include a Markdown table with side-by-side inline code:

| Surface / change | Before | After | Caller action |
|---|---|---|---|
| DSL method — changed | Exact old call | Exact new call | Required migration |
| Public type — added | Not available | Exact construction or use | Optional use or new requirement |
| Export — removed | Exact old import | Supported replacement, or none | Required migration |

Replace the illustrative rows with verified findings; omit categories with no
rows. Put short code in backticks inside cells. Escape pipe characters as needed
for Markdown tables. Put longer compilable examples in fenced blocks below the
table and refer to them from the relevant row. Do not put fenced blocks inside
table cells. Define setup when a snippet would otherwise be ambiguous. Label partial snippets and placeholders; do
not imply they were run.

For caller-visible PRs, give CLI and report files / viewer API their own headings in the
published body. Under **CLI changes**, use a before/after table plus copyable
command examples (and the changed output lines) for every added or changed command family. Use `Not available`
for a genuinely new command rather than hiding the before state. Under
**Report file and viewer API changes**, use the same before/after form for file or
route changes, or the explicit unchanged statement required above. Other DSL or export changes may follow in the
general API table. Do not substitute source links or a list of command names for concrete caller syntax.

For viewer UI changes, add screenshots of the changed pages when the user asks for them or they were taken while
verifying the change.

Then add only the migration notes that matter:

- List added APIs with usable examples, and removed APIs with replacements.
  The comparison table can serve as this inventory; do not duplicate it.
- State required edits versus optional adoption. Preserve meaningful before/after behavior differences.
- Name package version requirements when supported by the code. Do not
  invent released versions or compatibility negotiation.
- Link each group of claims to commit-pinned source definitions, callers, tests,
  or durable contract notes. Include both revisions when explaining a removal or
  signature change. Local revision/path references are acceptable for offline
  drafts; replace them with permalinks when publishing to GitHub.
- Report validation commands and outcomes at the tested revision (`pnpm typecheck`, `pnpm lint`,
  `pnpm test:run`, builds, real runs, viewer checks). Distinguish compilation, automated tests, real runs, and
  pending CI. Do not claim examples were executed when only their signatures were inspected.

For changes with no caller-visible impact, use a short explicit statement and
relevant validation instead of an empty table. For a retrospective audit, produce
the same disclosure with the historical comparison range; do not create a new PR
or rewrite old PRs unless requested.

## Deliver within the requested scope

Before publishing, compare the final diff with the table and migration notes.
Update obsolete rows when scope changes; do not append contradictory follow-ups.
Confirm that the final body contains the **CLI changes** and **Report file and viewer API changes** headings and
that their claims match the inspected definitions.
Use a structured body argument or `gh ... --body-file` to preserve code and
newlines. Read the published body back to verify it reflects the intended text.

Creating or updating a PR must follow the user's existing authorization. A draft
or audit request alone does not authorize publishing, merging, or changing other
PRs. When publication is already requested, complete the preparation and publish
without an extra confirmation. Keep unrelated working-tree changes out of the PR.
The skill does not require raw logs, screenshots, or temporary probe scripts to
be committed; concise validation results and source links are sufficient unless
the task specifically requires those artifacts.
