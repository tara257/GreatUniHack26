# Should we train the agents?

For this hackathon, improve reliable skills and measure behaviour before training a model. The current agents are rule-based controllers. Their new experience memory changes route choices, delays repeated failures, and shares temporary lessons through the existing failure-prone chat channel. It does not update model weights or infer the exact cause of death.

Training a general Minecraft player from scratch is a much larger project. For scale, [OpenAI's VPT research](https://openai.com/index/vpt/) trained its foundation model on 70,000 hours of labelled online video. A different approach, [Voyager](https://github.com/MineDojo/Voyager), combines a language model with a growing skill library without fine-tuning the underlying model. Our current code does not implement either research system.

## What is implemented

- Separate local experience memories, retained across reconnects/restarts.
- Failed-route cooldowns that increase on repeated failures and clear after success.
- Expiring danger/death observations that increase navigation costs near risky areas.
- Peer lessons delivered only by structured Minecraft chat. Outages block incoming lessons as well as outgoing messages.
- Night shelter, separate resting spots, hunger/recovery priorities, and bounded exploration.
- Local telemetry and recent decision/navigation events, visible with `!team stats` and `npm run report`.

## Evaluate before claiming improvement

Use separate saved test worlds so resets do not erase the demonstration world. Compare the original policy and the new policy on the same seeds, initial inventories, house sites, game times, and communication-outage schedules. Preserve equal start conditions and run several repetitions.

Record house completion time, deaths per agent, time spent hungry, route failures, repeated attempts avoided, and construction progress during outages. Count an episode that fails to finish as a failure. A short live smoke test or a high number of successful navigation calls is not evidence of a statistically reliable survival improvement. Counters are diagnostic calls, not independent trials.

The included automated tests cover decisions, persistence, and communication isolation. They are not a Minecraft simulator or a trained policy benchmark.

## Later options

1. Add dependable skills such as cooking, resource sharing, farming, and stronger equipment. Give each a clear success/failure result.
2. If useful, add a pretrained model to choose among these skills. Keep local survival controls and a rule-based fallback so a model/API outage cannot stop the agents.
3. Once there are enough recorded episodes, try training a small decision policy on a narrow task, such as choosing a safe route or deciding when to retreat. Evaluate it on unseen seeds against the existing controller before enabling it.

n8n could collect reports and prepare a dashboard, but it should not be required for movement, survival, memory, or communication recovery.
