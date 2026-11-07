# Autonomous Colony communication protocol — v1

This is an optional communication service for independent Minecraft agents. It relays observations, requests, and completion reports. It does not choose actions, assign tasks, transfer Minecraft items, elect a leader, resolve conflicting beliefs, or operate Minecraft connections.

The implementation includes a Node.js/`ws` relay, a Node.js agent adapter, independent simulated agents, automated tests, and a React dashboard served at `/`, and authenticated operator endpoints. The five Minecraft role bots now use `MinecraftChannel` by default to publish observations and learn discoveries through this relay. The old chat transport requires explicit `COMMS_TRANSPORT=chat`; WebSocket failure never triggers a chat fallback.

## Run and test

Use the repository's Node.js 22.12+ environment:

```sh
npm ci
npm run test:comms
npm run comms:demo
```

The demo starts an ephemeral relay and five separate agent processes (`Flint_Miner`, `Moss_Lumberjack`, `Ember_Builder`, `Sage_Crafter`, `Wren_Scout`). It separates them into three groups (2/2/1), verifies local work and within-group exchange while cross-group beliefs stay unchanged, layers individual isolation, and manually heals all links. Every agent must then receive at least the peers' versions recorded at the recovery checkpoint. The demo cleans up its processes. Its Minecraft connections are explicitly simulated; it does not connect to the live Minecraft server. This same scenario runs in `npm run test:comms`.

For a persistent local relay:

```sh
npm run comms:server
# Separate terminals, one independent process each:
npm run comms:agent -- Ember
npm run comms:agent -- Flint
npm run comms:agent -- Moss
```

Defaults: `COMMS_HOST=127.0.0.1`, `COMMS_PORT=8090`, agent `COMMS_URL=ws://127.0.0.1:8090/agents`. The relay prints a generated operator token, which changes on restart. A loopback server also saves it to the ignored `.state/comms-operator-PORT.token` file with owner-only permissions; the operator CLI uses it automatically for that local port. `COMMS_OPERATOR_TOKEN` can instead be supplied **only to the server/operator process**. Never pass it to gameplay agents. The team launcher removes it from agent environments and does not reload `.env` in child processes. `COMMS_AGENT_TOKEN` is an optional, separate shared admission credential for Node agents. A non-loopback bind requires explicit agent and operator credentials. Remote deployments additionally need TLS (`wss`/HTTPS), typically through a reverse proxy.

Agent IDs are unique among live connections. The shared agent credential admits trusted project agents; it is not a separate cryptographic identity credential for each ID. A duplicate live ID is rejected; a disconnected ID can reconnect and reclaim its pending queue. Registry state is retained until the relay restarts.

## Three distinct states

| State | Meaning | What it does **not** prove |
| --- | --- | --- |
| WebSocket connection | The agent currently has a registered relay socket. | That it is connected to Minecraft, making decisions, or reachable through every peer link. |
| Communication policy | Isolation, partition groups, and pairwise disabled links determine which peer messages may pass. | That the Minecraft connection or even the WebSocket has closed. |
| Minecraft report | The last explicit `STATUS_UPDATE.payload.minecraft.connected` value, with its observation/receipt times and staleness. | Current Minecraft presence after that report becomes stale. The relay cannot independently verify it. |

WebSocket ping/pong detects broken transports. Application `HEARTBEAT` messages separately track reported agent liveness. Missing application heartbeats mark the heartbeat stale, but do not automatically close an otherwise healthy WebSocket or infer a Minecraft disconnection. A socket close retains the last Minecraft report and lets it become stale; it never changes that report to `disconnected`.

Isolation affects **peer data delivery in both directions**. Registration, transport pings, heartbeats to the relay, status telemetry, acceptance/receipt acknowledgements, and operator monitoring remain available. Dashboard observations do not get broadcast to agents. Agents must not use the operator API as a hidden shared-memory channel.

## Connection and frame format

Connect to `/agents` using a JSON-text WebSocket. When configured, include the HTTP header `Authorization: Bearer <COMMS_AGENT_TOKEN>`. Node's `ws` supports this header. Browser pages are not admitted to the agent endpoint; the browser dashboard uses `/observe` instead.

