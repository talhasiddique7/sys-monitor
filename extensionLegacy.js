// Legacy version for GNOME 40-44 (CommonJS imports)
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const _ = ExtensionUtils.gettext;

function _f(template, ...args) {
    let index = 0;
    return template.replace(/%s/g, () => String(args[index++] ?? ''));
}

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

// ── Helpers: read /proc files (async) ─────────────────────────────────────

async function readFileAsync(path) {
    const file = Gio.File.new_for_path(path);
    try {
        const [data] = await file.load_contents_async(null);
        return new TextDecoder().decode(data);
    } catch { return null; }
}

// CPU: returns { user, nice, system, idle, total }
let _prevCpu = null;
async function getCpuPercent() {
    const raw = await readFileAsync('/proc/stat');
    if (!raw) return 0;
    const line = raw.split('\n')[0];
    const vals = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = vals[3] + vals[4];
    const total = vals.reduce((a, b) => a + b, 0);
    if (_prevCpu === null) { _prevCpu = { idle, total }; return 0; }
    const dIdle = idle - _prevCpu.idle;
    const dTotal = total - _prevCpu.total;
    _prevCpu = { idle, total };
    return dTotal === 0 ? 0 : Math.round((1 - dIdle / dTotal) * 100);
}

async function getMemInfo() {
    const raw = await readFileAsync('/proc/meminfo');
    if (!raw) return { ramPct: 0, swapPct: 0, ramUsedMB: 0, ramTotalMB: 0, swapUsedMB: 0, swapTotalMB: 0 };
    const get = key => {
        const m = raw.match(new RegExp(key + ':\\s+(\\d+)'));
        return m ? parseInt(m[1]) : 0;
    };
    const total = get('MemTotal'), available = get('MemAvailable'), free = get('MemFree'),
          buffers = get('Buffers'), cached = get('Cached'),
          swapTotal = get('SwapTotal'), swapFree = get('SwapFree');
    const fallbackUsed = total - free - buffers - cached;
    const used = Math.max(0, available ? total - available : fallbackUsed);
    const swapUsed = Math.max(0, swapTotal - swapFree);
    return {
        ramPct:    total ? Math.round(used / total * 100) : 0,
        swapPct:   swapTotal ? Math.round(swapUsed / swapTotal * 100) : 0,
        ramUsedMB: Math.round(used / 1024),
        ramTotalMB:Math.round(total / 1024),
        swapUsedMB: Math.round(swapUsed / 1024),
        swapTotalMB: Math.round(swapTotal / 1024),
    };
}

let _prevNet = null;
async function getNetSpeed(iface = null) {
    const raw = await readFileAsync('/proc/net/dev');
    if (!raw) return { upKB: 0, downKB: 0 };
    let rxBytes = 0, txBytes = 0;
    raw.split('\n').slice(2).forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) return;
        const name = parts[0].replace(':', '');
        if (name === 'lo') return;
        if (iface && name !== iface) return;
        rxBytes += parseInt(parts[1]);
        txBytes += parseInt(parts[9]);
    });
    const now = Date.now();
    if (_prevNet === null) { _prevNet = { rxBytes, txBytes, ts: now }; return { upKB: 0, downKB: 0 }; }
    const dt = (now - _prevNet.ts) / 1000;
    const upKB   = dt > 0 ? Math.round((txBytes - _prevNet.txBytes) / dt / 1024) : 0;
    const downKB  = dt > 0 ? Math.round((rxBytes - _prevNet.rxBytes) / dt / 1024) : 0;
    _prevNet = { rxBytes, txBytes, ts: now };
    return { upKB: Math.max(0, upKB), downKB: Math.max(0, downKB) };
}

// GPU: tries NVIDIA, AMD sysfs, then Intel's intel_gpu_top
let _gpuType = null;
let _gpuPath = null;
let _gpuError = null;
let _gpuTimeoutId = 0;
let _gpuProcess = null;

function stopIntelGpuSampling() {
    if (_gpuTimeoutId) {
        GLib.source_remove(_gpuTimeoutId);
        _gpuTimeoutId = 0;
    }

    if (_gpuProcess) {
        _gpuProcess.force_exit();
        _gpuProcess = null;
    }
}

