"use strict";

import { LANGS, set_lang, t, apply_i18n } from "./i18n";

import { invoke } from "@tauri-apps/api/core";
import { ask, open, message } from "@tauri-apps/plugin-dialog";
import { TrayIcon } from "@tauri-apps/api/tray";
import { defaultWindowIcon, getVersion } from "@tauri-apps/api/app";
import { Menu } from "@tauri-apps/api/menu";
import { exit } from "@tauri-apps/plugin-process";
import { CloseRequestedEvent, getCurrentWindow } from "@tauri-apps/api/window";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { JsImage } from '@tauri-apps/api/image';

const STATUT = Object.freeze({
  OK: 0,
  ISSUE: 1,
  PAUSED: 2,
  STOPPED: 3,
});

class _doc {
  id: string = "";
  name: string = "";
  savg: boolean = true;
  savg_dir: string = "";
  savg_freq: number = 24*60*60;
  savx: boolean = false;
  savx_dir: string = "";
  savx_freq: number = 24*60*60;

  logs: string = "";

  savg_pidt: number = -1;
  savg_statut: number = STATUT.OK;
  savg_msg: string = "";
  savg_next: string = "";
  savx_pidt: number = -1;
  savx_statut: number = STATUT.OK;
  savx_msg: string = "";
  savx_next: string = "";
}

class _datas {
  server: string = "";
  api: string = "";
  autostart: boolean = false;
  lang: string = (navigator.language || "en").slice(0, 2);

  run: boolean = false;
  pidt: number = -1;
  msg: string = "";
  statut: number = STATUT.OK;

  docs: Array<_doc> = [];
}

interface _available_docs {
  [key: string]: string;
}

class _error {
  code: number = 0;
  message: string = "err.unknown";
}

let datas:_datas = new _datas;
let availabe_docs: _available_docs = {};
let tray:TrayIcon;
let autostart_available = true;

getCurrentWindow().onCloseRequested(UI_close);

window.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#d_save")?.addEventListener("click", config_doc_save);
  document.querySelector("#d_remove")?.addEventListener("click", doc_remove);
  document.querySelector("#g_save")?.addEventListener("click", config_global_save);
  document.querySelector("#a_propos")?.addEventListener("click", UI_a_propos);
  document.querySelector("#tab_add")?.addEventListener("click", doc_add);
  document.querySelector("#d_savg_dir_open")?.addEventListener("click", UI_dir_chooser);
  document.querySelector("#d_savx_dir_open")?.addEventListener("click", UI_dir_chooser);
  document.querySelector("#d_savg_now")?.addEventListener("click", backup_now);
  document.querySelector("#d_savx_now")?.addEventListener("click", backup_now);
  document.querySelector("#g_stop")?.addEventListener("click", process_stop_all);
  document.querySelector("#g_go")?.addEventListener("click", process_launch);
  document.querySelector("#lang_sel")?.addEventListener("change", lang_change);

  document.querySelector("#g_api")?.addEventListener("change", UI_global_test_change);
  document.querySelector("#g_server")?.addEventListener("change", UI_global_test_change);
  document.querySelector("#g_autostart")?.addEventListener("change", UI_global_test_change);

  document.querySelector("#d_id")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_name")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg_dir")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg_fd")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg_fh")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savg_fm")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx_dir")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx_fd")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx_fh")?.addEventListener("change", UI_document_test_change);
  document.querySelector("#d_savx_fm")?.addEventListener("change", UI_document_test_change);

  // let's start by loading configuration
  await config_load_datas();

  // set the langage
  await lang_apply(datas.lang);

  // update the UI (tabs, etc)
  UI_init();

  // check autostart statut
  await Autostart_check();

  // and we launch the process
  start_API(true);
});


// All the stuff for the systray icon
async function systray_update() {
  const menu = await Menu.new({
    items: [
      {
        id: 'configure',
        text: t('tray.configure'),
        action: systray_config,
      },
      {
        id: 'quit',
        text: t('tray.quit'),
        action: systray_quit,
      },
    ],
  });

  if (tray) {
    await tray.setMenu(menu);
    return;
  }

  const tray_opt = {
    // here you can add a tray menu, title, tooltip, event handler, etc
    menu,
    menuOnLeftClick: true,
    icon: (await defaultWindowIcon()) as JsImage,
  };

  tray = await TrayIcon.new(tray_opt);
  tray.setVisible(true);
}

