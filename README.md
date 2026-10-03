# knell

Announces whatever you bolt on to Home Assistant, by way of MQTT discovery.
GitHub is merely the first bell.

1. On boot, knell publishes **retained discovery payloads** so entities
   materialize in HA automatically (surviving restarts of either side).
2. On an interval, it polls your sources and publishes plain states.
3. A last will (`availability`) flips every entity to *unavailable*
   if the bell stops ringing — silence is itself an announcement.

New data sources cost a publisher function, nothing else.

## Configuration

Environment variables, because twelve-factor is a lifestyle too:

| Variable             | Purpose                                         | Default |
|----------------------|-------------------------------------------------|---------|
| `MQTT_URL`           | Broker, e.g. `mqtt://homeassistant.local:1883`  | —       |
| `MQTT_USER`          | Broker username (HA user)                       | —       |
| `MQTT_PASS`          | Broker password                                 | —       |
| `INTERVAL`           | Poll interval in minutes                        | `30`    |
| `GITHUB_TOKEN`       | Fine-grained token, public repositories (read-only) | —   |
| `GITHUB_OWNERS`      | Users and/or orgs, comma separated              | —       |
| `GITHUB_ACTIVE_DAYS` | Only repos pushed to within this many days      | `365`   |
| `GITHUB_EXCLUDE`     | Globs to skip, e.g. `konfirm/sandbox,*/scratch-*` | —     |

### GitHub

Every public, non-archived, non-forked repository of `GITHUB_OWNERS` that saw
a push within `GITHUB_ACTIVE_DAYS` becomes a device in HA. New repositories
appear on their own; repositories going quiet (or excluded) are removed.

Each device carries: last commit, last push, latest branch, pull requests,
issues, actions (a *problem* sensor), latest release, stars and forks.

## Running

Requires Node 24+, which runs the TypeScript sources directly — no build step.

```sh
cp .env.example .env   # fill it in
npm ci --omit=dev
npm start
```

## Naming

- **knell** — the bell that announces. Tolling, so you don't have to
  send to know for whom.
- Future bolt-ons already reserved: **actuary** (trend prediction from
  collected history) and **auditor** (cross-checking HA state against
  reality). A small, ominous civil service.

## License

MIT — toll freely.