async function detectGpu() {
    _gpuPath = null;
    _gpuError = null;
    const hasNvidiaSmi = Boolean(GLib.find_program_in_path('nvidia-smi'));

    const drmBase = Gio.File.new_for_path('/sys/class/drm');
    if (!drmBase.query_exists(null)) { _gpuType = hasNvidiaSmi ? 'nvidia' : 'none'; return; }

    let amdPath = null;
    let hasNvidiaGpu = false;
    let hasIntelGpu = false;
    try {
        const enumerator = drmBase.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const card = info.get_name();
            if (!/^card\d+$/.test(card))
                continue;

            const path = `/sys/class/drm/${card}/device/gpu_busy_percent`;
            if (!amdPath && Gio.File.new_for_path(path).query_exists(null))
                amdPath = path;

            const vendor = (await readFileAsync(`/sys/class/drm/${card}/device/vendor`))?.trim();
            if (vendor === '0x10de')
                hasNvidiaGpu = true;
            else if (vendor === '0x8086')
                hasIntelGpu = true;
        }
        enumerator.close(null);
    } catch (error) {
        global.logError(error, 'SysMon GPU detection failed');
    }

    if (hasNvidiaGpu && hasNvidiaSmi) { _gpuType = 'nvidia'; return;     }

    if (amdPath) { _gpuType = 'amd'; _gpuPath = amdPath; return; }

    if (hasIntelGpu && GLib.find_program_in_path('intel_gpu_top')) { _gpuType = 'intel'; return; }

    _gpuType = 'none';
}

function parseIntelGpuSample(output) {
    let sampleStart = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let utilization = null;

    for (let i = 0; i < output.length; i++) {
        const char = output[i];
        if (sampleStart < 0) {
            if (char === '{') {
                sampleStart = i;
                depth = 1;
            }
            continue;
        }

        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
        } else if (char === '{') {
            depth++;
        } else if (char === '}' && --depth === 0) {
            try {
                const sample = JSON.parse(output.slice(sampleStart, i + 1));
                const engineValues = Object.values(sample.engines || {})
                    .map(engine => Number.parseFloat(engine.busy))
                    .filter(Number.isFinite);
                if (engineValues.length > 0)
                    utilization = Math.max(...engineValues);
            } catch (error) {
                // Ignore incomplete or non-sample JSON objects in the output.
            }
            sampleStart = -1;
        }
    }

    return utilization === null ? null : Math.max(0, Math.min(100, Math.round(utilization)));
}