function systray_config() {
  getCurrentWindow().show();
}
function systray_quit() {
  exit(0);
}

function isset (accessor: any) {
  return (typeof accessor !== 'undefined');
}

async function logs_notify_user(body: string, icon: string) {
  try {
    await invoke("notify", { summary: "GRIST backup", body: body, icon: icon });
  } catch {}
}

async function datas_save() {
  const txt = JSON.stringify(datas);
  invoke<string>("save", { datas: txt })
    .catch ((error) =>  {
    UI_notif(_parse_error(error).message);
  });
}

function UI_update_status_text() {
  let e = document.querySelector("#g_statut");
  if (e) e.textContent = t(datas.run ? "status.running" : "status.stopped");
}

function UI_update_autostart_label() {
  let e = document.querySelector("#g_autostart_label");
  if (e) e.textContent = t(autostart_available ? "global.autostart" : "global.autostart_unavailable");
}

async function lang_apply(lang: string) {
  _set_input("#lang_sel", lang);
  datas.lang = lang;
  set_lang(lang);
  apply_i18n();
  UI_update_status_text();
  UI_update_autostart_label();
  await systray_update();
}

async function lang_change() {
  const lg = _get_input("#lang_sel");
  await lang_apply(lg);
  await datas_save();
}

async function config_load_datas(): Promise<boolean> {
  // we stop all the backups if any
  //process_stop_all();

  // in any cases, we initialize the datas
  datas = new _datas;

  // let's start by loading configuration
  let json = "";
  try {
    json = await invoke("load");
  } catch (error) {
    if (typeof error === "string") await logs_notify_user(_parse_error(error).message, "dialog-error");
    return false;
  }
  if (json == "") return false;

  // parse the config
  let j: any;
  try {
    j = JSON.parse(json);
  } catch (error) {
    if (typeof error === "string") await logs_notify_user(t("err.conficontent"), "dialog-error");
    return false;
  }

  // we read the datas and populate the datas class (which as already been initialized)
  // if an entry doesn't exists or is malformed, we just skip it.
  if (j.server && typeof j.server === "string") datas.server = j.server;
  if (datas.server.slice(-1) == "/") datas.server = datas.server.slice(0,-1); // avoid final slash in server url
  if (j.api && typeof j.api === "string") datas.api = j.api;
  if (j.autostart && typeof j.autostart === "string") datas.autostart = _string_to_bool(j.autostart);
  if (j.lang && typeof j.lang === "string" && LANGS.includes(j.lang)) datas.lang = j.lang;

  if (j.docs && Array.isArray(j.docs)) {
    for (let i=0; i<j.docs.length; i++) {
      // minimal value to define a doc are id and name
      let d: any = j.docs[i];
      if (d.id && d.name && typeof d.id === "string" && typeof d.name === "string") {
        let doc = new _doc;
        doc.id = d.id;
        doc.name = d.name;
        if (d.savg && typeof d.savg === "string") doc.savg = _string_to_bool(d.savg);
        if (d.savx && typeof d.savx === "string") doc.savx = _string_to_bool(d.savx);
        if (d.savg_dir && typeof d.savg_dir === "string") doc.savg_dir = d.savg_dir;
        if (d.savx_dir && typeof d.savx_dir === "string") doc.savx_dir = d.savx_dir;
        if (d.savg_freq && !isNaN(d.savg_freq)) doc.savg_freq = Math.max(parseInt(d.savg_freq), 60);
        if (d.savx_freq && !isNaN(d.savx_freq)) doc.savx_freq = Math.max(parseInt(d.savx_freq), 60);
        if (d.logs && typeof d.logs === "string") doc.logs = d.logs;
        datas.docs.push(doc);
      }
    }
  }
  return true;
}

function UI_init() {
  // set the global values
  _set_input("#g_server", datas.server);
  _set_input("#g_api", datas.api);
  _set_input("#g_autostart", _bool_to_string(datas.autostart));

  // remove all the actual tabs if any
  let els = document.querySelectorAll(".tab");
  for (let i = els.length -1; i >= 0; i--) {
    els[i].parentNode?.removeChild(els[i]);
  }
  // create all the tabs
  const e_add = document.querySelector("#tab_add");
  for (let i=0; i<datas.docs.length; i++) {
    const doc = datas.docs[i];
    const tab = document.createElement("div");
    tab.textContent = doc.name;
    tab.className = "tab";
    tab.addEventListener("click", UI_tab_select_dom);
    e_add?.parentNode?.insertBefore(tab, e_add);
  }

  // select the first tab if any
  if (datas.docs.length > 0) {
    UI_tab_select(<HTMLElement>document.querySelectorAll(".tab")[0], false);
  } else {
    UI_tab_select(null, false);
  }
}

