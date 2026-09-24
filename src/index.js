require("dotenv").config();
const RPC = require("discord-rpc");
const WebSocket = require("ws");
const { spawn } = require("child_process");
const { TextDecoder } = require("util");

const clientId = process.env.DISCORD_CLIENT_ID;
const legacyHost = process.env.APPLE_TV_VLC_HOST || "";
const appleHost = process.env.APPLE_TV_HOST || legacyHost;
const vlcHost = process.env.VLC_HOST || legacyHost;
const appleTvId = process.env.APPLE_TV_ID || "";
const appleTvCredentials = process.env.APPLE_TV_CREDENTIALS || "";
const reconnectMs = Number(process.env.RECONNECT_MS || 5000);
const discordReconnect = process.env.DISCORD_AUTO_RECONNECT !== "0";
const showArtwork = process.env.SHOW_ARTWORK !== "0";
const showTimer = process.env.SHOW_TIMER !== "0";

if (!clientId) {
  console.error("Missing DISCORD_CLIENT_ID in .env");
  process.exit(1);
}

const rpc = new RPC.Client({ transport: "ipc" });
let rpcReady = false;
let ws;
let reconnectTimer;
let vlcMedia = null;
let vlcPlaying = false;
let vlcUpdatedAt = 0;
let appleMedia = null;
let applePlaybackKey = "";
let applePlaybackStartedAt = 0;
let appleLastUpdateAt = 0;
let appleStaleTimer = null;
const APPLE_STALE_MS = Number(process.env.APPLE_STALE_MS || 180000);
let lastSignature = "";
let pendingSignature = "";
let publishChain = Promise.resolve();
let atvProcess;
let atvPollTimer;
let atvPollRunning = false;
let atvWatcherHealthy = false;
let atvWatcherHasMedia = false;
let atvBuffer = "";
let atvStdoutLog = "";
let atvStderrLog = "";
const atvDecoder = new TextDecoder("utf-8");
const artworkCache = new Map();
const canalArtworkCache = new Map();
const epgArtworkCache = new Map();
const imdbArtworkCache = new Map();
const rejectedArtwork = new Set();
const channelCache = new Map();
let guideSourcesCache = null;
let guideSourcesFetchedAt = 0;

function redactSensitive(value = "") {
  return String(value || "")
    .replace(/((?:Credentials?|companion-credentials)\s*[:=]?\s*)[^,\r\n\s]+/gi, "$1[redacted]")
    .replace(/(--companion-credentials\s+)[^\s]+/gi, "$1[redacted]");
}

function cleanTitle(title = "") {
  let value = String(title || "");
  try { value = decodeURIComponent(value); } catch {}
  value = value.replace(/^file:\/\/+/i, "");
  value = value.split(/[\\/]/).pop() || value;
  return value
    .replace(/\.(mkv|mp4|avi|mov|m4v|webm)$/i, "")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usableTitle(title) {
  const t = cleanTitle(title);
  if (!t) return false;
  const normalized = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return !["fuge hinzu", "add", "remote playback", "entfernte wiedergabe"].includes(normalized);
}

function mediaTitle(m) {
  if (usableTitle(m?.title)) return cleanTitle(m.title);
  if (m?.id) return cleanTitle(m.id);
  return "VLC";
}

function prettyVlcMedia(rawTitle) {
  const raw = cleanTitle(rawTitle);

  // Accept both S01E21 and compact release naming such as S01E21720p.
  // Stop the episode number at 1-2 digits so a following 720p/1080p tag
  // can never become part of the episode number.
  const episode = raw.match(/^(.*?)[ ._-]+S(\d{1,2})E(\d{1,2})(?=\D|$)/i);
  if (episode) {
    const show = episode[1]
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      details: show,
      state: `Staffel ${Number(episode[2])} • Folge ${Number(episode[3])}`,
      artworkQuery: show
    };
  }

  const movie = raw
    .replace(/\s*(?:2160p|1080p|720p|576p|480p)\b.*$/i, "")
    .replace(/\s+(?:BluRay|WEB[- .]?DL|WEBRip|HDRip|DVDRip)\b.*$/i, "")
    .trim();

  return {
    details: movie || raw,
    state: "Film wird angesehen",
    artworkQuery: movie || raw
  };
}