async function getIntelGpuPercent() {
    try {
        stopIntelGpuSampling();
        const proc = Gio.Subprocess.new(
            ['intel_gpu_top', '-J', '-s', '200', '-o', '-'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        _gpuProcess = proc;
        let timeoutId;
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 750, () => {
            if (_gpuTimeoutId === timeoutId)
                _gpuTimeoutId = 0;
            if (_gpuProcess === proc)
                _gpuProcess = null;
            proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        _gpuTimeoutId = timeoutId;

        try {
            const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
            const utilization = parseIntelGpuSample(stdout);
            if (utilization === null)
                throw new Error(stderr.trim() || 'intel_gpu_top returned no GPU utilization sample');
            _gpuError = null;
            return utilization;
        } finally {
            if (_gpuTimeoutId === timeoutId) {
                GLib.source_remove(timeoutId);
                _gpuTimeoutId = 0;
            }
            if (_gpuProcess === proc)
                _gpuProcess = null;
        }
    } catch (error) {
        const message = error.message || String(error);
        if (_gpuError !== message)
            global.logError(error, 'SysMon Intel GPU sampling failed');
        _gpuError = message;
        return null;
    }
}

async function getGpuPercent() {
    if (_gpuType === 'amd') {
        const v = await readFileAsync(_gpuPath);
        return v ? parseInt(v.trim()) : 0;
    }
    if (_gpuType === 'intel') return getIntelGpuPercent();
    if (_gpuType === 'nvidia') {
        try {
            const proc = Gio.Subprocess.new(
                ['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
                Gio.SubprocessFlags.STDOUT_PIPE
            );
            const [stdout] = await proc.communicate_utf8_async(null, null);
            return parseInt(stdout.trim()) || 0;
        } catch { return 0; }
    }
    return 0;
}

// CPU temperature via sysfs (hwmon or thermal zones)
let _cpuTempPath = null;

const CPU_HWMON_NAMES = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'];
const CPU_THERMAL_TYPES = ['x86_pkg_temp', 'TCPU', 'acpitz'];

async function discoverCpuTempSensor() {
    _cpuTempPath = null;

    try {
        const hwmonBase = Gio.File.new_for_path('/sys/class/hwmon');
        const enumerator = hwmonBase.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const hwmon = info.get_name();
            const name = (await readFileAsync(`/sys/class/hwmon/${hwmon}/name`))?.trim();
            if (!name || !CPU_HWMON_NAMES.includes(name))
                continue;

            const hwmonPath = `/sys/class/hwmon/${hwmon}`;
            const pkgTemp = await _findHwmonPackageTemp(hwmonPath);
            if (pkgTemp) {
                _cpuTempPath = pkgTemp;
                enumerator.close(null);
                return;
            }
        }
        enumerator.close(null);
    } catch {
        // hwmon unavailable
    }

    try {
        const thermalBase = Gio.File.new_for_path('/sys/class/thermal');
        const enumerator = thermalBase.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const zone = info.get_name();
            const type = (await readFileAsync(`/sys/class/thermal/${zone}/type`))?.trim();
            if (!type || !CPU_THERMAL_TYPES.includes(type))
                continue;

            const tempFile = `/sys/class/thermal/${zone}/temp`;
            if (Gio.File.new_for_path(tempFile).query_exists(null)) {
                _cpuTempPath = tempFile;
                enumerator.close(null);
                return;
            }
        }
        enumerator.close(null);
    } catch {
        // thermal zones unavailable
    }
}

async function _findHwmonPackageTemp(hwmonPath) {
    for (let i = 1; i <= 32; i++) {
        const labelPath = `${hwmonPath}/temp${i}_label`;
        const inputPath = `${hwmonPath}/temp${i}_input`;
        const label = (await readFileAsync(labelPath))?.trim() ?? '';
        if (!Gio.File.new_for_path(inputPath).query_exists(null))
            continue;
        if (/package/i.test(label))
            return inputPath;
    }

    const fallback = `${hwmonPath}/temp1_input`;
    return Gio.File.new_for_path(fallback).query_exists(null) ? fallback : null;
}

async function getCpuTemperature() {
    if (!_cpuTempPath)
        return null;

    const raw = await readFileAsync(_cpuTempPath);
    if (!raw)
        return null;

    const milliC = parseInt(raw.trim(), 10);
    if (!Number.isFinite(milliC) || milliC <= 0)
        return null;

    return Math.round(milliC / 1000);
}

function getTempThresholdState(celsius) {
    if (celsius < 55)
        return { className: 'color-temp-cool', color: '#67c2ba' };
    if (celsius < 75)
        return { className: 'color-temp-warm', color: '#f4b24d' };
    return { className: 'color-temp-hot', color: '#ff6b6b' };
}

// ── Mini bar widget ────────────────────────────────────────────────────────

const THRESHOLD_STATES = [
    { max: 59, className: 'color-normal', color: '#8bd889' },
    { max: 79, className: 'color-warning', color: '#f4b24d' },
    { max: 100, className: 'color-critical', color: '#ff6b6b' },
];
const MONOCHROME_STATE = { className: 'color-monochrome', color: '#deddda' };

function getThresholdState(pct) {
    const currentPct = Math.max(0, Math.min(100, pct ?? 0));
    return THRESHOLD_STATES.find(state => currentPct <= state.max) ?? THRESHOLD_STATES[2];
}

function makePanelIcon(ext, iconName, colorClass) {
    const basePath = ext.path;
    const icon = new St.Icon({
        style_class: `sysmon-panel-icon ${colorClass}`,
        icon_size: 14,
        y_align: Clutter.ActorAlign.CENTER,
    });

    if (basePath) {
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([basePath, 'icons', `${iconName}-symbolic.svg`])
        );
        icon.gicon = new Gio.FileIcon({ file });
    } else {
        icon.icon_name = 'utilities-system-monitor-symbolic';
    }

    return icon;
}

function makeDropdownIcon(ext) {
    const icon = new St.Icon({
        style_class: 'sysmon-panel-chevron',
        icon_size: 16,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const file = ext.path
        ? Gio.File.new_for_path(
            GLib.build_filenamev([ext.path, 'icons', 'monitor-activity-symbolic.svg'])
        )
        : null;

    if (file && file.query_exists(null))
        icon.gicon = new Gio.FileIcon({file});
    else
        icon.icon_name = 'pan-down-symbolic';

    return icon;
}

const CHART_POINTS = 28;

const METRIC_THEMES = {
    cpu: { color: '#34d399', icon: 'cpu', tone: 'cpu' },
    ram: { color: '#a78bfa', icon: 'ram', tone: 'ram' },
    swap: { color: '#facc15', icon: 'swap', tone: 'swap' },
    gpu: { color: '#c084fc', icon: 'gpu', tone: 'gpu' },
};

const THEME_ICON_FALLBACK = {
    cpu: 'processor-symbolic',
    ram: 'memory-symbolic',
    swap: 'media-swap-symbolic',
    gpu: 'video-display-symbolic',
    upload: 'go-up-symbolic',
    download: 'go-down-symbolic',
};

function makeIconBadge(ext, iconName, tone, size = 'metric') {
    const isMetric = size === 'metric';
    const wrapPx = isMetric ? 40 : 28;
    const iconPx = isMetric ? 22 : 16;
    const wrapClass = isMetric ? 'sysmon-metric-icon-wrap' : 'sysmon-net-icon-wrap';
    const iconClass = isMetric ? 'sysmon-metric-icon' : 'sysmon-net-icon';

    const wrap = new St.Widget({
        style_class: `${wrapClass} tone-${tone}`,
        width: wrapPx,
        height: wrapPx,
        y_align: Clutter.ActorAlign.CENTER,
    });
    wrap.set_layout_manager(new Clutter.BinLayout());

    const icon = new St.Icon({
        style_class: `${iconClass} tone-${tone}`,
        icon_size: iconPx,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    let loaded = false;
    if (iconName && ext.path) {
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([ext.path, 'icons', `${iconName}-symbolic.svg`])
        );
        if (file.query_exists(null)) {
            icon.gicon = new Gio.FileIcon({ file });
            loaded = true;
        }
    }
    if (!loaded && iconName && THEME_ICON_FALLBACK[iconName])
        icon.icon_name = THEME_ICON_FALLBACK[iconName];

    wrap.add_child(icon);
    return wrap;
}

function rgbaFromHex(hex, alpha = 1) {
    const clean = hex.replace('#', '');
    return [
        parseInt(clean.slice(0, 2), 16) / 255,
        parseInt(clean.slice(2, 4), 16) / 255,
        parseInt(clean.slice(4, 6), 16) / 255,
        alpha,
    ];
}

function pushChartHistory(canvas, value) {
    canvas._history.push(Math.max(0, value ?? 0));
    while (canvas._history.length > canvas._maxPoints)
        canvas._history.shift();
    canvas.queue_repaint && canvas.queue_repaint();
}

function makeSparkline(color, width = 108, height = 30) {
    const canvas = new St.DrawingArea({ width, height, x_align: Clutter.ActorAlign.END });
    canvas._history = [];
    canvas._color = color;
    canvas._maxPoints = CHART_POINTS;
    canvas.connect('repaint', area => {
        const cr = area.get_context();
        const history = canvas._history;
        if (history.length < 2) { cr.$dispose(); return; }
        const max = Math.max(...history, 1);
        const offset = canvas._maxPoints - history.length;
        const step = width / (canvas._maxPoints - 1);
        const [r, g, b] = rgbaFromHex(canvas._color);
        cr.moveTo(offset * step, height - (history[0] / max) * (height - 6) - 3);
        for (let i = 1; i < history.length; i++) {
            const x = (offset + i) * step;
            const y = height - (history[i] / max) * (height - 6) - 3;
            cr.lineTo(x, y);
        }
        cr.setSourceRGBA(r, g, b, 0.92);
        cr.setLineWidth(1.6);
        cr.stroke();
        cr.$dispose();
    });
    return canvas;
}

function makeWaveChart(color, height = 52) {
    const canvas = new St.DrawingArea({ height, x_expand: true });
    canvas._history = [];
    canvas._color = color;
    canvas._maxPoints = CHART_POINTS;
    canvas.connect('repaint', area => {
        const cr = area.get_context();
        const history = canvas._history;
        const width = area.get_width() || 148;
        if (history.length < 2) { cr.$dispose(); return; }
        const max = Math.max(...history, 1);
        const offset = canvas._maxPoints - history.length;
        const step = width / (canvas._maxPoints - 1);
        const [r, g, b] = rgbaFromHex(canvas._color);
        const yAt = index => height - (history[index] / max) * (height - 10) - 5;
        const xAt = index => (offset + index) * step;
        cr.moveTo(xAt(0), height);
        cr.lineTo(xAt(0), yAt(0));
        for (let i = 1; i < history.length; i++)
            cr.lineTo(xAt(i), yAt(i));
        cr.lineTo(xAt(history.length - 1), height);
        cr.closePath();
        cr.setSourceRGBA(r, g, b, 0.28);
        cr.fill();
        cr.moveTo(xAt(0), yAt(0));
        for (let i = 1; i < history.length; i++)
            cr.lineTo(xAt(i), yAt(i));
        cr.setSourceRGBA(r, g, b, 0.88);
        cr.setLineWidth(1.5);
        cr.stroke();
        cr.$dispose();
    });
    return canvas;
}

 function roundRect(cr, x, y, w, h, r) {
     cr.moveTo(x+r, y);
     cr.lineTo(x+w-r, y);
     cr.arc(x+w-r, y+r, r, -Math.PI/2, 0);
     cr.lineTo(x+w, y+h-r);
     cr.arc(x+w-r, y+h-r, r, 0, Math.PI/2);
     cr.lineTo(x+r, y+h);
     cr.arc(x+r, y+h-r, r, Math.PI/2, Math.PI);
     cr.lineTo(x, y+r);
     cr.arc(x+r, y+r, r, Math.PI, 3*Math.PI/2);
     cr.closePath();
 }

 // ── Panel Indicator ────────────────────────────────────────────────────────

 const Indicator = GObject.registerClass(
 class Indicator extends PanelMenu.Button {
     _init(ext) {
         super._init(0.0, _('System Monitor'));
         this._ext = ext;
         this._settings = ext.getSettings();
         this._lastData = null;
         this._settingsChangedIds = [
             'monochrome-mode',
             'panel-show-values',
             'show-cpu',
             'show-ram',
             'show-swap',
             'show-network',
             'popup-show-cpu',
             'popup-show-ram',
             'popup-show-gpu',
             'popup-show-swap',
             'popup-show-network',
         ].map(key => this._settings.connect(`changed::${key}`, () => {
             if (this._lastData)
                 this.update(this._lastData);
             else
                 this._syncVisibility();
         }));

        this._panelBox = new St.BoxLayout({
            style_class: 'sysmon-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._cpuGroup = this._makePanelMetric('cpu', '0%', 'color-normal', 34);
        this._ramGroup = this._makePanelMetric('ram', '0%', 'color-normal', 34);
        this._swapGroup = this._makePanelMetric('swap', '0%', 'color-normal', 34);
        this._upGroup = this._makePanelMetric('upload', '0KB/s', 'color-up', 58);
        this._downGroup = this._makePanelMetric('download', '0KB/s', 'color-down', 58);

         const sep = () => {
             const label = new St.Label({
                 text: '|',
                 style_class: 'sysmon-panel-sep',
                 y_align: Clutter.ActorAlign.CENTER,
             });
             label.set_width(8);
             return label;
         };
         this._swapSep = sep();
         this._netSep = sep();
         this._cpuRamSep = sep();
         this._upDownSep = sep();

         this._panelBox.add_child(this._cpuGroup.box);
         this._panelBox.add_child(this._cpuRamSep);
         this._panelBox.add_child(this._ramGroup.box);
         this._panelBox.add_child(this._swapSep);
         this._panelBox.add_child(this._swapGroup.box);
         this._panelBox.add_child(this._netSep);
         this._panelBox.add_child(this._upGroup.box);
         this._panelBox.add_child(this._upDownSep);
         this._panelBox.add_child(this._downGroup.box);

         this._chevron = makeDropdownIcon(this._ext);
         this._panelBox.add_child(this._chevron);

         this.add_child(this._panelBox);

         this._buildPopup();
        this.menu.actor.add_style_class_name('sysmon-popup-menu');
        this.menu.actor.set_width(360);
        this._syncVisibility();
    }

    _buildPopup() {
         const titleItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'sysmon-popup-item' });
         const header = new St.BoxLayout({ style_class: 'sysmon-popup-header', x_expand: true });
         header.add_child(new St.Label({ text: _('System Monitor'), style_class: 'sysmon-popup-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
         header.add_child(new St.Icon({ icon_name: 'utilities-system-monitor-symbolic', style_class: 'sysmon-header-icon' }));
         const prefsBtn = new St.Button({
             style_class: 'sysmon-header-btn',
             child: new St.Icon({ icon_name: 'open-menu-symbolic', style_class: 'sysmon-header-icon' }),
             y_align: Clutter.ActorAlign.CENTER,
         });
         prefsBtn.connect('clicked', () => this._ext.openPreferences?.());
         header.add_child(prefsBtn);
         titleItem.add_child(header);
         this.menu.addMenuItem(titleItem);

         this._cpuItem = this._makeMetricCard('cpu', 'CPU', _('Processor load'), true);
         this.menu.addMenuItem(this._cpuItem.item);

         this._gpuItem = this._makeMetricCard('gpu', 'GPU', _('Graphics load'));
         this.menu.addMenuItem(this._gpuItem.item);

         this._ramItem = this._makeMetricCard('ram', 'RAM', _('Memory in use'));
         this.menu.addMenuItem(this._ramItem.item);

         this._swapItem = this._makeMetricCard('swap', 'Swap', _('Swap in use'));
         this.menu.addMenuItem(this._swapItem.item);

         const netItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'sysmon-popup-item' });
         const netGrid = new St.BoxLayout({ style_class: 'sysmon-net-grid', x_expand: true });

         this._upCard = this._makeNetCard(_('Upload'), 'upload', '#34d399', 'up');
         this._downCard = this._makeNetCard(_('Download'), 'download', '#60a5fa', 'down');

         netGrid.add_child(this._upCard.box);
         netGrid.add_child(this._downCard.box);
         netItem.add_child(netGrid);
         this.menu.addMenuItem(netItem);
         this._netItem = netItem;
     }

     _makeMetricCard(metricId, title, detail, withTemp = false) {
         const theme = METRIC_THEMES[metricId];
         const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'sysmon-popup-item' });
         const card = new St.BoxLayout({ vertical: false, x_expand: true, style_class: 'sysmon-metric-card' });

         const iconWrap = makeIconBadge(this._ext, theme.icon, theme.tone, 'metric');

         const body = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'sysmon-metric-body' });
         body.add_child(new St.Label({ text: title, style_class: 'sysmon-metric-title' }));
         const detailLbl = new St.Label({ text: detail, style_class: 'sysmon-metric-detail' });
         body.add_child(detailLbl);

         const rightCol = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER, style_class: 'sysmon-metric-side' });
         const stats = new St.BoxLayout({ vertical: false, x_align: Clutter.ActorAlign.END, style_class: 'sysmon-metric-stats' });
         let tempLbl = null;
         if (withTemp) {
             tempLbl = new St.Label({ text: '—°C', style_class: `sysmon-metric-temp tone-${theme.tone}`, visible: false });
             stats.add_child(tempLbl);
         }
         const pctLbl = new St.Label({ text: '0%', style_class: `sysmon-metric-pct tone-${theme.tone}` });
         stats.add_child(pctLbl);
         const sparkline = makeSparkline(theme.color);
         rightCol.add_child(stats);
         rightCol.add_child(sparkline);

         card.add_child(iconWrap);
         card.add_child(body);
         card.add_child(rightCol);
         item.add_child(card);
         return { item, detailLbl, pctLbl, tempLbl, sparkline, accentColor: theme.color, tone: theme.tone };
     }

    _makePanelMetric(iconName, valueText, valueClass, valueWidth) {
        const box = new St.BoxLayout({
            style_class: 'sysmon-panel-metric',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = makePanelIcon(this._ext, iconName, valueClass);
        box.add_child(icon);

        const value = new St.Label({
            text: valueText,
            style_class: `sysmon-panel-value ${valueClass}`,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
        });
        value.set_width(valueWidth);
        box.add_child(value);
        return { box, icon, value };
    }

     _makeNetCard(title, iconName, accentColor, tone) {
         const box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'sysmon-net-card' });
         const top = new St.BoxLayout({ vertical: false, style_class: 'sysmon-net-top' });
         top.add_child(makeIconBadge(this._ext, iconName, tone, 'net'));
         top.add_child(new St.Label({ text: title, style_class: 'sysmon-net-label' }));

         const valRow = new St.BoxLayout({ vertical: false, style_class: 'sysmon-net-value-row' });
         const val = new St.Label({ text: '0', style_class: `sysmon-net-value tone-${tone}` });
         const unit = new St.Label({ text: _('KB/s'), style_class: 'sysmon-net-unit' });
         valRow.add_child(val);
         valRow.add_child(unit);

         const wave = makeWaveChart(accentColor);
         box.add_child(top);
         box.add_child(valRow);
         box.add_child(wave);
         return { box, val, unit, wave, accentColor };
     }

     update(data) {
         this._lastData = data;
         const { cpu, cpuTemp, gpu, mem, net } = data;

        this._cpuGroup.value.set_text(`${cpu}%`);
        this._ramGroup.value.set_text(`${mem.ramPct}%`);
        this._swapGroup.value.set_text(`${mem.swapPct}%`);
        this._applyPanelThreshold(this._cpuGroup, cpu);
        this._applyPanelThreshold(this._ramGroup, mem.ramPct);
        this._applyPanelThreshold(this._swapGroup, mem.swapPct);

         if (net) {
            this._upGroup.value.set_text(_formatSpeed(net.upKB));
            this._downGroup.value.set_text(_formatSpeed(net.downKB));
         }

         this._refreshMetricCard(this._cpuItem, cpu);
         this._cpuItem.detailLbl.set_text(_('Processor load'));
         this._refreshCpuTemp(cpuTemp);
         this._refreshMetricCard(this._ramItem, mem.ramPct);
         this._ramItem.detailLbl.set_text(`${_formatMemory(mem.ramUsedMB)} / ${_formatMemory(mem.ramTotalMB)}`);
         this._refreshMetricCard(this._swapItem, mem.swapPct);
         this._swapItem.detailLbl.set_text(mem.swapTotalMB > 0
             ? `${_formatMemory(mem.swapUsedMB)} / ${_formatMemory(mem.swapTotalMB)}`
             : _('No swap configured'));

         if (gpu !== null) {
             this._refreshMetricCard(this._gpuItem, gpu);
             this._gpuItem.detailLbl.set_text(_f(_('%s load'), _formatGpuType()));
         } else {
             this._gpuItem.pctLbl.set_text('—');
             this._gpuItem.detailLbl.set_text(_gpuType === 'none'
                 ? _('No supported GPU found')
                 : _f(_('%s monitoring unavailable: %s'), _formatGpuType(), _gpuError?.split('\n')[0] || _('no reading')));
         }

         if (net) {
             const up = _splitSpeed(net.upKB);
             const down = _splitSpeed(net.downKB);
             this._upCard.val.set_text(up.val);
             this._upCard.unit.set_text(up.unit);
             this._downCard.val.set_text(down.val);
             this._downCard.unit.set_text(down.unit);
             this._refreshNetCard(this._upCard, net.upKB);
             this._refreshNetCard(this._downCard, net.downKB);
         }

         this._syncVisibility();
     }

     _refreshMetricCard(card, pct) {
         const mono = this._settings.get_boolean('monochrome-mode');
         const color = mono ? MONOCHROME_STATE.color : card.accentColor;
         const toneClass = mono ? 'tone-mono' : `tone-${card.tone}`;
         card.pctLbl.set_text(`${pct}%`);
         card.pctLbl.set_style_class_name(`sysmon-metric-pct ${toneClass}`);
         card.sparkline._color = color;
         pushChartHistory(card.sparkline, pct);
     }

     _refreshNetCard(card, kb) {
         const mono = this._settings.get_boolean('monochrome-mode');
         card.wave._color = mono ? MONOCHROME_STATE.color : card.accentColor;
         pushChartHistory(card.wave, kb);
     }

     _refreshCpuTemp(cpuTemp) {
         if (!this._cpuItem.tempLbl)
             return;

         if (cpuTemp === null || cpuTemp === undefined) {
             this._cpuItem.tempLbl.visible = false;
             return;
         }

         const mono = this._settings.get_boolean('monochrome-mode');
         const state = mono ? null : getTempThresholdState(cpuTemp);
         this._cpuItem.tempLbl.set_text(`${cpuTemp}°C`);
         if (mono)
             this._cpuItem.tempLbl.set_style_class_name('sysmon-metric-temp tone-mono');
         else if (state.className !== 'color-temp-cool')
             this._cpuItem.tempLbl.set_style_class_name(`sysmon-metric-temp ${state.className}`);
         else
             this._cpuItem.tempLbl.set_style_class_name('sysmon-metric-temp tone-cpu');
         this._cpuItem.tempLbl.visible = true;
     }

     _applyPanelThreshold(group, pct) {
         const state = this._settings.get_boolean('monochrome-mode')
             ? MONOCHROME_STATE
             : getThresholdState(pct);
         group.icon.set_style_class_name(`sysmon-panel-icon ${state.className}`);
         group.value.set_style_class_name(`sysmon-panel-value ${state.className}`);
     }

     _applyPanelStaticColor(group, colorClass) {
         const activeClass = this._settings.get_boolean('monochrome-mode')
             ? MONOCHROME_STATE.className
             : colorClass;
         group.icon.set_style_class_name(`sysmon-panel-icon ${activeClass}`);
         group.value.set_style_class_name(`sysmon-panel-value ${activeClass}`);
     }

     _syncVisibility() {
         const showCpu = this._settings.get_boolean('show-cpu');
         const showRam = this._settings.get_boolean('show-ram');
         const showSwap = this._settings.get_boolean('show-swap');
         const showNetwork = this._settings.get_boolean('show-network');
         const showValues = this._settings.get_boolean('panel-show-values');

         const popupCpu = this._settings.get_boolean('popup-show-cpu');
         const popupRam = this._settings.get_boolean('popup-show-ram');
         const popupSwap = this._settings.get_boolean('popup-show-swap');
         const popupNetwork = this._settings.get_boolean('popup-show-network');
         const popupGpu = this._settings.get_boolean('popup-show-gpu');
         const hasGpu = _gpuType !== 'none';

         this._cpuGroup.box.visible = showCpu;
         this._ramGroup.box.visible = showRam;
         this._swapGroup.box.visible = showSwap;
         this._upGroup.box.visible = showNetwork;
         this._downGroup.box.visible = showNetwork;

         this._cpuGroup.value.visible = showValues;
         this._ramGroup.value.visible = showValues;
         this._swapGroup.value.visible = showValues;
         this._upGroup.value.visible = showValues;
         this._downGroup.value.visible = showValues;

         this._cpuRamSep.visible = showValues && showCpu && showRam;
         this._swapSep.visible = showValues && showSwap && (showCpu || showRam);
         this._netSep.visible = showValues && showNetwork && (showCpu || showRam || showSwap);
         this._upDownSep.visible = showValues && showNetwork;

         this._cpuItem.item.visible = popupCpu;
         this._ramItem.item.visible = popupRam;
         this._swapItem.item.visible = popupSwap;
         this._gpuItem.item.visible = popupGpu && hasGpu;
         this._netItem.visible = popupNetwork;

         this._applyPanelStaticColor(this._upGroup, 'color-up');
         this._applyPanelStaticColor(this._downGroup, 'color-down');

         if (!this._lastData && this._settings.get_boolean('monochrome-mode')) {
             this._applyPanelStaticColor(this._cpuGroup, MONOCHROME_STATE.className);
             this._applyPanelStaticColor(this._ramGroup, MONOCHROME_STATE.className);
             this._applyPanelStaticColor(this._swapGroup, MONOCHROME_STATE.className);
         }
     }

     destroy() {
         for (const id of this._settingsChangedIds)
             this._settings.disconnect(id);
         this._settingsChangedIds = [];
         super.destroy();
     }
 });