Every frame has `v: 1` and `kind`. Register within five seconds:

```json
{"v":1,"kind":"REGISTER","agentId":"Ember"}
```

The response is `REGISTERED`, containing `agentId`, a fresh `sessionId`, `serverId`, `heartbeatIntervalMs`, message `limits`, and this agent's own `link: {isolated, partition}`. It does not contain the global agent status table. A changed `serverId` means this is a new relay process with a new in-memory registry/queue.

IDs must match `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`. `*` and `@relay` are reserved destinations, never agent IDs. IDs are case-sensitive.

## Publishing an agent message

```json
{
  "v": 1,
  "kind": "PUBLISH",
  "message": {
    "id": "b5fa0c50-2449-432a-b154-cc396b3e10cd",
    "type": "RESOURCE_REQUEST",
    "to": "Flint",
    "sentAt": 1794000000000,
    "ttlMs": 60000,
    "correlationId": "optional-related-message-id",
    "payload": {"resource": "oak_log", "amount": 8}
  }
}
```

| Field | Contract |
| --- | --- |
| `id` | Required, non-empty string, at most 128 characters. Use a new UUID for every new logical message. |
| `type` | One of the six types below. |
| `to` | Agent ID, `*` for all **currently known** other agents, or `@relay` for telemetry with no peer delivery. |
| `sentAt` | Required non-negative epoch milliseconds supplied by the sender. Informational; clocks are not assumed synchronized. |
| `ttlMs` | Optional, default 60000, integer 50–300000. Relay delivery lifetime starts at acceptance on the relay's clock. |
| `correlationId` | Optional string up to 128 characters, for responses related to a request. |
| `payload` | Required JSON object, subject to the type rules below. Extra application-specific fields are allowed within the frame-size limit. |
| `from` | Added authoritatively by the relay from the registered identity. If supplied by a publisher, it must match that identity. |
| `stateVersion` | On `STATUS_UPDATE` and `RESOURCE_UPDATE`: `{epoch: 1, revision: 42}`, both positive safe integers. Added automatically by the Node adapter. See ordering rules below. |

An agent ID must be registered at least once before direct messages can be accepted for it. Unknown recipients produce a retryable `UNKNOWN_RECIPIENT`; the adapter can retry while that peer starts or reconnects after a relay restart. A disconnected but known recipient has a queue. A broadcast snapshots membership at acceptance: a newly joining agent does not retroactively inherit old broadcasts. It must request discoveries or receive new advertisements from peers.

### Message types

| Type | Required payload | Optional/example fields and meaning |
| --- | --- | --- |
| `STATUS_UPDATE` | Object; no single observation is mandatory. | `minecraft: {connected: true}`, `health: 18`, `hunger: 14`, `position: {x: 10, y: 64, z: 20}`, `task: "gathering"`, `details: {...}`. Health/hunger are 0–20. Position components must be finite. Omitted observations are not invented by the server. |
| `RESOURCE_REQUEST` | `resource` (ID-format string), `amount` (positive integer). | `reason`, `requestId`, other local task context. This is a request to peers, not an allocation command. |
| `RESOURCE_UPDATE` | `resources`, a map of up to 128 resource names to non-negative integer totals. | Example: `{"resources":{"oak_log":12,"cobblestone":8},"revision":17}`. Values are the sender's reported snapshot, not deltas or a global inventory. |
| `TASK_COMPLETE` | `taskId`, string of at most 128 characters. | `result`, `position`, `evidence`. A peer's reported completion is not independently verified by the relay. |
| `TASK_REQUEST` | `requestId`, string of at most 128 characters. | `capabilities`, `taskId`, `description`. Agents decide whether/how to respond. The server does not generate assignments. |
| `HEARTBEAT` | Object, commonly `{}`. | Optional non-negative integer `uptimeMs`. The adapter sends these to `@relay`; an agent may also explicitly send one to a peer. |

