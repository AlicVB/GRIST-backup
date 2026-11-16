# GRIST backup

Tool to automate GRIST backups.

![1794686512478](image/README/1794686512478.png)

## Details

This app runs in the system tray, with a UI to configure the backups.

- Connection to the GRIST API is done via the API key (no OAuth support at the moment).
- You can manage as many documents as you want.
- You can back up a document either in GRIST format (full data) or in XLSX format (mainly useful to keep an offline copy).
- For each backup, you can specify the frequency and the destination.

## License

This app is provided under `GPL-3.0-or-later`. You can get the license here: [www.gnu.org/licenses/gpl-3.0.en.html#license-text](https://www.gnu.org/licenses/gpl-3.0.en.html#license-text)

## State

This tool is currently in the alpha phase. Tests have only been done on Linux.

## Build

This app is written using the Tauri framework, with vanilla JavaScript/HTML/CSS for the frontend.
Please see the Tauri docs for instructions on how to compile the app: [v2.tauri.app](https://v2.tauri.app/)