function docs_list_apply(docs: any) {
  // we check each registered doc to see if they are still in the list otherwise we mark them as problematic
  // we don't remove them to handle gracefully error in API fetching
  for (let i=datas.docs.length-1; i>=0; i--) {
    let id = datas.docs[i].id;
    let ok = false;
    for (let j=0; j< docs.length; j++) {
      if (docs[j].id && docs[j].id == id) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      datas.docs[i].savg_msg = t("doc.unreachable");
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

  // reset the combobox
  let sel:HTMLSelectElement | null = document.querySelector("#d_sel");
  if (sel) {
    sel.removeEventListener("change", doc_cb_changed);
    for (let i = sel.options.length -1; i >= 0; i--) {
      sel.remove(i);
    }

    // we add an empty option
    let o = document.createElement("option");
    o.value = "";
    o.text = "";
    sel.add(o);
    // we select this option by default
    sel.selectedIndex = 0;
  }

  // update the list of all available docs and the combobox
  availabe_docs = {}; // reset the list
  for (let j=0; j< docs.length; j++) {
    if (docs[j].id && typeof docs[j].id === "string" && docs[j].id != "" &&
        docs[j].name && typeof docs[j].name === "string" && docs[j].name != "" &&
        docs[j].path && typeof docs[j].path === "string" && docs[j].path != "")
    {
      availabe_docs[docs[j].id] = docs[j].name;
      if (sel) {
        let o = document.createElement("option");
        o.value = docs[j].id;
        o.text = docs[j].path;
        sel.add(o);
        // we select this option if this is the one from the actual doc
        if (docs[j].id == _get_input("#d_id")) sel.selectedIndex = j+1;
      }
    }
  }

  if (sel) sel.addEventListener("change", doc_cb_changed);
}

async function start_API(start_process: boolean) {
  // we load the list of available documents via the GRIST API
  if (datas.pidt > 0) {
    clearTimeout(datas.pidt);
  }
  invoke<string>("grist_get_docs", {server: datas.server, api: datas.api})
    .then((txt) => {
      datas.msg = "";
      datas.statut = STATUT.OK;
      datas.pidt = 0;
      logs_update_general_msg();
      let docs = JSON.parse(txt);
      if (docs && Array.isArray(docs)) docs_list_apply(docs);
      else docs_list_apply([]);

      // we can now launch the backups
      if (start_process) process_launch();
    })
    .catch((error) => {
      // we show the translated error msg
      datas.msg = _parse_error(error).message;
      datas.statut = STATUT.STOPPED;
      logs_update_general_msg();
      // and we update the tabs and select
      docs_list_apply([]);
      // we retry in 1 minute (maybe internet is back ;))
      datas.pidt = setTimeout(start_API, 60000, start_process);
    });
}

function doc_cb_changed() {
  let sel:HTMLSelectElement | null = document.querySelector("#d_sel");
  if (sel && sel.selectedIndex > 0) {
    let o = sel.options[sel.selectedIndex];
    _set_input("#d_id", o.value);
    _set_input("#d_name", availabe_docs[o.value]);
  } else {
    _set_input("#d_id", "");
    _set_input("#d_name", "");
  }
  UI_document_test_change();
}

function UI_tab_select_dom(event: MouseEvent) {
  if (event.currentTarget) UI_tab_select(<HTMLElement>event.currentTarget, true);
}

async function UI_tab_select(el: HTMLElement | null, save: boolean) {
  let cur = -1; // to be sure that no invalid selection is done
  // cycle througth all tabs in order to select the right one and deselect the others
  if (el) {
    const els = document.querySelectorAll<HTMLElement>(".tab");
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e == el) {
        e.style.backgroundColor = "#5f5f5f";
        cur = i;
      } else {
        e.style.backgroundColor = "#252525";
      }
    }
  }


  // if we have reclicked on the current tab, do nothing
  if (_get_input("#d_index", "-1") == cur.toString()) return;

  // we want to be sure previous datas are saved if needed
  if (save && parseInt(_get_input("#d_index", "-1")) >= 0 && UI_btn_get_active("d_save")) {
    const answer = await ask(t('dialog.save_before_switch'), {
      title: 'GRIST backup',
      kind: 'warning',
    });
    if (answer) config_doc_save();
  }

  // update the doc content
  if (cur < 0) {
    _set_input("#d_index", "-1");
    (document.querySelector("#doc")as HTMLElement).style.visibility = "hidden";
  } else {
    let doc = datas.docs[cur];
    _set_input("#d_index", cur.toString());
    _set_input("#d_sel", doc.id);
    _set_input("#d_id", doc.id);
    _set_input("#d_name", doc.name);

    (document.querySelector("#d_savg")as HTMLInputElement).checked = doc.savg;
    _set_input("#d_savg_dir", doc.savg_dir);
    let v = Math.floor(doc.savg_freq / 60); // nb total of minuts
    let vj = Math.floor(v/(24*60)); // nb of days
    v = v%(24*60); // nb of minutes left (in the day)
    let vh = Math.floor(v/60); // nb of hours
    v = v%60; // nb of minutes left
    _set_input("#d_savg_fd", vj.toString());
    _set_input("#d_savg_fh", vh.toString());
    _set_input("#d_savg_fm", v.toString());

    (document.querySelector("#d_savx")as HTMLInputElement).checked = doc.savx;
    _set_input("#d_savx_dir", doc.savx_dir);
    v = Math.floor(doc.savx_freq / 60); // nb total of minuts
    vj = Math.floor(v/(24*60)); // nb of days
    v = v%(24*60); // nb of minutes left (in the day)
    vh = Math.floor(v/60); // nb of hours
    v = v%60; // nb of minutes left
    _set_input("#d_savx_fd", vj.toString());
    _set_input("#d_savx_fh", vh.toString());
    _set_input("#d_savx_fm", v.toString());
    (document.querySelector("#d_save")as HTMLInputElement).disabled = true;

    // manage the top msg and the logs
    logs_show(doc);
    logs_show_next(doc);
    logs_update_doc_msg(doc);

    (document.querySelector("#doc")as HTMLElement).style.visibility = "visible";
  }
}

