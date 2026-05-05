import GLib from 'gi://GLib'; 
import Gio from 'gi://Gio'; 
import St from 'gi://St'; 
import Clutter from 'gi://Clutter'; 
import GObject from 'gi://GObject'; 
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'; 
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'; 
import * as Main from 'resource:///org/gnome/shell/ui/main.js'; 
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'; 
 
// ── Helpers: read /proc files ────────────────────────────────────────────── 
 
function readFile(path) { 
    try { 
        const [ok, data] = GLib.file_get_contents(path); 
        return ok ? new TextDecoder().decode(data) : null; 
    } catch { return null; } 
} 
 
// CPU: returns { user, nice, system, idle, total } 
let _prevCpu = null; 
function getCpuPercent() { 
    const raw = readFile('/proc/stat'); 
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
 
function getMemInfo() { 
    const raw = readFile('/proc/meminfo'); 
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
function getNetSpeed(iface = null) { 
    const raw = readFile('/proc/net/dev'); 
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
function detectGpu() { 
    if (GLib.find_program_in_path('nvidia-smi')) { _gpuType = 'nvidia'; return; } 
    const amdPath = '/sys/class/drm/card0/device/gpu_busy_percent'; 
    if (GLib.file_test(amdPath, GLib.FileTest.EXISTS)) { _gpuType = 'amd'; return; } 
    _gpuType = 'none'; 
} 
function getGpuPercent(callback) { 
    if (_gpuType === 'amd') { 
        const v = readFile('/sys/class/drm/card0/device/gpu_busy_percent'); 
        callback(v ? parseInt(v.trim()) : 0); 
        return; 
    } 
    if (_gpuType === 'nvidia') { 
        const [ok, pid] = GLib.spawn_async( 
            null, 
            ['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], 
            null, 
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD, 
            null 
        ); 
        // For simplicity, read synchronously with spawn_command_line_sync 
        try { 
            const [, stdout] = GLib.spawn_command_line_sync( 
                'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits' 
            ); 
            callback(parseInt(new TextDecoder().decode(stdout).trim()) || 0); 
        } catch { callback(0); } 
        return; 
    } 
    callback(0); 
} 
 
// ── Mini bar widget ──────────────────────────────────────────────────────── 
 
function makeBar(pct, color = '#4fc3f7') { 
    const W = 60, H = 6; 
    const canvas = new St.DrawingArea({ width: W, height: H, 
        y_align: Clutter.ActorAlign.CENTER }); 
    canvas.connect('repaint', area => { 
        const cr = area.get_context(); 
        // Background track 
        cr.setSourceRGBA(1,1,1,0.12); 
        roundRect(cr, 0, 0, W, H, 3); 
        cr.fill(); 
        // Filled portion 
        const hex = color.replace('#',''); 
        const r = parseInt(hex.slice(0,2),16)/255, 
               g = parseInt(hex.slice(2,4),16)/255, 
               b = parseInt(hex.slice(4,6),16)/255; 
         cr.setSourceRGBA(r, g, b, 0.9); 
         roundRect(cr, 0, 0, Math.max(3, W * pct/100), H, 3); 
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
 
         // Compact label in the panel bar 
         this._panelBox = new St.BoxLayout({ style_class: 'sysmon-panel-box' }); 
         this._panelLabel = new St.Label({ 
             text: 'CPU:— RAM:—', 
             y_align: Clutter.ActorAlign.CENTER, 
             style_class: 'sysmon-panel-label', 
         }); 
         this._panelBox.add_child(this._panelLabel); 
         this.add_child(this._panelBox); 
 
         // Build popup cards 
         this._buildPopup(); 
     } 
 
     _buildPopup() { 
         // CPU row 
         this._cpuItem = this._makeCard('CPU', '#4fc3f7'); 
         this.menu.addMenuItem(this._cpuItem.item); 
 
         // GPU row (shown if detected and enabled) 
         this._gpuItem = this._makeCard('GPU', '#ce93d8'); 
         this.menu.addMenuItem(this._gpuItem.item); 
 
         // RAM row 
         this._ramItem = this._makeCard('RAM', '#81c784'); 
         this.menu.addMenuItem(this._ramItem.item); 
 
         // Swap row 
         this._swapItem = this._makeCard('Swap', '#ffb74d'); 
         this.menu.addMenuItem(this._swapItem.item); 
 
         // Network row 
         const netItem = new PopupMenu.PopupBaseMenuItem({ reactive: false }); 
         this._netBox = new St.BoxLayout({ style_class: 'sysmon-net-box', 
             x_expand: true, vertical: false }); 
         this._upLabel   = new St.Label({ text: '↑ 0 KB/s', style_class: 'sysmon-net-label' }); 
         this._downLabel = new St.Label({ text: '↓ 0 KB/s', style_class: 'sysmon-net-label' }); 
         this._netBox.add_child(this._upLabel); 
         this._netBox.add_child(this._downLabel); 
         netItem.add_child(this._netBox); 
         this.menu.addMenuItem(netItem); 
         this._netItem = netItem; 
     } 
 
     _makeCard(title, color) { 
         const item = new PopupMenu.PopupBaseMenuItem({ reactive: false }); 
         const box = new St.BoxLayout({ x_expand: true, vertical: false, 
             style_class: 'sysmon-card-row' }); 
         const lbl = new St.Label({ text: title, style_class: 'sysmon-card-title', 
             x_expand: false }); 
         lbl.set_width(48); 
         const barHolder = new St.BoxLayout({ x_expand: true, 
             y_align: Clutter.ActorAlign.CENTER }); 
         const bar = makeBar(0, color); 
         barHolder.add_child(bar); 
         const pctLbl = new St.Label({ text: '0%', style_class: 'sysmon-card-pct', 
             x_align: Clutter.ActorAlign.END }); 
         box.add_child(lbl); 
         box.add_child(barHolder); 
         box.add_child(pctLbl); 
         item.add_child(box); 
         return { item, bar, barHolder, pctLbl }; 
     } 
 
     update(data) { 
         const { cpu, gpu, mem, net } = data; 
 
         // Panel label (compact) 
         this._panelLabel.set_text( 
             `CPU:${cpu}%  RAM:${mem.ramPct}%` + 
             (net ? `  ↑${_formatSpeed(net.upKB)} ↓${_formatSpeed(net.downKB)}` : '') 
         ); 
 
         // Refresh each bar 
         this._refreshCard(this._cpuItem, cpu); 
         this._refreshCard(this._gpuItem, gpu ?? 0); 
         this._gpuItem.item.visible = gpu !== null && 
             this._settings.get_boolean('show-gpu'); 
 
         this._refreshCard(this._ramItem, mem.ramPct); 
         this._refreshCard(this._swapItem, mem.swapPct); 
         this._swapItem.item.visible = this._settings.get_boolean('show-swap'); 
 
         if (net && this._settings.get_boolean('show-network')) { 
             this._upLabel.set_text(`↑ ${_formatSpeed(net.upKB)}`); 
             this._downLabel.set_text(`↓ ${_formatSpeed(net.downKB)}`); 
             this._netItem.visible = true; 
         } else { 
             this._netItem.visible = false; 
         } 
     } 
 
     _refreshCard(card, pct) { 
         card.pctLbl.set_text(`${pct}%`); 
         // Recreate bar with new value 
         const children = card.barHolder.get_children(); 
         children.forEach(c => card.barHolder.remove_child(c)); 
         const colorMap = { 0: '#4fc3f7', 1: '#ce93d8', 2: '#81c784', 3: '#ffb74d' }; 
         // Re-use bar with repaint 
         card.bar.queue_repaint && card.bar.queue_repaint(); 
     } 
 }); 
 
 function _formatSpeed(kb) { 
     if (kb >= 1024) return `${(kb/1024).toFixed(1)} MB/s`; 
     return `${kb} KB/s`; 
 } 
 
 // ── Main Extension ───────────────────────────────────────────────────────── 
 
 export default class SysMonExtension extends Extension { 
     enable() { 
         this._indicator = new Indicator(this); 
         Main.panel.addToStatusArea(this.uuid, this._indicator); 
 
         detectGpu(); 
         this._gpuPct = 0; 
         this._startTimer(); 
     } 
 
     _startTimer() { 
         const interval = this.getSettings().get_int('refresh-interval'); 
         this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => { 
             this._tick(); 
             return GLib.SOURCE_CONTINUE; // keep repeating 
         }); 
     } 
 
     _tick() { 
         const cpu = getCpuPercent(); 
         const mem = getMemInfo(); 
         const net = getNetSpeed(); 
 
         if (_gpuType !== 'none') { 
             getGpuPercent(pct => { 
                 this._gpuPct = pct; 
             }); 
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
