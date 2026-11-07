# GreatUniHack26 — Dragon Team

Independent Minecraft agents working towards defeating the Ender Dragon, even when their team communication fails.

**Current milestone: a starter house.** Each agent has a role and runs its own perceive → decide → act loop using deterministic rules (no LLM, no central controller):

| Agent | Role | What it does on its own |
| --- | --- | --- |
| Flint_Miner | Miner | Crafts its own pickaxe (chopping a tree if needed), upgrades to stone, mines stone, returns cobblestone to storage. |
| Moss_Lumberjack | Lumberjack | Fells nearby trees, delivers logs; once storage holds enough logs, delivers planks instead. Builds the storage chest if none exists. |
| Ember_Builder | Builder | Compares the house blueprint with the world, clears obstructions, places whatever it holds materials for, fetches the rest from storage, and switches to another part of the house when a material is missing. |
| Sage_Crafter | Crafter | Works out which components are still missing and crafts them from storage: door, glass panes (smelting sand), stairs, and planks from surplus logs. |
| Wren_Scout | Scout | Sweeps a square spiral around spawn and reports wood, stone, sand, coal, iron and water over team chat. |

All five agents start by default; set `TEAM_ROLES` (see `.env.example`) to run a subset, e.g. `TEAM_ROLES=miner,lumberjack,builder`. Nether progression, stronghold navigation and dragon combat are **not implemented yet**.

## Communication infrastructure

The standalone Node.js WebSocket relay is ready for simulated-agent testing. It supports unique agent IDs, the six standard message types, direct/broadcast delivery, selected-agent isolation, group partitions, link failures, bounded queues, acknowledgements, expiry, and reconnection. It keeps relay connectivity separate from reported Minecraft presence. Agent decisions remain local.

```sh
npm run comms:demo       # Three independent simulated processes, partition and heal
npm run comms:server     # Persistent relay on 127.0.0.1:8090
npm run comms:agent -- Ember  # Run each simulated agent in a separate terminal
npm run test:comms
```

See the **[message protocol and Minecraft integration guide](docs/communication-protocol.md)** for schemas, operator controls, delivery guarantees, and future dashboard endpoints. Queues are in memory; relay-process restart recovery requires agents to re-advertise their own facts. This initial implementation has no dashboard UI and does not replace the role agents' existing Minecraft chat transport.

## Start on this Mac

1. In Minecraft Launcher, choose **Java Edition → Installations → New installation → release 1.21.1**. Launch that installation. You need access to Minecraft Java Edition on your Microsoft account.
2. Double-click **Start Server.command**. On the first run, review the linked Minecraft EULA and type `yes` only if you accept. Wait for the server's `Done` message.
3. In Minecraft, choose **Multiplayer → Direct Connection**, enter **localhost:25565**, and join.
4. Double-click **Start Bots.command**. Watch the five agents join and introduce themselves.
5. Open Minecraft chat with **T** and send `!team start`.

To fly around as an observer, type `gamemode spectator YOUR_USERNAME` in the **server terminal** (without a slash). Return with `gamemode survival YOUR_USERNAME`. To shut down, type `quit` in the bots terminal, then `stop` in the server terminal.

## Chat controls

| Message | Effect |
| --- | --- |
| `!team help` | Show commands. |
| `!team start` | Each agent starts its own role loop. |
| `!team status` | Each agent reports role, task, inventory, deaths, and communication state. |
| `!team pause` | Stop work and movement. |
| `!team come` | Pause gathering and approach you, if you are nearby. |
| `!team comms off` | Block outgoing and incoming machine-readable team discoveries. |
| `!team comms on` | Resume communication and request/replay missed observations. |

The bots terminal also accepts `start`, `pause`, `status`, `comms off`, and `comms on`. These are operator controls, not shared gameplay decisions. Human operator commands remain available during a simulated outage.

Bots use readable messages such as `[TEAM 0123abcd] Wood at 12 65 -30`. Narration remains visible to spectators during the outage; agents only learn from `[TEAM ...]` messages, which are blocked before parsing. This simulates failure of the team message channel, **not** disconnection from the Minecraft world. Agents can still observe their own surroundings.

## Demo helpers

Run these in a second terminal while the server is running. They send console commands through `.server/console-inbox.txt`, which the server launcher forwards to the server console.

