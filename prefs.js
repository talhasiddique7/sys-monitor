import Adw from 'gi://Adw'; 
import Gtk from 'gi://Gtk'; 
import Gio from 'gi://Gio';
import {ExtensionPreferences, gettext as _} from 
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'; 
 
export default class Preferences extends ExtensionPreferences { 
    fillPreferencesWindow(window) { 
        const settings = this.getSettings(); 
        const page = new Adw.PreferencesPage(); 
        const group = new Adw.PreferencesGroup({ title: 'Display' }); 
 
        // Refresh interval spinner 
        const intervalRow = new Adw.SpinRow({ 
            title: 'Refresh interval (seconds)', 
            adjustment: new Gtk.Adjustment({ lower:1, upper:10, step_increment:1 }), 
        }); 
        settings.bind('refresh-interval', intervalRow, 'value', 
            Gio.SettingsBindFlags.DEFAULT); 
        group.add(intervalRow); 
 
        // Toggle rows 
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
    } 
} 
