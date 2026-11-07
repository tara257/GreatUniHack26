# Autonomous Colony · GreatUniHack26

Five independent Minecraft agents cooperate to build a house, even when their communication links fail.

**Current milestone: a starter house.** Each agent has a role and runs its own perceive → decide → act loop using deterministic rules (no LLM, no central controller):

| Agent | Role | What it does on its own |
| --- | --- | --- |
| Flint_Miner | Miner | Crafts its own pickaxe (chopping a tree if needed), upgrades to stone, mines stone, returns cobblestone to storage. |
| Moss_Lumberjack | Lumberjack | Fells nearby trees, delivers logs; once storage holds enough logs, delivers planks instead. Builds the storage chest if none exists. |
| Ember_Builder | Builder | Compares the house blueprint with the world, clears obstructions, places whatever it holds materials for, fetches the rest from storage, and switches to another part of the house when a material is missing. |
| Sage_Crafter | Crafter | Works out which components are still missing and crafts them from storage: door, glass panes (smelting sand), stairs, and planks from surplus logs. |
| Wren_Scout | Scout | Sweeps a square spiral around spawn and reports wood, stone, sand, coal, iron and water over WebSockets. |

On the first launch all five roles are selected. In the dashboard, tick the roles you want and click **Apply roster**, then **Start work**. Added roles join and start automatically; removed roles leave Minecraft with their memory saved. The choice is remembered for the next launch. Explicit `TEAM_ROLES` (see `.env.example`) overrides the saved selection, e.g. `TEAM_ROLES=miner,lumberjack,builder`. The shared goal is the 83-block starter house.

## Live dashboard

From the project folder, install packages and start the dashboard/relay:

```sh
npm ci
npm run dashboard
```