function _formatSpeed(kb) {
    if (kb >= 1024) return `${(kb/1024).toFixed(1)}${_('MB/s')}`;
    return `${kb}${_('KB/s')}`;
 }

 function _splitSpeed(kb) {
     if (kb >= 1024) return { val: (kb/1024).toFixed(1), unit: _('MB/s') };
     return { val: kb.toString(), unit: _('KB/s') };
 }

 function _formatMemory(mb) {
     if (mb >= 1024) return `${(mb / 1024).toFixed(1)} ${_('GiB')}`;
     return `${mb} ${_('MiB')}`;
 }

 function _formatGpuType() {
     if (_gpuType === 'nvidia') return 'NVIDIA';
     if (_gpuType === 'amd') return 'AMD';
     if (_gpuType === 'intel') return 'Intel';
     return _('GPU');
 }

 // ── Main Extension ─────────────────────────────────────────────────────────

class SysMonExtension {
    constructor() {
        this._indicator = null;
        this._timerId = null;
        this._gpuPct = 0;
        this._settings = null;
        this._refreshChangedId = 0;
    }

    async enable() {
        this._settings = this.getSettings();
        this._refreshChangedId = this._settings.connect('changed::refresh-interval', () => {
            this._restartTimer();
            this._tick();
        });
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea('sysmonitor@talhasiddique7', this._indicator);

        await Promise.all([detectGpu(), discoverCpuTempSensor()]);
        this._gpuPct = 0;
        this._startTimer();
        this._tick();
    }

