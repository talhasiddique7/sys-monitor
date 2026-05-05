import GLib from 'gi://GLib';
import Gio from 'gi://Gio'; 
import St from 'gi://St'; 
import Clutter from 'gi://Clutter'; 
import GObject from 'gi://GObject'; 
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'; 
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'; 
import * as Main from 'resource:///org/gnome/shell/ui/main.js'; 
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'; 
 
// ── Helpers: read /proc files (async) ─────────────────────────────────────

async function readFileAsync(path) {
    const file = Gio.File.new_for_path(path);
    try {
        const [ok, data] = await file.load_contents_async(null);
        return ok ? new TextDecoder().decode(data) : null;
    } catch { return null; }
} 
 
// CPU: returns { user, nice, system, idle, total }
let _prevCpu = null;
async function getCpuPercent() {
    const raw = await readFileAsync('/proc/stat');
    if (!raw) return 0;
    const line = raw.split('\n')[0]; // "cpu  N N N N N N N N N N"
    const vals = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = vals[3] + vals[4]; // idle + iowait
    const total = vals.reduce((a, b) => a + b, 0);
    if (_prevCpu === null) { _prevCpu = { idle, total }; return 0; }
    const dIdle = idle - _prevCpu.idle;
    const dTotal = total - _prevCpu.total;
    _prevCpu = { idle, total };
    return dTotal === 0 ? 0 : Math.round((1 - dIdle / dTotal) * 100);
} 
 
