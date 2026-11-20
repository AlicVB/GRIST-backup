"use strict";

const { ask, open, message } = window.__TAURI__.dialog;
const { invoke } = window.__TAURI__.core;
const { TrayIcon } = window.__TAURI__.tray;
const { defaultWindowIcon, getVersion } = window.__TAURI__.app;
const { Menu } = window.__TAURI__.menu;
const { exit } = window.__TAURI__.process;
const { getCurrentWindow } = window.__TAURI__.window;
const { enable, isEnabled, disable } = window.__TAURI__.autostart;

const STATUT = Object.freeze({
  OK: 0,
  ISSUE: 1,
  PAUSED: 2,
  STOPPED: 3,
});

// All the stuff for the systray icon
async function systray() {
  const menu = await Menu.new({
    items: [
      {
        id: 'configure',
        text: 'Configurer',
        action: systray_config,
      },
      {
        id: 'quit',
        text: 'Quitter',
        action: systray_quit,
      },
    ],
  });

  const tray_opt = {
    // here you can add a tray menu, title, tooltip, event handler, etc
    menu,
    menuOnLeftClick: true,
    icon: await defaultWindowIcon(),
  };

  const tray = await TrayIcon.new(tray_opt);
  tray.setVisible(true);
}

function systray_config(itemId) {
  getCurrentWindow().show();
}
function systray_quit(itemId) {
  exit(0);
}

function isset (accessor) {
  return (typeof accessor !== 'undefined');
}

async function config_load_datas() {
  // we stop all the backups if any
  process_stop_all();

  // let's start by loading configuration
  let txt = await invoke("load");
  if (txt != "") datas = JSON.parse(txt);
  datas_init(); // check datas values and initialize them if needed

  // initialize the UI with the datas loaded
  UI_init();

  // check autostart statut
  await Autostart_check();
}

let datas = {};
systray();

getCurrentWindow().onCloseRequested(UI_close);

window.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#d_save").addEventListener("click", config_doc_save);
  document.querySelector("#d_remove").addEventListener("click", doc_remove);
  document.querySelector("#g_save").addEventListener("click", config_global_save);
  document.querySelector("#a_propos").addEventListener("click", UI_a_propos);
  document.querySelector("#tab_add").addEventListener("click", doc_add);
  document.querySelector("#d_savg_dir_open").addEventListener("click", UI_dir_chooser);
  document.querySelector("#d_savx_dir_open").addEventListener("click", UI_dir_chooser);
  document.querySelector("#d_savg_now").addEventListener("click", backup_now);
  document.querySelector("#d_savx_now").addEventListener("click", backup_now);
  document.querySelector("#g_stop").addEventListener("click", process_stop_all);
  document.querySelector("#g_go").addEventListener("click", process_launch);

  document.querySelector("#g_api").addEventListener("change", UI_global_test_change);
  document.querySelector("#g_server").addEventListener("change", UI_global_test_change);
  document.querySelector("#g_autostart").addEventListener("change", UI_global_test_change);

  document.querySelector("#d_id").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_name").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg_dir").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg_fd").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg_fh").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg_fm").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx_dir").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx_fd").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx_fh").addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx_fm").addEventListener("change", UI_document_test_change);

  // let's start by loading configuration
  await config_load_datas();

  // and we launch the process
  start_API();
});

function datas_init() {
  if (datas == "") datas = {};
  if (!isset(datas.server)) datas.server = "https://grist.numerique.gouv.fr/api";
  if (!isset(datas.api)) datas.api = "";
  if (!isset(datas.docs)) datas.docs = [];
  if (!isset(datas.autostart)) datas.autostart = false;
  if (datas.server.slice(-1) == "/") datas.server = datas.server.slice(0,-1);

  // we also reset all the pids/pidt/errors
  // ideally those values shouldn't end in the config file, but that's much easier to have one unique structure
  datas.pidt = 0;
  datas.run = false;
  datas.msg = "";
  datas.statut = STATUT.OK;
  for (let i=0; i<datas.docs.length; i++) {
    datas.docs[i].savg_pidt = 0;
    datas.docs[i].savx_pidt = 0;
    datas.docs[i].savg_statut = STATUT.OK;
    datas.docs[i].savx_statut = STATUT.OK;
    datas.docs[i].savg_msg = "";
    datas.docs[i].savx_msg = "";
    datas.docs[i].savg_next = "";
    datas.docs[i].savx_next = "";
  }
}

