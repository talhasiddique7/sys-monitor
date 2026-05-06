// CommonJS imports (compatible with GNOME 40-50)
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const ExtensionUtils = imports.misc.extensionUtils;
const _ = ExtensionUtils.gettext;

// Check if Adw is available (GNOME 43+)
let Adw = null;
try {
    Adw = imports.gi.Adw;
} catch (e) {
    // Adw not available, will use Gtk fallback (GNOME 40-42)
} 
 
class Preferences {
    getSettings() {
        return ExtensionUtils.getSettings('org.gnome.shell.extensions.sysmon');
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        if (Adw) {
            // GNOME 43+ with libadwaita
            const page = new Adw.PreferencesPage();
            const group = new Adw.PreferencesGroup({ title: 'Display' });

            const intervalRow = new Adw.SpinRow({
                title: 'Refresh interval (seconds)',
                adjustment: new Gtk.Adjustment({ lower:1, upper:10, step_increment:1 }),
            });
            settings.bind('refresh-interval', intervalRow, 'value',
                Gio.SettingsBindFlags.DEFAULT);
            group.add(intervalRow);

            const toggles = [
                ['show-gpu',     'Show GPU'],
                ['show-swap',    'Show Swap'],
                ['show-network', 'Show Network'],
            ];
            toggles.forEach(([key, label]) => {
                const row = new Adw.SwitchRow({ title: label });
                settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
                group.add(row);
            });

            page.add(group);
            window.add(page);
        } else {
            // GNOME 40-42 fallback (Gtk-based)
            const frame = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 10,
                margin: 10,
            });

            const intervalLabel = new Gtk.Label({
                label: 'Refresh interval (seconds)',
                halign: Gtk.Align.START,
            });
            const intervalAdjustment = new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
                value: settings.get_int('refresh-interval'),
            });
            const intervalSpin = new Gtk.SpinButton({
                adjustment: intervalAdjustment,
            });
            intervalSpin.connect('value-changed', (widget) => {
                settings.set_int('refresh-interval', widget.value);
            });

            const intervalBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 10,
            });
            intervalBox.pack_start(intervalLabel, true, true, 0);
            intervalBox.pack_start(intervalSpin, false, false, 0);
            frame.pack_start(intervalBox, false, false, 0);

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
                    active: settings.get_boolean(key),
                });
                switchWidget.connect('notify::active', (widget) => {
                    settings.set_boolean(key, widget.active);
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
            window.add(frame);
        }
    }

    // For GNOME 40-42 compatibility
    buildPrefsWidget() {
        const settings = this.getSettings();
        const frame = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin: 10,
        });

        const intervalLabel = new Gtk.Label({
            label: 'Refresh interval (seconds)',
            halign: Gtk.Align.START,
        });
        const intervalAdjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 10,
            step_increment: 1,
            value: settings.get_int('refresh-interval'),
        });
        const intervalSpin = new Gtk.SpinButton({
            adjustment: intervalAdjustment,
        });
        intervalSpin.connect('value-changed', (widget) => {
            settings.set_int('refresh-interval', widget.value);
        });

        const intervalBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
        });
        intervalBox.pack_start(intervalLabel, true, true, 0);
        intervalBox.pack_start(intervalSpin, false, false, 0);
        frame.pack_start(intervalBox, false, false, 0);

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
                active: settings.get_boolean(key),
            });
            switchWidget.connect('notify::active', (widget) => {
                settings.set_boolean(key, widget.active);
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

function init() {
    return new Preferences();
}
