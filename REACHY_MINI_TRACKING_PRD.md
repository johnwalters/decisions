# Reachy Mini Object Tracking — PRD and Implementation Plan

Status: proposed · October 8, 2026

This document is temporarily stored in the Decisions project. Implementation belongs in a separate project; this plan does not require changes to the Fruit Decisions Lab.

## Product intent

Build a local application that lets a user select an object and have Reachy Mini turn its head to keep that object in the camera view. Begin with an understandable experiment using OpenAI's Decisions API to classify the target's position, then add a local tracking loop for smoother following.

The initial product should make the relationship between camera input, model decision, and head movement visible. Users should be able to compare API-only tracking with hybrid tracking on the same robot and target.

The specific OpenAI demo implementation has not been established. This design is a proposed approach, not a reconstruction of that demo.

## Users and primary experience

The primary user is a developer experimenting with embodied AI on a desk, using one robot and one target at a time.

1. Connect to Reachy Mini and confirm camera and movement availability.
2. View the camera feed and describe a target, such as “the red mug.” Optionally click the intended object to disambiguate it.
3. Select Decisions-only or hybrid mode.
4. Start tracking. See the target position, tracking state, and current head movement.
5. Move the object and observe the robot follow it.
6. Pause or stop immediately. Review latency, tracking quality, and API usage for the session.

An ambiguous target selection should ask the user to choose an instance before movement starts. Descriptions and reference crops help distinguish similar objects, but do not guarantee identity preservation.

## Scope

### MVP: Decisions-only prototype

- Robot connection, camera preview, and explicit start/stop controls.
- One described target per session.
- A finite classification of target position: left/center/right crossed with above/center/below, plus absent and uncertain.
- Small, bounded head corrections based on accepted decisions.
- Visible decisions, returned probabilities when available, frame age, request latency, and movement history.
- Dry-run mode that displays proposed movement without actuating the robot.
- Session metrics and JSON export without image pixels by default.

### Follow-up: hybrid tracking

- User selection or a suitable grounding model establishes an initial target bounding box.
- A local tracker maintains the selected target across camera frames.
- A local controller uses target center coordinates to produce smooth head corrections.
- Decisions API checks target presence or coarse position at a lower rate, particularly during acquisition and recovery.
- If a Decisions classification cannot provide a bounding box, it must not be treated as one. Use click selection, a local detector, or a separately validated grounding interface.

### Outside initial scope

Autonomous navigation, manipulation, multiple robots, multiple simultaneous targets, persistent face recognition, voice conversation, internet-hosted robot control, and general-purpose autonomous robot actions.

## Functional requirements

| Area | Required behavior |
|---|---|
| Connection | Display robot address, connection status, camera status, and actionable errors. |
| Target | Save the target description with each session; changing it clears tracking history and starts a new acquisition. |
| Start | Require a connected robot, fresh camera frames, valid target, and valid provider configuration for the chosen mode. |
| Decisions | Submit the target description and a recent frame; accept only the configured finite choices. |
| Movement | Convert accepted observations into application-controlled motion. Never execute arbitrary model-generated commands. |
| Pause/stop | Cancel pending work where supported, invalidate outstanding results, and stop application-controlled tracking motion. Verify the robot SDK's actual stop behavior. |
| Target loss | Stop corrective movement after the configured loss timeout; show Lost and offer reacquisition. |
| Search | Optional, explicitly enabled bounded scan; initially disabled. Search ends on reacquisition, timeout, stop, or travel limit. |
| Errors | Camera loss, robot disconnect, stale data, invalid output, refusal, and API failure produce visible states and no speculative correction. |
| Observability | Associate each decision and command with a session, frame sequence, capture time, and target version. |

## Architecture

Use a local Python service for the Reachy SDK, camera capture, tracking, and movement. Serve a lightweight browser UI locally. This is a proposed stack; confirm the SDK's supported runtime and installation path in the destination project.

```text
Browser UI → local session coordinator
                    ├─ camera → latest-frame buffer
                    ├─ Decisions adapter → discrete observation
                    ├─ local tracker → continuous observation (hybrid)
                    └─ controller → motion arbiter → Reachy SDK
```

The coordinator owns the session state. The motion arbiter is the only component allowed to send tracking commands. Camera acquisition, API requests, and actuator updates run independently so a slow request cannot block Stop or camera freshness checks.