function UI_init() {
  // set the global values
  document.querySelector("#g_server").value = datas.server;
  document.querySelector("#g_api").value = datas.api;
  document.querySelector("#g_autostart").checked = datas.autostart;

  // remove all the actual tabs if any
  let els = document.querySelectorAll(".tab");
  for (let i = els.length -1; i >= 0; i--) {
    els[i].parentNode.removeChild(els[i]);
  }
  // create all the tabs
  const e_add = document.querySelector("#tab_add");
  for (let i=0; i<datas.docs.length; i++) {
    const doc = datas.docs[i];
    const tab = document.createElement("div");
    tab.textContent = doc.name;
    tab.className = "tab";
    tab.addEventListener("click", UI_tab_select_dom);
    e_add.parentNode.insertBefore(tab, e_add);
  }

  // select the first tab if any
  UI_tab_select(document.querySelectorAll(".tab")[0], false);
}

function docs_list_apply(docs) {
  // we check each registered doc to see if they are still in the list otherwise we mark them as problematic
  // we don't remove them to handle gracefully error in API fetching
  for (let i=datas.docs.length-1; i>=0; i--) {
    let id = datas.docs[i].id;
    let ok = false;
    for (let j=0; j< docs.length; j++) {
      if (docs[j].id == id) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      datas.docs[i].savg_msg = "Le document n'est pas accessible !";
      datas.docs[i].savx_msg = "";
      datas.docs[i].savg_statut = STATUT.STOPPED;
      datas.docs[i].savx_statut = STATUT.STOPPED;
      logs_update_doc_msg(datas.docs[i]);
    } else {
      if (datas.docs[i].savg_statut == STATUT.STOPPED) datas.docs[i].savg_statut = STATUT.OK;
      if (datas.docs[i].savx_statut == STATUT.STOPPED) datas.docs[i].savx_statut = STATUT.OK;
      logs_update_doc_msg(datas.docs[i]);
    }
  }

  // we update the list of options available in the select form
  // we clear the select form
  let sel = document.querySelector("#d_sel");
  sel.removeEventListener("change", doc_cb_changed);
  for (let i = sel.options.length -1; i >= 0; i--) {
    sel.remove(i);
  }
  // we add an empty option
  let o = document.createElement("option");
  o.value = "";
  o.text = "";
  o.grist_name = "";
  sel.add(o);
  // we select this option by default
  sel.selectedIndex = 0;

  // we add all the items recently loaded
  for (let j=0; j< docs.length; j++) {
    o = document.createElement("option");
    o.value = docs[j].id;
    o.text = docs[j].path;
    o.grist_name = docs[j].name;
    sel.add(o);
    // we select this option if this is the one from the actual doc
    if (docs[j].id == document.querySelector("#d_id").value) sel.selectedIndex = j+1;
  }
  sel.addEventListener("change", doc_cb_changed);
}

async function start_API() {
  // we load the list of available documents via the GRIST API
  let server = datas.server;
  let api = datas.api;
  datas.pidt = 0;
  invoke("grist_get_docs", {server: server, api: api})
    .then((txt) => {
      datas.msg = "";
      datas.statut = STATUT.OK;
      datas.pidt = 0;
      logs_update_general_msg();
      let docs = JSON.parse(txt);
      docs_list_apply(docs);
      // we can now launch the backups
      process_launch();
    })
    .catch((error) => {
      let err = JSON.parse(error);
      // we show the error msg
      datas.msg = err.msg;
      datas.statut = STATUT.STOPPED;
      logs_update_general_msg();
      // and we update the tabs and select
      docs_list_apply([]);
      // we retry in 1 minute (maybe internet is back ;))
      datas.pidt = setTimeout(start_API, 60000);
    });
}

function doc_cb_changed(event) {
  let sel = document.querySelector("#d_sel");
  if (sel.selectedIndex > 0) {
    let o = sel.options[sel.selectedIndex];
    document.querySelector("#d_id").value = o.value;
    document.querySelector("#d_name").value = o.grist_name;
  } else {
    document.querySelector("#d_id").value = "";
    document.querySelector("#d_name").value = "";
  }
  UI_document_test_change();
}

function doc_get_from_tab(tab) {
  let els = document.querySelectorAll(".tab");
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    if (e == tab && i<datas.docs.length) {
      return datas.docs[i];
    }
  }
}

