# Trailhead

> Your footsteps become the trail.

A learning companion that never hands you a curriculum. It follows your
curiosity, draws the map afterwards from where you actually went, checks what you
really remember, and when a prerequisite is missing, fills in only that piece.

**Meta Global AI Developer Hackathon. Problem statement: Build for Your World.**

## The problem

This solves a learning problem I live with as someone with ADHD.

A curriculum gets abandoned, because following a plan to the end is the very thing
that doesn't happen. "Review your notes later" fails for the same reason: later
never comes. And a mind map that gets generated and handed over is a nice artifact
that nobody opens again.

What actually happens is that you wander, and you ask the same question again. So
Trailhead doesn't ask you to change. It works from what you already do.

Trailhead is a tool that helps with learning. It doesn't diagnose, treat or
measure anything about ADHD or attention.

## What it does

- **No curriculum up front.** Say "I want to learn AI" and it asks what brought you
  to it, once. A broad interest is enough: ask for the big picture or say
  "I don't know" and it starts explaining that interest with a concrete example,
  without another preference question. Structure is the result of your questions,
  not the input to them. Once you've asked a few things, or when you ask what's next,
  it offers a short path built from them, as buttons you can ignore.
- **Throw anything at it.** Drop or paste a screenshot, photo or diagram. Muse Spark
  works out what it is and places it on the map. It never asks where to file it.
- **The trail draws itself.** Every question and every image grows the map. Wandering
  isn't a flaw to correct: it's recorded as ground you covered.
- **Seeing isn't knowing.** The map tracks what you remember, not what you visited.
- **Fills only the hole.** When a concept depends on something you haven't seen, it
  says so, explains just that one piece, and goes straight back to your question.
- **Tests memory inside the conversation.** When you come back to something related,
  it asks what you remember before saying anything. Fail, and the concept is marked
  fuzzy and re-taught. There are no notifications and no "come back later".

| On the map | Meaning                                                    |
| ---------- | ---------------------------------------------------------- |
| Remembered | Answered a recall check correctly                          |
| Seen       | Looked at, memory not tested yet                           |
| Fuzzy      | Failed a recall check, or untouched for 30 days            |
| Hole       | Needed by another concept, but never looked at             |

## How it uses Meta's models

| Model                        | What it does here                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Muse Spark 1.3** (reading) | Reads every turn through structured output: which concepts it touches, their prerequisites, which one is blocking, and whether the learner is coming back or wrapping up. Grades recall answers. Understands thrown images. |
| **Muse Spark 1.3** (reply)   | Streams a reply that carries out what the turn was decided to do: fill one hole, test memory, re-teach what the learner saw before.                                                                                               |
| **SAM 3.1**                  | Picks the key region out of a thrown image, drawn over the image in the chat and cropped as the concept's thumbnail on the map. If it finds nothing, the turn carries on without it.                                             |

Without the reading step there is no map, no holes and no grading, so the product
doesn't exist without it. Muse Wonder isn't used, because it isn't available in South
Korea.

### One turn

```text
message + image + the trail so far
        │
        ▼
Muse Spark reads the turn ──────► structured JSON
        │
        ▼
engine (plain TypeScript) ──────► updates the map and decides the one thing to do:
        │                         fill a hole, test memory, offer a return, or answer
        ├──► the map updates in the browser: a new hole appears
        ▼
Muse Spark streams the reply, following that decision   (SAM 3.1 runs separately)
        │
        ▼
reply delivered ────────────────► the hole counts as filled, and the path extends
```

The model reads and writes. The state machine in
[`lib/trail/engine.ts`](lib/trail/engine.ts) decides, so what happens to the map never
depends on how a reply is worded, and every rule has a unit test.

## Getting started

Requires Node.js 22.9 or later.

```bash
npm install
cp .env.example .env.local   # then set MODEL_API_KEY, AUTH_EMAIL and AUTH_PASSWORD
npm run smoke                # checks the real API and rehearses the demo
npm run dev
```

Open <http://localhost:3000> and sign in with `AUTH_EMAIL` and `AUTH_PASSWORD`. Use
`localhost`: the dev server doesn't serve its scripts to `127.0.0.1`, and the page then
looks fine but does nothing.

`npm run smoke` calls the real API and costs about $0.10 per run.

## Try the demo flow

1. Say `I want to learn AI`. It asks one optional question about your interest.
   Say `I don't know` or `I want to understand ML, DL and LLMs as a whole` and it
   starts explaining. A direct request such as `Teach me AI` starts immediately.
2. Ask a question or two, and drop a screenshot. The trail grows on the right, and after
   a few questions a short suggested path appears under the reply.
