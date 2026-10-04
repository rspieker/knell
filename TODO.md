# TODO

## Up next

- [ ] **Render templates in tests** — tests compare template strings but never
      evaluate them, which let `value_json.values` (a dict method in Jinja)
      through. Evaluate them the way HA would.
- [ ] **Fewer requests** — workflows cost ~45 REST requests per poll (~90 an
      hour of 5000). Conditional requests (`ETag` / `If-None-Match`) are free
      when nothing changed; worth it once more bells share the limit.

## Next

- [ ] **Remote** — `rspieker/knell` or `konfirm/knell`; prerequisite for the next two.
- [ ] **Docker** — `node:24-alpine`, non-root, `CMD ["node", "source/main.ts"]`,
      multi-arch (amd64 + arm64) for NAS / HA host / Pi, `compose.yaml` example.
- [ ] **CI** — GitHub Actions: `npm run check` and `npm test` on Node 24;
      publish the image to GHCR on release.
- [ ] **launchd agent** — run knell at login on the laptop without a terminal,
      logging to `~/Library/Logs/knell.log`.

## Known gaps

- `source/mqtt.ts` and `source/main.ts` have no automated tests; they were
  verified live against Mosquitto (connect, retry, graceful stop, last will).
- Devices left over from an earlier run are removed on the first poll, unless
  the broker delivers their retained configs only after it; then on the next.
- Pull request attributes and the latest branch consider the first 100 of each.
- Workflow runs: the latest 20 per workflow are considered; a long-lived
  branch without a run among those reports nothing.
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

- **Keep or deprecate** — an overview of repositories gone quiet without being
  archived: the fine line between "kept in case I return to it" and "never
  again", which deserves a deliberate archive rather than abandonment.
  Possibly no more than a long `GITHUB_ACTIVE_DAYS` and a card judging age.

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

## Origins, and a debt upstream

knell is an idea that had been slumbering for a while: a bell for whatever
deserves announcing in HA. What woke it was the core GitHub integration
following the repositories you starred, while a developer mostly wants to
follow the ones they maintain. Should the mood ever strike, the request
below is ready to be filed (check the integration's current behaviour first,
it may have moved on).

<details>
<summary>Draft feature request: GitHub integration, follow repositories by owner</summary>

**Title:** GitHub: follow all (active) repositories of a user or organization

**The problem:** the integration is built around following individual
repositories, starred ones in particular. Developers maintaining their own
repositories, across a personal account and an organization or two, want
the opposite: every repository they own, appearing as it is created and
disappearing as it is archived or goes dormant, without revisiting the
integration's configuration.

**Proposal:** an option to follow repositories by owner (users and/or
organizations), with filters for visibility, archived, forks and recent
activity (e.g. "pushed within the last year"). GitHub's search API covers
all of this in a single paginated GraphQL query
(`user:a user:b is:public archived:false pushed:>=YYYY-MM-DD`).

**Worth knowing:** search silently omits owners a token may not see (e.g.
an organization rejecting fine-grained tokens living longer than 366 days),
so verify each owner first rather than removing its repositories.

**Prior art:** a working implementation as MQTT discovery, including the
per-repository entities (last commit, last push, latest branch, pull
requests, issues, check status, latest release, stars, forks): knell.

</details>

## The civil service

- **actuary** — trend prediction from collected history: stars per month,
  pull request age, time between releases, "this repository is going quiet".
  HA's long-term statistics (`state_class`) already keep the history.
- **auditor** — cross-checking HA state against reality: entities stuck
  *unavailable* or not updated for too long, batteries running low, devices
  HA thinks exist but that no longer answer. Needs subscribing to HA state,
  which the transport already supports.
