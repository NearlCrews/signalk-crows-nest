<h3 align="center">SignalK Active Captain Resources</h3>

<div align="center">

[![Release](https://img.shields.io/github/v/release/KvotheBloodless/signalk-activecaptain-resources)](https://github.com/KvotheBloodless/signalk-activecaptain-resources/releases)
[![GitHub Issues](https://img.shields.io/github/issues/KvotheBloodless/signalk-activecaptain-resources)](https://github.com/KvotheBloodless/signalk-activecaptain-resources/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/KvotheBloodless/signalk-activecaptain-resources)](https://github.com/KvotheBloodless/signalk-activecaptain-resources/pulls)
[![License](https://img.shields.io/github/license/KvotheBloodless/signalk-activecaptain-resources)](https://github.com/KvotheBloodless/signalk-activecaptain-resources?tab=MIT-1-ov-file#readme)

</div>

---

<p align="center">A plugin for the node.js <a href="https://github.com/SignalK/signalk-server">Signal K server</a> for boats to import points of interest from the <a href = "https://marine.garmin.com/thirdparty-stage/swagger/index.html">Garmin Active Captain API</a> and make these available as resources.
    <br> 
</p>

## 📝 Table of Contents

- [About](#about)
- [Getting Started](#getting_started)
- [Configuration](#configuration)
- [Usage](#usage)
- [Development](#development)
- [Authors](#authors)

## 🧐 About <a name = "about"></a>

 * Garmin's ActiveCaptain brings together the large boating community enabling sharing of information making boating safer, less expensive, and more enjoyable.

 * Signal K is an open source server application that runs as a central information hub on a boat. It centralises data, provides a rich API to consume the data, and is extensible through a comprehensive suite of plugins (such as this one) and web applications.

 * Freeboard is a powerful chart plotter web application that runs as a webapp on the Signal K server.

This plugin's purpose is to bring together these 3 components by making information from the ActiveCaptain API available as resources through the Signal K server which can then be consumed and displayed by Freeboard as an extra layer of information on the chart.

## 🏁 Getting Started <a name = "getting_started"></a>

These instructions will get you up and running.

### Prerequisites

 * A running instance of the Signal K node server with a position source (a GPS).

Instructions [here](https://github.com/SignalK/signalk-server/blob/master/README.md)

### Installing this plugin

Through the Signal K server Appstore, search for signalk-activecaptain-resources, and click the Install button.

![Signal K AppStore search](assets/search.png)

## ⚙️ Configuration <a name = "configuration"></a>

In the Signal K menu, head to Server -> Plugin Config, and find Garmin Active Captain Resources then enable the plugin. The default values are fine to start with, so you can just click Save.

The plugin ships its own configuration panel. Instead of the generic settings form, it shows a live status section (Garmin API reachability, cached point-of-interest count, last fetch, and recent errors), a cache-duration field, and the point-of-interest types arranged in labelled groups with All and None buttons. The panel requires Signal K admin UI 2.26.0 or newer; on older servers the plugin still works and falls back to the standard settings form.

<img width="996" alt="image" src="https://github.com/user-attachments/assets/1f3a0ebd-598d-40e7-847b-ae7ccb7c4607" />

The following options are available:

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| How long to cache data from Active Captain in minutes | number | 60 | Longer caching means less data traffic; shorter caching means more up to date data. |
| Include marinas | boolean | true | Include marina points of interest. |
| Include anchorages | boolean | true | Include anchorage points of interest. |
| Include hazards | boolean | true | Include hazard points of interest. |
| Include businesses | boolean | true | Include business points of interest. |
| Include boat ramps | boolean | true | Include boat ramp points of interest. |
| Include bridges | boolean | true | Include bridge points of interest. |
| Include dams | boolean | true | Include dam points of interest. |
| Include ferries | boolean | true | Include ferry points of interest. |
| Include inlets | boolean | true | Include inlet points of interest. |
| Include locks | boolean | true | Include lock points of interest. |
| Include local knowledge | boolean | true | Include local knowledge points of interest. |
| Include navigational aids | boolean | true | Include navigational aid points of interest. |
| Include airports | boolean | true | Include airport points of interest. |

Deselecting every POI type makes the plugin import nothing. A configuration
created before these toggles existed, which carries none of the toggle
settings, instead falls back to including all types so an upgrade keeps working
until the plugin is reconfigured.

## 🎈 Usage <a name="usage"></a>

In the Signal K menu, head to Webapps and launch Freeboard-SK. Enjoy the new information.

<img width="652" alt="image" src="https://github.com/user-attachments/assets/a0a83f64-b853-4381-9b5b-5434605d5eee" />

## 🛠️ Development <a name = "development"></a>

The plugin is written in TypeScript. The Node plugin under `src/` (excluding `src/panel/`) is compiled to `dist/` by the TypeScript compiler. The React configuration panel under `src/panel/` is bundled to `public/` by webpack as a Module Federation remote. Both `dist/` and `public/` are published to npm.

### Requirements

 * Node.js 20 or newer.

### Setup

```sh
npm install
```

### Common tasks

| Command | Description |
| ------- | ----------- |
| `npm run build` | Build the plugin and the configuration panel. |
| `npm run build:plugin` | Compile `src/` to `dist/`. |
| `npm run build:panel` | Bundle the React panel to `public/`. |
| `npm test` | Run the test suite under `test/`. |
| `npm run typecheck` | Type-check the plugin, the panel, and the tests. |
| `npm run lint` | Lint with ESLint 9 and neostandard. |
| `npm run lint:fix` | Lint and auto-fix. |
| `npm run clean` | Remove `dist/` and the panel build artifacts. |

See [docs/development.md](docs/development.md) for the build, test, and release
workflow, [CLAUDE.md](CLAUDE.md) for the project architecture and module
layout, and [CONTRIBUTING.md](.github/CONTRIBUTING.md) for how to contribute.
Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## ✍️ Authors <a name = "authors"></a>

- [@KvotheBloodless](https://github.com/KvotheBloodless) - Idea & Initial work

<a href="https://www.buymeacoffee.com/KvotheBloodless" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>


See also the list of [contributors](https://github.com/KvotheBloodless/signalk-activecaptain-resources/graphs/contributors) who participated in this project.
