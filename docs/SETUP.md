# Setup guide: LearnHarness on your Mac and your iPhone

This guide is for one person with one Mac and one iPhone. The Mac runs the LearnHarness desktop app (the mobile fork). The iPhone app uses the Mac over your home network or over Tailscale.

Last check: 2026-11-15, on an Intel MacBook Pro (macOS 26) and an iPhone 13 Pro Max (iOS 26.5.2).

## What you need

- The fork in `~/Development/learnharness`, branch `mobile/phone-access`.
- The phone app in `~/Development/learnharness-mobile`.
- Xcode 26.4 or later, signed in with your Apple ID (Xcode > Settings > Accounts).
- A Tailscale account. You create it yourself.

## 1. Build the desktop app

1. Quit `npm run desktop:dev` if it runs.
2. Run the build in the fork:

   ```bash
   cd ~/Development/learnharness && npm run desktop:personal
   ```

3. The app is in `dist-personal/mac/LearnHarness.app` (on Apple silicon: `dist-personal/mac-arm64/`).

The build is not signed and not notarized. It does not update itself from the upstream project, because an upstream update removes Phone Access.

## 2. Install the desktop app

CAUTION: The first start of a new version can change your data files, and you cannot go back to the old version without a backup. Back up the data folder first.

1. Back up the data folder:

   ```bash
   cp -R ~/Library/Application\ Support/LearnHarness/data ~/Library/Application\ Support/LearnHarness/data-backup-$(date +%Y-%m-%d)
   ```

2. Quit LearnHarness (LearnHarness > Quit).
3. Copy the new app to `/Applications`. Replace the old app if Finder asks.
4. Open `/Applications/LearnHarness.app`. Your sessions show as before.

## 3. Install Tailscale

1. Install Tailscale on the Mac and sign in.
2. Install Tailscale on the iPhone from the App Store. Sign in with the same account.
3. Make sure that both devices show "Connected" in the Tailscale app.

Install Tailscale before you pair. The phone gets the Mac's addresses only when it pairs.

## 4. Install the phone app

1. Connect the iPhone to the Mac with a cable, or put both on the same Wi-Fi.
2. On the iPhone, turn on Developer Mode (Settings > Privacy and Security > Developer Mode) if it is off.
3. Find the iPhone's hardware UDID:

   ```bash
   xcrun xctrace list devices
   ```

4. Build the Release build. `-allowProvisioningUpdates` lets Xcode make the provisioning profile (`npx expo run:ios` does not pass it, so its first build fails with "No profiles"):

   ```bash
   cd ~/Development/learnharness-mobile/ios && LANG=en_US.UTF-8 xcodebuild -workspace LearnHarness.xcworkspace -scheme LearnHarness -configuration Release -destination id=<UDID> -derivedDataPath ../build/release -allowProvisioningUpdates build
   ```

5. Install the app:

   ```bash
   xcrun devicectl device install app --device <UDID> ~/Development/learnharness-mobile/build/release/Build/Products/Release-iphoneos/LearnHarness.app
   ```

6. On a free Apple ID, iOS refuses to open the app the first time. On the iPhone, go to Settings > General > VPN and Device Management. Select your Apple ID and tap "Trust".

The Release build has the JavaScript inside the app. It does not need Metro.

The signing team is `ios.appleTeamId` in `app.json`. If you change to another Apple team, change this ID, then run `npx expo prebuild --platform ios --no-install` before the build.

## 5. Pair the iPhone

1. On the Mac, open LearnHarness > Phone Access….
2. Click "Turn on".
3. Make sure that the address list has a Tailscale address (100.x.x.x). If the window shows "No Tailscale address", turn on Tailscale on the Mac first.
4. Click "Show QR code".
5. On the iPhone, open LearnHarness and scan the code.

## 6. Use it away from home

- Keep the Mac on, open and connected to power. LearnHarness must be open on the Mac.
- Do not close the lid. A closed lid puts the Mac to sleep, unless an external display is connected.
- Keep Tailscale connected on the Mac and the iPhone.

## Free Apple ID: install again every 7 days

On a free Apple ID (Personal Team), the app stops opening 7 days after the install. Do step 4 again. Your pairing stays in the Keychain, so you do not have to pair again.

A paid Apple Developer Program membership gives a profile for 1 year, and TestFlight.

## Problems and fixes

| Problem                                                 | Cause                                                                          | Fix                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| The phone says it cannot reach the Mac.                 | The Mac sleeps, LearnHarness is closed, or Phone Access is off.                | Wake the Mac. Open LearnHarness. Turn on Phone Access.                                                                             |
| The phone connects at home but not away from home.      | Tailscale is off on one device, or the phone paired with no Tailscale address. | Turn on Tailscale on both devices. If Phone Access shows "Home Wi-Fi only" for the phone, remove the phone and pair again.         |
| The app does not open on the iPhone.                    | The 7-day profile of a free Apple ID expired.                                  | Install the app again (step 4).                                                                                                    |
| Xcode says that the bundle identifier is not available. | Another team uses `dev.local.learnharnessmobile`.                              | Change `ios.bundleIdentifier` in `app.json` to a name of your own, then run the prebuild and the build again. You must pair again. |
| The phone asks you to pair again.                       | The Mac made a new certificate, or you removed the phone on the Mac.           | Pair again (step 5).                                                                                                               |