Resource quantities are integers from 0 to 1,000,000,000; requests require a positive amount. Additional payload fields can carry evidence or task metadata. The state version orders snapshots from the **same source and message type**; it does not resolve contradictory reports from different agents or create consensus. Application-specific reconciliation remains an agent responsibility.

### State ordering and recovery

`STATUS_UPDATE` and `RESOURCE_UPDATE` are source-owned state streams. Each stream uses one monotonically increasing `stateVersion.revision` within a source incarnation (`stateVersion.epoch`). The adapter increments revisions on new `publish()` calls. Full snapshots are recommended; partial fields omitted from a status snapshot do not count as fresh observations. The relay retains the last explicit Minecraft observation separately.

- Higher epoch wins; within an epoch, higher revision wins. Wall clocks may move backwards without overriding version order. A source must never reuse a version with changed payload data.
- The relay rejects older versions (`STALE_STATE`) and equal-version conflicting payloads (`STATE_CONFLICT`) without updating reports or forwarding them. Identical equal-version state may be re-advertised with a new message ID; this does **not** refresh the original report's age.
- Receivers also track the latest successfully applied version per `(from, type)`. Late/duplicate/conflicting state is acknowledged but excluded from the application's `onMessage`; `stateIgnored` reports the reason. ACK therefore means receipt, not necessarily application of a new observation.
- Asynchronous handlers are serialized per source/type. A slow old handler cannot finish after a newer one and overwrite it. Handlers must still be idempotent in case they throw after partially applying changes.
- For compatibility, legacy messages without `stateVersion` use the same source's `sentAt` ordering until a versioned observation is seen. After that, unversioned updates cannot replace it. Use versions for the stronger guarantee; timestamps alone are vulnerable to clock changes.
- The adapter's `stateEpoch` defaults to 1 for one-process demonstrations. **Before restarting a real agent with the same ID, atomically increment and persist that agent's private epoch counter and pass it to `AgentClient`.** Do not generate epochs from unsynchronized wall clocks. Socket reconnects within the same adapter preserve revision counters automatically. Receiver version watermarks must likewise be persisted/restored with local knowledge if the receiver's own process will restart; this implementation keeps them in memory across socket/relay reconnects only.
- The adapter retains up to 128 own state/audience entries and 128 received source/type entries. Receiver watermarks do not expire during its lifetime; exceeding the stream cap refuses new streams instead of forgetting ordering protection. Message-ID deduplication has a separate expiry window.

On reconnect, peer registration, and policy changes, the relay sends `LINK_STATE` notifications containing only each agent's own link settings. Each adapter then re-advertises **its own** latest cached state to its original audience, using a new message ID but preserving the observation time and version. `@relay` telemetry stays private to operators. Requests, heartbeats, and task-completion events are not automatically recreated. No relay report is turned into an agent observation.

This allows synchronization after a long partition even if old delivery queues expired. Agents should continue publishing local state while offline (and periodically while online) so their local cached observation stays current. Re-advertising a cached observation does not make it a fresh observation. If publishing different audiences within one type, use one consistent source-owned stream; an older audience-specific snapshot remains older and may be rejected after a newer version has been accepted. Do not use the same type as unrelated, independently versioned facts.

## Acceptance, delivery, and acknowledgement

On admission, the publisher receives:

```json
{"v":1,"kind":"PUBLISH_ACK","id":"message-uuid","status":"accepted","expiresAt":1794000060000,"deliveries":{"Flint":"queued"}}
```

`PUBLISH_ACK` confirms storage in the current relay process, not peer receipt or task completion. Repeating an identical envelope with the same `(from, id)` returns `status: "duplicate"`, with current per-recipient results. Reusing that identity for different content is `ID_REUSE`. Retries must retain the original `sentAt`, payload, TTL, and recipient; the adapter freezes its copy for this purpose.

An eligible recipient receives:

```json
{
  "v":1,
  "kind":"MESSAGE",
  "message":{"id":"message-uuid","type":"TASK_COMPLETE","from":"Ember","to":"Flint","sentAt":1794000000000,"ttlMs":60000,"payload":{"taskId":"floor-1"}},
  "relay":{"serverId":"relay-uuid","acceptedAt":1794000000100,"expiresAt":1794000060100}
}
```

