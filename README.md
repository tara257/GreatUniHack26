# GreatUniHack26 — Autonomous Colony

Ember, Flint, and Moss are independent Minecraft agents with one shared goal: **build a house and stay alive, even when team communication fails**. You can watch them in Java Edition and read their decisions in chat.

They use explicit decision rules, not an LLM or a trained model. No API key or n8n subscription is needed.

## Communication infrastructure

The standalone Node.js WebSocket relay is ready for simulated-agent testing. It supports unique agent IDs, the six standard message types, direct/broadcast delivery, selected-agent isolation, group partitions, link failures, bounded queues, acknowledgements, expiry, and reconnection. It keeps relay connectivity separate from reported Minecraft presence. Agent decisions remain local.

```sh
npm run comms:demo       # Three independent simulated processes, partition and heal
npm run comms:server     # Persistent relay on 127.0.0.1:8090
npm run comms:agent -- Ember  # Run each simulated agent in a separate terminal
npm run test:comms
```

See the **[message protocol and Minecraft integration guide](docs/communication-protocol.md)** for schemas, operator controls, delivery guarantees, and future dashboard endpoints. Queues are in memory; relay-process restart recovery requires agents to re-advertise their own facts. This initial implementation has no dashboard UI and does not replace the running Minecraft bots' existing chat transport.

## Start on this Mac

1. Launch **Minecraft Java Edition 1.21.1**.
2. Double-click **Start Server.command**. On first use, review and accept the Minecraft EULA if you agree to it. Wait for `Done`.
3. Join **Multiplayer → Direct Connection → localhost:25565**.
4. Double-click **Start Bots.command**.
5. Set a house site if one is not already configured: `!team home X Y Z`. The coordinates are the corner of the floor, **one block above flat ground**, with a clear 5×5 area extending in positive X and Z. Allow four blocks of height above the ground. The entrance faces negative Z.
6. Send `!team start` in Minecraft chat (press **T**).

The house site is initial mission configuration given to every agent. Each agent then observes progress and makes decisions independently. On the original development world, `.env` sets the surveyed corner to **190, 72, 118**. Other generated worlds need their own site. The agreed corner is saved in each bot's memory. `HOUSE_ORIGIN` in `.env`, if set, overrides that saved corner on restart.

To watch, type `gamemode spectator YOUR_USERNAME` in the **server terminal** (without a slash). Fly with WASD, Space up, and Shift down. `teleport YOUR_USERNAME 192 80 111 0 45` gives a view of the development site's house. Return to survival with `gamemode survival YOUR_USERNAME`.

## What the agents do

- Gather logs and craft planks using ordinary survival inventories.
- Build a 5×5 house: floor, workbench, two-block-high walls, roof, wooden door, furnace, and interior torch. They gather dirt for exterior scaffolding, mine stone with a crafted pickaxe, and can make charcoal for lighting. Temporary dirt pillars can remain outside the finished house.
- Divide planned blocks between themselves. Bots inspect the world before placing a block. After 20 seconds without their own available work, or without observed progress, they can take over another agent's unfinished work.
- Send temporary work claims and resource discoveries through Minecraft chat. Claims expire after 30 seconds; they are hints, not a distributed lock. Duplicate work can occur during outages and is resolved by inspecting the actual blocks.
- Prioritize nearby threats and hunger over building. They flee hostile mobs, can strike nearby attackers while retreating, hunt nearby passive animals, collect food, and eat safe food. Once the house is ready they return to it, close the door, maintain food reserves, and repair missing planned blocks.
- Remember deaths, briefly avoid reported danger areas, respawn, and replan. These are saved observations, **not neural-network training**.
- Save failed routes across restarts, retry persistent failures less often, and prefer alternative waypoints. Blocked routes and deaths can be shared through chat; their effects expire instead of permanently blacklisting an area.
- Return to a completed shelter at night, interrupt expeditions at dusk, and use separate resting spots. Low-health bots with enough hunger to regenerate recover before collecting extra food. They leave the doorway clear and avoid closing it on a teammate.

This is a survival prototype, not a promise of indefinite survival. It has no farming, armour progression, beds, sophisticated combat, or general-purpose architectural planning. It needs an accessible, flat site and nearby resources. Difficult terrain, scarce food, collisions, and mobs can still interrupt progress.

## Chat controls

