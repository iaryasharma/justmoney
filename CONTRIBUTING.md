# Contributing to JustMoney

Thank you for wanting to help. JustMoney handles people's money, so the rules below are strict about privacy and about keeping the app small.

## Before you start

- **Look for an existing issue or discussion first.** For a larger change, open an issue and describe the problem before you write code. This saves you from building something that will not be merged.
- **Keep a pull request to one change.** Small, focused pull requests are reviewed faster.
- **Security problems are not issues.** Report them as described in [SECURITY.md](SECURITY.md).

## Principles every change must keep

1. **Private by construction.** There is no server, no account, no cloud sync and no analytics. A feature that needs a server needs a discussion first.
2. **Never store or log message text unencrypted.** Bank and payment messages are personal. Do not write them to logs, to fixtures or to the console.
3. **No personal data in the repository.** Tests and fixtures use invented names, invented UPI IDs and invented account numbers. Real receipts must be sanitised first.
4. **No new dependencies without a discussion.** The app is deliberately small. Explain why the new package is needed and what its licence is.
5. **Money must add up.** Totals are computed from records and must use the shared helpers (for example `isPersonalSpend` and `isTransferCategory`), not local copies.

## Setting up

See the **Build from source** section of the [README](README.md). Node.js 22 or newer is needed for the web checks. JDK 21 and the Android SDK are needed for the Android build.

## Checks before you open a pull request

Run these from the project root. All of them run in continuous integration, and a pull request needs them to pass.

```bash
npx tsc -b        # type check
npm test          # unit tests
npm run lint      # oxlint (warnings are allowed, errors are not)
npm run build     # production web build
```

If you change anything in `android/`, also run `npx cap sync android` and `./gradlew assembleDebug`.

For a change that touches the screen, please test it on a phone or on a 390 × 844 browser viewport, in light and dark mode if the app supports it.

## Code conventions

- **TypeScript and React** function components. Keep the logic in `src/lib` free of React, so it can be tested.
- **Plain CSS** in `src/index.css`, with the variables that already exist. Do not add a UI library.
- **Names:** `camelCase` for functions and variables, `PascalCase` for components and types. Use the existing words for things (for example "payee", "split", "plan"), so the app stays consistent.
- **Comments** explain *why* something is done in a particular way. Do not describe what the code plainly does.
- **Hooks** must be called before any early return.
- **Strings in single quotes** must not contain a plain apostrophe. Use `’` or double quotes.
- **Java** code in `android/app/src/main/java/app/justmoney` follows the existing style of the surrounding file.

## Commit messages and pull requests

- Write the first line in the imperative and keep it under about 70 characters, for example `Fix the split share total when a friend pays nothing`.
- Explain in the body what changed and why, when that is not obvious from the diff.
- In the pull request, say what you tested and how. Link the issue it closes.

## Licence of your contribution

By submitting a contribution you agree that it is licensed under the same licence as the project (see [LICENSE](LICENSE)). Only submit code you wrote, or code whose licence allows this use. Tell us where it came from if it was copied.

## Conduct

Be respectful and constructive. Assume good faith, and keep discussion focused on the work. The project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/), version 2.1.

Maintainers may close or lock issues and pull requests that do not follow these rules.