### Decisions-only loop

1. Read the newest usable frame; assign sequence and capture timestamp.
2. Submit one classification request with the target description.
3. Validate the response against the configured choices and probability policy.
4. Reject observations from previous sessions, previous targets, or frames older than the movement freshness limit.
5. Issue a small correction toward the target's classified region, or hold if centered, absent, uncertain, or rejected.
6. Wait for the correction to finish or be superseded, then sample a new frame.

Allow at most one classification request in flight initially. Use a latest-frame buffer rather than queueing every captured frame. Apply bounded backoff for failures; never replay movements to catch up with a backlog.

### Hybrid loop

Acquire a target box through selection or detection. Track locally, calculate horizontal and vertical center error, and issue smooth corrections at a measured sustainable rate. Run semantic checks asynchronously; they can request reacquisition but should not directly overwrite local motion commands.

Tracker confidence and API choice probabilities are different signals. Define and tune their policies separately. A tracker can confidently follow the wrong object, so explicitly test identity switches and reappearance after occlusion.

## Decisions API contract

The current workspace provides a working example in `app/api/decide/route.ts` using `POST /v1/decisions`, image input, and a named choice question. Use that as a reference during implementation; verify current endpoint access, model support, schema, refusals, and probability semantics before depending on it.

Proposed question: “Locate the specified target in this camera image. Classify the center of the target into the configured image regions. Choose absent if it is not visible and uncertain if its identity or location cannot be determined.”

Proposed choices:

```text
upper_left    upper_center    upper_right
middle_left   centered        middle_right
lower_left    lower_center    lower_right
absent        uncertain
```

Define center boundaries explicitly in normalized image coordinates, with a wider central band to reduce twitching. Diagonal choices allow simultaneous horizontal and vertical correction. Start with one joint question; compare separate axis questions only if evaluation justifies it.

Use returned probabilities only after validating their format. Any threshold is an empirical routing rule, not a guarantee of correctness. Missing or invalid probability data follows a documented conservative policy; record the original result and the routed action separately.

Reference crops may be useful for object identity, but multi-image support and ordering must be verified before enabling them. The MVP must work with a text description and one current frame.

## Motion controller

For API-only tracking, map directional regions to small configurable yaw/pitch increments. Use a dead band, confirmation across observations where useful, and acceleration/velocity limits to avoid rapid reversals. Larger steps are optional after measurements establish reliable behavior.

For hybrid tracking, calculate normalized errors from the target center:

```text
horizontal_error = (target_center_x - frame_width / 2) / (frame_width / 2)
vertical_error   = (target_center_y - frame_height / 2) / (frame_height / 2)
```

Start with proportional control and smoothing. Tune gains on hardware before considering integral or derivative terms. Confirm signs, units, camera orientation, and joint limits with dry-run and small motions. Camera coordinates alone are not robot angles; camera calibration or empirical mapping is needed.

Clamp every command to a conservative configured travel range within the hardware's supported limits. Set limits from the SDK and hardware documentation, not guessed angles. If the target remains outside the achievable view at a limit, hold and report that state.

## State model

`Disconnected → Ready → Acquiring → Tracking → Lost → Acquiring`

Pause transitions active states to `Paused`. Stop returns to `Ready` when connected. Failures transition to `Error` or `Disconnected`. Resume reacquires from a fresh frame. Each start, stop, target change, and mode change increments a generation identifier so late responses cannot trigger motion.

## UI and configuration

Use one screen with a prominent camera preview, target field, mode selector, Start/Pause/Stop controls, and tracking status. Display bounding boxes only when coordinates are actually available; Decisions-only mode can show the selected image region instead.

A diagnostics panel shows capture-to-action age, API round-trip time, local tracker rate, rejected observations, head position, request count, and estimated cost when verified pricing is configured. Keep API keys in the local service environment, never the browser or exports.

Expose an advanced panel for dead band, movement gains, motion limits, request cadence, freshness cutoff, loss timeout, and probability thresholds. Save configuration with session exports. Do not retain raw camera frames by default; optional evaluation recording must be clearly enabled and removable.

## Evaluation and release criteria

These are proposed engineering targets, not hardware or API guarantees. Establish the test setup during the hardware spike: lighting, distance, target size, motion speed, and robot version.

