\# CLAUDE.md — XZILLA: 3D Scam Destroyer Development Guide



\## 1. Project Context \& Architecture

\- \*\*App Type:\*\* Telegram Mini App (TMA) \& Mobile Web Game.

\- \*\*Engine:\*\* Single-file architecture (`index.html`) using Three.js (r128).

\- \*\*Theme:\*\* Solana / $XZILLA crypto synthwave lane-dodger. Player (Xrider on a chopper) avoids scams (KOL, RUGGER, SNAKE, FUDSTER, HONEYPOT, FAKE DROP) and collects HODLER/RUG BOSS items in a procedural 3D cityscape.

\- \*\*Environment:\*\* Neon grid floor, extruded 3D crypto towers, ad-screens pulling from `ads.json`, and neon pylons.

\- \*\*State/Save:\*\* Persistent upgrades via `localStorage`, personal-best leaderboards using Telegram `@username`.



\## 2. Environment \& File Paths

\- \*\*Local Working Path:\*\* `C:\\Users\\KOU\\Desktop\\xzilla-game\\`

\- \*\*Core Production File:\*\* `index.html` (All gameplay logic resides here).

\- \*\*Assets Base URL:\*\* `https://raw.githubusercontent.com/Xzilla-memecoin/xzilla-game/main/images/`



\## 3. Git \& GitHub Desktop Integration Rules

Claude Code has full access to the local shell, Git environment, and configurations.

\- \*\*Local Synchronization:\*\* All file changes must be written directly to disk in this repository path so they immediately populate in the GitHub Desktop app interface.

\- \*\*Commit Format:\*\* Use strict conventional commit style (e.g., `fix(quests): correct glitch whale typo`).

\- \*\*Sync Routine:\*\* Before closing tasks, verify files are indexed:

```bash

&#x20; git status

&#x20; git add .

&#x20; git commit -m "chore: progress sync update"

