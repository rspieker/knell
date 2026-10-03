# TODO

## Next

- [ ] **Remote** — `rspieker/knell` or `konfirm/knell`; prerequisite for the next two.
- [ ] **Docker** — `node:24-alpine`, non-root, `CMD ["node", "source/main.ts"]`,
      multi-arch (amd64 + arm64) for NAS / HA host / Pi, `compose.yaml` example.
- [ ] **CI** — GitHub Actions: `npm run check` and `npm test` on Node 24;
      publish the image to GHCR on release.
- [ ] **launchd agent** — run knell at login on the laptop without a terminal,
      logging to `~/Library/Logs/knell.log`.
- [ ] **`npm run forget`** — clear every retained knell topic (discovery,
      states, statuses), removing all knell devices from HA in one go.

## Known gaps

- `source/mqtt.ts` and `source/main.ts` have no automated tests; they were
  verified live against Mosquitto (connect, retry, graceful stop, last will).
- Devices left over from an earlier run are removed on the first poll, unless
  the broker delivers their retained configs only after it; then on the next.
- Pull request attributes and the latest branch consider the first 100 of each.
- Actions only reflects the default branch head; repositories without checks
  get a permanently *unknown* entity. Leave it out for those instead?
- HA's birth message (`homeassistant/status`) is ignored, which is fine while
  everything is retained; a broker losing its retained store would leave HA
  empty until knell's next poll.
- Deviations from `~/TOOLCHAIN.md` / `~/CONVENTIONS.md` worth recording there:
  - a service, not a library: no bundler, no npm publish, no release-it;
  - only `typescript` and `@types/node` as dev dependencies (Biome via editor,
    coverage via `node --experimental-test-coverage`);
  - TypeScript 7 (type checking only);
  - type stripping rejects `<Type>value` casts, so `value as Type` it is.
- The laptop runs Node 22; `engines` says 24.

## GitHub, more to announce

- **Unreleased commits** — commits on the default branch since the latest
  release: a "release due" sensor.
- **Oldest open pull request** age as its own sensor (now an attribute), and
  review requests waiting on you.
- **Dependabot** — open dependency update PRs, and security alerts (needs the
  *Dependabot alerts* read permission per repository).
- **Last failed workflow run** — which workflow, when, link; also catches
  scheduled workflows failing off the default branch head.
- **Traffic** — views and clones (needs push access, so a different token).

## More bells

- **npm** — per package: latest version, weekly downloads, deprecation; and
  whether the latest GitHub release made it to npm (half auditor already).
- **Certificates & domains** — days until TLS certificate and domain
  registration expiry for your own sites.
- **Endpoints** — status code and response time of your own services.
- **Dependencies** — outdated or vulnerable dependencies across your active
  repositories, from the npm registry and GitHub advisories.
- **The laptop itself** — last Time Machine backup, pending macOS updates,
  outdated Homebrew packages, free disk space. Knell runs there anyway.
- **Container images** — age of your GHCR images, newer base images available.

Check first whether HA already does a bell well (it has integrations for
certificate expiry, ping and many more); knell is for what it doesn't.

## The civil service

- **actuary** — trend prediction from collected history: stars per month,
  pull request age, time between releases, "this repository is going quiet".
  HA's long-term statistics (`state_class`) already keep the history.
- **auditor** — cross-checking HA state against reality: entities stuck
  *unavailable* or not updated for too long, batteries running low, devices
  HA thinks exist but that no longer answer. Needs subscribing to HA state,
  which the transport already supports.
