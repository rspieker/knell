# knell

> Something happened in one of your repositories. Something else didn't. Either way, Home Assistant ought to know.

> A bell, rung on schedule. It does not judge the news, nor soften it, nor wonder whether you wanted to hear it. It announces. It waits. It announces again. And should it ever stop, that, too, is news.

Announces whatever you bolt on to Home Assistant, by way of MQTT discovery.
GitHub is merely the first bell.

Design principle: **announce everything, remember nothing, fall silent audibly.**
knell keeps no state of its own; the broker remembers what was announced, and
the broker announces when knell is gone.

---

## When to use this

- You maintain more repositories than you look at. Some of them have started to notice.
- A build went red on Tuesday. You found out on Friday, from a stranger.
- Your dashboard knows the temperature of the fridge, but not whether anyone ever merged that pull request.
- You would rather be told than go and check. Checking is where mornings go to die.
- Something should have happened by now, and the silence is beginning to sound deliberate.

---

## Why not…

- **The Home Assistant GitHub integration** — it follows the repositories you starred, which is a different relationship altogether.
- **REST or command line sensors** — one hand-written entity at a time, and nobody tells them when a repository is born or laid to rest.
- **GitHub notifications** — they arrive in your inbox, where announcements go to wait.
- **Checking github.com** — you have to go there. That is rather the point.

---

## How it works

1. On boot, knell publishes **retained discovery payloads** so entities
   materialize in HA automatically (surviving restarts of either side).
2. On an interval, it polls your sources and publishes plain states.
3. A last will (`availability`) flips every entity to *unavailable*
   if the bell stops ringing — silence is itself an announcement.

New data sources cost a publisher function, nothing else.

---

## Running

Requires Node 24+, which runs the TypeScript sources directly — no build step.

```sh
cp .env.example .env   # fill it in
npm ci --omit=dev
npm start
```

While knell is down (or the laptop it runs on sleeps), its devices remain in
HA as *unavailable*; the first poll after coming back revives them.

To remove every device knell ever announced, stop it and run `npm run forget`.
Starting it again announces everything afresh.

---

## Configuration

Environment variables, because twelve-factor is a lifestyle too. `npm start`
reads them from `.env` when present.

| Variable             | Purpose                                             | Default                          |
|----------------------|-----------------------------------------------------|----------------------------------|
| `MQTT_URL`           | Broker, e.g. `mqtt://homeassistant.local:1883`      | —                                |
| `MQTT_USER`          | Broker username (HA user)                           | —                                |
| `MQTT_PASS`          | Broker password                                     | —                                |
| `INTERVAL`           | Poll interval in minutes                            | `30`                             |
| `LOG_LEVEL`          | `debug`, `info`, `warn` or `error`                  | `info`                           |
| `GITHUB_TOKEN`       | Fine-grained token, public repositories (read-only) | —                                |
| `GITHUB_OWNERS`      | Users and/or orgs, comma separated                  | —                                |
| `GITHUB_ACTIVE_DAYS` | Only repos pushed to within this many days          | `365`                            |
| `GITHUB_EXCLUDE`     | Globs to skip, e.g. `konfirm/sandbox,*/scratch-*`   | —                                |
| `GITHUB_TESTS`       | Globs recognising test workflows (name or file)     | `test*`                          |
| `GITHUB_BRANCHES`    | Globs of long-lived branches, besides the default   | `main,master,develop,release*`   |

A source without its configuration (e.g. no `GITHUB_TOKEN`) simply stays
silent. An unreachable broker is retried every five seconds.

---

## Bells

Every bell is a device of its own, through which its devices are connected,
reporting on itself: whether its last poll failed (and why), when it last
succeeded and how many devices it announced. It stays available while its
source does not, as that is precisely when it has something to say.

Entity ids follow `<domain>.knell_<bell>_<device>_<entity>`, e.g.
`sensor.knell_github_rspieker_tui_issues`, so wildcards like
`sensor.knell_github_*_last_push` select a bell's devices.

### GitHub

Every public, non-archived, non-forked repository of `GITHUB_OWNERS` that saw
a push within `GITHUB_ACTIVE_DAYS` becomes a device in HA, with its latest
release as version. New repositories appear on their own; repositories going
quiet (or excluded) are removed — quietly, as is only fitting.

