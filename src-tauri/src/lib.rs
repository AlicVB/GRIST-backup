use chrono::Utc;
use dirs;
use notify_rust;
use regex::Regex;
use reqwest;
use serde_json;
use std::fs;
use std::io::Write;
use std::path::Path;

fn clean_filename(filename: &str) -> String {
    let re = Regex::new(r#"[\\/:"<>|?*]"#).unwrap();
    re.replace_all(filename, "_").to_string()
}

// We build a structured error : the frontend is in charge of the translation
// with the message "key" and its "params".
fn get_error(err: u16, key: &str, params: serde_json::Value) -> String {
    return serde_json::json!({
      "error": err,
      "key": key,
      "params": params
    })
    .to_string();
}

fn get_config_dir() -> Result<std::path::PathBuf, String> {
    let cfd = match dirs::config_dir() {
        Some(p) => p,
        None => return Err(get_error(901, "err.config_dir", serde_json::json!({}))),
    };
    let mut path = cfd;
    path.push(env!("CARGO_PKG_NAME"));
    // we create it if needed
    if let Err(_) = fs::create_dir_all(&path) {
        return Err(get_error(
            901,
            "err.config_create",
            serde_json::json!({ "path": path.display().to_string() }),
        ));
    };
    return Ok(path);
}

#[tauri::command]
fn load() -> Result<String, String> {
    // let's get the config dir
    let mut path = get_config_dir()?;
    // if the config file exists, we read the file and return its content
    path.push("config.txt");
    return Ok(fs::read_to_string(&path).unwrap_or_default());
}

#[tauri::command]
fn save(datas: &str) -> Result<(), String> {
    // let's get the config dir
    let mut path = get_config_dir()?;
    path.push("config.txt");
    fs::write(&path, datas).map_err(|_| {
        get_error(
            901,
            "err.config_write",
            serde_json::json!({ "path": path.display().to_string() }),
        )
    })?;
    write_log(&format!(
        "I : Configuration saved here : {}",
        path.display()
    ));
    return Ok(());
}

#[tauri::command]
fn notify(summary: String, body: String, icon: String) {
    let _ = notify_rust::Notification::new()
        .summary(&summary)
        .body(&body)
        .icon(&icon)
        .timeout(notify_rust::Timeout::Milliseconds(6000)) //milliseconds
        .show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load,
            save,
            notify,
            grist_get_docs,
            grist_backup,
            write_log,
            last_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn load_datas() -> String {
    load().unwrap_or_default()
}

#[tauri::command]
async fn grist_get_docs(server: String, api: String) -> Result<String, String> {
    // the returned value (a JSON table with each doc details)
    let mut ret = "[".to_string();

    // instanciate the client that will be used to retrieve the JSON from GRIST API
    let client = reqwest::Client::new();

    // Let's grab all the organisation available for the user
    let cres = client
        .get(&format!("{}/orgs", server))
        .bearer_auth(&api)
        .send()
        .await;
    let res = match cres {
        Ok(f) => f,
        Err(_) => {
            write_log(&format!("E : Acces error to {}/orgs", server));
            return Err(get_error(
                1,
                "err.conn",
                serde_json::json!({ "url": format!("{}/orgs", server) }),
            )); // we return an error
        }
    };
    if res.status().as_u16() != 200 {
        write_log_status(&format!("{}/orgs", server), res.status().as_u16());
        let status = res.status().as_u16();
        let url = format!("{}/orgs", server);
        let key = match status {
            404 => "err.url_not_found",
            403 => "err.url_forbidden",
            401 => "err.url_auth",
            _ => "err.url_error",
        };
        return Err(get_error(
            status,
            key,
            serde_json::json!({ "url": url, "code": status }),
        ));
    }
    // we deserialize the returned value
    let rest = res.text().await.unwrap_or("".to_string());
    let orgs: serde_json::Value = match serde_json::from_str(&rest) {
        Ok(f) => f,
        Err(_) => {
            write_log(&format!(
                "E : Cannot deserialize output of {}/orgs",
                server
            ));
            return Err(get_error(
                900,
                "err.deserialize",
                serde_json::json!({ "url": format!("{}/orgs", server) }),
            ));
        }
    };
    // let's process each oraganisation returned
    let mut nbdoc = 0;
    if let Some(torgs) = orgs.as_array() {
        for org in torgs {
            if org["id"].is_number() {
                // we have found a "valid" organisation. Let's keep its values
                let org_name = org["name"].as_str().unwrap_or("??");
                let org_id = org["id"].as_number().unwrap();
                // Now we want to get all the workspaces available for this organisation
                let cres = client
                    .get(&format!("{}/orgs/{}/workspaces", server, org_id))
                    .bearer_auth(&api)
                    .send()
                    .await;
                let res = match cres {
                    Ok(f) => f,
                    Err(_) => continue, // the organisation doesn't have valid workspaces. We scan the next one
                };
                if res.status().is_success() {
                    // we deserialize the returned value
                    let rest = res.text().await.unwrap_or("".to_string());
                    let wks: serde_json::Value = match serde_json::from_str(&rest) {
                        Ok(f) => f,
                        Err(_) => continue,
                    };
                    // let's process each workspace returned
                    if let Some(twks) = wks.as_array() {
                        for wk in twks {
                            // we have found a "valid" workspace. Let's keep its values
                            let wk_name = wk["name"].as_str().unwrap_or("??");
                            // and we scan the docs array returned in the JSON
                            if let Some(tdocs) = wk["docs"].as_array() {
                                for doc in tdocs {
                                    nbdoc += 1;
                                    // we construct a JSON object with the path, the name and the id of the document
                                    let doc_name = doc["name"].as_str().unwrap_or("??");
                                    let doc_id = doc["id"].as_str().unwrap_or("");
                                    if doc_id != "" {
                                        let doc_path =
                                            format!("{}/{}/{}", org_name, wk_name, doc_name);
                                        // And we add that to the returned value
                                        ret += &serde_json::json!({
                                        "path": doc_path,
                                        "name": doc_name,
                                        "id": doc_id
                                        })
                                        .to_string();
                                        ret += ",";
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // if we have at least found 1 doc, we have an unwanted final comma in the JSON. Let's remove it
    if ret != "[" {
        let mut chars = ret.chars();
        chars.next_back();
        ret = chars.as_str().to_string();
    }
    // and we can close the JSON array and return the JSON string
    ret += "]";
    write_log(&format!("I : {} documents found on {}", nbdoc, server));
    return Ok(ret);
}

async fn _grist_backup(
    server: String,
    api: String,
    docid: String,
    docname: &String,
    dir: String,
    btype: String,
) -> Result<String, String> {
    let tpe = if btype != "/xlsx" { "" } else { &btype };
    // Check dir existence and validity
    let path = Path::new(&dir);
    if !path.exists() || !path.is_dir() || !path.is_absolute() {
        write_log(&format!(
            "BACKUP Directory \"{}\" is not valid for {} {}",
            dir, docname, tpe
        ));
        return Err(get_error(
            902,
            "err.dir",
            serde_json::json!({ "dir": dir }),
        ));
    }

    // instanciate the client that will be used to retrieve the JSON from GRIST API
    let client = reqwest::Client::new();

    // call the API for download
    let cres = client
        .get(&format!("{}/docs/{}/download{}", server, docid, tpe))
        .bearer_auth(&api)
        .send()
        .await;
    let res = match cres {
        Ok(f) => f,
        Err(_) => {
            write_log(&format!(
                "E : Access error to {}/docs/{}/download{}",
                server, docid, tpe
            ));
            return Err(get_error(904, "err.api_call", serde_json::json!({})));
        }
    };
    // Check the return status
    if res.status().as_u16() != 200 {
        write_log_status(
            &format!("{}/docs/{}/download{}", server, docid, tpe),
            res.status().as_u16(),
        );
    }
    // we return a "simplidied" error message
    match res.status().as_u16() {
        404 => {
            return Err(get_error(
                res.status().as_u16(),
                "err.doc_not_found",
                serde_json::json!({ "id": docid }),
            ));
        }
        403 => {
            return Err(get_error(
                res.status().as_u16(),
                "err.forbidden",
                serde_json::json!({ "id": docid }),
            ));
        }
        200 => (),
        e => {
            return Err(get_error(
                res.status().as_u16(),
                "err.status",
                serde_json::json!({ "code": e, "id": docid }),
            ));
        }
    };
    // get the file content
    let bres = match res.bytes().await {
        Ok(f) => f,
        Err(_) => {
            write_log(&format!(
                "E : API Cannot read the output of {}/docs/{}/download{}",
                server, docid, tpe
            ));
            return Err(get_error(903, "err.api_read", serde_json::json!({})));
        }
    };
    write_log(&format!(
        "I : API {}/docs/{}/download{} downloaded",
        server, docid, tpe
    ));

    // let's construct the destination path
    let dte = Utc::now().format("%Y-%m-%d %H-%M-%S").to_string();
    let ext = if tpe == "" { "grist" } else { "xlsx" };
    let path = path.join(format!("{}_{}.{}", clean_filename(docname), dte, ext));

    // and write the file content into the destination file
    if let Err(_) = fs::write(&path, bres) {
        write_log(&format!(
            "E : Cannot save the file {}",
            path.display()
        ));
        return Err(get_error(
            903,
            "err.file_write",
            serde_json::json!({ "path": path.display().to_string() }),
        ));
    };
    write_log(&format!(
        "I : BACKUP success for {} {}",
        docname, tpe
    ));
    return Ok("".to_string());
}

#[tauri::command]
async fn grist_backup(
    server: String,
    api: String,
    docid: String,
    docname: String,
    dir: String,
    btype: String,
) -> Result<String, String> {
    // the notifications are now sent by the frontend, with the translated messages
    return _grist_backup(server, api, docid, &docname, dir, btype).await;
}

#[tauri::command]
async fn last_backup(docname: String, dir: String, tp: String) -> u64 {
    let mut last: u64 = 0;
    if let Ok(paths) = fs::read_dir(dir) {
        for path in paths {
            let p = match path {
                Ok(f) => f,
                _ => continue,
            };
            let pfn = p.file_name();
            let pp = pfn.to_str().unwrap_or("");
            let ext = if tp == "/xlsx" { ".xlsx" } else { ".grist" };
            // we restrict the file pattern
            if pp.starts_with(&format!("{}_", clean_filename(&docname))) && pp.ends_with(ext) {
                if let Ok(mm) = p.metadata() {
                    if let Ok(tt) = mm.created() {
                        if let Ok(ss) = tt.duration_since(std::time::UNIX_EPOCH) {
                            if ss.as_secs() > last {
                                last = ss.as_secs();
                            }
                        };
                    };
                };
            };
        }
    };

    return last;
}

#[tauri::command]
fn write_log(text: &str) {
    // get the log file
    let mut path = match get_config_dir() {
        Ok(p) => p,
        Err(_) => return,
    };
    path.push("log.txt");

    // eventually remove the first lines if there's too much content

    // construct the line to write
    let txt = format!(
        "{} {}",
        Utc::now().format("[%d/%m/%Y %H:%M:%S]").to_string(),
        text
    );

    // append the line to the log file
    if let Ok(mut file) = fs::OpenOptions::new().append(true).create(true).open(&path) {
        if let Ok(_) = writeln!(file, "{}", txt) {
            return;
        };
    };
}

fn get_text_statut(api: &str, status: u16) -> String {
    match status {
        404 => return format!("Cannot found {}", api),
        403 => return format!("You don't have access rights for {}", api),
        401 => return format!("Authentification error to access {}", api),
        200 => return format!("Access successfull to {}", api),
        e => return format!("Error {} to access {}", e, api),
    }
}
fn write_log_status(api: &str, status: u16) {
    // get the log file
    if status != 200 {
        write_log(&format!("E : API {}", get_text_statut(api, status)));
    }
}
