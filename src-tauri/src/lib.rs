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

fn get_config_dir() -> Option<std::path::PathBuf> {
    // let's get the config dir
    let cfd = dirs::config_dir();
    if cfd.is_none() {
        let _ = notify_rust::Notification::new()
            .summary("GRIST backup")
            .body("Impossible de récupérer le dossier de configuration !")
            .icon("dialog-error")
            .timeout(notify_rust::Timeout::Milliseconds(6000)) //milliseconds
            .show();
        return None;
    };
    let mut path = cfd.unwrap();
    path.push(env!("CARGO_PKG_NAME"));
    // we create it if needed
    if let Err(_) = fs::create_dir_all(&path) {
        write_log(&format!(
            "E : Impossible de créer le dossier {}",
            path.display()
        ));
        let _ = notify_rust::Notification::new()
            .summary("GRIST backup")
            .body(&format!(
                "Impossible de créer le dossier de configuration {}",
                path.display()
            ))
            .icon("dialog-error")
            .timeout(notify_rust::Timeout::Milliseconds(6000)) //milliseconds
            .show();
        return None;
    };
    return Some(path);
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn load() -> String {
    // let's get the config dir
    let path = get_config_dir();
    if path.is_none() {
        return "".to_string();
    }
    let mut path = path.unwrap();
    // if the config file exists, we read the file and return its content
    path.push("config.txt");
    let datas = fs::read_to_string(path);
    match datas {
        Ok(txt) => txt,
        Err(_) => "".to_string(),
    }
}

#[tauri::command]
fn save(datas: &str) {
    // let's get the config dir
    let path = get_config_dir();
    if path.is_none() {
        return;
    }
    let mut path = path.unwrap();
    // if the config file exists, we read the file and return its content
    path.push("config.txt");
    let _ = fs::write(&path, datas);
    write_log(&format!(
        "I : Configuration sauvegardée ici : {}",
        path.display()
    ));
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
            grist_get_docs,
            grist_backup,
            write_log,
            last_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn load_datas() -> String {
    load()
}

fn get_error(err: u16, msg: &str) -> String {
    return serde_json::json!({
      "error": err,
      "msg": msg
    })
    .to_string();
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
            write_log(&format!("E : API Erreur d'accès à {}/orgs", server));
            return Err(get_error(1, &format!("Erreur d'accès à {}/orgs", server))); // we return an error
        }
    };
    if res.status().as_u16() != 200 {
        write_log_status(&format!("{}/orgs", server), res.status().as_u16());
        return Err(get_error(
            res.status().as_u16(),
            &get_text_statut(&format!("{}/orgs", server), res.status().as_u16()),
        ));
    }
    // we deserialize the returned value
    let rest = res.text().await.unwrap_or("".to_string());
    let orgs: serde_json::Value = match serde_json::from_str(&rest) {
        Ok(f) => f,
        Err(_) => {
            write_log(&format!(
                "E : Impossible de désérialiser le retour de {}/orgs",
                server
            ));
            return Err(get_error(
                900,
                &format!(
                    "E : Impossible de désérialiser le retour de {}/orgs",
                    server
                ),
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
    write_log(&format!("I : {} documents trouvés sur {}", nbdoc, server));
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
            "BACKUP Dossier \"{}\" invalide pour {} {}",
            dir, docname, tpe
        ));
        return Err(get_error(
            902,
            &format!(
                "Le dossier de sauvegarde \"{}\" n'est pas accessible !",
                dir
            ),
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
                "E : API Erreur d'accès à {}/docs/{}/download{}",
                server, docid, tpe
            ));
            return Err(get_error(902, "Erreur dans l'appel de l'API"));
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
                &format!("Impossible de trouver le document (id={})", docid),
            ));
        }
        403 => {
            return Err(get_error(
                res.status().as_u16(),
                &format!("Vous n'avez pas les droits suffisants (id={})", docid),
            ));
        }
        200 => (),
        e => {
            return Err(get_error(
                res.status().as_u16(),
                &format!("Erreur {} (id={})", e, docid),
            ));
        }
    };
    // get the file content
    let bres = match res.bytes().await {
        Ok(f) => f,
        Err(_) => {
            write_log(&format!(
                "E : API Impossible de lire le retour de {}/docs/{}/download{}",
                server, docid, tpe
            ));
            return Err(get_error(903, "Retour de l'API GRIST illisible"));
        }
    };
    write_log(&format!(
        "I : API {}/docs/{}/download{} récupéré",
        server, docid, tpe
    ));

    // let's construct the destination path
    let dte = Utc::now().format("%Y-%m-%d %H-%M-%S").to_string();
    let ext = if tpe == "" { "grist" } else { "xlsx" };
    let path = path.join(format!("{}_{}.{}", clean_filename(docname), dte, ext));

    // and write the file content into the destination file
    if let Err(_) = fs::write(&path, bres) {
        write_log(&format!(
            "Impossible d'enregistrer le fichier {}",
            path.display()
        ));
        return Err(get_error(
            903,
            &format!("Impossible d'enregistrer le fichier {}", path.display()),
        ));
    };
    write_log(&format!(
        "I : BACKUP sauvegarde effectuée pour {} {}",
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
    notif: bool
) -> Result<String, String> {
    let res = _grist_backup(server, api, docid, &docname, dir, btype).await;
    match &res {
        Ok(_) => {
            let _ = notify_rust::Notification::new()
                .summary("GRIST backup")
                .body(&format!("{} : Sauvegarde effectuée !", docname))
                .icon("dialog-information")
                .timeout(notify_rust::Timeout::Milliseconds(6000)) //milliseconds
                .show();
        }
        Err(r) => {
          if notif {
            let mut rr = "Erreur lors de la sauvegarde".to_string();
            let mut err = 1;
            if let Ok(rrr) = serde_json::from_str::<serde_json::Value>(r) {
                rr = rrr["msg"]
                    .as_str()
                    .unwrap_or("Erreur lors de la sauvegarde")
                    .to_string();

                err = rrr["error"]
                    .as_i64()
                    .unwrap_or(1);
            }
            if err != 902 {
              // don't notify directory error : it will spam the user
              let _ = notify_rust::Notification::new()
                .summary("GRIST backup")
                .body(&format!("{} : {}", docname, rr))
                .icon("dialog-error")
                .timeout(notify_rust::Timeout::Milliseconds(6000)) //milliseconds
                .show();
            }
          }
        }
    };

    return res;
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
    let path = get_config_dir();
    if path.is_none() {
        return;
    }
    let mut path = path.unwrap();
    path.push("log.txt");

    // eventually remove the first lines if there's too much content

    // construct the line to write
    let txt = format!(
        "{} {}",
        Utc::now().format("[%d/%m/%Y %H:%M:%S]").to_string(),
        text
    );

    // append the line into the log file
    if let Ok(mut file) = fs::OpenOptions::new().append(true).create(true).open(&path) {
        if let Ok(_) = writeln!(file, "{}", txt) {
            return;
        };
    };
}

fn get_text_statut(api: &str, status: u16) -> String {
    match status {
        404 => return format!("Impossible de trouver {}", api),
        403 => return format!("Vous n'avez pas les droits pour accéder à {}", api),
        401 => return format!("Erreur d'authentification pour accéder à {}", api),
        200 => return format!("Accès réussi à {}", api),
        e => return format!("Erreur {} pour accéder à {}", e, api),
    }
}
fn write_log_status(api: &str, status: u16) {
    // get the log file
    if status != 200 {
        write_log(&format!("E : API {}", get_text_statut(api, status)));
    }
}