| Measure | Proposed criterion |
|---|---|
| Stop | Application stops issuing commands within 100 ms of receiving Stop; measure physical settling separately. |
| Stale results | Zero motion from expired frames or invalidated sessions in deterministic tests. |
| Limits | Zero commands outside configured travel/velocity limits. |
| API-only following | For a slow desk target, return to the configured central region within three accepted correction cycles in at least 90% of trials. |
| Hybrid throughput | Sustain at least 15 usable tracking observations/sec on the chosen host. |
| Hybrid freshness | Capture-to-command age below 150 ms at the 95th percentile on the chosen setup. |
| Hybrid following | Target center remains in the central region for at least 90% of a defined slow-motion test, excluding acquisition and loss intervals. |
| Loss behavior | No tracking correction after the configured loss timeout; reacquisition never silently substitutes an ambiguous target. |

Test stationary targets, horizontal/vertical/diagonal motion, brief occlusion, exit and reentry, similar objects, poor lighting, mechanical limits, API timeout/refusal, dropped frames, disconnects, and Stop during an in-flight request. Report latency percentiles and target-loss duration alongside average centering error.

## Implementation milestones

### 0. Hardware and API feasibility

Confirm Reachy Mini variant, camera path, supported SDK, command semantics, cancellation, joint limits, and sustainable capture rate. Verify a live Decisions request using representative frames. Measure latency and directional classification accuracy before choosing request cadence and freshness limits.

Deliver: connection probe, camera preview, dry-run movements, a small labeled frame set, and a recorded feasibility decision. If API latency exceeds usable freshness for the desired motion speed, retain API-only as an experiment and prioritize hybrid tracking.

### 1. Observable Decisions-only MVP

Implement provider adapter, latest-frame scheduling, response validation, state machine, bounded controller, generation invalidation, UI controls, and diagnostics. Begin with dry-run, then test small movements with a stationary target and slow manual target motion.

Deliver: working demo plus exported evaluation sessions meeting the API-only criteria.

### 2. Local tracking

Add click-to-select acquisition and a replaceable tracker interface. Evaluate suitable local detectors/trackers on the intended targets and host rather than committing to a model before measurement. Add continuous controller tuning, confidence gating, and explicit loss handling.

Deliver: hybrid mode meeting agreed throughput, freshness, and centering targets.

### 3. Semantic acquisition and recovery

Add validated grounding if description-only automatic acquisition is required. Use Decisions checks to support presence and ambiguity handling. Add bounded optional search and identity-switch evaluation.

Deliver: recovery behavior with measured success rates and clear user intervention when identity is ambiguous.

### 4. Packaging and handoff

Document installation, environment configuration, startup, robot setup, tuning, supported hardware, and evaluation results. Provide a mock robot/provider for development without hardware and a replay harness for controller regression tests. Choose Reachy app packaging only after the runtime and distribution requirements are verified.

## Testing strategy

Use deterministic tests for command limits, sign conventions, session invalidation, stale-frame rejection, loss transitions, and Stop races. Replay labeled sequences to compare classification policies and controllers. Use live robot trials for physical behavior, oscillation, settling, and end-to-end latency; mocks cannot establish these properties.

Do not gate development on a broad test suite for incidental UI details. Prioritize the invariants that determine whether old or incorrect observations can move the robot.

## Decisions to resolve in the destination project

- Which Reachy Mini variant and host will run the service?
- Is the goal a visible Decisions API experiment, the smoothest practical tracker, or both? This plan assumes both, delivered in that order.
- What target classes and motion speeds define success?
- Is click selection acceptable for hybrid acquisition, or must acquisition be entirely language-driven?
- What API request budget and acceptable cloud image handling apply?
- Which Decisions model and schema are available to the account at implementation time?

## References and evidence boundaries

- Existing Decisions integration: `app/api/decide/route.ts` and `README.md` in this temporary workspace. This is local implementation evidence, not an assertion of generally available endpoint support.
- [OpenAI images and vision documentation](https://developers.openai.com/api/docs/guides/images-vision): general image-input guidance and spatial-localization limitations; not a specification for the Decisions endpoint.
- [Reachy Mini head tracking](https://huggingface.co/docs/reachy_mini/examples/head_tracking): reference for local face following; does not establish arbitrary-object tracking or the exact OpenAI demo architecture.
