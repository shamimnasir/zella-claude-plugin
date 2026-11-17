#!/usr/bin/env node
// Stdio MCP server for Zella. Forwards to the app's server on 127.0.0.1 and
// answers open_video itself: the sandboxed app can only read a file it was
// handed through the system's open path, so a path in a tool call is no use to it.
import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const PORT = 47821;
const TOKEN = process.env.ZELLA_MCP_TOKEN || '';
const APP = process.env.ZELLA_APP || 'Zella';
const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO_TYPES = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.zella']);
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const TURN_ON = 'Zella is not answering. Ask the person to open Zella, choose Claude in the Zella menu, and turn on Let Claude edit in Zella.';
const BAD_CODE = 'Zella refused the connection code. Ask the person to copy the code again from the Claude settings in Zella and update it here.';

const OPEN_VIDEO = {
  name: 'open_video',
  title: 'Open video',
  description: 'Open a video file from this Mac in Zella, replacing the video open now (its edits are saved first). Use a full path. Do this before editing.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Full path to a video file on this Mac' } },
    required: ['path'],
  },
  annotations: { title: 'Open video', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

let nextId = 1;
class AppError extends Error {}

// The connection code never leaves this process. Whatever is listening on the
// port gets a one-time proof that we know the code, good for two minutes, so a
// program that took the port while Zella was closed learns nothing it can reuse.
function proof() {
  const seconds = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('hex');
  const mac = createHmac('sha256', TOKEN).update(`v1|${seconds}|${nonce}`).digest('hex');
  return `ZellaProof v1.${seconds}.${nonce}.${mac}`;
}

function post(message) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(message));
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', agent: false,
      timeout: 70000,
      headers: {
        Host: `127.0.0.1:${PORT}`, 'Content-Type': 'application/json',
        Accept: 'application/json', 'Content-Length': body.length,
        Authorization: proof(),
      },
    }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(parts).toString();
        if (res.statusCode === 401) return reject(new AppError(BAD_CODE));
        if (res.statusCode !== 200) return reject(new AppError(`Zella answered ${res.statusCode}: ${raw}`));
        try { resolve(JSON.parse(raw)); } catch { reject(new AppError('Zella sent an answer I could not read.')); }
      });
    });
    req.on('timeout', () => req.destroy(new AppError('Zella took too long to answer.')));
    req.on('error', (e) => reject(e instanceof AppError ? e : new AppError(TURN_ON)));
    req.end(body);
  });
}

async function callApp(method, params) {
  const r = await post({ jsonrpc: '2.0', id: nextId++, method, params });
  if (r.error) throw new AppError(r.error.message);
  return r.result;
}

const snapshot = () => JSON.parse(readFileSync(join(HERE, 'tools-snapshot.json'), 'utf8'));

// Ready-made jobs, offered to Claude as MCP prompts (slash commands in clients
// that show them). Each one names real tools and ends by LOOKING at the result.
const CHECK = 'When the edit is done, call get_filmstrip and look at it. Fix anything that looks wrong before you report. Do not export unless the person asks; an export asks them in Zella first.';
const PROMPTS = [
  { name: 'make_it_viral', title: 'Make it viral',
    description: 'Turn the open video into a punchy vertical short: tight cuts, captions, zooms, music.',
    arguments: [{ name: 'platform', description: 'TikTok, Reels or Shorts (default TikTok)', required: false }],
    text: (a) => `Make the video open in Zella into a short for ${a.platform || 'TikTok'}. Call get_project_state first. Then: remove_silences and remove_filler_words (the person confirms these in Zella), add_captions and pick a bold style with apply_caption_preset (list_options with category caption_presets shows them), make_vertical and set_platform, apply_smart_zooms, add_music_loop with an energetic style such as Viral Bounce or Hype Trap, and apply_auto_sounds. ${CHECK}` },
  { name: 'clean_talking_head', title: 'Clean up a talking head',
    description: 'Cut the pauses and ums, clean the voice, add captions, keep it horizontal.',
    arguments: [],
    text: () => `Clean up the talking-head video open in Zella. Call get_project_state first. Then remove_silences, remove_filler_words, remove_noise, polish_voice, set_voice_loudness for the destination, add_captions with a calm style, and auto_enhance for the picture. ${CHECK}` },
  { name: 'tutorial_polish', title: 'Polish a screen tutorial',
    description: 'For screen recordings: cut dead air, zoom to the action, hide secrets, add captions and a quiet bed.',
    arguments: [],
    text: () => `Polish the screen-recording tutorial open in Zella. Call get_project_state first. Then remove_silences, blur_sensitive_text to hide keys, tokens and emails, auto_zoom_from_cursor (or apply_smart_zooms), add_captions, add_music_loop with Lo-Fi Chill or Corporate Clean, and add an add_intro_card if the person gives a title. ${CHECK}` },
  { name: 'hide_secrets', title: 'Hide secrets on screen',
    description: 'Find and blur API keys, tokens, passwords and emails across the whole video.',
    arguments: [{ name: 'what', description: 'Anything else to hide, in the person\'s words', required: false }],
    text: (a) => `Hide sensitive text in the video open in Zella. Call blur_sensitive_text${a.what ? ` with query "${a.what}"` : ''}. It reports each blur with its time; call get_frame at two or three of those times and check that nothing is readable. If something still shows, call blur_sensitive_text again over that part with a smaller interval, or add_callout with kind blur and an exact box.` },
  { name: 'review_edit', title: 'Review the edit',
    description: 'Look at the current edit and suggest the three changes that would help most.',
    arguments: [],
    text: () => 'Review the video open in Zella without changing it. Call get_project_state and get_filmstrip with count 9, then get_transcript if there are captions. Suggest the three changes that would help most, each with the Zella tool that does it. Ask before applying any of them.' },
];

