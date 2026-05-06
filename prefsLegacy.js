// Legacy preferences for GNOME 40-42 (Gtk-based, no libadwaita)
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const ExtensionUtils = imports.misc.extensionUtils;
const _ = ExtensionUtils.gettext;

class Preferences {
    constructor() {
        this._settings = null;
    }

    getSettings() {
        if (!this._settings) {
            this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.sysmon');
        }
        return this._settings;
    }

    buildPrefsWidget() {
        const frame = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin: 10,
        });

        // Refresh interval
        const intervalLabel = new Gtk.Label({
            label: 'Refresh interval (seconds)',
            halign: Gtk.Align.START,
        });
        const intervalAdjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 10,
            step_increment: 1,
            value: this.getSettings().get_int('refresh-interval'),
        });
        const intervalSpin = new Gtk.SpinButton({
            adjustment: intervalAdjustment,
        });
        intervalSpin.connect('value-changed', (widget) => {
            this.getSettings().set_int('refresh-interval', widget.value);
        });

        const intervalBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
        });
        intervalBox.pack_start(intervalLabel, true, true, 0);
        intervalBox.pack_start(intervalSpin, false, false, 0);
        frame.pack_start(intervalBox, false, false, 0);

        // Toggle switches
        const toggles = [
            ['show-gpu', 'Show GPU'],
            ['show-swap', 'Show Swap'],
            ['show-network', 'Show Network'],
        ];

        toggles.forEach(([key, label]) => {
            const switchLabel = new Gtk.Label({
                label: label,
                halign: Gtk.Align.START,
            });
            const switchWidget = new Gtk.Switch({
                active: this.getSettings().get_boolean(key),
            });
            switchWidget.connect('notify::active', (widget) => {
                this.getSettings().set_boolean(key, widget.active);
            });

            const switchBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 10,
            });
            switchBox.pack_start(switchLabel, true, true, 0);
            switchBox.pack_start(switchWidget, false, false, 0);
            frame.pack_start(switchBox, false, false, 0);
        });

        frame.show_all();
        return frame;
    }
}

let prefs = null;

function init() {
    prefs = new Preferences();
}

function buildPrefsWidget() {
    if (!prefs)
        prefs = new Preferences();

    return prefs.buildPrefsWidget();
}