3. Ask `Explain backpropagation`. A hole appears for what it rests on, such as the chain
   rule. Only that piece gets explained, then the reply returns to backpropagation, and
   the other holes stay on the map.
4. Press **+7d** to simulate a week passing, then ask something related, such as
   `How do you train a CNN?`. It tests your memory first. Stumble, and the concept turns
   fuzzy, gets re-taught, and the conversation goes back to your question.
5. Reload the page. The trail and the conversation are still there, ready to continue.

The time buttons exist for this demo, so the passing of days can be shown in minutes.
The interface is in English, with a switch to Korean at the top. Replies follow the
language you write in, so the whole flow works in either.

## Scope

There are no learner accounts: one email and password, set on the server, keep
strangers from spending the API credits. Your trail, conversation and images are
saved in this browser's IndexedDB, so they're still there when you come back days
later, which is when memory checks really come due. **New trail** erases them.
Nothing about a learner is stored on the server, so a trail doesn't follow you to
another browser or device, and clearing site data erases it. Dropped images are
sent to the Meta Model API with the turn they were dropped in, and later turns
carry only the text description.

## Scripts

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Starts the development server                      |
| `npm run build`     | Creates a production build                         |
| `npm run smoke`     | Checks the real Meta Model API and rehearses the demo |
| `npm run test`      | Runs the unit tests (no API key needed)            |
| `npm run typecheck` | Type-checks the project                            |
| `npm run lint`      | Lints the project                                  |

## Project layout

```text
app/
  page.tsx            The app: conversation on the left, trail on the right
  login/              The sign-in page
  api/turn/           One learner turn: read, decide, reply
  api/region/         SAM 3.1: the key region of a dropped image
  api/login/          Checks the email and password and starts a session
components/
  trail/              The conversation, the map, its details and the sign-in form
  ui/                 shadcn/ui components
lib/
  trail/
    engine.ts         The state machine: map updates and what each turn does
    analysis.ts       The structured output schema for reading a turn
    analyze.ts        Muse Spark and SAM 3.1 calls for reading a turn
    prompts.ts        What the reading and the reply are told
    types.ts          Knowledge nodes, traces and turn plans
    layout.ts         Where each concept sits on the map
    image.ts          Shrinking dropped images in the browser
    request.ts        What the browser sends for each turn
    session.ts        What gets saved, and checking it when it's read back
    session-store.ts  Saving the session in this browser's IndexedDB
    copy.ts           English and Korean interface text
  meta/               Meta Model API configuration, clients and SAM parsing
  api/                Request parsing and error mapping
  guard/              Sign-in sessions and the rate limiter
proxy.ts              Requires sign-in everywhere and rate-limits every /api route
scripts/smoke.ts      End-to-end check and demo rehearsal against the real API
Dockerfile            The app's container image
compose.yaml          The public demo: the app and its own Tailscale node
deploy/tailscale/     What that Tailscale node makes public
```

## Configuration

See [`.env.example`](.env.example). The API key and the sign-in values are read on the
server only. Until `AUTH_EMAIL` and `AUTH_PASSWORD` are both set, nobody can get in.

## Deploying

The public demo runs in containers ([`compose.yaml`](compose.yaml)). The app has a
read-only filesystem, runs without root and drops every capability. It shares the
network of its own Tailscale node, which makes only the app public through Funnel, so
the machine underneath stays private.

The tailnet needs HTTPS certificates turned on, and its policy has to grant the node the
`funnel` attribute.

```bash
cp .env.example .env.local   # then set MODEL_API_KEY, AUTH_EMAIL and AUTH_PASSWORD

# Log the node in once. Its normal start gives up after 60 seconds and changes the link.
docker compose run --rm --no-deps --entrypoint sh tailscale -c 'tailscaled --statedir=/var/lib/tailscale --tun=userspace-networking --socket=/tmp/ts.sock >/dev/null 2>&1 & sleep 3; tailscale --socket=/tmp/ts.sock up --hostname=trailhead-demo'

docker compose up -d --build
```

These values are passed in when the container starts and never go into the image. To update
the app and leave the node alone, run `git pull && docker compose up -d --build web`.

## Built during the hackathon

This repository was started during the hackathon's building period (Oct 27 to Nov 4,
2026, ET). Everything in it was written during that period, apart from open-source
dependencies and the generated shadcn/ui components in `components/ui/`. The commit
history shows how it was built.

## License

Trailhead is source-available under the [Sustainable Use License](LICENSE.md), the same
license [n8n](https://github.com/n8n-io/n8n) uses. The code is public, and you can use and
modify it for free for personal or non-commercial use or inside your own company. Selling
it, or offering it to others as a paid service, isn't allowed. Third-party components keep
their own licenses.
