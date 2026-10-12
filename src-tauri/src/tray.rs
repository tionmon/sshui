use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, AppHandle,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::commands::{hosts_file, proxy};

const TRAY_ID: &str = "main";
const SCHEME_PREFIX: &str = "hosts-scheme:";
const PROXY_PREFIX: &str = "proxy-profile:";

#[cfg(target_os = "macos")]
use objc2_app_kit::NSApplication;
#[cfg(target_os = "macos")]
use objc2_foundation::MainThreadMarker;

/// Build the tray menu, including a "Hosts schemes" submenu for one-click switching.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;

    let state = hosts_file::load_state().ok();
    let mut scheme_items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = Vec::new();
    match &state {
        Some(state) if !state.schemes.is_empty() => {
            for scheme in &state.schemes {
                let active = state.active_id.as_deref() == Some(scheme.id.as_str());
                scheme_items.push(Box::new(CheckMenuItem::with_id(
                    app,
                    format!("{}{}", SCHEME_PREFIX, scheme.id),
                    &scheme.name,
                    true,
                    active,
                    None::<&str>,
                )?));
            }
        }
        _ => scheme_items.push(Box::new(MenuItem::with_id(
            app,
            "hosts-none",
            "No schemes",
            false,
            None::<&str>,
        )?)),
    }
    let scheme_refs: Vec<&dyn IsMenuItem<tauri::Wry>> = scheme_items.iter().map(|i| i.as_ref()).collect();
    let hosts_menu = Submenu::with_items(app, "Hosts schemes", true, &scheme_refs)?;

    let separator = PredefinedMenuItem::separator(app)?;
    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&show_i, &hide_i, &separator, &hosts_menu];

    // Proxy profiles, once the user has created any
    let proxy_menu = match proxy::load_state() {
        Ok(state) if !state.profiles.is_empty() => {
            let active = state.active_id.as_deref();
            let mut entries = vec![CheckMenuItem::with_id(
                app,
                format!("{}{}", PROXY_PREFIX, proxy::DIRECT_ID),
                "Direct (no proxy)",
                true,
                active == Some(proxy::DIRECT_ID),
                None::<&str>,
            )?];
            for profile in &state.profiles {
                entries.push(CheckMenuItem::with_id(
                    app,
                    format!("{}{}", PROXY_PREFIX, profile.id),
                    &profile.name,
                    true,
                    active == Some(profile.id.as_str()),
                    None::<&str>,
                )?);
            }
            let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = entries.iter().map(|i| i as &dyn IsMenuItem<tauri::Wry>).collect();
            Some(Submenu::with_items(app, "Proxy", true, &refs)?)
        }
        _ => None,
    };
    if let Some(menu) = &proxy_menu {
        items.push(menu);
    }
    let separator2 = PredefinedMenuItem::separator(app)?;
    items.push(&separator2);
    items.push(&quit_i);
    Menu::with_items(app, &items)
}

/// Rebuild the tray menu after schemes or the active scheme change.
pub fn refresh_menu(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        match build_menu(app) {
            Ok(menu) => {
                let _ = tray.set_menu(Some(menu));
            }
            Err(e) => eprintln!("[TRAY] Failed to rebuild menu: {}", e),
        }
    }
}

fn apply_scheme_from_tray(app: &AppHandle, id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = hosts_file::apply_scheme(id).await;
        refresh_menu(&app);
        let _ = app.emit(hosts_file::STATE_CHANGED_EVENT, ());
        if let Err(e) = result {
            app.dialog()
                .message(e)
                .title("SSHUI")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    });
}

fn apply_proxy_from_tray(app: &AppHandle, id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || proxy::apply_blocking(&id)).await;
        refresh_menu(&app);
        let _ = app.emit(proxy::STATE_CHANGED_EVENT, ());
        let failures: Vec<String> = match result {
            Ok(Ok(results)) => results.into_iter().filter(|r| !r.ok).map(|r| format!("{}: {}", r.target, r.message)).collect(),
            Ok(Err(e)) => vec![e],
            Err(e) => vec![e.to_string()],
        };
        if !failures.is_empty() {
            app.dialog()
                .message(failures.join("\n"))
                .title("SSHUI")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    });
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    // Load and decode icon from embedded bytes - use icon.png for consistency with Dock icon
    let icon_bytes = include_bytes!("../icons/icon.png");
    let img = image::load_from_memory(icon_bytes)
        .map_err(|e| tauri::Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let raw_pixels = rgba.into_raw();
    let icon = tauri::image::Image::new(&raw_pixels, width, height);

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            id if id.starts_with(SCHEME_PREFIX) => {
                apply_scheme_from_tray(app, id[SCHEME_PREFIX.len()..].to_string());
            }
            id if id.starts_with(PROXY_PREFIX) => {
                apply_proxy_from_tray(app, id[PROXY_PREFIX.len()..].to_string());
            }
            "quit" => {
                eprintln!("[TRAY] Quit menu item clicked");
                app.exit(0);
            }
            "show" => {
                eprintln!("[TRAY] Show menu item clicked");

                #[cfg(target_os = "macos")]
                {
                    let mtm = unsafe { MainThreadMarker::new_unchecked() };
                    let app = NSApplication::sharedApplication(mtm);
                    app.setActivationPolicy(objc2_app_kit::NSApplicationActivationPolicy::Regular);
                }

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                eprintln!("[TRAY] Hide menu item clicked");

                #[cfg(target_os = "macos")]
                {
                    let mtm = unsafe { MainThreadMarker::new_unchecked() };
                    let app = NSApplication::sharedApplication(mtm);
                    app.setActivationPolicy(objc2_app_kit::NSApplicationActivationPolicy::Accessory);
                }

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                eprintln!("[TRAY] Tray icon clicked");
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        #[cfg(target_os = "macos")]
                        {
                            let mtm = unsafe { MainThreadMarker::new_unchecked() };
                            let ns_app = NSApplication::sharedApplication(mtm);
                            ns_app.setActivationPolicy(objc2_app_kit::NSApplicationActivationPolicy::Accessory);
                        }

                        let _ = window.hide();
                    } else {
                        #[cfg(target_os = "macos")]
                        {
                            let mtm = unsafe { MainThreadMarker::new_unchecked() };
                            let ns_app = NSApplication::sharedApplication(mtm);
                            ns_app.setActivationPolicy(objc2_app_kit::NSApplicationActivationPolicy::Regular);
                        }

                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
