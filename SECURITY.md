# Security policy

## Supported versions

Security fixes are made for the latest release. Please update to the latest APK from the Releases page before you report a problem, and check that it still happens.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. If that option is not shown, the repository owner needs to enable *private vulnerability reporting* in the repository's settings.

Include, if you can:

- the version (from the app's Settings screen) and the Android version of your phone,
- the steps to reproduce the problem,
- what you expected to happen, and what happened instead,
- the impact you think it has.

We aim to acknowledge a report within a few days, to discuss the fix with you, and to credit you in the release notes if you wish.

## Scope

In scope:

- access to the data stored on the phone (the encrypted database, the App Lock and the Keystore key handling),
- backups and restores (encryption, passwords, tampering with a backup file),
- capture of bank messages and notifications (anything that reads, stores or leaks message text),
- payment links and UPI handling (for example a link that changes the payee or the amount),
- the native Android components (exported components, intents, widgets, permissions).

Out of scope:

- problems that need a rooted phone, or physical access to an unlocked phone, unless the app makes them worse,
- problems in third-party services (Google ML Kit, Google Gemini, Yahoo Finance, the rates service) that are not caused by JustMoney,
- findings produced only by an automated scanner, without a demonstrated impact.

## What the app does with your data

JustMoney has no server. Your transactions, accounts and messages stay on your phone. The only network requests are the live share prices and exchange rates, and the optional AI features when you turn them on with your own key. Details are in the repository documentation.
