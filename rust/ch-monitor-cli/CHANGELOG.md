# Changelog

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
