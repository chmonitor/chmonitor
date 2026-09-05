# Changelog

## [0.1.4](https://github.com/chmonitor/chmonitor/compare/chm-v0.1.3...chm-v0.1.4) (2026-09-05)


### Features

* **cli:** add local named connections ([#3356](https://github.com/chmonitor/chmonitor/issues/3356)) ([2209b61](https://github.com/chmonitor/chmonitor/commit/2209b611ce1ca052c416c481832d7279db63f475))


### Bug Fixes

* **chm:** create credential file with 0600 atomically to close chmod race ([#3228](https://github.com/chmonitor/chmonitor/issues/3228)) ([1790fc9](https://github.com/chmonitor/chmonitor/commit/1790fc96b074cf97c679ebf20e3068a1e6db0aaf)), closes [#3224](https://github.com/chmonitor/chmonitor/issues/3224)
* **cli:** body-read errors, plaintext purge, rust consumer map ([#3337](https://github.com/chmonitor/chmonitor/issues/3337)) ([5421804](https://github.com/chmonitor/chmonitor/commit/5421804554d642ee02d64ea8b1b6cbb413b671e4))
* **rust:** format output.rs chain for stable rustfmt ([#3238](https://github.com/chmonitor/chmonitor/issues/3238)) ([4e81bb5](https://github.com/chmonitor/chmonitor/commit/4e81bb5faeca9535b782b9bcc6f08d927defbab6))
* **rust:** format output.rs chain for stable rustfmt ([#3239](https://github.com/chmonitor/chmonitor/issues/3239)) ([d2901cd](https://github.com/chmonitor/chmonitor/commit/d2901cd5438fb87c632ae0f3619826165398c134))
* **rust:** move output fns before test module for clippy ([#3234](https://github.com/chmonitor/chmonitor/issues/3234)) ([f64dfc8](https://github.com/chmonitor/chmonitor/commit/f64dfc8b7fa1f0b4f5e5d39e57af43f9a35b3c51))

## [0.1.3](https://github.com/chmonitor/chmonitor/compare/chm-v0.1.2...chm-v0.1.3) (2026-08-21)


### Features

* **cli:** brand the default TUI as chmonitor ([#3194](https://github.com/chmonitor/chmonitor/issues/3194)) ([55716b7](https://github.com/chmonitor/chmonitor/commit/55716b7d68656b9679a7d6eaafb761d6b7551c80))
* **cli:** chm update --beta switches channel and upgrades ([#3198](https://github.com/chmonitor/chmonitor/issues/3198)) ([4625b69](https://github.com/chmonitor/chmonitor/commit/4625b697a25a1fd40c29fdda0225bf9419b8c927))
* **cli:** launch interactive TUI by default ([#3193](https://github.com/chmonitor/chmonitor/issues/3193)) ([8e7d9b6](https://github.com/chmonitor/chmonitor/commit/8e7d9b6d263956c8b1809fcc83093085ce0248c8))
* **cli:** make chm doctor the cluster health command ([#3190](https://github.com/chmonitor/chmonitor/issues/3190)) ([8a26be8](https://github.com/chmonitor/chmonitor/commit/8a26be8b73df86cac7e7e69cca3feec96b324b7c))
* **cli:** migrate dashboard list picker to ratatui ([#3207](https://github.com/chmonitor/chmonitor/issues/3207)) ([cd8d2f8](https://github.com/chmonitor/chmonitor/commit/cd8d2f8eb98af2fc9881faa150964ddbe39719a3))
* **cli:** overview chart TUI, dashboard list, interactive config ([#3197](https://github.com/chmonitor/chmonitor/issues/3197)) ([b47b0c7](https://github.com/chmonitor/chmonitor/commit/b47b0c7786f4f1b4be136f54e536e8923dd218f2))


### Bug Fixes

* **cli:** cap live dashboard refresh and prune today query count ([#3204](https://github.com/chmonitor/chmonitor/issues/3204)) ([971ab33](https://github.com/chmonitor/chmonitor/commit/971ab33023f7a36509874be2c84cbee1ca121d35))
* **cli:** drop diagnose, upgrade, and completions ([#3205](https://github.com/chmonitor/chmonitor/issues/3205)) ([0f72b94](https://github.com/chmonitor/chmonitor/commit/0f72b946382266f2de9fa4ae80c9e6afb45e04a1))
* **cli:** exit after chm update and persist --beta/--stable ([#3201](https://github.com/chmonitor/chmonitor/issues/3201)) ([60b4833](https://github.com/chmonitor/chmonitor/commit/60b483388e5a085c728513e531fd406d8c590cb9))
* **cli:** route curl install.sh around Bot Fight Mode 403 ([7d97cf1](https://github.com/chmonitor/chmonitor/commit/7d97cf1546b1a43fc4142ad8bed1560763ce463c))
* **cli:** use clamp for TUI table page size ([#3209](https://github.com/chmonitor/chmonitor/issues/3209)) ([e85a027](https://github.com/chmonitor/chmonitor/commit/e85a027fb784afcc550d553c7418df031abf2cd2))
* **landing:** brand CLI install, beta badge, and What's new scroll ([#3203](https://github.com/chmonitor/chmonitor/issues/3203)) ([43ba12f](https://github.com/chmonitor/chmonitor/commit/43ba12f6868463d11974ee80fcf5de31b2384d4c))

## [Unreleased]

### Features

* **cli:** `chm update --beta` installs the latest beta and saves `channel = "beta"` (`--stable` switches back)
* **cli:** default TUI shows Overview dashboard charts (KPI/sparkline grid)
* **cli:** `chm dashboard list` / `open` (Overview + saved dashboards)
* **cli:** `chm dashboard list` picker uses ratatui (same alt-screen chrome as TUI/config)
* **cli:** interactive `chm config`; `chm config show` prints file layers
* **cli:** launch interactive TUI by default (`chm` with no subcommand; `chm tui` stays an alias)
* **cli:** drop `diagnose`, `upgrade`, and `completions` aliases; keep `chm` TUI, `auth`, `config`, and `update`
* **cli:** make `chm doctor` the cluster health command

## [0.1.2](https://github.com/chmonitor/chmonitor/compare/chm-v0.1.1...chm-v0.1.2) (2026-08-20)


### Features

* **cli:** add chm upgrade alias and explicit update fallbacks ([#3147](https://github.com/chmonitor/chmonitor/issues/3147)) ([7889840](https://github.com/chmonitor/chmonitor/commit/7889840a268ceebd16a0200955bd48e3e4a8fe90))
* **cli:** auth auto-detect, TUI panes, and chm/chmonitor alias ([#3185](https://github.com/chmonitor/chmonitor/issues/3185)) ([dd8db41](https://github.com/chmonitor/chmonitor/commit/dd8db416190a862ccc00ac1b9cbaf486ba75b56e))
* **cli:** chm rewrite with auth, channels, and self-hosted device login ([#3183](https://github.com/chmonitor/chmonitor/issues/3183)) ([91fefb4](https://github.com/chmonitor/chmonitor/commit/91fefb48a452defa83bea8938431f972c8914627))
* **telemetry:** send CHM_LICENSE_KEY on instance ping ([#3142](https://github.com/chmonitor/chmonitor/issues/3142)) ([a65e146](https://github.com/chmonitor/chmonitor/commit/a65e146925de0c68237728536c90ba0e40174ce2))


### Bug Fixes

* **cli:** rank chm-v* tags by semver and polish upgrade UX ([#3149](https://github.com/chmonitor/chmonitor/issues/3149)) ([d62efdf](https://github.com/chmonitor/chmonitor/commit/d62efdf3477109d5c26a76a6e1412a69a5e73230))
* **cli:** rename crate to chmonitor and publish only on stable tags ([#3188](https://github.com/chmonitor/chmonitor/issues/3188)) ([6a4673e](https://github.com/chmonitor/chmonitor/commit/6a4673e219f9913b2e909e1070b472651a9ec08c))

## [0.1.2](https://github.com/chmonitor/chmonitor/compare/chm-v0.1.1...chm-v0.1.2) (2026-08-20)


### Features

* **cli:** modular rewrite — auth device login, layered config, TUI chat, agent/prompt/audit/doctor, channel-aware self-update (stable|beta), default base URL `https://dash.chmonitor.dev`
* **cli:** ship `chmonitor` as an alias of `chm` (second cargo bin + install.sh symlink)


## [0.1.1](https://github.com/chmonitor/chmonitor/compare/chm-v0.1.0...chm-v0.1.1) (2026-08-06)


### Features

* **cli:** chm update — self-update from GitHub releases ([#2831](https://github.com/chmonitor/chmonitor/issues/2831)) ([ee6178b](https://github.com/chmonitor/chmonitor/commit/ee6178b426e67ec42280a5f7bcd4471a2068be89))
* **cli:** one-line install script + crates.io-ready metadata ([#2699](https://github.com/chmonitor/chmonitor/issues/2699)) ([#2731](https://github.com/chmonitor/chmonitor/issues/2731)) ([347f6a7](https://github.com/chmonitor/chmonitor/commit/347f6a7ded02719893da69e0511fce7358007118))
* **cli:** publish ch-monitor-cli to crates.io with a chm binary ([#2745](https://github.com/chmonitor/chmonitor/issues/2745)) ([a04c665](https://github.com/chmonitor/chmonitor/commit/a04c665add92fdd4cd131d7bae0f07a495b48b99)), closes [#2699](https://github.com/chmonitor/chmonitor/issues/2699)
* **telemetry:** CLI telemetry stream + analytics dashboard ([#2833](https://github.com/chmonitor/chmonitor/issues/2833)) ([b13ca71](https://github.com/chmonitor/chmonitor/commit/b13ca7111dcbaba1179d92407254e39a68df5565))
