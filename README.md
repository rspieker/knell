# knell

Announces whatever you bolt on to Home Assistant, by way of MQTT discovery.
GitHub is merely the first bell.

1. On boot, knell publishes **retained discovery payloads** so entities
   materialize in HA automatically (surviving restarts of either side).
2. On an interval, it polls your sources and publishes plain states.
3. A last will (`availability`) flips every entity to *unavailable*
   if the bell stops ringing — silence is itself an announcement.

New data sources cost a publisher function, nothing else.

## Running

Requires Node 24+, which runs the TypeScript sources directly — no build step.

```sh
cp .env.example .env   # fill it in
npm ci --omit=dev
npm start
```

While knell is down (or the laptop it runs on sleeps), its devices remain in
HA as *unavailable*; the first poll after coming back revives them.

## Configuration

Environment variables, because twelve-factor is a lifestyle too. `npm start`
reads them from `.env` when present.

| Variable             | Purpose                                             | Default |
|----------------------|-----------------------------------------------------|---------|
| `MQTT_URL`           | Broker, e.g. `mqtt://homeassistant.local:1883`      | —       |
| `MQTT_USER`          | Broker username (HA user)                           | —       |
| `MQTT_PASS`          | Broker password                                     | —       |
| `INTERVAL`           | Poll interval in minutes                            | `30`    |
| `LOG_LEVEL`          | `debug`, `info`, `warn` or `error`                  | `info`  |
| `GITHUB_TOKEN`       | Fine-grained token, public repositories (read-only) | —       |
| `GITHUB_OWNERS`      | Users and/or orgs, comma separated                  | —       |
| `GITHUB_ACTIVE_DAYS` | Only repos pushed to within this many days          | `365`   |
| `GITHUB_EXCLUDE`     | Globs to skip, e.g. `konfirm/sandbox,*/scratch-*`   | —       |

A source without its configuration (e.g. no `GITHUB_TOKEN`) simply stays
silent. An unreachable broker is retried every five seconds.

## Bells

### GitHub

Every public, non-archived, non-forked repository of `GITHUB_OWNERS` that saw
a push within `GITHUB_ACTIVE_DAYS` becomes a device in HA, with its latest
release as version. New repositories appear on their own; repositories going
quiet (or excluded) are removed.

| Entity         | Type                         | Attributes                               |
|----------------|------------------------------|------------------------------------------|
| Last commit    | timestamp (default branch)   | branch, sha, message, author, url        |
| Last push      | timestamp (any branch)       |                                          |
| Latest branch  | branch with newest commit    | committed, branches                      |
| Pull requests  | open count                   | drafts, oldest                           |
| Issues         | open count                   |                                          |
| Actions        | *problem* binary sensor      | state (`success`, `failure`, `pending`…) |
| Latest release | tag                          | published, url                           |
| Stars          | count                        |                                          |
| Forks          | count                        |                                          |

Actions reflects the combined checks on the default branch head: *problem*
on failure or error, *OK* otherwise, *unknown* for repositories without
checks.

The token needs no permissions beyond public read access, which covers every
owner at once. Organizations may refuse fine-grained tokens living longer
than 366 days; GitHub search quietly omits owners a token may not see, so
knell checks every owner first and goes *unavailable* with GitHub's reason
rather than removing their repositories.

## How it talks MQTT

| Topic                                   | Payload                                   |
|-----------------------------------------|-------------------------------------------|
| `knell/status`                          | `online` / `offline` (last will)          |
| `knell/<source>/status`                 | `online` / `offline` (last poll's result) |
| `homeassistant/device/<id>/config`      | device discovery, one per device          |
| `knell/<source>/<device>/state`         | `{ values, attributes }` of all entities  |

Everything is retained, so the broker doubles as knell's memory: on boot it
reads back its own discovery payloads to remove devices that no longer
exist. Entities require both status topics to be `online`, so a failing
source reads differently from a knell that is gone. Payloads from other
integrations are never touched.

To remove a device by hand, delete it in HA; as long as its source still
returns it, the next poll brings it back, so exclude it at the source.

## Adding a bell

A source returns devices; the rest — discovery, state, removal,
availability — is knell's business.

```ts
import type { Source } from './device.ts';

export const weather: Source = {
	id: 'weather',
	interval: 10, // minutes, optional
	async poll() {
		return [{
			id: 'garden',
			name: 'Garden',
			entities: [
				{ key: 'temperature', name: 'Temperature', component: 'sensor', value: 21.5,
					config: { device_class: 'temperature', unit_of_measurement: '°C' } },
			],
		}];
	},
};
```

Register it in `source/main.ts`. Anything in `config` is passed to HA as is.

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

## Naming

- **knell** — the bell that announces. Tolling, so you don't have to
  send to know for whom.
- Future bolt-ons already reserved: **actuary** (trend prediction from
  collected history) and **auditor** (cross-checking HA state against
  reality). A small, ominous civil service.

## License

MIT — toll freely.
