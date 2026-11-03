# NOVA Download Manager — Windows icon pack

## Recommended Tauri 2 placement
Copy the contents of `src-tauri/icons/` into your project at `src-tauri/icons/` (merge/replace the existing generated icons). The important Windows executable icon is `icon.ico`.

In `src-tauri/tauri.conf.json`, ensure the bundle icon list includes:

```json
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico",
      "icons/icon.png"
    ]
  }
}
```

If your config already has a `bundle` section, merge only the `icon` array; do not replace unrelated settings. Then rebuild the Windows installer/EXE. Existing installed shortcuts may keep the old icon until recreated or the Windows icon cache refreshes.

## Other assets
- `windows/nova-app.ico`: multi-size icon for EXE resources, shortcuts, and installer tools.
- `windows/nova-installer.png` / `nova-uninstaller.png`: optional branded setup/removal artwork.
- `windows/taskbar-tray/`: optional status variants for active, paused, completed, error, and idle states. These are separate PNGs; wire them into your tray/status code if desired.
- `windows/file-associations/`: optional consistent PNG placeholders for file-type associations. Windows file associations generally require registered file-type icons in your installer or application manifest; these PNGs are not registered automatically.
- `branding/`: master 1024px PNG and favicon.

## Important
This pack contains actual image files and a multi-resolution ICO. The installer, tray states, and file-type icons are assets only; they do not automatically change your app. Your Tauri config, installer script, and tray/file-association code must reference them.
