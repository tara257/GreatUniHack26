# Dashboard and recording

Use Node.js 22.12+ and Java 21. Run `npm ci`, then `npm run dashboard` in the project folder. This builds React and starts the existing relay at http://127.0.0.1:8090/. If the relay is already running, build with `npm run build:dashboard` and refresh instead of starting a second server. Backend changes require a relay restart.

Start Minecraft with `npm run server`, then the independent agents with `npm run bots`, each in its own terminal. Join Minecraft Java 1.21.1 at `localhost:25565`. New agents wait for `!team start` in Minecraft chat. The dashboard is a monitoring and fault-injection surface; it never selects gameplay tasks.

## Recording a run

1. Join the world before starting the bots' work. In Minecraft chat use `/gamemode spectator` if you have permission. Otherwise, from a project terminal, use `npm run cmd -- gamemode spectator YOUR_USERNAME`. Space flies up, Shift flies down; scrolling changes spectator speed.
2. Choose a fixed view that includes the building site and storage. The house starts six blocks east and two north of world spawn. A stationary camera makes construction easier to follow when sped up.
3. Begin your screen recording, then send `!team start`. Hide the Minecraft HUD with F1 (Fn+F1 on some Macs) after sending the command if you want a clean view. Agents' work and the house progress should be recorded as they actually happen.
4. Capture a separate dashboard segment: isolate an agent or partition the group, show that Minecraft stays connected, then restore communication and show state exchange. Explain whether the displayed segment is real time or sped up.
5. Use `!team pause` to stop their actions. This is not a world pause: weather, time and mobs can still change. The roles currently lack a complete eating/survival loop, so long unattended survival recordings may stall.

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