function UI_tab_select_dom(event) {
  UI_tab_select(event.currentTarget, true);
}

async function UI_tab_select(el, save) {
  let cur = -1; // to be sure that no invalid selection is done
  // cycle througth all tabs in order to select the right one and deselect the others
  const els = document.querySelectorAll(".tab");
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    if (e == el) {
      e.style.backgroundColor = "#5f5f5f";
      cur = i;
    } else {
      e.style.backgroundColor = "#252525";
    }
  }

  // if we have reclicked on the current tab, do nothing
  if (document.querySelector("#d_index").value == cur) return;

  // we want to be sure previous datas are saved if needed
  if (save && document.querySelector("#d_index").value >= 0 && UI_btn_get_active("d_save")) {
    const answer = await ask('Voulez-vous enregistrer les données avant de changer de document ?', {
      title: 'GRIST backup',
      kind: 'warning',
    });
    if (answer) config_doc_save();
  }

  // update the doc content
  if (cur < 0) {
    document.querySelector("#d_index").value = -1;
    document.querySelector("#doc").style.visibility = "hidden";
  } else {
    let doc = datas.docs[cur];
    document.querySelector("#d_index").value = cur;
    document.querySelector("#d_sel").value = doc.id;
    document.querySelector("#d_id").value = doc.id;
    document.querySelector("#d_name").value = doc.name;

    document.querySelector("#d_savg").checked = doc.savg;
    document.querySelector("#d_savg_dir").value = doc.savg_dir;
    let v = Math.floor(doc.savg_freq / 60); // nb total of minuts
    let vj = Math.floor(v/(24*60)); // nb of days
    v = v%(24*60); // nb of minutes left (in the day)
    let vh = Math.floor(v/60); // nb of hours
    v = v%60; // nb of minutes left
    document.querySelector("#d_savg_fd").value = vj;
    document.querySelector("#d_savg_fh").value = vh;
    document.querySelector("#d_savg_fm").value = v;

    document.querySelector("#d_savx").checked = doc.savx;
    document.querySelector("#d_savx_dir").value = doc.savx_dir;
    v = Math.floor(doc.savx_freq / 60); // nb total of minuts
    vj = Math.floor(v/(24*60)); // nb of days
    v = v%(24*60); // nb of minutes left (in the day)
    vh = Math.floor(v/60); // nb of hours
    v = v%60; // nb of minutes left
    document.querySelector("#d_savx_fd").value = vj;
    document.querySelector("#d_savx_fh").value = vh;
    document.querySelector("#d_savx_fm").value = v;
    document.querySelector("#d_save").disabled = true;

    // manage the top msg and the logs
    logs_show(doc);
    logs_show_next(doc);
    logs_update_doc_msg(doc);

    document.querySelector("#doc").style.visibility = "visible";
  }
}

function logs_update_doc_msg(doc) {
  // let search the doc index
  let cur = -1;
  for (let i=0; i< datas.docs.length; i++) {
    if (datas.docs[i] == doc) {
      cur = i;
      break;
    }
  }
  if (cur < 0) return;

  // we update the tab color
  const tab = document.querySelectorAll(".tab")[cur];
  if (doc.savx_statut != STATUT.OK || doc.savg_statut != STATUT.OK) {
    tab.classList.add("tab_error");
  } else {
    tab.classList.remove("tab_error");
  }

  // manage the top msg
  if (document.querySelector("#d_index").value == cur) {
    let msg = doc.savg_msg;
    if (msg != "" && doc.savx_msg != "") msg += " -- ";
    if (doc.savx_msg != "") msg += doc.savx_msg;
    let stat = Math.max(doc.savg_statut, doc.savx_statut);
    if (msg != "" && stat != STATUT.OK) {
      document.querySelector("#d_msg").textContent = msg;
      document.querySelector("#d_msg").className = "msg_" + stat;
    } else {
      document.querySelector("#d_msg").className = "msg_hide";
      document.querySelector("#d_msg").textContent = "";
    }
  }
}

function logs_update_general_msg() {
  if (datas.msg != "" && datas.statut != STATUT.OK) {
    document.querySelector("#g_msg").textContent = datas.msg;
    document.querySelector("#g_msg").className = "msg_" + datas.statut;
  } else {
    document.querySelector("#g_msg").className = "msg_hide";
    document.querySelector("#g_msg").textContent = "";
  }
}