     _startTimer() {
         const interval = this._settings.get_int('refresh-interval');
         this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
             this._tick();
             return GLib.SOURCE_CONTINUE;
         });
     }

     _restartTimer() {
         if (this._timerId) {
             GLib.source_remove(this._timerId);
             this._timerId = null;
         }

         this._startTimer();
     }

     _tick() {
         Promise.all([
             getCpuPercent(),
             getCpuTemperature(),
             getMemInfo(),
             getNetSpeed()
         ]).then(([cpu, cpuTemp, mem, net]) => {
             const payload = { cpu, cpuTemp, mem, net };
             if (_gpuType !== 'none') {
                 return getGpuPercent().then(gpu => {
                     this._gpuPct = gpu;
                     this._indicator.update({ ...payload, gpu: _gpuType !== 'none' ? this._gpuPct : null });
                 });
             }
             this._indicator.update({ ...payload, gpu: _gpuType !== 'none' ? this._gpuPct : null });
         }).catch(error => global.logError(error, 'SysMon update failed'));
    }

     getSettings() {
         return ExtensionUtils.getSettings('org.gnome.shell.extensions.sysmon');
     }

     disable() {
         stopIntelGpuSampling();
         if (this._timerId) {
             GLib.source_remove(this._timerId);
             this._timerId = null;
         }
         if (this._settings && this._refreshChangedId) {
             this._settings.disconnect(this._refreshChangedId);
             this._refreshChangedId = 0;
         }
         if (this._indicator)
             this._indicator.destroy();
         this._indicator = null;
         this._settings = null;
         _prevCpu = null;
         _prevNet = null;
         _cpuTempPath = null;
     }

     get path() {
         return ExtensionUtils.getCurrentExtension().path;
     }

     openPreferences() {
         ExtensionUtils.openPrefs();
     }
}

function init() {
    ExtensionUtils.initTranslations();
    return new SysMonExtension();
}
