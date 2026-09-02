// Declaring the app's own commands here is what makes them callable at all.
//
// Tauri's ACL is usually something only plugins have to think about, because
// an app that ships bundled files counts as a "local" origin and local origins
// may call any command in `generate_handler!` for free. This window loads the
// live site instead, so every invoke arrives from a remote origin — and Tauri
// then requires an explicit permission for *every* command, the app's own
// included (`Webview::on_message`: `plugin_command.is_some() ||
// has_app_acl_manifest || !is_local`). Without one it rejects the call with
// "Command <name> not allowed by ACL" before the Rust function is ever
// reached. `remote.urls` in capabilities/default.json puts this origin in
// scope; it does not grant anything on its own.
//
// That is the whole story behind pairing "succeeding on the server but failing
// locally", and behind session.json never being written either: the webview
// could not reach save_bridge_token or save_session at all. The bridge loop
// kept working throughout because it calls load_bridge_token as a plain Rust
// function, with no IPC in front of it.
//
// Each name below autogenerates an `allow-<kebab-name>` permission, which
// capabilities/default.json then grants. Every command registered in main.rs's
// `generate_handler!` must appear in both places — one that is registered but
// not granted is callable in name only, and fails at runtime with nothing in
// the app's own logs to say why.
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "list_serial_ports",
            "print_ticket",
            "get_default_windows_printer",
            "save_session",
            "load_session",
            "clear_session",
            "save_bridge_token",
            "load_bridge_token",
            "clear_bridge_token",
        ])),
    )
    .expect("failed to run tauri-build");
}