function prettyAppleMedia(title, artist) {
  let details = cleanTitle(title);
  let state = cleanTitle(artist);

  // CANAL+ HU example:
  // Title:  "Csillagkapu 8. évad"
  // Artist: "5. epizód : Ikon"
  const season = details.match(/^(.*?)\s+(\d+)\.\s*évad\s*$/i);
  const episode = state.match(/^(\d+)\.\s*epiz[oó]d\s*(?::\s*(.*))?$/i);

  // Fallback for terminals/processes that replace Hungarian accented characters with �.
  const brokenSeason = !season ? details.match(/^(.*?)\s+(\d+)\s+�vad\s*$/i) : null;
  const brokenEpisode = !episode ? state.match(/^(\d+)\s+epiz�d\s*(?::\s*(.*))?$/i) : null;
  const seasonMatch = season || brokenSeason;
  const episodeMatch = episode || brokenEpisode;

  if (seasonMatch) {
    details = seasonMatch[1].trim();
    const parts = [`Staffel ${Number(seasonMatch[2])}`];
    if (episodeMatch) {
      parts.push(`Folge ${Number(episodeMatch[1])}`);
      if (episodeMatch[2]) parts.push(episodeMatch[2].trim());
    } else if (state) {
      parts.push(state);
    }
    state = parts.join(" • ");
    return { details, state, artworkQuery: details };
  }

  return {
    details: details || "Apple TV",
    state: state || "Video wird angesehen",
    artworkQuery: details || null
  };
}

function normalizeProgrammeTitle(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decodeXml(value = "") {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function parseXmltvDate(value) {
  const m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])(\d{2})(\d{2})/);
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const offset = (+m[8] * 60 + +m[9]) * 60000 * (m[7] === "+" ? 1 : -1);
  return utc - offset;
}

function decodeHtml(value = "") {
  return decodeXml(String(value || ""))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

async function findEpgArtwork(programmeTitle) {
  const title = cleanTitle(programmeTitle);
  const key = normalizeProgrammeTitle(title);
  if (!key) return null;
  if (epgArtworkCache.has(key)) return epgArtworkCache.get(key);

  try {
    const slug = title.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const url = "https://www.tvmusor.eu/tvmusor/" + slug;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 watching-now-on-appletv/0.9" },
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const page = await response.text();
      let image =
        page.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        page.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
      if (!image) {
        const imgs = [...page.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];
        const wanted = normalizeProgrammeTitle(title);
        for (const m of imgs) {
          const tag = m[0];
          const alt = decodeHtml(tag.match(/alt=["']([^"']*)["']/i)?.[1] || "");
          if (normalizeProgrammeTitle(alt).includes(wanted)) { image = m[1]; break; }
        }
      }
      if (image) {
        image = decodeHtml(image);
        if (image.startsWith("//")) image = "https:" + image;
        if (image.startsWith("/")) image = "https://www.tvmusor.eu" + image;
        if (image.startsWith("https://") || image.startsWith("http://")) {
          epgArtworkCache.set(key, image);
          console.log("EPG cover: \"" + title + "\" -> " + image);
          return image;
        }
      }
    }
  } catch (err) {
    console.log("EPG cover lookup:", err.message);
  }
  epgArtworkCache.set(key, null);
  return null;
}

