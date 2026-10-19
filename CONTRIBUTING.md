# Contributing

Thanks for helping bake Brot.

1. Read [AGENTS.md](AGENTS.md) (conventions apply to humans too) and the relevant doc in `docs/`.
2. `pnpm install`, then `pnpm dev`.
3. Keep PRs small and scoped to one package where possible.
4. Before opening a PR: `pnpm typecheck && pnpm lint && pnpm test`.
5. UI changes follow [DESIGN.md](DESIGN.md) and include a screenshot (light and dark).
6. Contributions are accepted under the project's licenses. Sign off your commits (`git commit -s`, DCO).

Features that circumvent site protections or enable multi-account automation won't be merged. See [SECURITY.md](SECURITY.md).