| Entity         | Type                         | Attributes                                         |
|----------------|------------------------------|----------------------------------------------------|
| Last commit    | timestamp (default branch)   | branch, sha, message, author, commit               |
| Last push      | timestamp (any branch)       |                                                    |
| Latest branch  | branch with newest commit    | committed, default_branch, branches                |
| Pull requests  | open count                   | drafts, oldest                                     |
| Issues         | open count                   |                                                    |
| Latest release | tag                          | published, release                                 |
| Stars          | count                        |                                                    |
| Forks          | count                        |                                                    |
| Tests          | *problem* binary sensor      | default_branch, workflows                          |
| Workflows      | *problem* binary sensor      | default_branch, workflows, failing_branches        |

Every entity also carries `repository` and `url`. The bell adds a **Rate
limit** entity: requests remaining, per GitHub resource in its attributes.

**Workflows** are judged by their latest completed run on each long-lived
branch: the default one and those matching `GITHUB_BRANCHES`. Workflows only
running for pull requests are judged by those instead. *Problem* means such a
run failed (or timed out), or GitHub disabled a scheduled workflow for
inactivity, which it does after 60 days without activity, telling no one.
Failures on other branches are listed in `failing_branches`: reported, not
judged. **Tests** are the workflows matching `GITHUB_TESTS`, judged alike.

Both appear only where there is something to report: a repository without
workflows that ran gets neither, rather than a permanent *unknown*. Per
workflow, the attributes hold its name, file, state and latest run
(conclusion, event, branch, when, url), as well as the latest run for each
long-lived branch, leaving any further judgement to HA.

The token needs no permissions beyond public read access, which covers every
owner at once. Organizations may refuse fine-grained tokens living longer
than 366 days; GitHub search quietly omits owners a token may not see, so
knell checks every owner first and goes *unavailable* with GitHub's reason
rather than removing their repositories.

#### On the dashboard

knell provides; HA interprets. [`examples/knell.jinja`](examples/knell.jinja)
holds template macros deciding what deserves attention, written once, and
[`examples/repositories.yaml`](examples/repositories.yaml) an
[auto-entities](https://github.com/thomasloven/lovelace-auto-entities) card
showing every repository as a
[Mushroom](https://github.com/piitaya/lovelace-mushroom) card, most recently
pushed first, new repositories included.

---

## How it talks MQTT

| Topic                                   | Payload                                   |
|-----------------------------------------|-------------------------------------------|
| `knell/status`                          | `online` / `offline` (last will)          |
| `knell/<source>/status`                 | `online` / `offline` (last poll's result) |
| `homeassistant/device/<id>/config`      | device discovery, one per device          |
| `knell/<source>/state`                  | `{ values, attributes }` of the bell      |
| `knell/<source>/<device>/state`         | `{ values, attributes }` of all entities  |

Everything is retained, so the broker doubles as knell's memory: on boot it
reads back its own discovery payloads to remove devices that no longer
exist, and entities a device no longer has. Entities require both status
topics to be `online`, so a failing source reads differently from a knell
that is gone. Payloads from other integrations are never touched.

Deleting a device in HA is a polite suggestion: as long as its source still
returns it, the next poll brings it back. To be rid of it, exclude it at the
source.

---

## Adding a bell

A source returns devices; the rest — discovery, state, removal,
availability — is knell's business, and knell is particular about its business.

```ts
import type { Source } from './device.ts';

export const weather: Source = {
	id: 'weather',
	name: 'Weather', // optional, names the bell device
	interval: 10, // minutes, optional
	async poll() {
		return {
			devices: [{
				id: 'garden',
				name: 'Garden',
				entities: [
					{ key: 'temperature', name: 'Temperature', component: 'sensor', value: 21.5,
						config: { device_class: 'temperature', unit_of_measurement: '°C' } },
				],
			}],
			entities: [], // optional, of the bell itself
		};
	},
};
```

Register it in `source/main.ts`. Anything in `config` is passed to HA as is.

---

## Development

```sh
npm run check      # type check (tsc, no emit)
npm test           # unit (source/**/*.spec.ts) and integration (test/**)
npm run test:coverage
```

Integration tests run knell against an in-memory broker
(`test/broker.ts`) and recorded GitHub responses (`test/fixtures`).
Formatting and linting follow `biome.json`, applied by the editor.

See [TODO.md](TODO.md) for what's next.

---

## Naming

- **knell** — the bell that announces. Tolling, so you don't have to
  send to know for whom.
- Future bolt-ons already reserved: **actuary** (trend prediction from
  collected history) and **auditor** (cross-checking HA state against
  reality). A small, ominous civil service.

---

## License

MIT — toll freely.