After applying the observation to its local state, the recipient sends:

```json
{"v":1,"kind":"ACK","from":"Ember","id":"message-uuid"}
```

Unacknowledged deliveries retry approximately every 1.5 seconds when the link permits. ACKs are tied to the recipient's current session and are idempotent. The publisher receives `DELIVERY_STATUS` with `id`, `recipient`, and `status: "delivered"` or `"expired"`. Delivery results and expiry events are also visible to operators, even if the publisher is offline when they occur. Replaying the publish during the deduplication window can retrieve its current results.

Receipt ACKs say that the consumer handler returned successfully; they do not mean Minecraft actions have finished. Send a separate `TASK_COMPLETE` after actual completion. Make handlers idempotent: a failed handler may have partially applied an effect, and process restarts can erase an in-memory deduplication cache.

### Recovery and limits

- Delivery is retried within the message TTL, with at-least-once semantics. There is no exactly-once or global-order guarantee. Retries and reconnects can interleave messages; agent knowledge can diverge.
- Messages queued during a logical partition or known-recipient socket outage replay after restoration, if still within TTL. All isolation/partition/link rules are checked again on each send. Healing one layer does not bypass another layer that remains blocked.
- A message already written to a socket cannot be recalled by a subsequently applied partition. Already learned facts are never erased.
- Previously accepted messages can be delivered after their sender's socket disconnects. That is store-and-forward of an existing message, not evidence that the sender is still online.
- Default server limits: 16 KiB per incoming frame, 64 retained agent IDs, 128 pending messages per recipient, and 4096 retained accepted-message records. Publish deduplication records live until the delivery deadline plus 60 seconds. Duplicate-ID protection is bounded by that window.
- Queue admission is atomic across broadcast recipients. If any destination is full, the entire new publish is rejected with retryable `QUEUE_FULL`; it is not partially relayed. Expiry is reported explicitly. Slow sockets are closed with code 1013 so unacknowledged deliveries can replay on reconnection.
- The adapter has a bounded 256-message local outbox while disconnected or awaiting acceptance. Its separate local deadline starts at enqueue and uses `ttlMs`. A local timeout may occur after the server accepted a message but its ACK was lost; `mayHaveBeenAccepted` exposes that uncertainty. Server TTL starts at server acceptance, so the two deadlines are intentionally distinct.
- **Relay delivery storage is in memory. A relay restart loses its registry, pending accepted messages, and deduplication history.** The CLI separately persists fault policy to `.state/comms-network-PORT.json` and loads it before admitting agents. The library is memory-only unless its caller supplies `initialFaults` and `onFaultChange`. The new `serverId` makes the epoch change visible. Re-advertise each agent's own current facts and request missing peer facts on reconnect. Durable delivery across relay-process loss requires a future persistence layer.
- The adapter's received-ID cache is bounded to 4096 entries for at most six minutes, retained across socket reconnects but not adapter-process restarts. Persist semantic task/resource state in each agent's own storage if it must survive process loss.

## Control frames and errors

| Kind | Direction / purpose |
| --- | --- |
| `REGISTER`, `REGISTERED` | Identity handshake and relay/session epoch. |
| `PUBLISH`, `PUBLISH_ACK` | New peer data and acceptance result. |
| `MESSAGE`, `ACK` | Routed delivery and recipient receipt. |
| `DELIVERY_STATUS` | Relay-to-publisher delivery/expiry information. |
| `LINK_STATE` | Relay-to-agent update of its own `{isolated, partition}` settings, also sent after peer registration to prompt source-owned state exchange. It contains no peer observations. |
| `ERROR` | `{v, kind, code, message, retryable, id?}`. `id` identifies a rejected publish where possible. |
| `SUBSCRIBE`, `SNAPSHOT` | Operator observer authentication and read-only monitoring. |

