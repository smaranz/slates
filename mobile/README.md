# Slates mobile

Slates mobile is an installable Capacitor 8 shell for iPhone and Android. It
uses the same Next.js product UI as the browser and desktop apps, with a phone
layout that adds bottom navigation, safe-area handling, swipeable assignment
stacks, compact calendar cells, mobile inbox detail, and a mobile tutor rail.

## Architecture and boundaries

The native shell loads a configured Slates server URL. This is intentional:
the current portal uses Next.js route handlers, local AI backends, and a
server-side Schoology API key, so it cannot be packaged as a static web
export without removing core behavior.

On a physical phone:

- The Next.js portal runs on a trusted computer or private host, and holds
  the Schoology API key.
- The phone talks only to the configured portal URL; the portal signs and
  makes every Schoology request itself.
- Board state is cached in the phone's WebView storage after it has loaded.
- Sync and the server-backed tutor features need the host to be online. The
  phone never holds the API key itself.
- Push-reminder toggles remain app preferences. Native push delivery has not
  been implemented.

Do not expose the current portal directly to the public internet: it does not
yet include multi-user authentication. Use a trusted LAN or an authenticated
private network; use HTTPS outside local development.

## First-time setup

Requirements:

- Node.js 22+
- iOS: macOS with Xcode 26+ and an Apple development team for devices
- Android: Android Studio 2025.2.1+ with SDK 36 and a configured emulator or device

Those versions follow the current [Capacitor 8 environment
requirements](https://capacitorjs.com/docs/getting-started/environment-setup).

Install the mobile dependencies:

```bash
cd mobile
npm install
```

Start the portal on the host computer:

```bash
cd web
npm install
npm run dev:mobile
```

`dev:mobile` listens on the LAN instead of only the loopback interface. Find
the host computer's LAN address, then configure the native shell:

```bash
cd mobile
cp .env.example .env
# Edit SLATES_MOBILE_SERVER_URL, for example http://192.168.1.42:3000
npm run check:server
npm run sync
```

The address is copied into each native project during `npm run sync`. Run sync
again after changing `.env` or native plugins. If no URL is configured, the
app builds successfully and opens a local setup screen instead of claiming it
is connected.

Simulator shortcuts:

- iOS Simulator: `http://localhost:3000`
- Android Emulator: `http://10.0.2.2:3000`
- Physical devices: the host's reachable LAN/private-network URL; never
  `localhost`

Plain HTTP is enabled only for Android debug builds and local-network iOS use.
Use an authenticated HTTPS endpoint for release builds.

## Run and build

```bash
# Launch from the CLI (requires a configured .env)
npm run run:ios
npm run run:android

# Or open the native IDEs
npm run open:ios
npm run open:android
```

For a signed iOS archive, select the `App` target in Xcode, choose your team,
set a unique bundle identifier if `com.slates.app` is unavailable, and use
Product > Archive. For Android, create a release signing key and configure the
release signing block in Android Studio before generating an App Bundle.

App icons and launch images are generated from `resources/icon.png` and
`resources/splash.png`:

```bash
npm run assets
npm run sync
```

## Verification

Repository checks that do not need a simulator or signing identity:

```bash
cd web
npx tsc --noEmit
npm run lint
npm run build

cd ../mobile
npm run sync
npm run doctor
cd android && ./gradlew assembleDebug
```

An unsigned iOS Simulator build can be checked with `xcodebuild` when an iOS
Simulator SDK is installed. Physical-device installation and store submission
still require the owner's Apple/Google signing credentials.

Capacitor documents `server.url` as a live-reload/development facility rather
than a production deployment mechanism. This repository therefore provides a
real installable developer/device foundation, but it is not represented as an
App Store or Play Store release architecture. Before public-store distribution,
bundle a dedicated local mobile client (or adopt a supported authenticated
deployment/update service) and keep the Next.js server behind an
authenticated API. The current remote shell must not be shipped publicly as-is.