function logs_update_doc_msg(doc: _doc) {
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
  if (_get_input("#d_index", "-1")== cur.toString()) {
    let msg = doc.savg_msg;
    if (msg != "" && doc.savx_msg != "") msg += " -- ";
    if (doc.savx_msg != "") msg += doc.savx_msg;
    let stat = Math.max(doc.savg_statut, doc.savx_statut);
    if (msg != "" && stat != STATUT.OK) {
      (document.querySelector("#d_msg")as HTMLElement).textContent = msg;
      (document.querySelector("#d_msg")as HTMLElement).className = "msg_" + stat;
    } else {
      (document.querySelector("#d_msg")as HTMLElement).className = "msg_hide";
      (document.querySelector("#d_msg")as HTMLElement).textContent = "";
    }
  }
}

function logs_update_general_msg() {
  if (datas.msg != "" && datas.statut != STATUT.OK) {
    (document.querySelector("#g_msg")as HTMLElement).textContent = datas.msg;
    (document.querySelector("#g_msg")as HTMLElement).className = "msg_" + datas.statut;
  } else {
    (document.querySelector("#g_msg")as HTMLElement).className = "msg_hide";
    (document.querySelector("#g_msg")as HTMLElement).textContent = "";
  }
}

function doc_add() {
  // let's add the doc in the datas first
  let doc:_doc = new _doc;
  doc.id = "";
  doc.name = t("doc.unnamed");
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
  e_add?.parentNode?.insertBefore(tab, e_add);

  // select this tab
  UI_tab_select(tab, true);
}