Important error codes: `ID_IN_USE`, `INVALID_MESSAGE`, `INVALID_JSON`, `INVALID_FRAME`, `ID_REUSE`, `UNKNOWN_RECIPIENT`, `QUEUE_FULL`, `AGENT_LIMIT`, `INVALID_ACK`, `UNAUTHORIZED`, and `READ_ONLY`. Binary frames are rejected. Oversize frames close with WebSocket code 1009. Duplicate identity, missing registration, and invalid observer authentication close with 1008. An unknown application heartbeat does not masquerade as a WebSocket transport failure.

State admission also returns non-retryable `STALE_STATE` and `STATE_CONFLICT`. Publishing a fresh observation with a new version is an agent action; repeatedly retrying a rejected old version cannot make it current.

## Operator API and React dashboard

`GET /health` is public and returns service/version/server epoch only. All `/api/*` endpoints require `Authorization: Bearer <operator token>`.

| Endpoint | Body / response |
| --- | --- |
| `GET /api/state` | Current operator snapshot. |
| `POST /api/isolation` | `{"agentId":"Moss","isolated":true}`; use `false` to restore. |
| `POST /api/partitions` | `{"groups":[["Ember","Flint"],["Moss"]]}`. All named IDs must already be known and occur at most once. |
| `POST /api/partitions` | `{"groups":[]}` heals group partitions only. |
| `POST /api/links` | `{"a":"Ember","b":"Moss","enabled":false}` blocks a bidirectional pair; use `true` to restore that pair. |
| `POST /api/reset` | `{}` starts a new communication run: clears all faults, counters and recent events, generates a new `runId`/`runStartedAt`; preserves sockets, observations, queued messages, deduplication, source versions and Minecraft state. |
| `POST /api/heal` | `{}` manually clears all isolation flags, partitions, and disabled pairs. It does not reconnect dead sockets or change Minecraft presence. |

With partitions enabled, agents omitted from the groups—including newly registered IDs—belong to an `unassigned` group. They can communicate with one another but not with assigned groups. Isolation and pairwise disabled links compose with the partition rule.

Example operator command, in a separate terminal:

```sh
export OPERATOR_TOKEN='paste-the-token-printed-by-the-server'
curl -s http://127.0.0.1:8090/api/state \
  -H "Authorization: Bearer $OPERATOR_TOKEN"
curl -s -X POST http://127.0.0.1:8090/api/isolation \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"Moss","isolated":true}'
```

Snapshots contain server epoch/revision/time, `runId`, `runStartedAt`, saved `faults: {isolatedIds, groups, disabledPairs}`, counters, limits, retained agent records, pairwise link reasons, and the latest 200 operational events. Each agent has `connection`, `heartbeat`, `communication`, `minecraft`, `reports`, and `pendingMessages`. Reports include the sender's `reportedAt`, server `receivedAt`, computed `ageMs`, `stale`, and (for versioned state) `stateVersion`. Display staleness and provenance; do not label old reports as current truth. For each pair, `policyAllowed` means no logical fault blocks it; `transportAvailable` means both registered sockets are open; `canCommunicate` requires **both**. `blockedBy` lists policy reasons separately from transport state. An accepted queued message can still outlive its sender socket.

The server CLI logs structured events to stdout with `at`, `serverId`, and `revision`: isolation enabled/disabled, partitions changed/cleared, pair enabled/disabled, effective link failed/restored, whole-network restored, simulation reset, agent connected/disconnected, message accepted/sent/delivered/expired, and state rejected. `message-sent.attempt` distinguishes retries; `message-delivered` is a recipient ACK. The bounded operator event history is for recent inspection, not durable auditing. Capture stdout to a local log if a complete run history is needed; relay restart resets its in-memory history. The `createRelay({onEvent})` hook allows an external log sink.

Use `npm run comms:control -- status`, `isolate ID`, `restore ID`, `partition A,B C,D E`, `link A B off`, or `heal` from an operator terminal with `COMMS_OPERATOR_TOKEN` set. `COMMS_HTTP_URL` optionally selects a different relay. `restore ID` removes just that isolation; `heal` clears every fault layer. The CLI does not load `.env`, helping keep operator credentials out of the agent environment.

