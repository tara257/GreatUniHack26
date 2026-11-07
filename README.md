# GreatUniHack26 — Dragon Team

Three independent Minecraft agents working towards defeating the Ender Dragon, even when their team communication fails.

**Current milestone:** Ember, Flint, and Moss join a local Java Edition server, talk in Minecraft chat, autonomously collect nearby wood, remember discoveries/death locations, and exchange missed discoveries after a communication outage. Crafting, Nether progression, stronghold navigation, and dragon combat are **not implemented yet**. Decisions currently use explicit rules; no LLM or n8n account is required.

## Start on this Mac

1. In Minecraft Launcher, choose **Java Edition → Installations → New installation → release 1.21.1**. Launch that installation. You need access to Minecraft Java Edition on your Microsoft account.
2. Double-click **Start Server.command**. On the first run, review the linked Minecraft EULA and type `yes` only if you accept. Wait for the server's `Done` message.
3. In Minecraft, choose **Multiplayer → Direct Connection**, enter **localhost:25565**, and join.
4. Double-click **Start Bots.command**. Watch Ember, Flint, and Moss join and introduce themselves.
5. Open Minecraft chat with **T** and send `!team start`.

To fly around as an observer, type `gamemode spectator YOUR_USERNAME` in the **server terminal** (without a slash). Return with `gamemode survival YOUR_USERNAME`. To shut down, type `quit` in the bots terminal, then `stop` in the server terminal.

## Chat controls

| Message | Effect |
| --- | --- |
| `!team help` | Show commands. |
| `!team start` | Each bot starts its own wood-gathering decision loop. |
| `!team status` | Each bot reports task, inventory, deaths, and communication state. |
| `!team pause` | Stop gathering and movement. |
| `!team come` | Pause gathering and approach you, if you are nearby. |
| `!team comms off` | Block outgoing and incoming machine-readable team discoveries. |
| `!team comms on` | Resume communication and request/replay missed observations. |

The bots terminal also accepts `start`, `pause`, `status`, `comms off`, and `comms on`. These are operator controls, not shared gameplay decisions. Human operator commands remain available during a simulated outage.

Bots use readable messages such as `[TEAM 0123abcd] Wood at 12 65 -30`. Narration remains visible to spectators during the outage; agents only learn from `[TEAM ...]` messages, which are blocked before parsing. This simulates failure of the team message channel, **not** disconnection from the Minecraft world. Agents can still observe their own surroundings.

## How the prototype works

- Each agent is a separate Node process with its own file in `.state/`. Files are not shared between bots.
- The launcher starts/stops processes and passes human controls; it never assigns tasks or shares world state.
- Each agent chooses nearby trees using its own observations and direction preference. Overlapping work is possible; task leasing is a future milestone.
- Death locations are remembered as danger areas. Agents avoid choosing wood targets near known deaths. This is a simple conservative rule, not an inferred cause of death or a trained model.
- Discoveries persist across process restarts. Reconnection requests a replay; duplicate messages are ignored. Memory is bounded to recent observations.
- Bots reconnect to the server after connection loss. Respawn retains local memory.
- The first milestone stops at eight logs per bot. It does not yet deposit items, craft tools, or proceed to the next stage.

## Local server and dependencies

Use Node.js 22+ and Java 21. On macOS with Homebrew:

```sh
brew install node@22 openjdk@21
export PATH="$(brew --prefix node@22)/bin:$PATH"
npm ci
npm run setup:server
npm test
npm run server
# In a second terminal:
npm run bots
```

The project uses Yarn's public npm registry mirror because the primary npm registry timed out on the development network. Package versions and integrity hashes are pinned in `package-lock.json`.

The setup downloads the official **1.21.1** server jar from Mojang's version manifest and verifies its SHA-1. It uses a separate world in `.server/`; existing single-player saves are untouched. `.server/`, `.state/`, and credentials are ignored by Git.

The development server binds to **127.0.0.1 only**. It uses offline bot identities so all three bots can join the local experiment without separate Microsoft logins. Do not expose this configuration to the internet or remove its loopback binding. A shared/public server needs a separate authentication and networking setup.

Optional settings are in `.env.example`. The included server is fixed to port 25565 and version 1.21.1; changes to bot settings must match the server.

## Build towards the Ender Dragon

1. **Connection and communication:** join, chat, independent gathering, outage/replay, local memory.
2. **Survival and teamwork:** food, tools, crafting, shared supplies, task claims and takeover after timeouts.
3. **Nether:** portal construction, navigation, blaze rods, and pearls.
4. **The End:** stronghold search, portal entry, crystal destruction, dragon combat and recovery.
5. **Evidence:** compare progress during outages, recovery time, repeated deaths, and task duplication across saved runs.

n8n can later process queued run logs and lessons. Live decisions must continue without n8n availability.

## Verification

`npm test` exercises communication isolation, replay after an outage, deduplication, and restart persistence using the actual message handler. In-game behaviour also needs a running Java server; test it with the steps above.

Live verification on 7 November 2026: all three bots joined the local 1.21.1 server and exchanged chat discoveries. Ember collected seven logs and Flint collected one during the initial run. During a simulated outage, all three kept their received knowledge unchanged while local discovery continued. A temporary observer sent `!team comms on` through Minecraft chat; all three restored communication and received previously missed facts.

Known prototype limitations: pathfinding can time out on difficult terrain and replan; gathering is not yet dependable enough for a full survival run. The observer connection also emitted one dependency `PartialReadError` while reading item-component data, although it stayed connected and completed the chat test. Protocol compatibility needs further investigation before adding complex inventories and dragon progression. Library errors remain visible in the bot terminal.