function doc_add() {
  // let's add the doc in the datas first
  let doc = {};
  doc.id = "";
  doc.name = "sans nom";
  doc.savg = true;
  doc.savg_dir = "";
  doc.savg_freq = 86400; // one day in seconds
  doc.savg_pidt = 0;
  doc.savx = false;
  doc.savx_dir = "";
  doc.savx_freq = 86400; // one day in seconds
  doc.savx_pidt = 0;
  doc.logs = "";
  doc.savg_next = "";
  doc.savx_next = "";
  doc.savx_statut = STATUT.OK;
  doc.savx_msg = "";
  doc.savg_statut = STATUT.OK;
  doc.savg_msg = "";

  datas.docs.push(doc);
  // add the corresponding tab
  const e_add = document.querySelector("#tab_add");
  const tab = document.createElement("div");
  tab.textContent = doc.name;
  tab.className = "tab";
  tab.addEventListener("click", UI_tab_select_dom);
  e_add.parentNode.insertBefore(tab, e_add);

  // select this tab
  UI_tab_select(tab, true);
}

async function config_doc_save() {
  // let's get the doc object and update it
  const i = document.querySelector("#d_index").value;
  if (i < 0 || i >= datas.docs.length) {
    console.log("Impossible de sauvegarder. Index introuvable");
    return;
  }
  let doc = datas.docs[i];
  // let's stop the eventual process associated to the doc
  if (doc.savg_pidt>0) clearTimeout(doc.savg_pidt);
  if (doc.savx_pidt>0) clearTimeout(doc.savx_pidt);

  doc.id = document.querySelector("#d_id").value;
  doc.name = document.querySelector("#d_name").value;
  doc.savg = document.querySelector("#d_savg").checked;
  doc.savg_dir = document.querySelector("#d_savg_dir").value;
  doc.savg_freq = document.querySelector("#d_savg_fd").value * 24*60*60 + document.querySelector("#d_savg_fh").value * 60*60 + document.querySelector("#d_savg_fm").value * 60;
  doc.savx = document.querySelector("#d_savx").checked;
  doc.savx_dir = document.querySelector("#d_savx_dir").value;
  doc.savx_freq = document.querySelector("#d_savx_fd").value * 24*60*60 + document.querySelector("#d_savx_fh").value * 60*60 + document.querySelector("#d_savx_fm").value * 60;

  // safety checks
  let notif = "Sauvegarde effectuée"
  if (doc.savg) {
    if (doc.savg_dir == "") {
      notif += "<br> - GRIST désactivé : dossier vide"
      doc.savg = false;
      document.querySelector("#d_savg").checked = false;
    }
    if (doc.savg_freq < 60) {
      notif += "<br> - GRIST désactivé : fréquence inférieure à 1 min."
      doc.savg = false;
      document.querySelector("#d_savg").checked = false;
    }
  }
  if (doc.savx) {
    if (doc.savx_dir == "") {
      notif += "<br> - EXCEL désactivé : dossier vide"
      doc.savx = false;
      document.querySelector("#d_savx").checked = false;
    }
    if (doc.savx_freq < 60) {
      notif += "<br> - EXCEL désactivé : fréquence inférieure à 1 min."
      doc.savx = false;
      document.querySelector("#d_savx").checked = false;
    }
  }

  // reset the errors etc
  doc.savx_statut = STATUT.OK;
  doc.savg_statut = STATUT.OK;
  doc.savx_msg = "";
  doc.savg_msg = "";
  logs_update_doc_msg(doc);

  // refresh the tab name
  const els = document.querySelectorAll(".tab");
  els[i].textContent = doc.name;

  // save the value to the config file
  const txt = JSON.stringify(datas);
  await invoke("save", { datas: txt });

  // notif
  UI_notif(notif);
  UI_btn_set_active("d_save", false);

  // if needed, we restart the process for the doc
  if (datas.run) {
    if (doc.savg) {
      process_launch_doc(doc, "");
    }
    // we launch the excel backups
    if (doc.savx) {
      process_launch_doc(doc, "/xlsx");
    }
  }
}

