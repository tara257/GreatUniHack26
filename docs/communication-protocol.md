# Autonomous Colony communication protocol — v1

This is an optional communication service for independent Minecraft agents. It relays observations, requests, and completion reports. It does not choose actions, assign tasks, transfer Minecraft items, elect a leader, resolve conflicting beliefs, or operate Minecraft connections.

The initial implementation includes a Node.js/`ws` relay, a Node.js agent adapter, independent simulated agents, automated tests, and operator endpoints for a future React dashboard. The existing Minecraft bots still use their original chat transport; this service has not been wired into their gameplay code. There is no dashboard UI in this change.

## Run and test

Use the repository's Node.js 22+ environment:

```sh
npm ci
npm run test:comms
npm run comms:demo
```

The demo starts an ephemeral relay and three separate agent processes, partitions Moss away from Ember/Flint, verifies that local work continues, shows their different resource beliefs, heals the partition, and checks isolated-agent recovery. It cleans up its processes on completion. Its Minecraft connection reports are explicitly simulated.

For a persistent local relay:

```sh
npm run comms:server
# Separate terminals, one independent process each:
npm run comms:agent -- Ember
npm run comms:agent -- Flint
npm run comms:agent -- Moss
```

Defaults: `COMMS_HOST=127.0.0.1`, `COMMS_PORT=8090`, agent `COMMS_URL=ws://127.0.0.1:8090/agents`. The relay prints a generated operator token, which changes on restart. `COMMS_OPERATOR_TOKEN` can instead be supplied **only to the server process**. Never pass it to gameplay agents. `COMMS_AGENT_TOKEN` is an optional, separate shared admission credential for Node agents. A non-loopback bind requires explicit agent and operator credentials. Remote deployments additionally need TLS (`wss`/HTTPS), typically through a reverse proxy.

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

Connect to `/agents` using a JSON-text WebSocket. When configured, include the HTTP header `Authorization: Bearer <COMMS_AGENT_TOKEN>`. Node's `ws` supports this header. Browser pages are not admitted to the agent endpoint; the future browser dashboard uses `/observe` instead.

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

Resource quantities are integers from 0 to 1,000,000,000; requests require a positive amount. Additional payload fields can carry agent-owned versions, evidence, or task metadata. For facts that can change, the Minecraft developer should use source-owned revisions/epochs and application-specific merge rules. Arrival order and timestamps alone are not consensus, and the relay does not resolve contradictory reports.

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
- **Relay storage is in memory. A relay restart loses its registry, fault policy, pending accepted messages, and deduplication history.** The new `serverId` makes the epoch change visible. Re-advertise each agent's own current facts and request missing peer facts on reconnect. Durable delivery across relay-process loss requires a future persistence layer.
- The adapter's received-ID cache is bounded to 4096 entries for at most six minutes, retained across socket reconnects but not adapter-process restarts. Persist semantic task/resource state in each agent's own storage if it must survive process loss.

## Control frames and errors

| Kind | Direction / purpose |
| --- | --- |
| `REGISTER`, `REGISTERED` | Identity handshake and relay/session epoch. |
| `PUBLISH`, `PUBLISH_ACK` | New peer data and acceptance result. |
| `MESSAGE`, `ACK` | Routed delivery and recipient receipt. |
| `DELIVERY_STATUS` | Relay-to-publisher delivery/expiry information. |
| `LINK_STATE` | Relay-to-agent update of its own `{isolated, partition}` settings. It contains no peer observations. |
| `ERROR` | `{v, kind, code, message, retryable, id?}`. `id` identifies a rejected publish where possible. |
| `SUBSCRIBE`, `SNAPSHOT` | Operator observer authentication and read-only monitoring. |

Important error codes: `ID_IN_USE`, `INVALID_MESSAGE`, `INVALID_JSON`, `INVALID_FRAME`, `ID_REUSE`, `UNKNOWN_RECIPIENT`, `QUEUE_FULL`, `AGENT_LIMIT`, `INVALID_ACK`, `UNAUTHORIZED`, and `READ_ONLY`. Binary frames are rejected. Oversize frames close with WebSocket code 1009. Duplicate identity, missing registration, and invalid observer authentication close with 1008. An unknown application heartbeat does not masquerade as a WebSocket transport failure.

## Operator API and future React integration

`GET /health` is public and returns service/version/server epoch only. All `/api/*` endpoints require `Authorization: Bearer <operator token>`.

| Endpoint | Body / response |
| --- | --- |
| `GET /api/state` | Current operator snapshot. |
| `POST /api/isolation` | `{"agentId":"Moss","isolated":true}`; use `false` to restore. |
| `POST /api/partitions` | `{"groups":[["Ember","Flint"],["Moss"]]}`. All named IDs must already be known and occur at most once. |
| `POST /api/partitions` | `{"groups":[]}` heals group partitions only. |
| `POST /api/links` | `{"a":"Ember","b":"Moss","enabled":false}` blocks a bidirectional pair; use `true` to restore that pair. |

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

Snapshots contain server epoch/revision/time, counters, limits, retained agent records, pairwise link reasons, and the latest 200 operational events. Each agent has `connection`, `heartbeat`, `communication`, `minecraft`, `reports`, and `pendingMessages`. Reports include the sender's `reportedAt`, server `receivedAt`, computed `ageMs`, and `stale`. Display staleness and provenance; do not label old reports as current truth. Link `transportAvailable` means both sockets are live for new exchanges; an accepted queued message can still outlive its sender socket.

For live observation, open `/observe`, then send `{"v":1,"kind":"SUBSCRIBE","token":"operator-token"}`. You receive `SNAPSHOT` frames initially, after state changes, and periodically for age/staleness refresh. Observer sockets cannot publish agent messages or mutate faults. Use the authenticated HTTP endpoints for controls.

A future React client should use the browser's native `WebSocket` API, not the Node-only `ws` package ([ws documentation](https://github.com/websockets/ws)). Keep its operator token separate from agents. The server does not enable cross-origin HTTP access; use a development proxy or same-origin deployment for dashboard REST calls. No React components have been implemented here.

## Minecraft developer integration

Use the included adapter from `src/comms/agent-client.js`. `start()` returns immediately; `publish()` returns a message ID immediately. Neither should be awaited by the gameplay loop.

```js
import { AgentClient } from './comms/agent-client.js';

const peerKnowledge = new Map(); // Private to this agent; persist it if needed.
const comms = new AgentClient({
  agentId: bot.username,
  url: process.env.COMMS_URL,
  token: process.env.COMMS_AGENT_TOKEN,
  onMessage: async message => {
    // Apply your own conflict/version policy before replacing newer facts.
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

`onMessage` is awaited before ACK. Duplicate deliveries are suppressed while a handler runs and after it succeeds. A thrown/rejected handler produces `handlerError` and no ACK, allowing retry. `message` is a notification event after successful handling. Other adapter events include `ready`, `offline`, `accepted`, `deliveryStatus`, `linkState`, `connectionError`, `relayError`, `protocolError`, and `publishRejected`. These are nonfatal transport events; the application decides how to display or record them.

When integrating, select one machine-readable peer-data path. Continuing to parse the existing `[TEAM ...]` Minecraft chat messages during a WebSocket partition would bypass the experiment. Human-readable chat narration may remain, and agents may still observe visible world changes locally. Do not feed operator snapshots back into agent decision loops.