For live observation, open `/observe`, then send `{"v":1,"kind":"SUBSCRIBE","token":"operator-token"}`. You receive `SNAPSHOT` frames initially, after state changes, and periodically for age/staleness refresh. Observer sockets cannot publish agent messages or mutate faults. Use the authenticated HTTP endpoints for controls.

The React client in `dashboard/` uses the browser's native WebSocket API; `ws` remains server-side. Build with `npm run build:dashboard`; the relay serves the generated `dashboard/dist/` assets at `/`. `npm run dashboard` builds and starts the relay. The same-origin UI uses the authenticated HTTP endpoints for every fault control, checks the response, then renders the resulting snapshot. It reconnects automatically and ignores older snapshot revisions within the same server epoch. No mock agent data is included in the dashboard.

For loopback deployments, `POST /dashboard/session` returns an operator token only when the bind address and request hostname are loopback, the request port matches the relay, the `Origin` exactly matches that host/port, and `X-Colony-Dashboard: 1` is supplied. Cross-origin requests are not enabled. The browser holds this token in memory and sends it in the observer handshake and Bearer headers, never in URLs or the frontend bundle. Remote hosts use manual operator authentication; agents never receive this token.

The run reset preserves previously accepted pending messages, so acknowledgements after reset can count deliveries for messages accepted before the new run. Counters describe activity since reset, not a closed cohort of messages. Snapshot revision stays monotonic across run resets, and `simulation-reset` starts the new event history.

The builder publishes an optional `STATUS_UPDATE.payload.house`: `{blueprint, observedAt, origin: {x,y,z}, placed, required, percent, unknown, phases: [{name,placed,required}], cells: [{x,y,z,status}]}`. Cell positions are relative to `origin`; status is `complete`, `missing`, `obstructed` or `unknown`. This is the builder's observed blueprint, not authoritative server-world state. Unknown blocks are included in the denominator and flagged, giving a lower-bound completion estimate. The UI labels stale surveys, and aggregates resources only from fresh connected Minecraft reports; it does not claim to know chest contents.

## Minecraft developer integration

The repository's real bots already use `src/comms/minecraft-channel.js`. Start the Minecraft server, `npm run comms:server`, and `npm run bots`, then send `!team start` in Minecraft. The bridge periodically broadcasts real status and inventory, plus up to 32 fresh own discoveries in `RESOURCE_UPDATE.payload.discoveries`. It validates team membership and discoveries before feeding the existing role memory. Peer reports and version watermarks are saved with that memory before ACK; each agent increments/saves its own epoch before connecting. Health, tasks, and inventories are observations, not instructions. Minecraft connection loss is reported separately; relay loss does not touch the Minecraft socket or role loop.

Human narration remains in Minecraft chat, but incoming machine-readable chat observations are ignored in WebSocket mode. Use authenticated operator controls for selective isolation/partitions. The local `!team comms off` command closes only the relay adapter; `comms on` reconnects it. Local communication-off state also persists across restarts.

For a different Minecraft client, use the adapter from `src/comms/agent-client.js` as below. `start()` returns immediately; `publish()` returns a message ID immediately. Neither should be awaited by the gameplay loop. The raw adapter's own state is in memory; the existing `MinecraftChannel` provides the per-agent persistence described above.

```js
import { AgentClient } from './comms/agent-client.js';

const peerKnowledge = new Map(); // Private to this agent; persist it if needed.
const comms = new AgentClient({
  agentId: bot.username,
  stateEpoch: persistedAgentEpoch, // Increment/save in this agent's own storage before each process start.
  url: process.env.COMMS_URL,
  token: process.env.COMMS_AGENT_TOKEN,
  onMessage: async message => {
    // The adapter filters old versions within each source/type before this callback.
    // Reconcile conflicting facts from different sources using your own policy.
    // Requests are inputs to your decision loop, never commands from the relay.
    peerKnowledge.set(message.from, message);
    // Persist local observations here if receipt should depend on persistence.
  }
});

let minecraftConnected = false;
function advertise() {
  comms.publish('STATUS_UPDATE', {
    minecraft: { connected: minecraftConnected },
    task: currentLocalTask
  });
}
bot.on('spawn', () => { minecraftConnected = true; advertise(); });
bot.on('end', () => { minecraftConnected = false; advertise(); });
comms.on('ready', ({serverChanged}) => {
  advertise(); // Advertise only your own observations; request peer updates as needed.
  if (serverChanged) console.log('New relay epoch; old accepted queues may be gone.');
});
comms.on('offline', () => console.log('Comms unavailable; local gameplay continues.'));
comms.on('publishRejected', result => console.log('Message not confirmed:', result));
comms.on('handlerError', ({error}) => console.log('Peer observation handler failed:', error));
comms.start();

// Keep the existing autonomous game/decision loop running independently.
// Do not call bot.quit(), pause movement, or replace local beliefs on bus loss.
// Call comms.close() only when this communication adapter is being shut down.
```