async function findCanalPlusArtwork(programmeTitle) {
  const title = cleanTitle(programmeTitle);
  const key = normalizeProgrammeTitle(title);
  if (!key) return null;
  if (canalArtworkCache.has(key)) return canalArtworkCache.get(key);

  try {
    // CANAL+ Hungary exposes programme pages with the real programme artwork.
    // Search the official catalogue, then read the page's image metadata.
    const query = encodeURIComponent('site:canalplus.com/hu/hu/filmek/ "' + title + '"');
    const searchUrls = [
      "https://www.google.com/search?q=" + query,
      "https://www.bing.com/search?q=" + query
    ];
    const programmeUrls = [];

    for (const searchUrl of searchUrls) {
      try {
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36"
          },
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) continue;
        const html = decodeHtml(await response.text());

        const patterns = [
          /https:\/\/www\.canalplus\.com\/hu\/hu\/filmek\/[^"'<> &]+/gi,
          /https:\/\/www\.canalplus\.com\/hu\/hu\/sorozatok\/[^"'<> &]+/gi
        ];
        for (const pattern of patterns) {
          for (const m of html.matchAll(pattern)) {
            let url = m[0].replace(/&amp;.*$/i, "");
            try { url = decodeURIComponent(url); } catch {}
            if (!programmeUrls.includes(url)) programmeUrls.push(url);
          }
        }
        if (programmeUrls.length) break;
      } catch {}
    }

    for (const url of programmeUrls.slice(0, 8)) {
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 watching-now-on-appletv/1.0" },
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) continue;
        const page = await response.text();

        const pageTitle = decodeHtml(
          page.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
          page.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
          page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") ||
          ""
        );
        const pageKey = normalizeProgrammeTitle(pageTitle);
        if (pageKey && pageKey !== key && !pageKey.includes(key) && !key.includes(pageKey)) continue;

        let image =
          page.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
          page.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
          page.match(/https:\/\/thumb\.canalplus\.pro\/[^"'<> ]+/i)?.[0];

        if (image) {
          image = decodeHtml(image).replace(/\\u002F/g, "/").replace(/\\\//g, "/");
          if (image.startsWith("//")) image = "https:" + image;
          if (image.startsWith("https://") || image.startsWith("http://")) {
            canalArtworkCache.set(key, image);
            console.log('CANAL+ cover: "' + title + '" -> ' + image);
            return image;
          }
        }
      } catch {}
    }
    console.log('CANAL+ cover: no official artwork found for "' + title + '"');
  } catch (err) {
    console.log("CANAL+ cover lookup:", err.message);
  }

  canalArtworkCache.set(key, null);
  return null;
}

async function findImdbArtwork(title) {
  const key = normalizeProgrammeTitle(title);
  if (!key) return null;
  if (imdbArtworkCache.has(key)) return imdbArtworkCache.get(key);

  try {
    // IMDb's public suggestion endpoint returns canonical title matches and
    // poster URLs from IMDb's own media CDN. Use it only as an artwork fallback.
    const first = key[0] || "x";
    const url = `https://v2.sg.media-imdb.com/suggestion/${encodeURIComponent(first)}/${encodeURIComponent(title)}.json`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 watching-now-on-appletv/1.0" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      imdbArtworkCache.set(key, null);
      return null;
    }

    const data = await response.json();
    const candidates = Array.isArray(data?.d) ? data.d : [];
    const exact = candidates.find(item => normalizeProgrammeTitle(item?.l) === key);
    const selected = exact || candidates.find(item => item?.i?.imageUrl) || null;
    const image = selected?.i?.imageUrl || null;

    if (image && /^https?:\/\//i.test(image)) {
      imdbArtworkCache.set(key, image);
      console.log(`IMDb cover: "${title}" -> ${image}`);
      return image;
    }
  } catch (err) {
    console.log("IMDb cover lookup:", err.message);
  }

  imdbArtworkCache.set(key, null);
  return null;
}

async function findSeriesArtwork(showName) {
  const key = String(showName || "").trim().toLowerCase();
  if (!key) return null;
  if (artworkCache.has(key)) return artworkCache.get(key);

  try {
    // TVmaze provides poster images and permits direct linking to its image CDN.
    // Use the fuzzy search endpoint rather than singlesearch so Hungarian/localized
    // titles have a better chance of resolving to the correct show.
    const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(showName)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "watching-now-on-appletv/0.7" },
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const results = await response.json();
      const normalized = normalizeProgrammeTitle(showName);
      const exact = results.find(item => normalizeProgrammeTitle(item?.show?.name) === normalized);
      const selected = exact || results[0];
      let image = selected?.show?.image?.original || selected?.show?.image?.medium || null;
      if (image) {
        // Keep VLC artwork exactly as it worked before the CANAL+ integration:
        // pass TVmaze's public image URL directly to Discord RPC.
        artworkCache.set(key, image);
        console.log(`TVmaze cover: "${showName}" -> ${image}`);
        return image;
      }
    }

    artworkCache.set(key, null);
    return null;
  } catch (err) {
    console.log("TVmaze:", err.message);
    artworkCache.set(key, null);
    return null;
  }
}

