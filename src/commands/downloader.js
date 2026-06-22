'use strict';

/**
 * ── STREET EMPIRE DOWNLOADER ─────────────────────────────────────────────────
 * Each platform tries multiple free APIs in order until one works:
 *   YouTube video: Izumi → Okatsu → Vreden
 *   YouTube audio: Izumi(url) → Izumi(query) → Okatsu → Vreden
 *   TikTok:        Izumi → tikwm.com → Okatsu
 *   Twitter/X:     Izumi → Okatsu
 *
 * .dl [url]        auto-detect & download video
 * .dl yt [url]     YouTube video
 * .dl yta [url]    YouTube audio MP3
 * .dl tt [url]     TikTok (no watermark)
 * .dl tw [url]     Twitter/X video
 * .dl info [url]   show video info + thumbnail
 * .vid <search>    search YouTube → thumbnail → download video
 * .aud <search>    search YouTube → thumbnail → download as MP3
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const MAX_VIDEO_BYTES = 62 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

const AXIOS_OPTS = {
  timeout: 60000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
  },
  responseType: 'json',
};

// ── Lazy loaders ──────────────────────────────────────────────────────────────
let _axios = null;
function getAxios() { if (!_axios) _axios = require('axios'); return _axios; }

let _yts = null;
function getYts() { if (!_yts) _yts = require('yt-search'); return _yts; }

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function tryRequest(fn, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
  throw lastErr;
}

// ── Platform detection ────────────────────────────────────────────────────────
function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url))      return 'youtube';
  if (/tiktok\.com|vm\.tiktok\.com/i.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com|t\.co/i.test(url))   return 'twitter';
  return 'generic';
}

function formatDuration(secs) {
  if (!secs) return 'unknown';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

function extractYtId(url) {
  return (url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/) || [])[1];
}

// ── Fetch thumbnail buffer ────────────────────────────────────────────────────
function fetchThumb(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    try {
      const mod = url.startsWith('https') ? https : require('http');
      mod.get(url, { timeout: 8000 }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

// ── Download buffer from URL ──────────────────────────────────────────────────
async function fetchBuffer(url) {
  const res = await getAxios().get(url, { ...AXIOS_OPTS, responseType: 'arraybuffer', timeout: 120000 });
  return Buffer.from(res.data);
}

// ── API: Izumi video (YouTube) ────────────────────────────────────────────────
async function izumiVideo(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(url)}&format=720`, AXIOS_OPTS)
  );
  if (res?.data?.result?.download) return res.data.result; // { download, title, thumbnail }
  throw new Error('Izumi video: no download URL');
}

// ── API: Izumi audio by URL ───────────────────────────────────────────────────
async function izumiAudioByUrl(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(url)}&format=mp3`, AXIOS_OPTS)
  );
  if (res?.data?.result?.download) return res.data.result;
  throw new Error('Izumi audio by URL: no download');
}

// ── API: Izumi audio by query ─────────────────────────────────────────────────
async function izumiAudioByQuery(query) {
  const res = await tryRequest(() =>
    getAxios().get(`https://izumiiiiiiii.dpdns.org/downloader/youtube-play?query=${encodeURIComponent(query)}`, AXIOS_OPTS)
  );
  if (res?.data?.result?.download) return res.data.result;
  throw new Error('Izumi audio by query: no download');
}

// ── API: Okatsu video fallback ────────────────────────────────────────────────
async function okatsuVideo(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(url)}`, AXIOS_OPTS)
  );
  if (res?.data?.result?.mp4) return { download: res.data.result.mp4, title: res.data.result.title };
  throw new Error('Okatsu video: no mp4');
}

// ── API: Okatsu audio fallback ────────────────────────────────────────────────
async function okatsuAudio(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`, AXIOS_OPTS)
  );
  if (res?.data?.dl) return { download: res.data.dl, title: res.data.title, thumbnail: res.data.thumb };
  throw new Error('Okatsu audio: no download');
}

// ── API: Vreden video fallback ────────────────────────────────────────────────
async function vredenVideo(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://api.vreden.my.id/api/ytmp4?url=${encodeURIComponent(url)}`, AXIOS_OPTS)
  );
  const d = res?.data?.result;
  if (d?.download?.url || d?.url) return { download: d.download?.url || d.url, title: d.title };
  throw new Error('Vreden video: no download');
}

// ── API: Vreden audio fallback ────────────────────────────────────────────────
async function vredenAudio(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(url)}`, AXIOS_OPTS)
  );
  const d = res?.data?.result;
  if (d?.download?.url || d?.url) return { download: d.download?.url || d.url, title: d.title };
  throw new Error('Vreden audio: no download');
}

// ── YouTube video — chained fallback ──────────────────────────────────────────
async function youtubeVideoDownload(url) {
  const sources = [izumiVideo, okatsuVideo, vredenVideo];
  let lastErr;
  for (const fn of sources) {
    try { return await fn(url); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── YouTube audio — chained fallback ──────────────────────────────────────────
async function youtubeAudioDownload(url, title) {
  const sources = [
    () => izumiAudioByUrl(url),
    () => izumiAudioByQuery(title || url),
    () => okatsuAudio(url),
    () => vredenAudio(url),
  ];
  let lastErr;
  for (const fn of sources) {
    try { return await fn(); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── API: TikTok (Izumi) ───────────────────────────────────────────────────────
async function izumiTiktok(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://izumiiiiiiii.dpdns.org/downloader/tiktok?url=${encodeURIComponent(url)}`, AXIOS_OPTS)
  );
  if (res?.data?.result?.download) return res.data.result;
  throw new Error('Izumi TikTok: no download');
}

// ── API: TikTok (tikwm.com — free, no key, long-running) ─────────────────────
async function tikwmTiktok(url) {
  const res = await tryRequest(() =>
    getAxios().post('https://www.tikwm.com/api/', `url=${encodeURIComponent(url)}&hd=1`, {
      ...AXIOS_OPTS,
      headers: { ...AXIOS_OPTS.headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  );
  const d = res?.data?.data;
  if (d?.play) return { download: d.play, title: d.title };
  throw new Error('tikwm: no download');
}

// ── API: TikTok (Okatsu) ──────────────────────────────────────────────────────
async function okatsuTiktok(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://okatsu-rolezapiiz.vercel.app/downloader/tiktok?url=${encodeURIComponent(url)}`, AXIOS_OPTS)
  );
  if (res?.data?.result?.download || res?.data?.dl) {
    return { download: res.data.result?.download || res.data.dl, title: res.data.result?.title || res.data.title };
  }
  throw new Error('Okatsu TikTok: no download');
}

// ── TikTok — chained fallback ─────────────────────────────────────────────────
async function tiktokDownload(url) {
  const sources = [izumiTiktok, tikwmTiktok, okatsuTiktok];
  let lastErr;
  for (const fn of sources) {
    try { return await fn(url); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── API: Twitter (Izumi) ──────────────────────────────────────────────────────
async function izumiTwitter(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://izumiiiiiiii.dpdns.org/downloader/twitter?url=${encodeURIComponent(url)}`, AXIOS_OPTS)
  );
  if (res?.data?.result?.download) return res.data.result;
  throw new Error('Izumi Twitter: no download');
}

// ── API: Twitter (Okatsu) ─────────────────────────────────────────────────────
async function okatsuTwitter(url) {
  const res = await tryRequest(() =>
    getAxios().get(`https://okatsu-rolezapiiz.vercel.app/downloader/twitter?url=${encodeURIComponent(url)}`, AXIOS_OPTS)
  );
  if (res?.data?.result?.download || res?.data?.dl) {
    return { download: res.data.result?.download || res.data.dl, title: res.data.result?.title || res.data.title };
  }
  throw new Error('Okatsu Twitter: no download');
}

// ── Twitter — chained fallback ────────────────────────────────────────────────
async function twitterDownload(url) {
  const sources = [izumiTwitter, okatsuTwitter];
  let lastErr;
  for (const fn of sources) {
    try { return await fn(url); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── YouTube search ────────────────────────────────────────────────────────────
async function ytSearch(query) {
  const res = await getYts()(query);
  return res.videos?.[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────

class DownloaderCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'info') return this._info(args.slice(1), sender, chatJid, sock, message);
    if (sub === 'yt')   return this._dlUrl('youtube', false, args.slice(1), sender, chatJid, sock, message);
    if (sub === 'yta')  return this._dlUrl('youtube', true,  args.slice(1), sender, chatJid, sock, message);
    if (sub === 'tt')   return this._dlUrl('tiktok',  false, args.slice(1), sender, chatJid, sock, message);
    if (sub === 'tw')   return this._dlUrl('twitter', false, args.slice(1), sender, chatJid, sock, message);
    if (sub.startsWith('http')) return this._dlUrl('auto', false, args, sender, chatJid, sock, message);

    await sock.sendMessage(chatJid, { text: [
      `📥 *DOWNLOADER*`, ``,
      `*.dl [url]*        — auto-detect & download`,
      `*.dl yt [url]*     — YouTube video`,
      `*.dl yta [url]*    — YouTube audio (MP3)`,
      `*.dl tt [url]*     — TikTok (no watermark)`,
      `*.dl tw [url]*     — Twitter/X video`,
      `*.dl info [url]*   — show info + thumbnail`, ``,
      `*.vid <search>*    — search & download YouTube video`,
      `*.aud <search>*    — search & download YouTube audio (MP3)`,
    ].join('\n') }, { quoted: message });
  }

  async vidSearch(args, sender, chatJid, sock, message) {
    return this._search(args, false, sender, chatJid, sock, message);
  }

  async audSearch(args, sender, chatJid, sock, message) {
    return this._search(args, true, sender, chatJid, sock, message);
  }

  // ── Search → info card → download ─────────────────────────────────────────
  async _search(args, isAudio, sender, chatJid, sock, message) {
    const query = args.join(' ').trim();
    if (!query) {
      await sock.sendMessage(chatJid, { text: `\`\`\`Usage: ${isAudio ? '.aud' : '.vid'} <search term>\`\`\`` }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatJid, { text: `\`\`\`🔍 Searching: ${query}...\`\`\`` }, { quoted: message });

    let video;
    try { video = await ytSearch(query); } catch {
      await sock.sendMessage(chatJid, { text: '```Search failed — try again```' }, { quoted: message }); return;
    }
    if (!video) {
      await sock.sendMessage(chatJid, { text: '```No results found```' }, { quoted: message }); return;
    }

    const dur      = video.duration?.timestamp || formatDuration(video.duration?.seconds);
    const thumbBuf = await fetchThumb(video.thumbnail);
    const caption  = [
      `${isAudio ? '🎵' : '🎬'} *${isAudio ? 'AUDIO' : 'VIDEO'} FOUND*`, ``,
      `🎬 *${video.title}*`,
      `👤 ${video.author?.name || 'Unknown'}`,
      `⏱️ ${dur} | 👁️ ${(video.views || 0).toLocaleString()} views`, ``,
      isAudio ? '```⏳ Downloading audio... Converting to MP3...```' : '```⏳ Downloading video...```',
    ].join('\n');

    if (thumbBuf?.length) {
      await sock.sendMessage(chatJid, { image: thumbBuf, caption }, { quoted: message });
    } else {
      await sock.sendMessage(chatJid, { text: caption }, { quoted: message });
    }

    await this._runDownload({ url: video.url, platform: 'youtube', isAudio, title: video.title, sender, chatJid, sock, message });
  }

  // ── .dl info ──────────────────────────────────────────────────────────────
  async _info(args, sender, chatJid, sock, message) {
    const url = args[0];
    if (!url?.startsWith('http')) {
      await sock.sendMessage(chatJid, { text: '```Usage: .dl info [url]```' }, { quoted: message }); return;
    }
    await sock.sendMessage(chatJid, { text: '```🔍 Fetching info...```' }, { quoted: message });
    try {
      const platform = detectPlatform(url);
      let title, thumbUrl, dur;

      if (platform === 'youtube') {
        const vid = await ytSearch(url);
        if (vid) { title = vid.title; thumbUrl = vid.thumbnail; dur = vid.duration?.timestamp; }
        else {
          const ytId = extractYtId(url);
          if (ytId) thumbUrl = `https://i.ytimg.com/vi/${ytId}/sddefault.jpg`;
        }
      }

      const thumbBuf = await fetchThumb(thumbUrl);
      const infoText = [
        `📋 *VIDEO INFO*`, ``,
        title ? `🎬 *${title}*` : `🔗 ${url}`,
        dur   ? `⏱️ ${dur}` : '',
        ``, `\`\`\`Download: .dl ${url}\`\`\``,
      ].filter(Boolean).join('\n');

      if (thumbBuf?.length) {
        await sock.sendMessage(chatJid, { image: thumbBuf, caption: infoText }, { quoted: message });
      } else {
        await sock.sendMessage(chatJid, { text: infoText }, { quoted: message });
      }
    } catch {
      await sock.sendMessage(chatJid, { text: '```Could not fetch info```' }, { quoted: message });
    }
  }

  // ── URL download entry ────────────────────────────────────────────────────
  async _dlUrl(type, isAudio, args, sender, chatJid, sock, message) {
    const url = args[0];
    if (!url?.startsWith('http')) {
      await sock.sendMessage(chatJid, { text: '```Provide a valid URL```' }, { quoted: message }); return;
    }
    const platform = type === 'auto' ? detectPlatform(url) : type;

    await sock.sendMessage(chatJid, {
      text: isAudio ? '```⏳ Downloading audio... Converting to MP3...```' : '```⏳ Downloading... may take up to 60s```'
    }, { quoted: message });

    await this._runDownload({ url, platform, isAudio, sender, chatJid, sock, message });
  }

  // ── Core download + send ──────────────────────────────────────────────────
  async _runDownload({ url, platform, isAudio, title, sender, chatJid, sock, message }) {
    try {
      let downloadUrl, finalTitle;

      if (platform === 'youtube') {
        if (isAudio) {
          const data = await youtubeAudioDownload(url, title);
          downloadUrl = data.download || data.dl || data.url;
          finalTitle  = data.title || title;
        } else {
          const data = await youtubeVideoDownload(url);
          downloadUrl = data.download || data.mp4 || data.url;
          finalTitle  = data.title || title;
        }
      } else if (platform === 'tiktok') {
        const data = await tiktokDownload(url);
        downloadUrl = data.download || data.url;
        finalTitle  = data.title || 'TikTok';
      } else if (platform === 'twitter') {
        const data = await twitterDownload(url);
        downloadUrl = data.download || data.url;
        finalTitle  = data.title || 'Twitter';
      } else {
        // Generic — try YouTube chain as last resort
        const data = await youtubeVideoDownload(url);
        downloadUrl = data.download;
        finalTitle  = data.title || title;
      }

      if (!downloadUrl) throw new Error('No download URL returned from API');

      // Fetch the file buffer
      const buf     = await fetchBuffer(downloadUrl);
      const maxSize = isAudio ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;

      if (buf.length > maxSize) {
        await sock.sendMessage(chatJid, {
          text: `\`\`\`File too large (${(buf.length/1024/1024).toFixed(1)}MB)\nMax: ${(maxSize/1024/1024).toFixed(0)}MB — try a shorter clip\`\`\``
        }, { quoted: message }); return;
      }

      if (isAudio) {
        await sock.sendMessage(chatJid, {
          audio: buf, mimetype: 'audio/mpeg', fileName: `${finalTitle || 'audio'}.mp3`, ptt: false,
        }, { quoted: message });
      } else {
        await sock.sendMessage(chatJid, {
          video: buf, mimetype: 'video/mp4',
          caption: finalTitle ? `🎬 *${finalTitle}*\n📥 SE Bot` : `📥 𝘿𝙊𝙒𝙉𝙇𝙊𝘼𝘿𝙀𝘿 𝘽𝙔 𝙎𝙀 𝘽𝙊𝙏`,
          fileName: `${finalTitle || 'video'}.mp4`,
        }, { quoted: message });
      }

    } catch (err) {
      console.error('[downloader]', err.message);
      const m = err.message || '';
      const errText =
        /no video|no media|does not contain/i.test(m) ? 'No video found in that URL.' :
        /unavailable|private|removed/i.test(m)        ? 'Video unavailable or private.' :
        /too large/i.test(m)                           ? m :
        /402|payment required/i.test(m)                ? 'Download service hit a paywall — try again, fallback sources will be used.' :
        /429|rate.?limit/i.test(m)                      ? 'Download service rate limited — try again in a minute.' :
        /EAI_AGAIN|ENOTFOUND|getaddrinfo/i.test(m)      ? 'Download services unreachable — check server network/DNS.' :
        /ECONNREFUSED|ECONNRESET|timeout|ETIMEDOUT/i.test(m) ? 'Download service unavailable — try again shortly.' :
                                                         `Download failed: ${m.slice(0, 120)}`;
      await sock.sendMessage(chatJid, { text: `\`\`\`${errText}\`\`\`` }, { quoted: message });
    }
  }
}

module.exports = DownloaderCommand;
module.exports.commands = {
  dl:       'execute',
  download: 'execute',
  vid:      'vidSearch',
  aud:      'audSearch',
};