async function getMemInfo() {
    const raw = await readFileAsync('/proc/meminfo');
    if (!raw) return { ramPct: 0, swapPct: 0, ramUsedMB: 0, ramTotalMB: 0 };
    const get = key => {
        const m = raw.match(new RegExp(key + ':\\s+(\\d+)'));
        return m ? parseInt(m[1]) : 0;
    };
    const total = get('MemTotal'), free = get('MemFree'),
          buffers = get('Buffers'), cached = get('Cached'),
          swapTotal = get('SwapTotal'), swapFree = get('SwapFree');
    const used = total - free - buffers - cached;
    return {
        ramPct:    total ? Math.round(used / total * 100) : 0,
        swapPct:   swapTotal ? Math.round((swapTotal - swapFree) / swapTotal * 100) : 0,
        ramUsedMB: Math.round(used / 1024),
        ramTotalMB:Math.round(total / 1024),
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
        if (name === 'lo') return;                  // skip loopback
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
 
// GPU: tries nvidia-smi, then AMD sysfs 
let _gpuType = null; // 'nvidia' | 'amd' | 'none' 
async function detectGpu() { 
    if (GLib.find_program_in_path('nvidia-smi')) { _gpuType = 'nvidia'; return; } 
    const amdFile = Gio.File.new_for_path('/sys/class/drm/card0/device/gpu_busy_percent'); 
    const exists = await amdFile.query_exists_async(null); 
    if (exists) { _gpuType = 'amd'; return; } 
    _gpuType = 'none'; 
} 
async function getGpuPercent() { 
    if (_gpuType === 'amd') { 
        const v = await readFileAsync('/sys/class/drm/card0/device/gpu_busy_percent'); 
        return v ? parseInt(v.trim()) : 0; 
    } 
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
 
// ── Mini bar widget ──────────────────────────────────────────────────────── 
 
const THRESHOLD_STATES = [
    { max: 59, className: 'color-normal', color: '#8bd889' },
    { max: 79, className: 'color-warning', color: '#f4b24d' },
    { max: 100, className: 'color-critical', color: '#ff6b6b' },
];

function getThresholdState(pct) {
    const currentPct = Math.max(0, Math.min(100, pct ?? 0));
    return THRESHOLD_STATES.find(state => currentPct <= state.max) ?? THRESHOLD_STATES[2];
}

function makePanelIcon(ext, iconName, colorClass) {
    const basePath = ext.path ?? ext.dir?.get_path?.();
    const icon = new St.Icon({
        style_class: `sysmon-panel-icon ${colorClass}`,
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

function makeBar(pct, color = '#4fc3f7') { 
    const W = 100, H = 6; 
    const canvas = new St.DrawingArea({ width: W, height: H, 
        y_align: Clutter.ActorAlign.CENTER }); 
    canvas._pct = pct;
    canvas._color = color;
    canvas.connect('repaint', area => { 
        const cr = area.get_context(); 
        const currentPct = Math.max(0, Math.min(100, canvas._pct ?? 0));
        // Background track 
        cr.setSourceRGBA(1,1,1,0.08); 
        roundRect(cr, 0, 0, W, H, 3); 
        cr.fill(); 
        // Filled portion 
        const hex = (canvas._color ?? color).replace('#',''); 
        const r = parseInt(hex.slice(0,2),16)/255, 
               g = parseInt(hex.slice(2,4),16)/255, 
               b = parseInt(hex.slice(4,6),16)/255; 
         cr.setSourceRGBA(r, g, b, 0.9); 
         roundRect(cr, 0, 0, Math.max(3, W * currentPct/100), H, 3); 
         cr.fill(); 
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
         super._init(0.0, 'System Monitor'); 
         this._ext = ext; 
         this._settings = ext.getSettings(); 
 
        // Compact top-bar layout matching the reference pill treatment.
        this._panelBox = new St.BoxLayout({
            style_class: 'sysmon-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._cpuGroup = this._makePanelMetric('cpu', '0%', 'color-normal', 26);
        this._ramGroup = this._makePanelMetric('ram', '0%', 'color-normal', 26);
        this._swapGroup = this._makePanelMetric('swap', '0%', 'color-normal', 26);
        this._upGroup = this._makePanelMetric('upload', '0KB/s', 'color-up', 48);
        this._downGroup = this._makePanelMetric('download', '0KB/s', 'color-down', 48);

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

         this._panelBox.add_child(this._cpuGroup.box); 
         this._panelBox.add_child(sep()); 
         this._panelBox.add_child(this._ramGroup.box); 
         this._panelBox.add_child(this._swapSep); 
         this._panelBox.add_child(this._swapGroup.box); 
         this._panelBox.add_child(this._netSep); 
         this._panelBox.add_child(this._upGroup.box);
         this._upDownSep = sep();
         this._panelBox.add_child(this._upDownSep);
         this._panelBox.add_child(this._downGroup.box); 
 
         this.add_child(this._panelBox); 
 
         this._buildPopup();
        this.menu.actor.set_width(280);
    }

    _buildPopup() { 
         // Title 
         const titleItem = new PopupMenu.PopupBaseMenuItem({ reactive: false }); 
         titleItem.add_child(new St.Label({ text: 'SYSTEM MONITOR', style_class: 'sysmon-popup-title' })); 
         this.menu.addMenuItem(titleItem); 
 
         // CPU row 
         this._cpuItem = this._makeCard('CPU', '#4fc3f7'); 
         this.menu.addMenuItem(this._cpuItem.item); 
 
         // GPU row 
         this._gpuItem = this._makeCard('GPU', '#ce93d8', true); 
         this.menu.addMenuItem(this._gpuItem.item); 
 
         // RAM row 
         this._ramItem = this._makeCard('RAM', '#81c784'); 
         this.menu.addMenuItem(this._ramItem.item); 
 
         // Swap row 
         this._swapItem = this._makeCard('Swap', '#ffb74d'); 
         this.menu.addMenuItem(this._swapItem.item); 
 
         // Network Cards 
         const netItem = new PopupMenu.PopupBaseMenuItem({ reactive: false }); 
         const netGrid = new St.BoxLayout({ style_class: 'sysmon-net-grid', x_expand: true }); 
         
         this._upCard = this._makeNetCard('UPLOAD', 'color-up'); 
         this._downCard = this._makeNetCard('DOWNLOAD', 'color-down'); 
         
         netGrid.add_child(this._upCard.box); 
         netGrid.add_child(this._downCard.box); 
         netItem.add_child(netGrid); 
         this.menu.addMenuItem(netItem); 
         this._netItem = netItem; 
     } 
 
     _makeCard(title, color, isGpu = false) { 
         const item = new PopupMenu.PopupBaseMenuItem({ reactive: false }); 
         const box = new St.BoxLayout({ x_expand: true, vertical: false, style_class: 'sysmon-card-row' }); 
         
         const titleBox = new St.BoxLayout({ vertical: false, x_expand: false }); 
         const lbl = new St.Label({ text: title, style_class: 'sysmon-card-title' }); 
         lbl.set_width(40); 
         titleBox.add_child(lbl); 
         
         if (isGpu) { 
             const badge = new St.Label({ text: 'NVIDIA', style_class: 'sysmon-gpu-badge' }); 
             titleBox.add_child(badge); 
         } 
         
         const barHolder = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER, style: 'padding: 0 12px;' }); 
         const bar = makeBar(0, color); 
         barHolder.add_child(bar); 
         
         const pctLbl = new St.Label({ text: '0%', style_class: 'sysmon-card-pct' }); 
         
         box.add_child(titleBox); 
         box.add_child(barHolder); 
         box.add_child(pctLbl); 
         item.add_child(box); 
         return { item, bar, barHolder, pctLbl }; 
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
 
     _makeNetCard(title, colorClass) { 
         const box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'sysmon-net-card' }); 
         const lbl = new St.Label({ text: title, style_class: 'sysmon-net-card-title' }); 
         const valBox = new St.BoxLayout({ vertical: false }); 
         const val = new St.Label({ text: '0.0', style_class: 'sysmon-net-card-value ' + colorClass }); 
         const unit = new St.Label({ text: 'MB/s', style_class: 'sysmon-net-card-unit' }); 
         
         valBox.add_child(val); 
         valBox.add_child(unit); 
         box.add_child(lbl); 
         box.add_child(valBox); 
         return { box, val, unit }; 
     } 
 
     update(data) { 
         const { cpu, gpu, mem, net } = data; 
 
        // Panel labels 
        this._cpuGroup.value.set_text(`${cpu}%`); 
        this._ramGroup.value.set_text(`${mem.ramPct}%`); 
        this._swapGroup.value.set_text(`${mem.swapPct}%`); 
        this._applyPanelThreshold(this._cpuGroup, cpu);
        this._applyPanelThreshold(this._ramGroup, mem.ramPct);
        this._applyPanelThreshold(this._swapGroup, mem.swapPct);
         
         const showNetwork = this._settings.get_boolean('show-network');
         const showSwap = this._settings.get_boolean('show-swap');

         if (net) { 
            this._upGroup.value.set_text(_formatSpeed(net.upKB)); 
            this._downGroup.value.set_text(_formatSpeed(net.downKB)); 
         } 
         this._swapSep.visible = showSwap;
         this._swapGroup.box.visible = showSwap;
         this._netSep.visible = showNetwork;
         this._upGroup.box.visible = showNetwork;
         this._upDownSep.visible = showNetwork;
         this._downGroup.box.visible = showNetwork;
 
         // Refresh popup bars 
         this._refreshCard(this._cpuItem, cpu); 
         this._refreshCard(this._ramItem, mem.ramPct); 
         this._refreshCard(this._swapItem, mem.swapPct); 
         this._swapItem.item.visible = showSwap; 
 
         if (gpu !== null) { 
             this._refreshCard(this._gpuItem, gpu); 
             this._gpuItem.item.visible = this._settings.get_boolean('show-gpu'); 
         } else { 
             this._gpuItem.item.visible = false; 
         } 
 
         if (net && showNetwork) { 
             const up = _splitSpeed(net.upKB); 
             const down = _splitSpeed(net.downKB); 
             this._upCard.val.set_text(up.val); 
             this._upCard.unit.set_text(up.unit); 
             this._downCard.val.set_text(down.val); 
             this._downCard.unit.set_text(down.unit); 
             this._netItem.visible = true; 
         } else { 
             this._netItem.visible = false; 
         } 
     } 
 
     _refreshCard(card, pct) { 
         const state = getThresholdState(pct);
         card.pctLbl.set_text(`${pct}%`); 
         card.pctLbl.set_style_class_name(`sysmon-card-pct ${state.className}`);
         card.bar._pct = pct;
         card.bar._color = state.color;
         card.bar.queue_repaint && card.bar.queue_repaint(); 
     } 

     _applyPanelThreshold(group, pct) {
         const state = getThresholdState(pct);
         group.icon.set_style_class_name(`sysmon-panel-icon ${state.className}`);
         group.value.set_style_class_name(`sysmon-panel-value ${state.className}`);
     }
 }); 
 
function _formatSpeed(kb) { 
    if (kb >= 1024) return `${(kb/1024).toFixed(1)}MB/s`; 
    return `${kb}KB/s`; 
 } 
 
 function _splitSpeed(kb) { 
     if (kb >= 1024) return { val: (kb/1024).toFixed(1), unit: 'MB/s' }; 
     return { val: kb.toString(), unit: 'KB/s' }; 
 } 
 
 // ── Main Extension ───────────────────────────────────────────────────────── 
 
 export default class SysMonExtension extends Extension { 
     async enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        await detectGpu();
        this._gpuPct = 0;
        this._startTimer();
    } 
 
     _startTimer() { 
         const interval = this.getSettings().get_int('refresh-interval'); 
         this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => { 
             this._tick(); 
             return GLib.SOURCE_CONTINUE; 
         }); 
     } 
 
     async _tick() {
        const [cpu, mem, net] = await Promise.all([
            getCpuPercent(),
            getMemInfo(),
            getNetSpeed()
        ]);

        if (_gpuType !== 'none') {
            this._gpuPct = await getGpuPercent();
        }

        this._indicator.update({
            cpu,
            gpu: _gpuType !== 'none' ? this._gpuPct : null,
            mem,
            net,
        });
    } 
 
     disable() { 
         if (this._timerId) { 
             GLib.source_remove(this._timerId); 
             this._timerId = null; 
         } 
         this._indicator?.destroy(); 
         this._indicator = null; 
         _prevCpu = null; 
         _prevNet = null; 
     } 
 } 