async function config_doc_save() {
  // let's get the doc object and update it
  const i = parseInt(_get_input("#d_index", "-1"));
  if (i < 0 || i >= datas.docs.length) {
    console.log(t("log.index_not_found"));
    return;
  }
  let doc = datas.docs[i];
  // let's stop the eventual process associated to the doc
  if (doc.savg_pidt>0) clearTimeout(doc.savg_pidt);
  if (doc.savx_pidt>0) clearTimeout(doc.savx_pidt);

  doc.id = _get_input("#d_id");
  doc.name = _get_input("#d_name");
  doc.savg = (document.querySelector("#d_savg")as HTMLInputElement).checked;
  doc.savg_dir = _get_input("#d_savg_dir");
  doc.savg_freq = parseInt(_get_input("#d_savg_fd", "0")) * 24*60*60 + parseInt(_get_input("#d_savg_fh", "0")) * 60*60 + parseInt(_get_input("#d_savg_fm", "0")) * 60;
  doc.savx = (document.querySelector("#d_savx")as HTMLInputElement).checked;
  doc.savx_dir = _get_input("#d_savx_dir")
  doc.savx_freq = parseInt(_get_input("#d_savx_fd", "0")) * 24*60*60 + parseInt(_get_input("#d_savx_fh", "0")) * 60*60 + parseInt(_get_input("#d_savx_fm", "0")) * 60;

  // safety checks
  let notif = t("notif.saved")
  if (doc.savg) {
    if (doc.savg_dir == "") {
      notif += "<br>" + t("notif.grist_disabled_empty")
      doc.savg = false;
      (document.querySelector("#d_savg")as HTMLInputElement).checked = false;
    }
    if (doc.savg_freq < 60) {
      notif += "<br>" + t("notif.grist_disabled_freq")
      doc.savg = false;
      (document.querySelector("#d_savg")as HTMLInputElement).checked = false;
    }
  }
  if (doc.savx) {
    if (doc.savx_dir == "") {
      notif += "<br>" + t("notif.excel_disabled_empty")
      doc.savx = false;
      (document.querySelector("#d_savx")as HTMLInputElement).checked = false;
    }
    if (doc.savx_freq < 60) {
      notif += "<br>" + t("notif.excel_disabled_freq")
      doc.savx = false;
      (document.querySelector("#d_savx")as HTMLInputElement).checked = false;
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
  await datas_save();

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
  let changed = (datas.server != _get_input("#g_server") ||
                  datas.api != ("#g_api") ||
                  datas.autostart != (document.querySelector("#g_autostart")as HTMLInputElement).checked);
  UI_btn_set_active("g_save", changed);
}
function UI_document_test_change() {
  const i = parseInt(_get_input("#d_index", "-1"));
  if (i < 0 || i >= datas.docs.length) return;

  let doc = datas.docs[i];

  let changed = (doc.id != _get_input("#d_id") ||
                  doc.name != _get_input("#d_name") ||
                  doc.savg != (document.querySelector("#d_savg")as HTMLInputElement).checked ||
                  doc.savg_dir != _get_input("#d_savg_dir") ||
                  doc.savg_freq != parseInt(_get_input("#d_savg_fd", "0")) * 24*60*60 + parseInt(_get_input("#d_savg_fh", "0")) * 60*60 + parseInt(_get_input("#d_savg_fm", "0")) * 60 ||
                  doc.savx != (document.querySelector("#d_savx")as HTMLInputElement).checked ||
                  doc.savx_dir != _get_input("#d_savx_dir") ||
                  doc.savx_freq != parseInt(_get_input("#d_savx_fd", "0")) * 24*60*60 + parseInt(_get_input("#d_savx_fh", "0")) * 60*60 + parseInt(_get_input("#d_savx_fm", "0")) * 60);
  UI_btn_set_active("d_save", changed);
}

async function config_global_save() {
  // we retrieve the global values
  let server = _get_input("#g_server");
  if (server.slice(-1) == "/") {
    server = server.slice(0,-1);
    _set_input("#g_server", server);
  }
  let api = _get_input("#g_api");
  let autostart = (document.querySelector("#g_autostart")as HTMLInputElement).checked;

  // if nothing has changed, just exit
  if(datas.server == server && datas.api == api && datas.autostart == autostart) return;

  // update autostart data
  if (datas.autostart != autostart) {
    datas.autostart = autostart;
    await Autostart_check();
  }

  // We stop all the process if started (only if server or api has changed)
  if(datas.server != server || datas.api != api) {
    // stop the process if it has started
    let r = datas.run;
    if (r) process_stop_all();

    // update the main class values
    datas.server = server;
    datas.api = api;

    // if it was started previously, restart the process
    start_API(r);
  }

  // save the value to the config file
  await datas_save();

  // notif
  UI_notif(t("notif.saved"))

  UI_btn_set_active("g_save", false);
}

function UI_notif(txt: string) {
  const e = document.querySelector("#notif");
  if (e) {
    e.innerHTML = txt;
    e.classList.add("notif_show");

    // we hide the notification after 5 seconds
    setTimeout(() => {
      e.classList.remove("notif_show");
    }, 5000);
  }
}

async function UI_dir_chooser(event: Event) {
  let e:HTMLInputElement | null = document.querySelector("#d_savx_dir");
  if ((<HTMLElement>event.currentTarget).id == "d_savg_dir_open") e = document.querySelector("#d_savg_dir");
  if (e) {
    const dir = await open({ directory: true, defaultPath: e.value });
    if (dir) {
      e.value = dir;
      UI_document_test_change();
    }
  }
}

async function backup_now(event: Event) {
  // details of the document to backup
  const i = parseInt(_get_input("#d_index", "-1"));
  if (i < 0 || i >= datas.docs.length) {
    console.log(t("log.index_not_found"));
    return;
  }

  // type of backup
  let tpe="/xlsx";
  if ((<HTMLElement>event.currentTarget).id == "d_savg_now") tpe = "";

  backup_doc(datas.docs[i], tpe, false, true);
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
    datas.run = true;
  } else {
    // update the buttons
    UI_btn_set_active("g_stop", false);
    UI_btn_set_active("g_go", true);
    datas.run = false;
  }
  UI_update_status_text();
}

async function process_launch_doc(doc: _doc, tpe: string) {
  // we first want to know what is the last backup datetime
  let dir = doc.savg_dir;
  if (tpe == "/xlsx") dir = doc.savx_dir;
  let last = parseInt(await invoke<string>("last_backup", {docname: doc.name, dir: dir, tp: tpe}));

  // we determine how long we have to wait for the first backup
  let freq = doc.savg_freq;
  if (tpe == "/xlsx") freq = doc.savx_freq;
  let diff = freq - (Math.floor(Date.now()/1000) - last);
  if (diff < 0) diff = 0;

  // launch the first backup
  let pidt = setTimeout(backup_doc, diff*1000, doc, tpe, true, true);
  if (tpe == "/xlsx") doc.savx_pidt = pidt;
  else doc.savg_pidt = pidt;
  logs_show_next(doc, tpe, diff);
}

function logs_show_next(doc: _doc, tpe?: string, delay?: number) {
  if (typeof tpe !== 'undefined' && typeof delay !== 'undefined') {
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
      if (parseInt(_get_input("#d_index", "-1")) == i) {
        let tx = doc.savg_next;
        if (tx != "" && doc.savx_next != "") tx += "<br>";
        if (doc.savx_next != "") tx += doc.savx_next;
        (document.querySelector("#d_next") as HTMLElement).innerHTML = tx;
      }
      break;
    }
  }
}