function UI_global_test_change() {
  let changed = (datas.server != document.querySelector("#g_server").value ||
                  datas.api != document.querySelector("#g_api").value ||
                  datas.autostart != document.querySelector("#g_autostart").checked);
  UI_btn_set_active("g_save", changed);
}
function UI_document_test_change() {
  const i = document.querySelector("#d_index").value;
  if (i < 0 || i >= datas.docs.length) return;

  let doc = datas.docs[i];

  let changed = (doc.id != document.querySelector("#d_id").value ||
                  doc.name != document.querySelector("#d_name").value ||
                  doc.savg != document.querySelector("#d_savg").checked ||
                  doc.savg_dir != document.querySelector("#d_savg_dir").value ||
                  doc.savg_freq != document.querySelector("#d_savg_fd").value * 24*60*60 + document.querySelector("#d_savg_fh").value * 60*60 + document.querySelector("#d_savg_fm").value * 60 ||
                  doc.savx != document.querySelector("#d_savx").checked ||
                  doc.savx_dir != document.querySelector("#d_savx_dir").value ||
                  doc.savx_freq != document.querySelector("#d_savx_fd").value * 24*60*60 + document.querySelector("#d_savx_fh").value * 60*60 + document.querySelector("#d_savx_fm").value * 60);
  UI_btn_set_active("d_save", changed);
}

async function config_global_save() {
  // first, we stop all the process if started
  let r = datas.run;
  if (r) process_stop_all();

  datas.server = document.querySelector("#g_server").value;
  if (datas.server.slice(-1) == "/") datas.server = datas.server.slice(0,-1);
  datas.api = document.querySelector("#g_api").value;
  datas.autostart = document.querySelector("#g_autostart").checked;

  // save the value to the config file
  const txt = JSON.stringify(datas);
  await invoke("save", { datas: txt });

  // notif
  UI_notif("Sauvegarde effectuée")

  // reload the datas
  await config_load_datas();
  UI_btn_set_active("g_save", false);

  // if it was started previously, restart the process
  if (r) {
    clearTimeout(datas.pidt);
    start_API();
  }
}

function UI_notif(txt) {
  const e = document.querySelector("#notif");
  e.innerHTML = txt;
  e.classList.add("notif_show");

  // we hide the notification after 5 seconds
  setTimeout(() => {
    e.classList.remove("notif_show");
  }, 5000);
}

async function UI_dir_chooser(event) {
  let e = document.querySelector("#d_savx_dir");
  if (event.currentTarget.id == "d_savg_dir_open") e = document.querySelector("#d_savg_dir");
  const dir = await open({ directory: true, defaultPath: e.value });
  if (dir) {
    e.value = dir;
    UI_document_test_change();
  }
}

async function backup_now(event) {
  // details of the document to backup
  const i = document.querySelector("#d_index").value;
  if (i < 0 || i >= datas.docs.length) {
    console.log("Impossible de sauvegarder. Index introuvable");
    return;
  }

  // type of backup
  let tpe="/xlsx";
  if (event.currentTarget.id == "d_savg_now") tpe = "";

  backup_doc(datas.docs[i], tpe, false);
}

function process_launch() {
  if (!isset(datas) || !isset(datas.docs)) return;
  if (datas.run) return; // process already launched
  if (datas.statut != STATUT.OK) return; // don't lauch doc backup if there's an error with the server itself

  invoke("write_log", { text: "I : Process lancés" });
  let nb = 0;
  // for each doc, we launch the backups process
  for (let i=0; i< datas.docs.length; i++) {
    let doc = datas.docs[i];
    // we launch the grist backups
    if (doc.savg) {
      // safety checks
      if (doc.savg_dir != "" && doc.savg_freq >= 60) {
        process_launch_doc(doc, "");
        nb++;
      }
    }
    // we launch the excel backups
    if (doc.savx) {
      // safety checks
      if (doc.savx_dir != "" && doc.savx_freq >= 60) {
        process_launch_doc(doc, "/xlsx");
        nb++;
      }
    }
  }
  if (nb > 0) {
    // update the buttons
    UI_btn_set_active("g_stop", true);
    UI_btn_set_active("g_go", false);
    document.querySelector("#g_statut").textContent = "Lancé";
    datas.run = true;
  } else {
    // update the buttons
    UI_btn_set_active("g_stop", false);
    UI_btn_set_active("g_go", true);
    document.querySelector("#g_statut").textContent = "Arrêté";
    datas.run = false;
  }
}

