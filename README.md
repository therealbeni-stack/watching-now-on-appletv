# Watching Now on AppleTV

**Show what you're watching on Apple TV as Discord Rich Presence.**

> 🧪 **Public Beta — v0.4.2-beta**  
> The project is under active development. Metadata availability and behavior can vary between Apple TV apps and streaming services.

[**⬇️ Download v0.4.2-beta for Windows**](https://github.com/therealbeni-stack/watching-now-on-appletv/releases/tag/v0.4.2-beta) · [**🐞 Report a bug**](https://github.com/therealbeni-stack/watching-now-on-appletv/issues/new?template=bug_report.yml) · [**✨ Request a feature**](https://github.com/therealbeni-stack/watching-now-on-appletv/issues/new?template=feature_request.yml)

**Watching Now on AppleTV** is a Windows application by **benesch.dev** that brings compatible Apple TV / tvOS Now Playing information to **Discord Rich Presence**.

When the active tvOS app exposes the necessary information, Discord can show the title you are watching together with movie/series details, season and episode information, artwork, channel information and playback state/timing.

## ✨ Features

- Automatic Apple TV discovery on the local network
- Apple TV Companion pairing directly from the application
- Discord Rich Presence integration
- Movie, series, season and episode information when available
- Artwork lookup and fallbacks
- Channel information when available
- Playback state/timer when reliable information is available
- Automatic Discord reconnect
- System tray support with minimize-to-tray and clean Exit behavior
- Windows application, Desktop shortcut, Start menu and tray icon
- Diagnostics for troubleshooting

## ⬇️ Download & install

The recommended public-beta download is the GitHub Release:

**[Download Watching Now on AppleTV v0.4.2-beta](https://github.com/therealbeni-stack/watching-now-on-appletv/releases/tag/v0.4.2-beta)**

Installer:

`Watching-Now-on-AppleTV-Setup-0.4.2.exe`

The installer is currently **unsigned**, so Windows SmartScreen may display a warning. End users do **not** need to install Python, Node.js or a development environment; the Windows package includes the helper runtime required by the application.

## 💻 Requirements

- Windows 10/11
- Apple TV and PC on the same local network
- Discord Desktop installed and running
- A compatible Apple TV/tvOS app exposing Now Playing information

## 🚀 First setup

1. Install and start **Watching Now on AppleTV**.
2. Open **Apple TV** in the application and choose **Find Apple TVs**.
3. Select the Apple TV you want to use.
4. Enter the pairing PIN displayed by Apple TV.
5. Keep Discord Desktop running.
6. Start playing something on Apple TV and check your Discord activity.

Pairing credentials are stored locally using Windows/Electron secure storage. Personal device addresses and credentials are not built into the application.

## 🧪 Public beta

Real-world reports from different Apple TV models, tvOS versions, Windows systems, Discord versions and streaming apps are especially useful.

**Important:** metadata availability is controlled by the tvOS app/service. Some apps expose rich Now Playing information; others expose only part of it or none at all. Watching Now on AppleTV cannot create metadata that tvOS does not provide.

## 🐞 Found a bug?

Please use the **[Beta bug report](https://github.com/therealbeni-stack/watching-now-on-appletv/issues/new?template=bug_report.yml)** form.

Useful reports include the app version, Windows version/build, Apple TV model/generation, tvOS version, Discord Desktop version, streaming/player app, expected and actual behavior, reproduction steps, and the application's **Advanced → Diagnostics** output.

**Never post pairing credentials, passwords, authentication tokens, cookies, private account data, or other secrets.** Review diagnostics before posting them. Local/private IP addresses and device identifiers can also be redacted when they are not needed to reproduce the issue.

For ideas and improvements, use the **[Feature request](https://github.com/therealbeni-stack/watching-now-on-appletv/issues/new?template=feature_request.yml)** form.

## 🔒 Privacy

The application needs local-network access to communicate with the selected Apple TV and internet access for Discord Rich Presence and supported metadata/artwork lookups.

Beta diagnostics are **not silently uploaded** by the application. Information is shared with the project only when you intentionally submit it in a GitHub issue.

## ⚠️ Known beta limitations

- tvOS apps expose different amounts of Now Playing metadata.
- Artwork/channel detection can require external metadata matching and may occasionally be missing or incorrect.
- Some playback timing values exposed by services are not reliable.
- The Windows installer is currently unsigned.
- Beta updates are currently manual.
- Multi-device support is still being refined.

## 🛠️ Development

```powershell
npm.cmd install
npm.cmd run desktop
```

For direct engine testing:

```powershell
npm.cmd start
```

The release workflow builds a bundled `pyatv` helper before packaging the Windows installer.

## 💬 Feedback

Bug reports and feature requests are welcome through **GitHub Issues**. Please keep one problem or request per issue where possible.

---

Developed by **benesch.dev** · Current public beta: **v0.4.2-beta**