async function backup_doc(doc: _doc, tpe: string, retry: boolean, notif: boolean) {
  let dir = doc.savg_dir;
  if (tpe == "/xlsx") dir = doc.savx_dir;
  // let manage the return value
  let log = "GRIST : "
  if (tpe == "/xlsx") log = "EXCEL : ";
  const dt = new Date();
  log += dt.toLocaleString();
  invoke("grist_backup", { server: datas.server, api: datas.api, docid: doc.id, docname: doc.name, dir: dir, btype: tpe})
    .then(async (_) => {
      // successfull backup
      UI_notif(t("notif.saved_ok"));
      if (notif) await logs_notify_user(t("backup.success_notif", { name: doc.name }), "dialog-information");
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
        let pidt = setTimeout(backup_doc, freq*1000, doc, tpe, retry, true);
        if (tpe == "/xlsx") doc.savx_pidt = pidt;
        else doc.savg_pidt = pidt;
      }
    })
    .catch(async (e) => {
      const err: _error = _parse_error(e);
      UI_notif(err.message);
      if (notif && err.code != 902) await logs_notify_user(t("backup.error_notif", { name: doc.name, msg: err.message }), "dialog-error");
      doc.logs = log + " ERR<br>" + doc.logs;
      logs_show(doc);
      // we handle the retry of the backup if needed
      let freq = doc.savg_freq;
      if (tpe == "/xlsx") freq = doc.savx_freq;
      freq = Math.min(freq, 60);
      if (freq == 0) freq = 60;
      if (retry) {
        let pidt = setTimeout(backup_doc, freq*1000, doc, tpe, retry, false);
        if (tpe == "/xlsx") doc.savx_pidt = pidt;
        else doc.savg_pidt = pidt;
        logs_show_next(doc, tpe, freq);
      } else {
        if (tpe == "/xlsx") logs_show_next(doc, tpe, doc.savx_freq);
        else logs_show_next(doc, tpe, doc.savg_freq);
      }
      // we update the error banner
      if (tpe == "/xlsx") {
        doc.savx_msg = err.message;
        doc.savx_statut = STATUT.ISSUE;
      } else {
        doc.savg_msg = err.message;
        doc.savg_statut = STATUT.ISSUE;
      }
      logs_update_doc_msg(doc);
    });
}