| Message | Effect |
| --- | --- |
| `!team start` | Begin/resume building and survival decisions. |
| `!team status` | Report current task, observed house progress, health, hunger, resources, deaths, and communication state. |
| `!team stats` | Show recorded navigation successes/failures, avoided retries, and deaths since experience tracking began. |
| `!team pause` | Stop autonomous work and movement. |
| `!team home X Y Z` | Set the common floor corner; existing blocks are preserved. |
| `!team come` | Pause and approach you if you are nearby. |
| `!team comms off` | Block incoming/outgoing structured team messages. |
| `!team comms on` | Restore communication and replay recent discoveries. |
| `!team help` | Show commands. |

The bots terminal accepts the same controls without `!team`, except `come` needs a player in Minecraft chat. Type `quit` in the bots terminal to stop them; type `stop` in the server terminal to save and stop the world.

## Communication-failure demo

1. Start the team and watch construction progress with `!team status`.
2. Send `!team comms off`. Each bot keeps its own saved plan, inventory, observations, and decision loop. Narration remains visible to humans, but bots cannot learn facts or claims from it.
3. Watch them continue gathering, building, or handling threats based on their own situation. The world is still visible, so an agent can see blocks another agent has placed.
4. Send `!team comms on`. Recent discoveries replay and duplicate messages are ignored. Expired claims are not resurrected.

This simulates failure of the **team message channel**, not disconnection from Minecraft. Operator controls remain available during the outage. Every bot runs in a separate Node process and reads only its own memory file. The launcher passes operator commands but does not assign live jobs or share inventories, observations, or decisions.

## Local setup

Use Node.js 22+ and Java 21. With Homebrew:

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

The project uses Yarn's public npm registry mirror because the primary registry timed out on the development network. Dependencies and integrity hashes are pinned in `package-lock.json`.

Setup downloads the official **1.21.1** server jar from Mojang and verifies its SHA-1. The existing development world keeps its original directory name, `.server/dragon-team`, so changing the mission does not reset the world. `.server/`, `.state/`, `.env`, and credentials are ignored by Git.

The development server binds to **127.0.0.1 only** and uses offline bot identities. Do not expose this configuration to the internet. Shared/public hosting requires a separate authentication and networking setup.

Optional settings are described in `.env.example`. Bot port/version must match the server. n8n could later collect demonstration results; the live agents must continue independently of it.

## Learning and measuring progress

Run `npm run report` for local snapshots of health, food, house progress, navigation outcomes, and recent deaths. This reporter is for people; agents still read only their own state files. Snapshot ages are displayed because an agent can be busy in a longer action.

Each bot keeps bounded route records, temporary danger observations, and its latest 128 decision/navigation events in its own `.state/NAME.json`. A failed route gets a 15-second cooldown, increasing to at most three minutes on repeated failure. A later success clears it. Operator pauses and threat interruptions do not teach false failures; genuine navigation timeouts do. Shared failure reports retain their original time, and an older replay cannot override a newer local success.

This is experience-based adaptation of hand-written skills, not a trained neural network. See [the learning plan](docs/learning.md) for how to evaluate improvements and when model training would make sense.

## Verification

`npm test` checks the shelter enclosure and roof supports, separate task selection, takeover after a stall, damage repair, survival priorities, communication isolation, replay/deduplication, expiring claims, and restart persistence. Live gameplay still needs the Java server.

Experience regressions also check increasing retry delays, newer-success precedence over replay, decaying death lessons, memory bounds, nightfall interrupts, doorway yielding, timeout learning, and avoiding false lessons from operator pauses. The improved controller was smoke-tested in the existing completed house: Ember and Flint reached separate resting spots, and Moss successfully left the doorway to forage. This is functional verification, not a measured survival-rate comparison.

Live verification on 7 November 2026: the agents completed all **84 planned placements** at the development site, including the door, furnace, and torch. They gathered/crafted construction resources, hunted and ate, and switched to food gathering and maintenance afterwards. Two bots were moved back from the previous mission's distant locations for the initial setup; no construction materials were spawned. During a communication outage, all three agents' received knowledge stayed unchanged while Ember placed two additional blocks. Restoring communication recovered missed facts. Survival remains imperfect: Moss died and resumed from saved memory during the run.

Known dependency issue: the 1.21.1 protocol stack emits a `PartialReadError` when joining this world. Observed connections continue and inventory crafting/placement work, but the error remains visible and protocol compatibility needs further investigation. Pathfinding is bounded and retries other jobs after failures; that does not guarantee every terrain obstacle is solvable.