async function process_launch_doc(doc, tpe) {
  // we first want to know what is the last backup datetime
  let dir = doc.savg_dir;
  if (tpe == "/xlsx") dir = doc.savx_dir;
  let last = await invoke("last_backup", {docname: doc.name, dir: dir, tp: tpe});

  // we determine how long we have to wait for the first backup
  let freq = doc.savg_freq;
  if (tpe == "/xlsx") freq = doc.savx_freq;
  let diff = freq - (Math.floor(Date.now()/1000) - last);
  if (diff < 0) diff = 0;

  // launch the first backup
  let pidt = setTimeout(backup_doc, diff*1000, doc, tpe, true);
  if (tpe == "/xlsx") doc.savx_pidt = pidt;
  else doc.savg_pidt = pidt;
  logs_show_next(doc, tpe, diff);
}

function logs_show_next(doc, tpe, delay) {
  if (isset(tpe) && isset(delay)) {
    // we compute the next backup text if specified
    let dt = new Date();
    if (tpe == "/xlsx") {
      if (doc.savx && delay > 0) {
        dt.setSeconds(dt.getSeconds() + delay)
        doc.savx_next = "EXCEL : " + dt.toLocaleString();
      }
      else doc.savx_next = "";
    }
    else {
      if (doc.savg && delay> 0) {
        dt.setSeconds(dt.getSeconds() + delay)
        doc.savg_next = "GRIST : " + dt.toLocaleString();
      }
      else doc.savg_next = "";
    }
  }


  // we update the logs in the UI only if this is the current selected document
  for (let i=0; i< datas.docs.length; i++) {
    if (datas.docs[i] == doc) {
      if (document.querySelector("#d_index").value == i) {
        let tx = doc.savg_next;
        if (tx != "" && doc.savx_next != "") tx += "<br>";
        if (doc.savx_next != "") tx += doc.savx_next;
        document.querySelector("#d_next").innerHTML = tx;
      }
      break;
    }
  }
}

async function backup_doc(doc, tpe, retry) {
  let dir = doc.savg_dir;
  if (tpe == "/xlsx") dir = doc.savx_dir;
  // let manage the return value
  let log = "GRIST : "
  if (tpe == "/xlsx") log = "EXCEL : ";
  const dt = new Date();
  log += dt.toLocaleString();
  invoke("grist_backup", { server: datas.server, api: datas.api, docid: doc.id, docname: doc.name, dir: dir, btype: tpe })
    .then((txt) => {
      // successfull backup
      UI_notif("Sauvegarde effectuée avec succès");
      doc.logs = log + " OK<br>" + doc.logs;
      logs_show(doc);
      let freq = 0;
      if (tpe == "/xlsx") {
        doc.savx_msg = "";
        doc.savx_statut = STATUT.OK;
        if (doc.savx) freq = doc.savx_freq;
      }
      else {
        doc.savg_msg = "";
        doc.savg_statut = STATUT.OK;
        if (doc.savg) freq = doc.savg_freq;
      }
      logs_update_doc_msg(doc);
      logs_show_next(doc, tpe, freq);
      // if needed, we launch the next backup
      if (retry && freq > 0 && datas.run) {
        let pidt = setTimeout(backup_doc, freq*1000, doc, tpe, retry);
        if (tpe == "/xlsx") doc.savx_pidt = pidt;
        else doc.savg_pidt = pidt;
      }
    })
    .catch((e) => {
      let err = JSON.parse(e);
      UI_notif(err.msg);
      doc.logs = log + " ERR<br>" + doc.logs;
      logs_show(doc);
      // we handle the retry of the backup if needed
      let freq = doc.savg_freq;
      if (tpe == "/xlsx") freq = doc.savx_freq;
      freq = Math.min(freq, 60);
      if (freq == 0) freq = 60;
      if (retry) {
        let pidt = setTimeout(backup_doc, freq*1000, doc, tpe, retry);
        if (tpe == "/xlsx") doc.savx_pidt = pidt;
        else doc.savg_pidt = pidt;
        logs_show_next(doc, tpe, freq);
      } else {
        if (tpe == "/xlsx") logs_show_next(doc, tpe, doc.savx_freq);
        else logs_show_next(doc, tpe, doc.savg_freq);
      }
      // we update the error banner
      if (tpe == "/xlsx") {
        doc.savx_msg = err.msg;
        doc.savx_statut = STATUT.ISSUE;
      } else {
        doc.savg_msg = err.msg;
        doc.savg_statut = STATUT.ISSUE;
      }
      logs_update_doc_msg(doc);
    });
}