async function listTools() {
  try {
    const live = await callApp('tools/list', {});
    // With no video open the app cannot describe each tool's inputs, so the
    // snapshot supplies them.
    if (live._meta?.['com.zellahq/tools']?.schemasAvailable) return { tools: [OPEN_VIDEO, ...live.tools] };
  } catch { /* Zella closed or switched off: the list still has to load. */ }
  return { tools: [OPEN_VIDEO, ...snapshot()] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openVideo(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return text('Give the full path to the video, starting with /.', true);
  let real;
  try {
    real = realpathSync(path);
    if (!statSync(real).isFile() && extname(real).toLowerCase() !== '.zella') return text('That path is not a file.', true);
  } catch { return text(`There is no file at ${path}.`, true); }
  if (!VIDEO_TYPES.has(extname(real).toLowerCase())) return text('Zella opens .mp4, .mov, .m4v, .avi, .mkv and .zella files.', true);

  const opened = await new Promise((resolve) => execFile('open', ['-a', APP, real], (e) => resolve(!e)));
  if (!opened) return text('macOS could not open Zella. Is it installed?', true);

  let last = TURN_ON;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const r = await callApp('tools/call', { name: 'current_video', arguments: {} });
      if (r.isError) return r;
      const v = JSON.parse(r.content[0].text);
      if (v.loaded && v.path && samePath(v.path, real)) {
        return text(`Opened ${real} (${Number(v.seconds).toFixed(1)} seconds). Call get_project_state next.`);
      }
      last = 'Zella did not finish opening the video in time. Ask the person to look at Zella.';
    } catch (e) { last = e.message; }
  }
  return text(last, true);
}

function samePath(a, b) {
  try { return realpathSync(a) === b; } catch { return a === b; }
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[1],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: 'zella', title: 'Zella', version: '0.2.0' },
        instructions: 'Zella edits the video open in the Zella app on this Mac. Call open_video first if needed, then get_project_state. After an edit, look at the result with get_frame or get_filmstrip before saying it is done. Every edit is one undo step (undo_last_action). Exports, large deletes and cleanup cuts ask the person in Zella, so tell them to look for the question. Long tools answer with a job_id: pass it to check_progress.',
      };
    }
    case 'ping': return {};
    case 'prompts/list':
      return { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) };
    case 'prompts/get': {
      const p = PROMPTS.find((x) => x.name === msg.params?.name);
      if (!p) { const err = new Error(`Zella has no prompt called ${msg.params?.name}.`); err.code = -32602; throw err; }
      return { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(msg.params?.arguments ?? {}) } }] };
    }
    case 'tools/list': return listTools();
    case 'tools/call': {
      const { name, arguments: args } = msg.params ?? {};
      if (name === 'open_video') return openVideo(args?.path);
      try { return await callApp('tools/call', { name, arguments: args ?? {} }); }
      catch (e) { return text(e.message, true); }
    }
    default: {
      const err = new Error(`Zella does not handle ${msg.method}.`);
      err.code = -32601;
      throw err;
    }
  }
}

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'That is not JSON.' } });
  }
  if (msg.id === undefined) return; // a notification
  try { send({ jsonrpc: '2.0', id: msg.id, result: await handle(msg) }); }
  catch (e) { send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message } }); }
});
