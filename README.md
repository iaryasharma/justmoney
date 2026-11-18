# JustMoney

JustMoney is an Android money tracker. It reads payments from your bank and UPI
messages, notifications and receipts, so most expenses are added without typing.
It plans your month, splits bills with friends, and keeps everything on the phone.

- **No account, no server.** Your data lives on the device. Backups are files you control.
- **Capture:** bank SMS, UPI and payment notifications, receipt photos, pasted text, and voice or typed sentences ("450 swiggy dinner").
- **Plan:** a spending plan with saving first, for salaried, business, freelance and student profiles.
- **Split:** share bills in a group or privately, with a pay link that opens the friend's UPI app with the amount filled in.
- **Insights:** trends, net worth, recap cards, and PDF reports.

## Getting started

Requirements: Node.js 22 or newer. For Android, JDK 21 and the Android SDK.

```bash
npm install
npm run dev          # web version at http://localhost:5173
npm test             # unit tests
npm run lint         # oxlint
npm run build        # type-check and production build into dist/
```

## Building the Android app

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug        # on Windows: gradlew.bat assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/`.
`npx cap sync` copies `dist/` into the Android project, so run it after every web change.

## Project layout

```
src/
  App.tsx, main.tsx     start-up, navigation, the tab bar
  screens/              one file per screen (Home, Plan, Split, Planner, Settings …)
  components/           shared UI: sheets, cards, chips, the phone-style widgets
  lib/                  all logic, grouped by feature (no React in here):
    core/               storage, types, formatting, money basics, shared helpers
    accounts/           bank accounts, cards, cash, blocked money (IPO, mandates)
    capture/            reading payments: SMS, notifications, receipts, statements, AI questions
    payees/             who you paid: payees, contacts, shops, recurring detection
    plan/               spending plan, pots, savings, tax, profession rules, AutoPay
    split/              shared bills: groups, pay links, bill splitting
    invest/             investments, IPOs, prices and exchange rates
    backup/             backup, restore and file export
    notify/             notifications, alerts, the home-screen widget
    reports/            recap, year in money, monthly report
    fixtures/           sample OCR and statement data used by the tests
public/                 icons, fonts, brand logos and sounds
android/                the Capacitor Android project (native plugins in app/src/main/java)
docs/                   architecture, file walkthrough and the UX audit
```

Each test file sits next to the module it tests (`plan/plan.test.ts` tests `plan/plan.ts`).

## Documentation

- `docs/ARCHITECTURE.md`: how the pieces fit together and why.
- `docs/PROJECT_STRUCTURE.md`: where every folder lives and where to change what.
- `docs/WALKTHROUGH.md`: one line per source file.
- `docs/memories.md`: what the app does, the security model, and the decisions made along the way.
- `docs/AGENT_MEMORIES.md`: the handbook for working on the project.

## Privacy

Everything runs on the device. The app does not send your transactions anywhere.
Payment links (`#pa=…`) keep their details after the `#`, which browsers never send to a server.
Use Settings → Diagnostics to see the on-device error log.

## License

To be added.
