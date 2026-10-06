---
name: passci
description: >-
  Opt-in workflow triggered when the developer includes /passci in the prompt.
  Produces the requested code change, immediately opens a draft pull request so
  the developer can view the suggested changes, and then pushes follow-up
  commits prefixed with [Style Maintenance], [Independent review follow-ups]
  (after triggering "/gemini review" in the PR up to 3 times or until no
  high-priority issues come up), and [Address CI errors] so all CI checks pass
  and unit tests pass with 95% confidence even when skipped by CI. Use only when
  the prompt includes /passci.
---

# Opt-In Pass CI & 95% Unit Test Confidence Workflow (`/passci`)

This skill is **opt-in** and activates whenever a developer includes `/passci`
in their prompt when asking Jetski to make a code change and open a pull request
in `googleapis/google-cloud-node`.

## Overview of the `/passci` Workflow

When `/passci` is included in the prompt, future pull requests created with
Jetski follow this exact sequence:

1.  **Produce a code change that does what the user asked** on a dedicated
    feature/fix branch and commit the initial solution.
2.  **Produce a draft PR so that the developer can see the suggested changes**
    immediately after the problem is solved, *before* the additional changes for
    style, extra reviews, and addressing CI errors are done.
3.  **While the developer looks at the draft PR, keep adding commits** to the
    branch as separate, clearly prefixed commits (per
    [`CONTRIBUTING.md` — Addressing code review comments](../../../CONTRIBUTING.md#addressing-code-review-comments)):
    *   **Add commits prefixed with `[Style Maintenance]`**: Before doing
        independent review follow-ups, complete a step where we apply the
        principle: *"Referencing existing contributing guidelines and coding
        style documentation helps agents maintain code base quality."* Ensure
        the codebase quality of the changes is maintained and the style
        pertaining to the codebase is maintained by referencing the repository's
        existing contributing guidelines and coding style documentation.
    *   **Add commits prefixed with `[Independent review follow-ups]`**: Before
        doing the CI checks, have Gemini independently review the code changes
        by typing `"/gemini review"` in the PR twice and address the review
        comments that come up with commits prefixed with
        `[Independent review follow-ups]`. Do this **three times or until no
        high priority issues come up, whatever comes first**.
    *   **Add commits prefixed with `[Address CI errors]`**: Verify that all CI
        checks pass **and** unit tests pass with **95% confidence** even if they
        are not running in the continuous integration pipeline. If there are CI
        or unit test failures after completing the original task, add additional
        commits prefixed with `[Address CI errors]` until all checks pass.

Stage | Timing | Action | Required Commit Prefix
:--- | :--- | :--- | :---
**1. Solve the Task** | First | Produce a code change that does what the user asked | `<type>(<package>): <description>`
**2. Open Draft PR** | Immediately after Stage 1 (before style, reviews, and CI fixes) | Open a draft PR (`gh pr create --draft`) so the developer can view the suggested changes right away | *(Draft PR opened from initial commit)*
**3. Style Maintenance** | While developer views draft PR, before independent reviews | *"Referencing existing contributing guidelines and coding style documentation helps agents maintain code base quality."* Audit against [`CONTRIBUTING.md`](../../../CONTRIBUTING.md), [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), [`gts`](https://github.com/google/gts), [`.eslintrc.json`](../../../.eslintrc.json), [`.prettierrc.cjs`](../../../.prettierrc.cjs), and [`bin/linter.mjs`](../../../bin/linter.mjs) | `[Style Maintenance]`
**4. Independent Gemini Reviews** | After `[Style Maintenance]`, before CI checks | Type `"/gemini review"` in the PR twice and address review comments; repeat **three times or until no high priority issues come up, whatever comes first** | `[Independent review follow-ups]`
**5. 95% Unit Tests & Pass CI** | After independent reviews | Verify unit tests pass with 95% confidence (even if skipped in CI) and fix any CI failures | `[Address CI errors]`

--------------------------------------------------------------------------------

## Helper Script (`scripts/passci.py`)

Use the bundled helper script [scripts/passci.py](scripts/passci.py) to audit
contributing guidelines and style rules, inspect `/gemini review` rounds and
high-priority issue counts on the PR, identify CI unit test blind spots, compute
the 95% confidence unit test plan, and verify commit prefix ordering:

```bash
# 1. Audit changed files, CI blind spots, and CONTRIBUTING.md style compliance:
python3 .agents/skills/passci/scripts/passci.py \
  --repo-root . \
  --base-ref upstream/main \
  --mode audit

# 2. Check "/gemini review" rounds and high-priority issue status on the PR:
python3 .agents/skills/passci/scripts/passci.py \
  --repo-root . \
  --mode check-reviews \
  --pr <PR_NUMBER>

# 3. Generate the 95% confidence unit test & CI verification plan:
python3 .agents/skills/passci/scripts/passci.py \
  --repo-root . \
  --base-ref upstream/main \
  --mode verify-ci \
  --confidence 0.95

# 4. Validate commit history prefixes ([Style Maintenance], [Independent review follow-ups], [Address CI errors]):
python3 .agents/skills/passci/scripts/passci.py \
  --repo-root . \
  --base-ref upstream/main \
  --mode verify-commits
```

--------------------------------------------------------------------------------

## Detailed Stage-by-Stage Instructions

### Stage 1: Produce a Code Change That Does What the User Asked

1.  **Create a dedicated branch** from `upstream/main` (or `origin/main`), never
    committing directly to `main`:

    ```bash
    git checkout -b <type>/<short-topic> upstream/main
    ```
2.  **Implement the requested code change** and corresponding unit tests as
    required by
    [`CONTRIBUTING.md` — Sending a pull request](../../../CONTRIBUTING.md#sending-a-pull-request).
3.  **Commit the initial implementation** following the
    [`CONTRIBUTING.md` — Commit messages](../../../CONTRIBUTING.md#commit-messages)
    format (`<type>(<package>): <description>`, lowercase verb after colon, no
    trailing period, under 76 characters):

    ```bash
    git add -A
    git commit -m "<type>(<package>): <concise summary of user request>"
    ```

### Stage 2: Open a Draft Pull Request Immediately

Right after solving the user's task in Stage 1 — **before** performing style
maintenance, extra reviews, or CI error fixes — open a draft pull request so the
developer can inspect the suggested changes while follow-up commits are added:

1.  **Push the initial branch to the remote**:

    ```bash
    git push -u origin <branch_name>
    ```
2.  **Create the draft pull request** following
    `.agents/skills/create-pr/SKILL.md` and
    [`CONTRIBUTING.md`](../../../CONTRIBUTING.md):

    ```bash
    gh pr create --draft \
      --repo googleapis/google-cloud-node \
      --base main \
      --head <fork_owner>:<branch_name> \
      --title "<type>(<package>): <description>" \
      --body "<structured PR body per .agents/skills/create-pr/SKILL.md>"
    ```
3.  **Share the draft PR in Jetski and continue immediately**:
    *   Surface the draft PR link (and create a `.url.json` artifact with
        `UserFacing: true`) so the developer can view the initial solution right
        away.
    *   Immediately continue to Stage 3, Stage 4, and Stage 5, pushing each
        additional commit to the same draft PR branch.

### Stage 3: Style Maintenance & Contributing Guidelines (`[Style Maintenance]`)

> *"Referencing existing contributing guidelines and coding style documentation
> helps agents maintain code base quality."*

Before doing independent review follow-ups, audit the code changes against the
repository's existing contributing guidelines and coding style documentation to
ensure codebase quality and style consistency are maintained:

#### Authoritative Contributing & Coding Style References

Reference and enforce each of the following documents when auditing the branch:

1.  **Repository Contributing Guidelines ([`CONTRIBUTING.md`](../../../CONTRIBUTING.md))**:
    *   [**Sending a pull request**](../../../CONTRIBUTING.md#sending-a-pull-request):
        Every new source file must include the Apache-2.0 Google LLC copyright
        header, and logic changes must include unit tests.
    *   [**Leaving a TODO**](../../../CONTRIBUTING.md#leaving-a-todo): Every
        `TODO` comment must link to a tracked GitHub issue in the exact format:
        `// TODO(https://github.com/googleapis/google-cloud-node/issues/<number>): explain what needs to be done`
    *   [**Commit messages & Issue references**](../../../CONTRIBUTING.md#commit-messages):
        Follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/#summary)
        (`<type>(<package>): <description>`), keep the summary line under ~76
        characters with a lowercase verb after the colon and no trailing period,
        use plain text in commit bodies, and reference issues using `Fixes #123`
        or `For #123` (never `Closes` or `Resolves`).
    *   [**Addressing code review comments**](../../../CONTRIBUTING.md#addressing-code-review-comments):
        Add follow-up commits rather than amending and force-pushing so
        reviewers can inspect incremental changes at each stage.
    *   [**Handling Dependency Updates**](../../../CONTRIBUTING.md#handling-dependency-updates):
        Only modify dependencies for security vulnerabilities, bug fixes, or
        feature support linked to an issue in the repository.
    *   [**Package-level Contributing Guidelines**](../../../core/packages/gax/CONTRIBUTING.md#contributing-a-patch):
        *"Ensure that your code adheres to the existing style in the code to
        which you are contributing."*
2.  **Google TypeScript & JavaScript Coding Style Documentation**:
    *   [**Google TypeScript Style Guide**](https://google.github.io/styleguide/tsguide.html)
        and
        [**Google JavaScript Style Guide**](https://google.github.io/styleguide/jsguide.html):
        Enforce `const`/`let` (never `var`), strict equality (`===`/`!==`),
        explicit types over `any` where practical, `UpperCamelCase` for
        classes/interfaces/types, `lowerCamelCase` for methods/variables, and
        clear JSDoc annotations.
    *   [**Google TypeScript Style (`gts`)**](https://github.com/google/gts):
        The automated style guide, linter, and formatter configured across this
        monorepo.
3.  **Repository Linter & Formatter Configurations**:
    *   [**`.eslintrc.json`**](../../../.eslintrc.json): Extends
        `./node_modules/gts` and enforces `import/no-extraneous-dependencies`,
        `promise/always-return`, `promise/catch-or-return`,
        `promise/no-callback-in-promise`, `promise/no-nesting`,
        `n/no-extraneous-require`, and `@typescript-eslint/no-empty-interface`
        (plus package-specific overrides for `handwritten/firestore` and
        `packages/**/*.ts`).
    *   [**`.prettierrc.cjs`**](../../../.prettierrc.cjs): Inherits
        `gts/.prettierrc.json` formatting rules (single quotes, no bracket
        spacing).
    *   [**`bin/linter.mjs`**](../../../bin/linter.mjs): Runs isolated ESLint
        worker threads and `tsc --noEmit` across every modified package.

#### Running Style Maintenance & Committing with `[Style Maintenance]`

1.  Run the style audit, package auto-fixer, and strict monorepo linter:

    ```bash
    # Audit against CONTRIBUTING.md rules (Apache headers, TODO links, commit conventions):
    python3 .agents/skills/passci/scripts/passci.py \
      --repo-root . --base-ref upstream/main --mode audit

    # Run gts/Prettier/ESLint autofix in each touched package directory:
    pnpm --dir <package_dir> run fix

    # Run the monorepo strict linter and TypeScript compiler check:
    GIT_DIFF_ARG="upstream/main...HEAD -- :!packages" node ./bin/linter.mjs --strict
    ```
2.  Commit any style, formatting, comment, or contributing-guideline updates
    with a commit message prefixed with `[Style Maintenance]` and push to the
    draft PR:

    ```bash
    git add -A
    git commit -m "[Style Maintenance] align changes with CONTRIBUTING.md and gts coding style guidelines"
    git push
    ```

### Stage 4: Independent Gemini Code Reviews via `"/gemini review"` (`[Independent review follow-ups]`)

Before running the CI checks, have Gemini independently review the code changes
by typing `"/gemini review"` in the PR twice and addressing the review comments
that come up with commits prefixed with `[Independent review follow-ups]`. Do
this **three times or until no high priority issues come up, whatever comes
first**:

1.  **Request Independent Gemini Review on the Draft PR**:
    *   Post `"/gemini review"` as a comment on the open draft pull request so
        `gemini-code-assist[bot]` independently reviews the code changes with no
        prior session context:

        ```bash
        gh pr comment <pr_number> \
          --repo googleapis/google-cloud-node \
          --body "/gemini review"
        ```
2.  **Retrieve and Inspect the Review Comments**:
    *   Wait for Gemini Code Assist to post its review and inline comments on
        the PR, then inspect all findings:

        ```bash
        gh api repos/googleapis/google-cloud-node/pulls/<pr_number>/reviews
        gh api repos/googleapis/google-cloud-node/pulls/<pr_number>/comments
        python3 .agents/skills/passci/scripts/passci.py \
          --repo-root . --mode check-reviews --pr <pr_number>
        ```
    *   *(If `gemini-code-assist[bot]` does not respond on a personal fork
        within the polling window, also run an independent, context-isolated
        Gemini review subagent via `invoke_subagent` with only the raw PR diff
        and `CONTRIBUTING.md` so independent review comments are still generated
        and addressed).*
3.  **Address Review Comments with `[Independent review follow-ups]` Commits**:
    *   Fix the issues raised in the review comments, commit the changes with a
        commit message starting with `[Independent review follow-ups]`, and push
        to the draft PR:

        ```bash
        git add -A
        git commit -m "[Independent review follow-ups] address /gemini review comments (round <r>)"
        git push
        ```
4.  **Repeat Up to Three Times or Until No High-Priority Issues Come Up**:
    *   Check whether any high-priority issues (`![high]`, `![critical]`,
        `High`, `Critical`, `P0`, `P1`, bugs, race conditions, or broken types)
        were raised in the round.
    *   Stop after **3 rounds** OR as soon as a review round produces **no high
        priority issues**, **whichever comes first**.

### Stage 5: 95% Confidence Unit Test Verification & Addressing CI Errors (`[Address CI errors]`)

#### Why Unit Tests Are Skipped in the `google-cloud-node` CI Pipeline

Inspecting [`ci/run_conditional_tests.sh`](../../../ci/run_conditional_tests.sh)
and `.github/workflows/` shows five cases where unit tests do **not** run in the
CI pipeline:

CI Blind Spot | Root Cause in [`ci/run_conditional_tests.sh`](../../../ci/run_conditional_tests.sh) | Required Local Verification
:--- | :--- | :---
**`core/packages/*` & `core/dev-packages/*` on Node.js** | `presubmit.yaml` does not set `IS_CORE=true`; `ci/run_conditional_tests.sh` logs `skipping core package ... in non-core trigger` and skips all Node.js 22/24/26 unit tests. | Run `pnpm --dir <pkg_dir> run compile && pnpm --dir <pkg_dir> test` directly on Node.js.
**`core/packages/tools` & `gapic-node-processing` on Bun** | `ci/run_conditional_tests.sh` explicitly skips these internal CLI tools when `JS_RUNTIME=bun`. | Run `pnpm --dir <pkg_dir> test` on Node.js and verify CLI invocations directly.
**Windows Exemption List** | `windows_exempt_tests` skips `core/`, `core/packages/`, `core/dev-packages/`, `.github/scripts/`, and `handwritten/cloud-profiler/`. | Run unit tests locally and verify cross-platform path handling (`path.sep`, `path.posix`).
**Root Tooling (`bin/*`) & Shared Core Libraries** | `ci/run_conditional_tests.sh` only checks `git diff` on `ci/` or per-package directories; edits to `bin/run-test.cjs`, `bin/proxyquire-bun-shim.cjs`, `bin/linter.mjs`, or `core/packages/*` do not trigger downstream package tests in CI. | Run stratified sample of downstream packages ($n = 59$) for $\ge 95\%$ confidence.
**`ignore.json` Packages** | Any directory listed in `ignore.json` is skipped by `ci/run_conditional_tests.sh`. | Run `pnpm --dir <pkg_dir> test` directly.

#### Verifying Unit Tests at $\ge 95\%$ Confidence & Passing All CI Checks

1.  **Direct Multi-Runtime Unit Test Execution on All Touched Packages**:
    *   For every modified package directory (even when skipped by
        `ci/run_conditional_tests.sh`), compile and run its unit tests under both
        **Node.js** and **Bun**:

        ```bash
        pnpm --dir <pkg_dir> run compile
        pnpm --dir <pkg_dir> test
        JS_RUNTIME=bun MOCHA_PARALLEL=false bun --bun run --cwd <pkg_dir> test
        ```
2.  **Statistical $\ge 95\%$ Unit Test Confidence**:
    *   Re-run modified unit test suites ($n = \lceil \ln(1 - 0.95) / \ln(0.5)
        \rceil = 5$ runs across Node.js and Bun) with zero failures.
    *   When shared infrastructure (`bin/*`, `ci/*`, `core/packages/gax`,
        `google-auth-library-nodejs`, `gaxios`, `gcp-metadata`, `teeny-request`)
        is modified, by the statistical Rule of Three ($n = \lceil \ln(1 - 0.95)
        / \ln(0.95) \rceil = 59$), run unit tests across a stratified sample of
        $n = 59$ downstream packages with **0 failures** to establish with
        **95% confidence** that at least 95% of monorepo packages pass.
3.  **Run Local CI Checks & Monitor GitHub Actions Workflow Runs**:
    *   Execute the local CI suite:

        ```bash
        pnpm install --frozen-lockfile --ignore-scripts
        pnpm run compile
        GIT_DIFF_ARG="upstream/main...HEAD -- :!packages" node ./bin/linter.mjs --strict
        RUN_TESTS_MODE=RUN_UNIT_TESTS BUILD_TYPE=presubmit TEST_TYPE=units \
          SHARD_TOTAL=1 SHARD_INDEX=0 GIT_DIFF_ARG="upstream/main...HEAD" \
          bash ci/run_conditional_tests.sh --strict
        ```
    *   Monitor all GitHub Actions checks on the draft pull request:

        ```bash
        gh pr checks <pr_number> --repo googleapis/google-cloud-node
        ```
4.  **Commit Any CI Fixes with `[Address CI errors]`**:
    *   If any local or remote CI check fails after the original task was
        completed, fix the failure, commit with the prefix
        `[Address CI errors]`, and push to the draft PR:

        ```bash
        git add -A
        git commit -m "[Address CI errors] <description of CI or unit test fix>"
        git push
        ```
    *   Repeat until every CI check on the draft pull request passes and unit
        tests pass with $\ge 95\%$ confidence.

--------------------------------------------------------------------------------

## Verification Checklist Before Completing `/passci`

-   [ ] **1. Code Change Committed**: Initial commit solves the user's request
    and follows `<type>(<package>): <description>`.
-   [ ] **2. Draft PR Opened Right Away**: Draft PR (`gh pr create --draft`)
    opened immediately after solving the problem, *before* style, extra review,
    and CI fix commits.
-   [ ] **3. `[Style Maintenance]` Commit(s) Pushed**: Audited against
    [`CONTRIBUTING.md`](../../../CONTRIBUTING.md),
    [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html),
    [`gts`](https://github.com/google/gts),
    [`.eslintrc.json`](../../../.eslintrc.json),
    [`.prettierrc.cjs`](../../../.prettierrc.cjs), and
    [`bin/linter.mjs`](../../../bin/linter.mjs) (*"Referencing existing
    contributing guidelines and coding style documentation helps agents maintain
    code base quality."*), with commits prefixed with `[Style Maintenance]`.
-   [ ] **4. `[Independent review follow-ups]` Commit(s) Pushed**: Triggered
    `"/gemini review"` in the PR and addressed comments with commits prefixed
    with `[Independent review follow-ups]`, repeating up to **3 times or until
    no high priority issues come up, whatever comes first**.
-   [ ] **5. `[Address CI errors]` Commit(s) & 95% Unit Test Confidence**: Unit
    tests verified with $\ge 95\%$ confidence (even if skipped in CI), any CI
    failures resolved in commits prefixed with `[Address CI errors]`, and all
    draft PR CI checks pass.