Open **[Autonomous Colony](http://127.0.0.1:8090/)**. In two other terminals, run `npm run server` and `npm run bots` (reuse existing processes if already running). Join Java Edition **1.21.1**, server **localhost:25565**, and type `!team start` in chat. The dashboard is served by the relay on port 8090; there is no separate React development server to start.

If the relay is already running, `npm run build:dashboard` rebuilds the UI; refresh the browser. Restart the relay after backend changes, and the bots after agent changes. `npm run dashboard` builds the UI and then starts the relay, so do not launch a second copy on the same port.

- **Choose who joins Minecraft** controls the independent local bot launcher. Applying a roster joins/removes bots; **Isolate** only blocks their peer messages. **Start work / Pause work** are explicit human controls.
- **Progress while links are blocked** records confirmed gathering, crafting, deposits, placements and new resource sightings from affected agents. **Start outage demo → Restore & save result → Present evidence** provides a recording-friendly result; **Download evidence** exports JSON. Nothing is backfilled or invented.
- Five cards show separately reported Minecraft presence, relay/link status, task, inventory and observation age. Unknown or old observations are labelled, not filled with example data.
- The graph shows real pairwise reachability. Amber dashed links are deliberately blocked; gray links have unavailable or unknown transport. Moving dots correspond to recorded send attempts.
- House progress and the blueprint come from the builder's actual block survey. Unloaded blocks are marked unobserved. Resources sum fresh carried inventories only, excluding shared chests.
- **Isolate** blocks one agent's peer links in both directions. **Create partition** assigns each agent to A/B/C. Restoring one isolation preserves other fault layers; **Restore network** clears all layers.
- **Reset simulation** starts a new communication run: counters, recent events and faults reset. Minecraft world, inventories, agent memory, reports and accepted queued messages remain intact. It does **not** create a fresh world.
- Event filters, pause/resume, inventory expansion, resource search, network highlighting and full-screen presentation mode are available. The view keeps up to 2,000 events per run; it displays the latest 100 matching its filter. Reloading starts with the relay's latest 200 events.

The browser connects to `/observe` with its native WebSocket API. Local same-origin sessions authenticate automatically; remote sessions can enter an operator token through connection settings. The token is kept in browser memory, never bundled into JavaScript or stored in URLs/local storage. See [dashboard and recording notes](docs/dashboard.md) for details.

## Communication infrastructure

The Node.js WebSocket relay supports both the five real role bots and independent simulated agents. It supports unique agent IDs, the six standard message types, direct/broadcast delivery, selected-agent isolation, group partitions, link failures, bounded queues, acknowledgements, expiry, and reconnection. It keeps relay connectivity separate from reported Minecraft presence. Agent decisions remain local.

```sh
npm run comms:demo       # Five independent simulated processes, three partitions, then heal
npm run comms:server     # Persistent relay on 127.0.0.1:8090
npm run comms:agent -- Ember  # Run each simulated agent in a separate terminal
npm run test:comms
```

See the **[message protocol and Minecraft integration guide](docs/communication-protocol.md)** for schemas, operator controls, delivery guarantees, and dashboard endpoints. The role bots use WebSockets by default. Their human-readable narration remains in Minecraft chat, but they do not learn structured peer data from chat in this mode. Queues are in memory; adapters re-advertise their own facts after reconnection. The React dashboard uses the same live relay.

The extended failure simulator tracks which links can actually exchange messages, supports layered isolation/partitions and a manual `heal`, and logs failures, restoration, send attempts, and acknowledgements. State messages carry source-owned versions; both the relay and client prevent older versions from overwriting newer observations. Clients re-advertise their own latest published state after reconnects, topology changes, or a new peer joining. No server assigns agent actions.

For manual testing, start the relay and simulated agents, then use a separate **operator terminal**:

```sh
npm run comms:control -- status
npm run comms:control -- isolate Wren_Scout
npm run comms:control -- restore Wren_Scout
npm run comms:control -- partition Flint_Miner,Moss_Lumberjack Ember_Builder,Sage_Crafter Wren_Scout
npm run comms:control -- heal
```

All named agents must have registered first. Start real Minecraft agents with `npm run bots`, or simulated ones with `npm run comms:agent -- NAME` in separate terminals. These controls affect peer links without closing Minecraft connections. The local server saves its operator credential in the ignored `.state/comms-operator-8090.token` file (owner access only); the CLI reads it automatically. For a remote relay, supply `COMMS_HTTP_URL` and `COMMS_OPERATOR_TOKEN` only in the operator terminal. The relay prints timestamped JSON events; the status command shows readable agent/link tables. Restart an already running relay to load code changes; a restart clears its in-memory queues and reports. The CLI persists fault settings in `.state/comms-network-PORT.json` and applies them before agents reconnect.

## Updating a teammate's checkout

The old bots have been replaced by the five role bots above. Before working on an existing checkout, save local changes and run:

```sh
git pull --ff-only
npm ci
```

`npm ci` installs the versions in the lockfile. Start the dashboard and relay with `npm run dashboard`, then `npm run bots` starts the five role bots using it. Stop an old bot process before starting the replacement team; pulling files does not update an already running process. Gameplay continues if the relay is unavailable; peer communication resumes when it returns.

## Start on this Mac

1. In Minecraft Launcher, choose **Java Edition → Installations → New installation → release 1.21.1**. Launch that installation. You need access to Minecraft Java Edition on your Microsoft account.
2. Double-click **Start Server.command**. On the first run, review the linked Minecraft EULA and type `yes` only if you accept. Wait for the server's `Done` message.
3. In Minecraft, choose **Multiplayer → Direct Connection**, enter **localhost:25565**, and join.
4. In another terminal in the project folder, run **`npm run dashboard`** and open **http://127.0.0.1:8090/**. Leave it running. If one is already running, reuse it; restart it once after updating its code.
5. Double-click **Start Bots.command**. Watch the five agents join and introduce themselves.
6. Open Minecraft chat with **T** and send `!team start`.

To demonstrate a failure while watching Minecraft, run `npm run comms:control -- isolate Moss_Lumberjack` in another terminal. Moss continues its own role, but it cannot exchange new peer information. Run `npm run comms:control -- restore Moss_Lumberjack` to restore that link. `npm run comms:control -- status` shows which links can communicate. If a partition or pairwise fault also applies, use `heal` to clear all fault layers.

To fly around as an observer, type `gamemode spectator YOUR_USERNAME` in the **server terminal** (without a slash). Return with `gamemode survival YOUR_USERNAME`. To shut down, type `quit` in the bots terminal, then `stop` in the server terminal.

## Chat controls

| Message | Effect |
| --- | --- |
| `!team help` | Show commands. |
| `!team start` | Each agent starts its own role loop. |
| `!team status` | Each agent reports role, task, inventory, deaths, and communication state. |
| `!team pause` | Stop work and movement. |
| `!team come` | Pause gathering and approach you, if you are nearby. |
| `!team comms off` | Close each bot's relay adapter locally, leaving Minecraft and its role loop running. |
| `!team comms on` | Reconnect the relay adapters and exchange current observations. |

The bots terminal also accepts `start`, `pause`, `status`, `comms off`, `comms on`, and `roles miner,builder` (a comma-separated selection). These are operator controls, not shared gameplay decisions. Human operator commands remain available during a simulated outage.

Bots publish real health, hunger, position, task, inventory, and their own discoveries over WebSockets. Received discoveries feed the existing local role memory; reported inventories do not magically reveal shared chest contents or assign work. Administrator isolation leaves both Minecraft and relay sockets connected while preventing peer delivery. The local `!team comms off` command instead closes the relay socket, so its status correctly differs from a policy-blocked link. In both cases, agents can still observe their own surroundings and perform local work.

Set `COMMS_TRANSPORT=chat` explicitly to use the old `[TEAM ...]` chat transport. There is no automatic fallback to chat when WebSocket communication fails; that would bypass a partition. Use WebSocket mode for relay failure demonstrations. Each real agent atomically saves its incremented source epoch and received version watermarks in its own state file, protecting state ordering across process restarts.

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
- **Communication.** Agents publish first sightings of resources (one per 16-block region) as versioned WebSocket observations. Minecraft chat narrates their actions for spectators. When an agent can't see a resource nearby, it travels to the nearest reported location. If it finds nothing there, it marks that spot exhausted in its own memory. Reports queue during a comms outage and replay when comms return.
- Death locations are remembered as danger areas, and targets near them are avoided. Failed targets are skipped for 30 seconds.
- Every role may clear terrain to escape blocked routes; house, storage and utility blocks remain protected. Unreachable targets and escaped animals get a cooldown, and failed exploration changes direction.
- **Local fallback:** after a persistent shortage, an otherwise idle agent can gather wood, mine stone or make components. It checks its own blueprint and chest observations; it does not receive a central replacement assignment or read the selected roster. Different roles wait different amounts of time (15–75 seconds) to reduce duplication. Progress resets the timer. Isolation alone does not trigger takeover: a still-working miner may already be supplying the shared chest.
- **Basic survival:** agents eat carried food, hunt visible passive animals when hungry, and search when critically hungry instead of resting forever. They avoid sprinting when hungry or injured. This is not a complete combat, farming or survival system.
- Minecraft 1.21.1 inventory clicks use full server acknowledgements so unchanged crafting-result slots cannot stall a recipe. Wood crafting chooses compatible planks, and sand trips persist until a useful load is collected.

## Local server and dependencies

Use Node.js 22.12+ and Java 21. On macOS with Homebrew:

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

The development server binds to **127.0.0.1 only**. It uses offline bot identities so all five bots can join the local experiment without separate Microsoft logins. Do not expose this configuration to the internet or remove its loopback binding. A shared/public server needs a separate authentication and networking setup.

Optional settings are in `.env.example`. The included server is fixed to port 25565 and version 1.21.1; changes to bot settings must match the server.

## Verification

`npm test` covers the communication channel (isolation, replay, deduplication, persistence) and every role's decision rules against simulated views. It also includes a blueprint simulation showing that repeatedly placing the builder's next cell completes the whole house. That test checks build order only, not reach or pathfinding.

Live checks with all five Minecraft role bots verified isolation, three-way partitions, restoration and fresh state exchange while their Minecraft connections stayed open. Browser checks exercised roster removal/rejoin, work start/pause, outage capture, JSON download and evidence presentation; responsive layouts were checked at desktop and phone widths. In a measured 68-second outage, the fully isolated miner reported one resource block broken, one crafted item and two new resource sightings. The frozen result correctly showed no house increase in that interval (81/83 before and after). This is agent-reported evidence, not a claim that every seed completes: pathfinding, furnace work and terrain can still need tuning. Basic eating and hunting are implemented; hostile mobs, difficult terrain and long unattended runs remain limitations. A dependency occasionally emits `PartialReadError` while reading Minecraft item-component data; the observed bots continued connecting and reporting despite it.