async function getHungarianGuideSources() {
  const now = Date.now();
  if (guideSourcesCache && now - guideSourcesFetchedAt < 6 * 60 * 60 * 1000) return guideSourcesCache;

  // Stable iptv-org generated Hungarian guides. musor.tv currently covers
  // the broadest set; Yettel and tvmusor.hu are useful fallbacks.
  const urls = [
    "https://iptv-org.github.io/epg/guides/hu/musor.tv.xml",
    "https://iptv-org.github.io/epg/guides/hu/tv.yettel.hu.xml",
    "https://iptv-org.github.io/epg/guides/hu/tvmusor.hu.xml"
  ];

  guideSourcesCache = urls;
  guideSourcesFetchedAt = now;
  return urls;
}

async function findChannelFromTvListings(programmeTitle) {
  try {
    const response = await fetch("https://tvlistings.eu/hu/hungary", {
      headers: { "User-Agent": "Mozilla/5.0 watching-now-on-appletv/0.6" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const html = await response.text();

    // Split the guide into channel sections. We only use this as a fallback
    // and only accept a unique channel containing the exact normalized title.
    const sections = html.split(/<h2\b/i).slice(1);
    const wanted = normalizeProgrammeTitle(programmeTitle);
    const matches = [];

    for (const section of sections) {
      const heading = section.match(/>([\s\S]*?)<\/h2>/i)?.[1] || "";
      const channel = decodeXml(heading.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (!channel) continue;

      const plain = decodeXml(
        section
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
      );
      if (normalizeProgrammeTitle(plain).includes(wanted)) matches.push(channel);
    }

    const unique = [...new Set(matches)];
    return unique.length === 1 ? unique[0] : null;
  } catch (err) {
    console.log("TVListings EPG:", err.message);
    return null;
  }
}

async function findChannelByProgramme(programmeTitle) {
  const normalizedWanted = normalizeProgrammeTitle(programmeTitle);
  if (!normalizedWanted || normalizedWanted.length < 3) return null;

  const cacheKey = normalizedWanted;
  const cached = channelCache.get(cacheKey);
  if (cached && cached.channel && Date.now() - cached.at < 10 * 60 * 1000) return cached.channel;

  try {
    const sources = await getHungarianGuideSources();
    const now = Date.now();
    const matches = [];

    for (const url of sources.slice(0, 6)) {
      let xml;
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "watching-now-on-appletv/0.5" },
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) continue;
        xml = await response.text();
      } catch {
        continue;
      }

      const channelNames = new Map();
      for (const match of xml.matchAll(/<channel\s+id="([^"]+)"[\s\S]*?<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>[\s\S]*?<\/channel>/gi)) {
        channelNames.set(match[1], decodeXml(match[2].replace(/<[^>]+>/g, "").trim()));
      }

      for (const match of xml.matchAll(/<programme\s+([^>]*)>([\s\S]*?)<\/programme>/gi)) {
        const attrs = match[1];
        const body = match[2];
        const channel = attrs.match(/channel="([^"]+)"/i)?.[1];
        const start = attrs.match(/start="([^"]+)"/i)?.[1];
        const stop = attrs.match(/stop="([^"]+)"/i)?.[1];
        const title = body.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1];
        if (!channel || !start || !title) continue;

        const clean = decodeXml(title.replace(/<[^>]+>/g, "").trim());
        if (normalizeProgrammeTitle(clean) !== normalizedWanted) continue;

        const startMs = parseXmltvDate(start);
        const stopMs = stop ? parseXmltvDate(stop) : startMs + 4 * 60 * 60 * 1000;
        // Allow a small EPG clock tolerance around the programme window.
        if (Number.isFinite(startMs) && now >= startMs - 3 * 60 * 1000 && now <= stopMs + 3 * 60 * 1000) {
          matches.push(channelNames.get(channel) || channel);
        }
      }
    }

    const unique = [...new Set(matches.filter(Boolean))];
    // Prefer the exact current EPG match. If the same programme is simulcast on
    // several channels, keep the first current match instead of hiding channel data.
    let channel = unique.length >= 1 ? unique[0].replace(/\s*\(HD\)\s*$/i, "").trim() : null;

    // Public XMLTV guide URLs are not guaranteed to be published continuously.
    // Fall back to the current Hungary guide page when XMLTV yields nothing.
    if (!channel && unique.length === 0) {
      channel = await findChannelFromTvListings(programmeTitle);
    }

    channelCache.set(cacheKey, { channel, at: Date.now() });
    if (channel) console.log(`EPG: "${programmeTitle}" -> ${channel}`);
    else if (unique.length > 1) console.log(`EPG: ambiguous channel for "${programmeTitle}": ${unique.join(", ")}`);
    return channel;
  } catch (err) {
    console.log("EPG:", err.message);
    channelCache.set(cacheKey, { channel: null, at: Date.now() });
    return null;
  }
}

