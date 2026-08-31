Retro: Added Inline Documentation and TODO Annotations to BigQuery Package

Overview
Brief summary of what happened:
Comprehensive inline comments, descriptive block annotations, and forward-looking TODO comments were added across core components of the `@google-cloud/bigquery` handwritten package (including `bigquery.ts`, `dataset.ts`, `table.ts`, `logger.ts`, `rowBatch.ts`, `rowQueue.ts`, and `util.ts`).

The impact of the event was:
Enhanced developer readability and clarity around internal batching logic, schema merging, request interception, and query job parameter handling in the BigQuery library.

The root cause(s) of the event was:
Resolution of Node Issue #1 requesting comments and TODO annotations in BigQuery codebase.

Details
Timeline:
- Inspected existing codebase structure and identified key BigQuery modules.
- Created and switched to work branch `issue-1-fix`.
- Added targeted inline documentation, explanation comments, and TODO reminders for future performance investigations and feature validations.
- Verified TypeScript syntax across all modified files using Node experimental type checking.
- Prepared retro document and committed changes.

What went well?
- Fast identification of handwritten BigQuery modules and targeted edits.
- TypeScript syntax verification passed smoothly on all modified files without monorepo build overhead.

What didn't go well?
- Initial branch creation collision resolved by switching to the branch.

Where did we get lucky?
- Direct Node native type parsing enabled instantaneous syntax validation without heavy dependency installations.

Follow-ups and Action Items:
- [ ] Monitor CI and branch builds on remote.