| Command | What it does |
| --- | --- |
| `npm run cmd -- <command>` | Send any server console command, e.g. `npm run cmd -- gamemode creative b_caul`. |
| `npm run stage` | A temporary surveyor bot finds flat open ground with trees near spawn and moves the world spawn there (storage and the house follow). It sets day, clear weather, peaceful difficulty, `keepInventory` and spawn radius 0. It teleports everyone over and dresses the bots: miner in an iron helmet, lumberjack in a red cap and shirt, builder in a yellow hard hat and orange hi-vis, crafter in a purple apron, scout in green. Name tags are coloured by role. `npm run stage -- x y z` uses your own coordinates. |
| `npm run boost` | Speed II, Haste II and Saturation for every bot. No items: they still gather and craft everything themselves. Effects are cleared on death, so re-run it then. |

Set `PLAYER_NAME` if your Minecraft username is not `b_caul`. True custom skins are not possible on this vanilla offline server, so the outfits are made from dyed armour instead.

## How the agents work

- Each agent is a separate Node process (`src/agent.js`) with its own memory file in `.state/`. Files are not shared between agents.
- The launcher (`src/team.js`) only starts and stops processes and passes on human commands. It never assigns tasks or shares world state.
- Every ~1.5 s an agent runs `perceive` (reads its own surroundings and inventory), then its role's pure `decide` function (`src/roles/*.js`), which returns one action. Shared skills in `src/skills.js` carry out that action. Pausing, dying or disconnecting cancels the action in progress.
- **Shared conventions, not shared state.** Every agent works out the same storage location (chests within 4 blocks of world spawn) and house origin (6 east, 2 north of spawn) from the server's spawn point. Override them with `STORAGE_POS` and `BUILD_ORIGIN`. Agents learn what is in storage only by opening the chests themselves.
- **Blueprint** (`src/blueprint.js`): drawn as one text grid per layer, so every block is listed explicitly and the result is always the same. **Progress** = required (non-air) blocks currently correct ÷ 83, shown in every builder message and in `!team status` as `[house 42%: 35/83 blocks]`. It is a 5×5 house with a cobblestone floor, log corner posts, plank walls and roof, a door, two glass-pane windows and a front step (25 cobblestone, 45 planks, 8 logs, 1 door, 2 glass panes, 1 stairs). The builder places the floor from the centre outward and the roof from the walls inward.
- **Enough is enough.** Each gatherer compares what the house still needs (including the door, stairs, glass and furnace the crafter must make) with what it last saw in storage plus what it carries (`src/plan.js`). Once nothing is short, the miner, lumberjack and scout stop gathering and **help the builder**: they place blocks they hold (working from the other end of the build order), drop off materials they can't place yet, and fetch only what they can place now. The crafter helps whenever it has nothing to craft. Because helpers can't see what the builder is carrying, they may slightly over-gather while the builder holds withdrawn materials.
- **Reaching the roof.** Blocks are placed without needing line of sight (the server only checks reach), and the builder may walk inside the house to place roof blocks from below. The door is always fitted from outside, so nobody is shut in. If a roof block still can't be reached, the builder digs two dirt, pillars up beside the wall, places every roof block now within reach, and digs the pillar away again. An interrupted pillar is remembered and removed first next time.
- **Independence.** No agent waits on another. Without a lumberjack, the miner chops its own wood for a pickaxe. Without a chest, whichever agent has the wood builds one. The builder keeps placing whatever it has and says which materials it is waiting for.
- **Communication.** Agents publish first sightings of resources (one per 16-block region) as `[TEAM id] Stone at x y z`. When an agent can't see a resource nearby, it travels to the nearest reported location. If it finds nothing there, it marks that spot exhausted in its own memory. Reports queue during a comms outage and replay when comms return.
- Death locations are remembered as danger areas, and targets near them are avoided. Failed targets are skipped for 30 seconds.
- The miner may dig through terrain to reach stone but never inside the storage area or the house site. The other agents don't dig while pathfinding.

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

`npm test` covers the communication channel (isolation, replay, deduplication, persistence) and every role's decision rules against simulated views. It also includes a blueprint simulation showing that repeatedly placing the builder's next cell completes the whole house. That test checks build order only, not reach or pathfinding.

**Not yet verified in-game:** the role system has not run against a live server. The earlier live test (7 November 2026, wood gathering and comms outage/replay) was done on the previous single-role bot. Things most likely to need tuning in a live run: pathfinding timeouts on rough terrain, reaching roof cells from outside the footprint, door/stairs facing (any facing is accepted), and chest placement on uneven ground near spawn. Agents do not eat yet, so long runs will eventually starve them. The observer connection earlier emitted one dependency `PartialReadError` while reading item-component data. Inventory-heavy work (chests, crafting, furnaces) may expose that protocol issue.
