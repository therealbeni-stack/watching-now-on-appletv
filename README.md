# Watching Now on AppleTV — Public Beta

> **Beta software:** this project is under active development. Expect bugs, incomplete metadata and behavior that may vary between Apple TV apps and streaming services.

**Watching Now on AppleTV** is a Windows application by **benesch.dev** that brings compatible Apple TV / tvOS Now Playing information to **Discord Rich Presence**.

It can display the title you are watching and, when the available metadata allows it, movie/series information, season and episode details, artwork, channel information and playback state/timing.

## 🧪 Public beta

The project is now open for public testing. Real-world reports from different Apple TV models, tvOS versions, Windows systems, Discord versions and streaming apps are especially useful.

**Important:** metadata availability is controlled by the tvOS app/service. Some apps expose rich Now Playing information; others expose only part of it or none at all. This application cannot create metadata that tvOS does not provide.

## Download and install

### Download

The recommended public-beta download is the latest GitHub Release:

**[Download Watching Now on AppleTV v0.4.1 Beta](https://github.com/therealbeni-stack/watching-now-on-appletv/releases/tag/v0.4.1-beta)**

Release assets contain the Windows installer. GitHub Actions artifacts are intended mainly for development builds.

`Watching-Now-on-AppleTV-Setup-0.4.1.exe`

The installer is currently unsigned, so Windows SmartScreen may display a warning. Review the repository and release information before installing beta software.

End users do **not** need to install Python, Node.js or a development environment. The Windows package includes the helper runtime required by the application.

## Requirements

- Windows 10/11
- Apple TV and PC on the same local network
- Discord Desktop installed and running
- A compatible Apple TV/tvOS app exposing Now Playing information

## First setup

1. Install and start Watching Now on AppleTV.
2. Open **Apple TV** and choose **Find Apple TVs**.
3. Select the Apple TV you want to use.
4. Enter the pairing PIN displayed by Apple TV.
5. Keep Discord Desktop running.
6. Start playing something on Apple TV and check your Discord activity.

Pairing credentials are stored locally using Windows/Electron secure storage. Personal device addresses and credentials are not built into the application.

## Features

- Apple TV discovery and Companion pairing
- Discord Rich Presence
- automatic Discord reconnect
- title/movie/series and episode parsing
- channel detection when available
- artwork lookup and fallbacks
- playback state/timer when reliable information is available
- system tray support with minimize-to-tray and clean Exit behavior
- custom Windows application, Desktop shortcut, Start menu and tray icon
- duplicate Apple TV discovery-result filtering after pairing
- optional Start with Windows
- diagnostics for troubleshooting

## 🐞 Beta bug reports — please include as much as possible

Use the **Bug report** issue form. Detailed reports are extremely valuable. Please include the application version, Windows version/build, Apple TV model/generation, tvOS version, Discord Desktop version, streaming/player app, what you were watching, expected behavior, actual behavior, exact reproduction steps, whether the issue happens every time, screenshots/video where useful, and the application's **Advanced → Diagnostics** output.

Also mention whether Apple TV discovery and pairing worked, whether Discord connected, whether the title appeared, whether artwork/channel/timer appeared, how long the status remained visible, and whether changing app/content or restarting Apple TV/Discord/the application changed the result.

**Never post pairing credentials, passwords, authentication tokens, cookies, private account data, or other secrets.** Before posting diagnostics, review them and remove anything you consider private. Local/private IP addresses and device identifiers can also be redacted if they are not necessary to reproduce the issue.

## Privacy

The application needs local-network access to communicate with the selected Apple TV and internet access for Discord Rich Presence and supported metadata/artwork lookups. Beta diagnostics are not silently uploaded by the application. Information is shared with the project only when you intentionally submit it in a GitHub issue.

## Known beta limitations

- tvOS apps expose different amounts of Now Playing metadata.
- artwork/channel detection can require external metadata matching and may occasionally be missing or incorrect.
- some playback timing values exposed by services are not reliable.
- the Windows installer is currently unsigned.
- beta updates are currently manual.
- multi-device support is still being refined.

## Development

```powershell
npm.cmd install
npm.cmd run desktop
```

For direct engine testing:

```powershell
npm.cmd start
```

The release workflow builds a bundled `pyatv` helper before packaging the Windows installer.

## Feedback

Please use GitHub Issues for bugs and reproducible technical problems. Feature requests are also welcome, but keep one problem/request per issue where possible.

Developer: **benesch.dev**

Version: **0.4.1 Beta**