async function clearPresence() {
  lastSignature = "";
  pendingSignature = "";
  if (rpcReady) {
    try { await rpc.clearActivity(); } catch {}
  }
}

function queuePublish() {
  publishChain = publishChain.then(() => publish()).catch(err => console.error(err));
  return publishChain;
}

async function publish() {
  if (!rpcReady) return;

  // Apple TV Now Playing (e.g. CANAL+) has priority when it is actively playing/paused.
  // VLC metadata can remain cached after the user leaves VLC. Only let VLC win
  // while it is actually playing and has produced a recent WebSocket update.
  const vlcIsActive = Boolean(vlcMedia && vlcPlaying && Date.now() - vlcUpdatedAt < 15000);
  const appleLooksLikeActiveVlc = Boolean(
    appleMedia && vlcIsActive &&
    normalizeProgrammeTitle(cleanTitle(appleMedia.title)) === normalizeProgrammeTitle(cleanTitle(mediaTitle(vlcMedia)))
  );
  const appleIsFresh = Boolean(appleMedia);
  const useApple = Boolean(
    appleIsFresh && ["Playing", "Paused"].includes(appleMedia.deviceState) && !appleLooksLikeActiveVlc
  );
  let pretty;
  let isPlaying;
  let positionMs = null;
  let durationMs = null;
  let source = "";

  if (useApple) {
    pretty = prettyAppleMedia(appleMedia.title, appleMedia.artist);
    const channel = await findChannelByProgramme(appleMedia.title);
    if (channel) pretty.state = `${decodeXml(channel).replace(/\s+/g, " ").trim()} • ${pretty.state}`;
    isPlaying = appleMedia.deviceState === "Playing";
    // pyatv's CANAL+ Position is not a reliable wall-clock elapsed value.
    // Keep one stable timer per programme instead of rebuilding the Discord
    // start timestamp from every position update.
    const playbackKey = normalizeProgrammeTitle(appleMedia.title) + "|" + normalizeProgrammeTitle(appleMedia.artist);
    if (playbackKey !== applePlaybackKey) {
      applePlaybackKey = playbackKey;
      applePlaybackStartedAt = Date.now();
    }
    positionMs = null;
    source = "Apple TV";
  } else if (vlcIsActive) {
    const title = mediaTitle(vlcMedia);
    pretty = prettyVlcMedia(title);
    isPlaying = vlcPlaying;
    positionMs = Number.isFinite(vlcMedia.currentTime) ? vlcMedia.currentTime : null;
    durationMs = Number.isFinite(vlcMedia.duration) ? vlcMedia.duration : null;
    source = "VLC";
  } else {
    await clearPresence();
    return;
  }

  let foundArtwork = null;
  let artworkSource = null;
  if (showArtwork && pretty.artworkQuery) {
    if (useApple) {
      foundArtwork = await findCanalPlusArtwork(appleMedia.title);
      if (foundArtwork) artworkSource = "CANAL+";
      if (!foundArtwork) {
        foundArtwork = await findEpgArtwork(appleMedia.title);
        if (foundArtwork) artworkSource = "EPG";
      }
    }
    if (!foundArtwork) {
      foundArtwork = await findSeriesArtwork(pretty.artworkQuery);
      if (foundArtwork) artworkSource = "TVmaze";
    }
    if (!foundArtwork) {
      foundArtwork = await findImdbArtwork(pretty.artworkQuery);
      if (foundArtwork) artworkSource = "IMDb";
    }
  }
  const artwork = foundArtwork && !rejectedArtwork.has(foundArtwork) ? foundArtwork : null;
  const signature = JSON.stringify([
    source, pretty.details, pretty.state, isPlaying,
    Math.floor((positionMs || 0) / 1000), durationMs, artwork
  ]);
  if (signature === lastSignature || signature === pendingSignature) return;
  pendingSignature = signature;

  const activity = {
    details: pretty.details.slice(0, 128),
    state: (isPlaying ? pretty.state : `Pausiert • ${pretty.state}`).slice(0, 128),
    instance: false
  };

  if (artwork) {
    activity.largeImageKey = artwork;
    activity.largeImageText = pretty.details.slice(0, 128);
  }

  if (showTimer && useApple && isPlaying && applePlaybackStartedAt) {
    activity.startTimestamp = new Date(applePlaybackStartedAt);
  } else if (showTimer && isPlaying && Number.isFinite(positionMs)) {
    activity.startTimestamp = new Date(Date.now() - positionMs);
  }
  if (showTimer && isPlaying && Number.isFinite(durationMs) && durationMs > 0 && Number.isFinite(positionMs)) {
    activity.endTimestamp = new Date(Date.now() - positionMs + durationMs);
  }

  try {
    await rpc.setActivity(activity);
    lastSignature = signature;
    pendingSignature = "";
    console.log(`Discord [${source}]:`, activity.details, "-", activity.state, artwork ? `- Cover: ${artworkSource}` : "");
  } catch (err) {
    if (artwork) {
      console.log("Discord rejected external cover URL; disabling this cover for the current session.");
      rejectedArtwork.add(artwork);
      delete activity.largeImageKey;
      delete activity.largeImageText;
      await rpc.setActivity(activity);
      pendingSignature = "";
      lastSignature = JSON.stringify([
        source, pretty.details, pretty.state, isPlaying,
        Math.floor((positionMs || 0) / 1000), durationMs, null
      ]);
      console.log(`Discord [${source}]:`, activity.details, "-", activity.state, "- Cover disabled by legacy RPC");
      return;
    }
    pendingSignature = "";
    throw err;
  }
}

