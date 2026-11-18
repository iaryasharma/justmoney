# Third-party notices

JustMoney is built on the open-source packages below. Their licences apply to the code they provide. The list is taken from the packages' own licence fields at the time of writing; the full licence text for each is in the package it came with.

## Runtime libraries

| Package | Licence | Used for |
|---|---|---|
| `react`, `react-dom` | MIT | the user interface |
| `@capacitor/core`, `@capacitor/android`, `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/local-notifications`, `@capacitor/share` | MIT | the Android shell and native plugins |
| `jspdf`, `jspdf-autotable` | MIT | PDF reports |
| `pdfjs-dist` | Apache-2.0 | reading PDF statements and receipts |
| `qrcode` | MIT | UPI QR codes |
| `@fontsource/hind`, `@fontsource/kalam` | SIL Open Font License 1.1 | the Hind and Kalam typefaces |

## Build and test tools (not shipped in the app)

`@capacitor/cli`, `@types/node`, `@types/qrcode`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `vite`, `vitest`, `oxlint` (MIT); `typescript` (Apache-2.0).

## Android components

The Android build also uses Google's AndroidX libraries (Apache-2.0) and the on-device text recognition models from Google ML Kit (`com.google.mlkit`), which are governed by Google's own terms of use.

## Bundled files to confirm before publishing

These files ship inside the app, but their origin and licence are not recorded in this repository. Confirm them before the repository is made public:

- **`public/fonts/NotoSans-Regular.ttf`, `public/fonts/NotoSans-Bold.ttf`**: Noto Sans is normally released under the SIL Open Font License 1.1. Add its licence text if it is included.
- **`public/sounds/*.wav`** (`bell`, `chime`, `pop`, `soft`): the source and licence of these sounds are not recorded.
- **`public/brands/*.webp`** (about 130 company and service logos): trademarks and logos belong to their owners. Their use in an app needs a decision on whether they stay in the public repository.
- **`public/icons/*.png`** (about 115 alternative app icons): several are based on characters and artwork from films, games and television shows. Their use needs a decision before publication.
- **Launcher and widget artwork in `android/`**: confirm that the artwork is original.
