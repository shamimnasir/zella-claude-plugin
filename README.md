# Zella for Claude

Let Claude edit videos in the [Zella](https://zellahq.com) app on your Mac. Ask in plain words: "cut the pauses, add captions and export it". Zella does the work on your Mac, and Claude can look at the result before it tells you it is done.

Claude can cut pauses and filler words, write and style captions, clean up your voice, add music and sound effects, pick a look, zoom, blur keys and emails on screen, add titles, transitions and callouts, change speed, make a vertical version and export.

Claude can also **see** the edit: `get_frame` returns a picture of one moment and `get_filmstrip` a sheet of several, with every caption, look, zoom and blur in it.

## What you need

- **A Mac with Zella installed and open**, on **Zella Founder**. Zella itself is free to download from the Mac App Store; this plugin only works on the Founder plan, a one-time purchase inside the app. On any other plan, Zella answers every request with "Part of Zella Founder".
- **Claude Code**: in the Terminal, in an editor, or in the Code tab of the Claude desktop app.
- **Node.js 18 or newer.** Type `node -v` in Terminal to check.

It does not work on iPhone, in Claude chat, or in Cowork. Those cannot ask you for the connection code, so they skip this plugin's server.

## Set up

1. In Zella, open the Zella menu and choose **Claude…**.
2. Turn on **Let Claude edit in Zella** and click **Copy** to copy your connection code.
3. Install the plugin. In Claude Code, run these two commands:

   ```
   /plugin marketplace add shamimnasir/zella-claude-plugin
   /plugin install zella@zella
   ```

4. When Claude Code asks for your **Zella connection code**, paste it. Claude Code keeps it in your Mac's keychain.
5. Ask Claude something like "Open /Users/me/Movies/demo.mp4 and tell me how long it is." Drag a file from Finder into the window to get its full location.

## Ready-made jobs

Claude Code lists these as slash commands:

- **make_it_viral**: a vertical short with tight cuts, captions, zooms and an energetic music bed.
- **clean_talking_head**: cut pauses and ums, clean the voice, add captions.
- **tutorial_polish**: for screen recordings: cut dead air, zoom to the action, hide secrets, add captions and a quiet bed.
- **hide_secrets**: find and blur API keys, tokens, passwords and emails, then check the frames.
- **review_edit**: look at the edit and suggest three changes, without changing anything.

## What this plugin runs, sends and stores

Everything it does is in `server.mjs`, a single readable file with no dependencies beyond Node itself.

- **It runs** one local process, `node server.mjs`, which Claude Code starts and talks to over standard input and output.
- **It talks to** Zella only, at `127.0.0.1` port `47821` on your own Mac. It makes no other network connection and contacts no server on the internet.
- **Your connection code** never leaves the process. Each request carries a one-time proof made from the code (an HMAC with a timestamp and a random value, good for two minutes), so a program listening on that port cannot reuse it.
- **It runs one command**: `open -a Zella <file>`, when Claude asks to open a video, so that macOS hands that file to Zella. It first checks that the path is a real video file (.mp4, .mov, .m4v, .avi, .mkv or .zella).
- **It reads** `tools-snapshot.json` from its own folder, the list of Zella's tools, used when Zella is closed.
- **It stores** nothing. Zella keeps your edits in its own project files, as it always does.

## What stays private, and what does not

- **Your video file stays on your Mac.** The plugin and Zella never upload it.
- **Claude does read what it asks Zella for.** That includes the words spoken in your video (the transcript), project details and pictures of frames from the edit. Those go to Claude, and Anthropic handles them under Claude's own terms, not Zella's. If a video's words or pictures must stay on your Mac, do not use this plugin for it. Zella's own captions and Auto-Polish run entirely on your Mac without it.

## What still needs you

Zella shows a question before it exports, deletes most of a video, or cuts silences and filler words. Click **Allow** in Zella; no answer within 5 minutes means no. A small sign in the corner of your screen shows when Claude is connected or working, with a **Stop** button while it works. Nearly every edit can be undone with Undo in Zella.

## If it does not connect

- Zella must be open, with **Let Claude edit in Zella** turned on.
- If you clicked **Make a new code** in Zella, update the code in Claude Code: run `/plugin configure zella@zella` and paste the new code.
- Full guide: [zellahq.com/docs/claude-connector](https://zellahq.com/docs/claude-connector/). Help: [zellahq.com/support](https://zellahq.com/support/).

## License

MIT. See `LICENSE`.