function requestPlaying() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "playing" }));
  }
}

function handleVlcMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  if (msg.type === "playing" && msg.media) {
    vlcMedia = {
      id: msg.media.id,
      title: msg.media.title,
      duration: Number(msg.media.duration),
      currentTime: Number(msg.currentTime)
    };
    vlcPlaying = true;
    vlcUpdatedAt = Date.now();
    queuePublish();
    return;
  }

  if (msg.type === "play") {
    vlcPlaying = true;
    vlcUpdatedAt = Date.now();
    if (vlcMedia && msg.currentTime != null) vlcMedia.currentTime = Number(msg.currentTime);
    queuePublish();
    return;
  }

  if (msg.type === "pause") {
    vlcPlaying = false;
    vlcUpdatedAt = Date.now();
    if (vlcMedia && msg.currentTime != null) vlcMedia.currentTime = Number(msg.currentTime);
    queuePublish();
    return;
  }

  if (msg.type === "seekTo") {
    if (!vlcMedia && msg.media) {
      vlcMedia = {
        id: msg.media.id,
        title: msg.media.title || msg.media.id,
        duration: Number(msg.media.duration),
        currentTime: Number(msg.currentTime)
      };
    } else if (vlcMedia) {
      vlcMedia.currentTime = Number(msg.currentTime);
    }
    vlcUpdatedAt = Date.now();
    requestPlaying();
  }
}

