# Dashboard and recording

Use Node.js 22.12+ and Java 21. Run `npm ci`, then `npm run dashboard` in the project folder. This builds React and starts the existing relay at http://127.0.0.1:8090/. If the relay is already running, build with `npm run build:dashboard` and refresh instead of starting a second server. Backend changes require a relay restart.

Start Minecraft with `npm run server`, then the independent agents with `npm run bots`, each in its own terminal. Join Minecraft Java 1.21.1 at `localhost:25565`. New agents wait for `!team start` in Minecraft chat. The dashboard also lets the human operator select roles and start/pause them; it never selects gameplay tasks.

## Recording a run

1. Join the world before starting the bots' work. In Minecraft chat use `/gamemode spectator` if you have permission. Otherwise, from a project terminal, use `npm run cmd -- gamemode spectator YOUR_USERNAME`. Space flies up, Shift flies down; scrolling changes spectator speed.
2. Choose a fixed view that includes the building site and storage. The house starts six blocks east and two north of world spawn. A stationary camera makes construction easier to follow when sped up.
3. Begin your screen recording, then send `!team start`. Hide the Minecraft HUD with F1 (Fn+F1 on some Macs) after sending the command if you want a clean view. Agents' work and the house progress should be recorded as they actually happen.
4. Capture a separate dashboard segment: isolate an agent or partition the group, show that Minecraft stays connected, then restore communication and show state exchange. Explain whether the displayed segment is real time or sped up.
5. Use `!team pause` to stop their actions. This is not a world pause: weather, time and mobs can still change. Basic eating and passive-animal hunting are available, but long unattended survival recordings can still stall on terrain or hostile mobs.

**Reset simulation on the dashboard only resets the communication run.** It clears faults, counters and recent log history while retaining Minecraft progress and queued messages. It cannot erase or regenerate the Minecraft world.

## Starting a genuinely new world

Stop the bot team (`quit`), stop Minecraft cleanly (`stop` in the server terminal), and stop the relay (Ctrl+C) before moving any saved files. Wait for world saving and process exit. Keep a dated backup of:

- The world directory selected by `level-name` in `.server/server.properties` (default `.server/dragon-team`). It contains inventories, positions and built blocks.
- Each of the five `<agent ID>.json` memory files in `BOT_STATE_DIR` (default `.state`). These include private knowledge, progress and version watermarks.
- `.state/comms-network-8090.json` if you want to save the previous failure configuration.

Move the world and the five agent memories into that backup, and move the saved network policy too if the new run should start with all links available. Leave the EULA acceptance, verified server jar and private operator credential files in place. Restart all three services. Restarting the relay with the fresh agent memories avoids old source-version state being mixed with the new run. A blank `level-seed` generates a new seed; a fixed seed generates fresh terrain from that same seed.

Newly generated terrain may need an open site selected. The `stage` helper can search for one, but also equips bots and changes difficulty/rules for a presentation; see its documented effects before using it for a survival comparison. A strict fresh run should start with empty inventories and record any operator changes to spawn, weather or game rules.

Backups and worlds stay under ignored local directories. Never commit `.state`, `.server` or operator tokens.

## Reading the dashboard

Minecraft presence is an agent report, independent of its relay socket and peer-link policy. Reports older than 15 seconds are stale. An observer connection outage makes live peer reachability unverified and disables controls. It does not stop the bots. House blocks and inventories come from actual agent observations, with no sample values substituted for missing data.

The relay keeps 200 recent events. An open dashboard accumulates up to 2,000 events for its current run and displays the latest 100 matching the selected filter. Pause freezes the log view only; agents and message delivery continue. Capture relay stdout for a complete event history.

## Choosing the team

In **Choose who joins Minecraft**, tick Miner, Lumberjack, Builder, Crafter and/or Scout, then click **Apply roster**. Unchanged agents keep running. New roles join and start their local loops; removed roles save memory and disconnect from Minecraft. You can remove all roles while keeping the launcher running. **Start work / Pause work** applies to the selected processes. Checkboxes are membership controls; **Isolate** is a different experiment and keeps the bot in Minecraft.

Run `npm run bots` once to make these controls available. Selection persists in ignored `.state/team-selection.json`; an explicit `TEAM_ROLES` environment value overrides it at the next launcher start. The local relay passes authenticated lifecycle requests through a private Unix socket (a named pipe on Windows). Gameplay does not require that control connection or the relay. Remote relay deployments do not expose this local launcher feature.

## Showing progress during an outage

1. Start the bots while there is useful work left. Choose a working role in the **Progress while links are blocked** panel and click **Start outage demo**. The usual isolation and partition controls also start evidence windows automatically.
2. Show the agent's Minecraft status and the blocked links. Wait for confirmed outcomes to appear. Travelling, waiting and failed actions do not count. A zero remains zero if the bots make no measured progress.
3. Click **Restore & save result**. This restores all fault layers and freezes the measurements. Click **Present evidence** for a large, uncluttered view suitable for your recording; **Download evidence** keeps the result as JSON.
4. Explain the scope: peer messaging was interrupted, while Minecraft, local observations and shared chests remained available. Partially connected agents and fully isolated agents are labelled separately. House before/after is colony-wide context, separate from the affected-agent counters.

The relay keeps the latest eight windows in memory until restart or **Reset simulation**. A topology change closes one window and starts another. Download before restarting if you want a durable record. Counts begin only when the bot receives that window's opaque marker; actions spanning a window change, stale reports and reports arriving after restoration are excluded. This deliberately undercounts uncertain work. With the entire relay offline, live evidence is unavailable; do not claim this panel measures that interval. These are instrumented bot reports, not an independent Minecraft-server audit. A completed house naturally leaves less useful work to demonstrate.