function logs_show(doc) {
  if (!isset(doc.logs)) doc.logs = "";
  // we don't want more than 8 logs to keep the list light
  let ll = doc.logs.split("<br>");
  if (ll.length > 8) ll = ll.slice(0, 8-ll.length);
  doc.logs = ll.join("<br>");
  // save the value to the config file
  const txt = JSON.stringify(datas);
  invoke("save", { datas: txt });

  // we update the logs in the UI only if this is the current selected document
  for (let i=0; i< datas.docs.length; i++) {
    if (datas.docs[i] == doc) {
      if (document.querySelector("#d_index").value == i) {
        document.querySelector("#d_logs").innerHTML = doc.logs;
      }
      break;
    }
  }
}

function process_stop_all() {
  if (!datas.run) return; //process already stopped
  invoke("write_log", { text: "I : Process arrêtés" });
  // update the buttons
  UI_btn_set_active("g_stop", false);
  UI_btn_set_active("g_go", true);
  document.querySelector("#g_statut").textContent = "Arrêté";
  datas.run = false;
  if (!isset(datas.docs)) return;
  // for each doc, we stop the backups process
  for (let i=0; i< datas.docs.length; i++) {
    let doc = datas.docs[i];
    if (doc.savg_pidt > 0) {
      try {clearTimeout(doc.savg_pidt)} catch {};
      doc.savg_pidt = 0;
      doc.savg_next = "";
    }
    if (doc.savx_pidt > 0) {
      try {clearTimeout(doc.savx_pidt)} catch {};
      doc.savx_pidt = 0;
      doc.savx_next = "";
    }
    logs_show_next(doc);
  }
}

function UI_btn_set_active(id, active) {
  if (active) {
    document.querySelector("#" + id).classList.remove("img_btn_disabled");
  } else {
    document.querySelector("#" + id).classList.add("img_btn_disabled");
  }
}
function UI_btn_get_active(id) {
  return !document.querySelector("#" + id).classList.contains("img_btn_disabled");
}

async function doc_remove() {
  let i = document.querySelector("#d_index").value;
  if (i < 0 || i >= datas.docs.length) return;
  // we stop all the process of the doc
  let doc = datas.docs[i];
  if (doc.savg_pidt > 0) {
    try {clearTimeout(doc.savg_pidt)} catch {};
    doc.savg_pidt = 0;
    doc.savg_next = "";
  }
  if (doc.savx_pidt > 0) {
    try {clearTimeout(doc.savx_pidt)} catch {};
    doc.savx_pidt = 0;
    doc.savx_next = "";
  }
  // we remove the doc from the datas
  datas.docs.splice(i,1);
  // we remove the actual tab
  let tab = document.querySelectorAll(".tab")[i];
  tab.parentNode.removeChild(tab);
  // we select the first tab (if no tab is still here, this will be handle by the fct)
  UI_tab_select(document.querySelectorAll(".tab")[0], false);

  // save the value to the config file
  const txt = JSON.stringify(datas);
  await invoke("save", { datas: txt });

  // notif
  UI_notif("Sauvegarde effectuée")
}

async function UI_a_propos() {
  let txt = "GRIST backup";
  txt += "\nversion : " + await getVersion();
  txt += "\n\nLicence : GPL-3.0-or-later";
  txt += "\ncopyright : A.RENAUDIN 2026";
  await message(txt, { title: 'GRIST backup', kind: 'info' });
}

async function UI_close(event) {
  event.preventDefault();
  await config_doc_save();
}

async function Autostart_check() {
  try {
    let auto = await isEnabled();
    if (datas.autostart && !auto) await enable();
    else if (!datas.autostart && auto) await disable();
    document.querySelector("#g_autostart_label").textContent = "Lancer au démarrage du système";
  } catch(error) {
    // autostart can't be enable on this platform
    document.querySelector("#g_autostart_label").textContent = "Lancer au démarrage du système (indisponible)";
    document.querySelector("#g_autostart").checked = false;
    document.querySelector("#g_autostart").disabled = true;
    // if it's not enabled, it doesn't matter otherwise we warn the user
    if (!datas.autostart) return;
    datas.autostart = false;
    config_global_save();
    UI_notif("Impossible d'activer le démarrage automatique sur ce système");
    await invoke("write_log", { text: "Cannot activate autostart on this system" });
  }
}