function connectVlc() {
  clearTimeout(reconnectTimer);
  if (!vlcHost) { console.log("VLC host not configured; skipping VLC WebSocket."); return; }
  console.log(`Connecting to VLC at ws://${vlcHost} ...`);
  ws = new WebSocket(`ws://${vlcHost}`);

  ws.on("open", () => {
    console.log("Connected to Apple TV VLC");
    requestPlaying();
  });

  ws.on("message", handleVlcMessage);

  ws.on("close", () => {
    console.log("Apple TV VLC disconnected");
    vlcMedia = null;
    vlcPlaying = false;
    vlcUpdatedAt = 0;
    queuePublish();
    reconnectTimer = setTimeout(connectVlc, reconnectMs);
  });

  ws.on("error", err => {
    if (err?.code === "ECONNREFUSED") {
      console.log("Apple TV VLC is not running; CANAL+/Now Playing watcher remains active.");
      return;
    }
    console.log("VLC WebSocket:", err.message);
  });
}

function parseAtvBlock(block) {
  const get = label => {
    const match = block.match(new RegExp("^\\s*" + label + ":\\s*(.*)$", "mi"));
    return match ? match[1].trim() : "";
  };

  const mediaType = get("Media type");
  const deviceState = get("Device state");
  const title = get("Title");
  const artist = get("Artist");
  const positionRaw = get("Position");
  const position = positionRaw ? Number(positionRaw.replace(/s$/i, "")) : NaN;

  if (mediaType === "Unknown" || deviceState === "Idle" || deviceState === "Stopped") {
    appleMedia = null;
    appleLastUpdateAt = 0;
    clearTimeout(appleStaleTimer);
    applePlaybackKey = "";
    applePlaybackStartedAt = 0;
    queuePublish();
    return;
  }

  if (title || artist) {
    atvWatcherHasMedia = true;
    appleLastUpdateAt = Date.now();
    clearTimeout(appleStaleTimer);
    appleStaleTimer = setTimeout(() => {
      if (appleMedia && Date.now() - appleLastUpdateAt >= APPLE_STALE_MS) {
        console.log("Apple TV Now Playing has not updated for a while; keeping the last known activity until an explicit idle/stopped update or watcher disconnect.");
      }
    }, APPLE_STALE_MS + 250);
    appleMedia = {
      mediaType,
      deviceState,
      title,
      artist,
      position: Number.isFinite(position) ? position : null
    };
    queuePublish();
  }
}

function handleAtvOutput(chunk) {
  atvBuffer += atvDecoder.decode(chunk, { stream: true }).replace(/\r/g, "");
  const separator = "--------------------";

  while (atvBuffer.includes(separator)) {
    const index = atvBuffer.indexOf(separator);
    const block = atvBuffer.slice(0, index);
    atvBuffer = atvBuffer.slice(index + separator.length);
    parseAtvBlock(block);
  }
}

function pollAppleTvPlaying() {
  if (atvPollRunning || (!appleTvId && !appleHost)) return;
  atvPollRunning = true;
  const bundledAtv = process.env.ATVREMOTE_EXE || "";
  const pythonExe = process.env.PYTHON_EXE || "python";
  const remoteArgs = [
    ...(appleHost ? ["--scan-hosts", appleHost] : []),
    ...(appleTvId ? ["--id", appleTvId] : []),
    ...(appleTvCredentials ? ["--companion-credentials", appleTvCredentials] : []),
    "--protocol", "companion",
    "playing"
  ];
  const poll = spawn(bundledAtv || pythonExe, bundledAtv ? remoteArgs : [
    "-X", "utf8", "-m", "pyatv.scripts.atvremote", ...remoteArgs
  ], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
  });
  let out = "", err = "";
  poll.stdout.on("data", data => { out += data.toString(); });
  poll.stderr.on("data", data => { err += data.toString(); });
  poll.on("error", e => {
    console.log("Apple TV playing poll failed:", e.message);
    atvPollRunning = false;
  });
  poll.on("close", code => {
    atvPollRunning = false;
    const safeOut = redactSensitive(out).trim();
    const safeErr = redactSensitive(err)
      .replace(/^.*DeprecationWarning: There is no current event loop.*\r?\n?/gmi, "")
      .replace(/^\s*loop = asyncio\.get_event_loop\(\)\s*\r?\n?/gmi, "")
      .trim();
    if (code === 0 && safeOut) {
      console.log("Apple TV playing poll:\n" + safeOut);
      parseAtvBlock(out);
    } else if (code !== 0 && safeErr) {
      if (/_touchStart failed|_sessionStart failed|ProtocolError/i.test(safeErr)) {
        console.log("Apple TV playing poll: Companion session temporarily busy; retrying on the next interval.");
      } else {
        console.log("Apple TV playing poll diagnostics:\n" + safeErr);
      }
    }
  });
}