function logs_show(doc: _doc) {
  if (!isset(doc.logs)) doc.logs = "";
  // we don't want more than 8 logs to keep the list light
  let ll = doc.logs.split("<br>");
  if (ll.length > 8) ll = ll.slice(0, 8-ll.length);
  doc.logs = ll.join("<br>");
  // save the value to the config file
  datas_save();

  // we update the logs in the UI only if this is the current selected document
  for (let i=0; i< datas.docs.length; i++) {
    if (datas.docs[i] == doc) {
      if (parseInt(_get_input("#d_index", "-1")) == i) {
        (document.querySelector("#d_logs") as HTMLElement).innerHTML = doc.logs;
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
  datas.run = false;
  UI_update_status_text();
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

function UI_btn_set_active(id: string, active: boolean) {
  if (active) {
    document.querySelector("#" + id)?.classList.remove("img_btn_disabled");
  } else {
    document.querySelector("#" + id)?.classList.add("img_btn_disabled");
  }
}
function UI_btn_get_active(id: string) {
  return !document.querySelector("#" + id)?.classList.contains("img_btn_disabled");
}

async function doc_remove() {
  let i = parseInt(_get_input("#d_index", "-1"));
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
  tab?.parentNode?.removeChild(tab);
  // we select the first tab (if no tab is still here, this will be handle by the fct)
  UI_tab_select(<HTMLElement>document.querySelectorAll(".tab")[0], false);

  // save the value to the config file
  await datas_save();

  // notif
  UI_notif(t("notif.saved"))
}

async function UI_a_propos() {
  let txt = "GRIST backup";
  txt += "\n" + t("about.version") + await getVersion();
  txt += "\n" + t("about.license");
  txt += "\n" + t("about.copyright");
  await message(txt, { title: 'GRIST backup', kind: 'info' });
}

async function UI_close(event: CloseRequestedEvent) {
  event.preventDefault();
  await config_doc_save();
}

async function Autostart_check() {
  try {
    let auto = await isEnabled();
    if (datas.autostart && !auto) await enable();
    else if (!datas.autostart && auto) await disable();
    autostart_available = true;
  } catch(error) {
    // autostart can't be enable on this platform
    autostart_available = false;
    let e = document.querySelector<HTMLInputElement>("#g_autostart");
    if (e) {
      e.checked = false;
      e.disabled = true;
    }
    // if it's not enabled, it doesn't matter otherwise we warn the user
    if (!datas.autostart) {
      UI_update_autostart_label();
      return;
    }
    datas.autostart = false;
    config_global_save();
    UI_notif(t("notif.autostart_fail"));
    await invoke("write_log", { text: "Cannot activate autostart on this system" });
  }
  UI_update_autostart_label();
}

function _get_input(id:string, default_value: string = ""):string {
  let e:HTMLInputElement | null = document.querySelector(id);
  if (e) return e.value;
  return default_value;
}
function _set_input(id:string, val:string):boolean {
  let e:HTMLInputElement | null = document.querySelector(id);
  if (e) {
    e.value = val;
    return true;
  }
  return false;
}
function _bool_to_string(val: boolean): string {
  if (val) return "true";
  else return "false";
}
function _string_to_bool(val: string): boolean {
  return (val == "true");
}
function _parse_error(json: string): _error {
  let err: _error = new _error;
  try {
    const e = JSON.parse(json);
    err.code = parseInt(e.error) || 0;
    err.message = t(e.key || "err.unknown", e.params || {});
  } catch {
    // nothing to do
  }
  return err;
}