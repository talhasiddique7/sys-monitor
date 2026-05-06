// ESM preferences (GNOME 45+)
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SysMonPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: _('Display')});

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh interval (seconds)'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
            }),
        });
        settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(intervalRow);

        const toggles = [
            ['show-gpu', _('Show GPU')],
            ['show-swap', _('Show Swap')],
            ['show-network', _('Show Network')],
        ];

        for (const [key, label] of toggles) {
            const row = new Adw.SwitchRow({title: label});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        }

        page.add(group);
        window.add(page);
    }
}