function startAppleTvPolling() {
  clearInterval(atvPollTimer);
  console.log("Starting Apple TV active playing fallback (10s)...");
  pollAppleTvPlaying();
  atvPollTimer = setInterval(() => {
    if (!atvWatcherHealthy) pollAppleTvPlaying();
  }, 10000);
}

function startAppleTvWatcher() {
  if (atvProcess) return;
  if (!appleTvId && !appleHost) { console.log("Apple TV not configured. Open Settings and pair/select a device."); return; }
  console.log("Starting Apple TV Now Playing watcher...");
  atvWatcherHealthy = true;
  atvWatcherHasMedia = false;

  // Run pyatv through Python and force UTF-8 stdout/stderr on Windows.
  // This prevents Hungarian text such as "vígjáték", "évad" and "epizód"
  // from being corrupted by the Windows console code page.
  const bundledAtv = process.env.ATVREMOTE_EXE || "";
  const pythonExe = process.env.PYTHON_EXE || "python";
  const remoteArgs = [
    ...(appleHost ? ["--scan-hosts", appleHost] : []),
    ...(appleTvId ? ["--id", appleTvId] : []),
    ...(appleTvCredentials ? ["--companion-credentials", appleTvCredentials] : []),
    "push_updates"
  ];
  atvProcess = spawn(bundledAtv || pythonExe, bundledAtv ? remoteArgs : [
    "-X", "utf8", "-m", "pyatv.scripts.atvremote", ...remoteArgs
  ], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8"
    }
  });

  atvProcess.stdout.on("data", data => {
    atvStdoutLog = (atvStdoutLog + redactSensitive(data.toString())).slice(-8000);
    handleAtvOutput(data);
  });
  // atvremote push_updates exits as soon as stdin reaches EOF. Keep stdin open.
  if (atvProcess.stdin?.writable) atvProcess.stdin.write("");
  atvProcess.stderr.on("data", data => {
    const message = data.toString().trim();
    if (!message) return;
    if (message.includes("DeprecationWarning: There is no current event loop")) return;
    const safe = redactSensitive(message);
    atvStderrLog = (atvStderrLog + safe + "\n").slice(-8000);
    console.log("pyatv:", safe);
  });

  atvProcess.on("error", err => {
    console.log("Apple TV watcher failed:", err.message);
  });

  atvProcess.on("close", code => {
    atvWatcherHealthy = false;
    atvWatcherHasMedia = false;
    if (code !== 0) {
      const combined = (atvStderrLog || atvStdoutLog || "").trim();
      if (combined) console.log("Apple TV watcher diagnostics:\n" + combined);
    }
    console.log(`Apple TV watcher stopped (code ${code}). Reconnecting...`);
    atvStdoutLog = "";
    atvStderrLog = "";
    atvProcess = null;
    clearTimeout(appleStaleTimer);
    // Preserve the last known Apple TV activity across watcher reconnects.
    // Some tvOS apps do not emit frequent Now Playing updates, so clearing here
    // makes Discord presence disappear even while playback is still active.
    setTimeout(startAppleTvWatcher, reconnectMs);
  });
}

let servicesStarted = false;
function startServicesOnce() {
  if (servicesStarted) return;
  servicesStarted = true;
  connectVlc();
  startAppleTvWatcher();
  setTimeout(() => {
    if (!atvWatcherHasMedia) startAppleTvPolling();
  }, 8000);
}
function connectDiscord() {
  console.log("Connecting to Discord...");
  rpc.login({ clientId }).catch(err => {
    rpcReady = false;
    console.log("Discord connection:", err.message);
    if (discordReconnect) setTimeout(connectDiscord, reconnectMs);
  });
}
rpc.on("ready", () => {
  rpcReady = true;
  console.log("Connected to Discord");
  startServicesOnce();
});
rpc.on("disconnected", () => {
  rpcReady = false;
  console.log("Discord disconnected");
  if (discordReconnect) setTimeout(connectDiscord, reconnectMs);
});
connectDiscord();