`onMessage` is awaited before ACK. Duplicate deliveries are suppressed while a handler runs and after it succeeds. A thrown/rejected handler produces `handlerError` and no ACK, allowing retry. `message` is a notification event after successful handling. Other adapter events include `ready`, `offline`, `accepted`, `deliveryStatus`, `linkState`, `stateSync`, `stateIgnored`, `connectionError`, `relayError`, `protocolError`, and `publishRejected`. These are nonfatal transport events; the application decides how to display or record them.

When integrating, select one machine-readable peer-data path. Continuing to parse the existing `[TEAM ...]` Minecraft chat messages during a WebSocket partition would bypass the experiment. Human-readable chat narration may remain, and agents may still observe visible world changes locally. Do not feed operator snapshots back into agent decision loops.

## Optional outage evidence telemetry

`REGISTERED.link` and `LINK_STATE` include `evidenceWindow` (opaque string or `null`). This identifies an operator measurement interval, not a task or peer observation. The Minecraft adapter supplies it only to instrumentation; decisions do not depend on it. A changed blocked-link set starts a new interval. Restoring all faults closes it.

Real bots include optional `STATUS_UPDATE.payload.progress`:

```json
{
  "windowId": "opaque-window-id",
  "totals": {"resourceBlocks": 3, "itemsCrafted": 0, "itemsDeposited": 0, "blocksPlaced": 0, "discoveries": 1},
  "lastAction": {"metric": "resourceBlocks", "amount": 1, "item": "stone", "at": 1794067000000}
}
```

Counters are monotonic per source epoch and window. Capture a marker before an operation and record its verified outcome only if the marker is still current. Digging checks an actual block change; crafting/depositing check inventory deltas; placing checks the resulting block. Discovery counts are new resource regions, not repeated messages. The relay requires fresh source-version acceptance, the active marker and valid nonnegative counters; decreasing counters or older epochs cannot add credit. It sums new deltas, accounts for process epochs and freezes results on restoration. Timestamps are for display; clock comparisons do not admit progress across outage boundaries.

Operator snapshots add `evidence: {activeId, captures}`. Each capture includes start/end times, blocked links, affected-agent rows with blocked/total peers, counters, report times, Minecraft reports and interruptions. A comparable fully loaded builder survey adds house before/after context. This observer-only aggregate is never fed back into bot decisions. Latest eight captures are retained in memory; reset/restart clears them. Missing markers, transport loss or late reports can undercount; clients must not infer success from absence of telemetry.

## Local operator roster API

These endpoints require the same operator Bearer credential as fault controls and a loopback-bound relay:

- `GET /api/roster`: launcher availability and five `{name, role, selected, processRunning}` records.
- `POST /api/roster` with `{"action":"roles","roles":["miner","crafter"]}`: apply membership, preserving unchanged processes.
- `POST /api/roster` with `{"action":"start"}` or `{"action":"pause"}`: human lifecycle command.

The relay delegates to the separate `npm run bots` launcher over a private local socket. It neither starts a launcher nor assigns gameplay tasks. Invalid input returns 400; missing launcher returns 503; non-loopback deployments return 403. Removing a role really disconnects it from Minecraft, unlike communication isolation. Roster changes retain the agent's saved memory and Minecraft inventory. No operator credential is passed to agent children.
