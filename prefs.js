// ESM preferences (GNOME 45+)
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SysMonPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(480, 560);

        const page = new Adw.PreferencesPage();

        const generalGroup = new Adw.PreferencesGroup({
            title: _('General'),
            description: _('Refresh rate and appearance.'),
        });

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh interval (seconds)'),
            subtitle: _('Lower values update faster and use slightly more CPU.'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
            }),
        });
        settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(intervalRow);

        const monochromeRow = new Adw.SwitchRow({
            title: _('Monochrome mode'),
            subtitle: _('Use one neutral color instead of status colors.'),
        });
        settings.bind('monochrome-mode', monochromeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(monochromeRow);

        page.add(generalGroup);

        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel'),
            description: _('Choose what the panel button shows. The arrow opens the popup.'),
        });

        const valuesRow = new Adw.SwitchRow({
            title: _('Show values'),
            subtitle: _('Hide the numbers to keep only the icons in the panel.'),
        });
        settings.bind('panel-show-values', valuesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(valuesRow);

        const panelToggles = [
            ['show-cpu', _('CPU'), _('Display CPU usage in the panel.')],
            ['show-ram', _('RAM'), _('Display memory usage in the panel.')],
            ['show-swap', _('Swap'), _('Display swap usage in the panel.')],
            ['show-network', _('Network'), _('Display upload and download speeds in the panel.')],
        ];

        for (const [key, label, subtitle] of panelToggles) {
            const row = new Adw.SwitchRow({title: label, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            panelGroup.add(row);
        }

        page.add(panelGroup);

        const popupGroup = new Adw.PreferencesGroup({
            title: _('Popup'),
            description: _('Choose which graphs appear in the popup.'),
        });

        const popupToggles = [
            ['popup-show-cpu', _('CPU graph'), _('Show the CPU graph and temperature.')],
            ['popup-show-ram', _('RAM graph'), _('Show the memory graph.')],
            ['popup-show-gpu', _('GPU graph'), _('Show GPU load when supported.')],
            ['popup-show-swap', _('Swap graph'), _('Show the swap graph.')],
            ['popup-show-network', _('Network graphs'), _('Show upload and download graphs.')],
        ];

        for (const [key, label, subtitle] of popupToggles) {
            const row = new Adw.SwitchRow({title: label, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            popupGroup.add(row);
        }

        page.add(popupGroup);
        window.add(page);
    }
}
