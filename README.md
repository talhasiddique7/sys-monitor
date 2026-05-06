# System Monitor

A lightweight, professional GNOME Shell extension that displays real-time system resource usage directly in your top panel.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![GNOME](https://img.shields.io/badge/GNOME-40%2B-4a90d9.svg)


## Features

- **CPU Usage** - Real-time CPU utilization percentage
- **GPU Monitoring** - Auto-detects NVIDIA (via nvidia-smi) and AMD GPUs
- **RAM Usage** - Memory consumption with percentage and detailed popup
- **Swap Usage** - Swap space utilization
- **Network Speed** - Live upload/download speeds in KB/s or MB/s

### Visual Indicators

| Color | Threshold | Meaning |
|-------|-----------|---------|
| 🟢 Green | < 60% | Normal usage |
| 🟡 Orange | 60-79% | Warning level |
| 🔴 Red | 80%+ | Critical usage |

### Panel Display

The extension adds compact, icon-based metrics to your GNOME panel:
- CPU, RAM, Swap percentages with dynamic color coding
- Upload and download speeds
- Click for detailed popup with progress bars

## Installation

### Install from GNOME Extensions (Recommended)

The easiest way to install is directly from the GNOME Extensions website:

**[Download from extensions.gnome.org](https://extensions.gnome.org/extension/9838/system-monitor/)**

After installing, enable the extension via the Extensions app or run:
```bash
gnome-extensions enable sysmonitor@talhasiddique7
```

### Quick Install (Manual)

```bash
git clone https://github.com/talhasiddique7/sys-monitor.git
cd sys-monitor
chmod +x install.sh
./install.sh
```

Then restart GNOME Shell:
- **X11**: Press `Alt+F2`, type `r`, press Enter
- **Wayland**: Log out and log back in

Enable the extension:
```bash
gnome-extensions enable sysmonitor@talhasiddique7
```

### Manual Install

1. Copy the extension folder to `~/.local/share/gnome-shell/extensions/sysmonitor@talhasiddique7/`
2. Compile schemas: `glib-compile-schemas schemas/`
3. Restart GNOME Shell and enable via Extensions app

## Configuration

Open **Extensions → System Monitor → Settings** to customize:

| Setting | Description | Default |
|---------|-------------|---------|
| Refresh interval | Update frequency (1-10 seconds) | 2s |
| Show GPU | Display GPU in popup | Enabled |
| Show Swap | Display swap in panel & popup | Enabled |
| Show Network | Display network speeds | Enabled |

## Requirements

- **GNOME Shell**:
  - Main package (`extension.js`/`prefs.js`): 45, 46, 47, 48, 49, 50
  - Legacy package (`extensionLegacy.js`/`prefsLegacy.js`): 40, 41, 42, 43, 44
- **GPU Support** (optional):
  - NVIDIA: `nvidia-smi` must be in PATH
  - AMD: `sysfs` interface at `/sys/class/drm/card0/device/gpu_busy_percent`

## Validation

Run all automated checks with one command:

```bash
make check
```

Build separate upload artifacts for GNOME 40-44 and GNOME 45-50:

```bash
make pack-dual
```

This runs:
- JavaScript syntax checks for `extension.js`, `extensionLegacy.js`, `prefs.js`, and `prefsLegacy.js`
- GSettings schema validation
- `metadata.json` validation
- `install.sh` shell syntax validation
- Extension pack + zip integrity verification
- Unit tests automatically, when a test runner is configured in the project

## Technical Details

The extension reads system data from:
- `/proc/stat` - CPU statistics
- `/proc/meminfo` - Memory and swap info
- `/proc/net/dev` - Network interface statistics

All monitoring is done locally without external dependencies (except for NVIDIA GPU support).

## Screenshots

### Panel View
Compact indicators in the GNOME top panel showing real-time system metrics:

![Panel View](screenshots/panel.png)

### Detailed Popup
Click any panel indicator to open the detailed popup with progress bars:

![Popup View](screenshots/popup.png)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - see LICENSE file for details.

---

**Author**: [@talhasiddique7](https://github.com/talhasiddique7)
