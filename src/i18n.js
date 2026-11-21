"use strict";

export const LANGS = ["fr", "en"];

const translations = {
  fr: {
    "app.title": "GRIST sauvegarde",
    "h1.main": "Outil de sauvegarde de documents GRIST",
    "global.options": "Options globales de l'espace de travail GRIST :",
    "global.server": "URL du serveur GRIST :",
    "global.api": "Clé API :",
    "global.api_placeholder": "Clé API...",
    "global.autostart": "Lancer au démarrage du système",
    "global.autostart_unavailable": "Lancer au démarrage du système (indisponible)",
    "btn.save": "Enregistrer les modifications",
    "server.state": "Etat du service :",
    "status.stopped": "Arrêté",
    "status.running": "Lancé",
    "btn.stop": "Arrêter les sauvegardes programmées",
    "btn.start": "Lancer les sauvegardes programmées",
    "docs.title": "Documents à sauvegarder :",
    "btn.add_doc": "Ajouter un document à gérer",
    "doc.ident": "Identification du document :",
    "doc.select": "Document GRIST :",
    "doc.id": "Identifiant GRIST :",
    "doc.id_placeholder": "Identifiant du document",
    "doc.name": "Nom du document :",
    "doc.name_placeholder": "Le nom que vous voulez",
    "full.title": "Sauvegarde complète :",
    "full.enable": "Activer la sauvegarde complète (recommandé)",
    "xls.title": "Sauvegarde tableur Excel :",
    "xls.enable": "Activer la sauvegarde Excel (accès hors ligne)",
    "dir.label": "Dossier de destination :",
    "dir.placeholder": "Dossier sur le disque",
    "freq.label": "Fréquence de sauvegarde :",
    "freq.days": "jours",
    "freq.hours": "heures",
    "freq.minutes": "minutes",
    "btn.backup_now": "Effectuer une sauvegarde maintenant",
    "next.title": "Prochaines sauvegardes :",
    "last.title": "Dernières sauvegardes :",
    "btn.remove_doc": "Ne plus gérer ce document",
    "btn.about": "A propos",
    "lang.title": "Langue",
    "tray.configure": "Configurer",
    "tray.quit": "Quitter",
    "dialog.save_before_switch": "Voulez-vous enregistrer les données avant de changer de document ?",
    "doc.unreachable": "Le document n'est pas accessible !",
    "doc.unnamed": "sans nom",
    "notif.saved": "Sauvegarde effectuée",
    "notif.saved_ok": "Sauvegarde effectuée avec succès",
    "notif.grist_disabled_empty": " - GRIST désactivé : dossier vide",
    "notif.grist_disabled_freq": " - GRIST désactivé : fréquence inférieure à 1 min.",
    "notif.excel_disabled_empty": " - EXCEL désactivé : dossier vide",
    "notif.excel_disabled_freq": " - EXCEL désactivé : fréquence inférieure à 1 min.",
    "notif.autostart_fail": "Impossible d'activer le démarrage automatique sur ce système",
    "backup.success_notif": "{name} : Sauvegarde effectuée !",
    "backup.error_notif": "{name} : {msg}",
    "about.version": "version : ",
    "about.license": "Licence : GPL-3.0-or-later",
    "about.copyright": "copyright : A.RENAUDIN 2026",
    "log.index_not_found": "Impossible de sauvegarder. Index introuvable",
    "err.unknown": "Erreur lors de la sauvegarde",
    "err.conn": "Erreur d'accès à {url}",
    "err.deserialize": "Impossible d'analyser la réponse de {url}",
    "err.dir": "Le dossier de sauvegarde \"{dir}\" n'est pas accessible !",
    "err.api_call": "Erreur dans l'appel de l'API",
    "err.api_read": "Retour de l'API GRIST illisible",
    "err.file_write": "Impossible d'enregistrer le fichier {path}",
    "err.doc_not_found": "Impossible de trouver le document (id={id})",
    "err.forbidden": "Vous n'avez pas les droits suffisants (id={id})",
    "err.status": "Erreur {code} (id={id})",
    "err.url_not_found": "Impossible de trouver {url}",
    "err.url_forbidden": "Vous n'avez pas les droits pour accéder à {url}",
    "err.url_auth": "Erreur d'authentification pour accéder à {url}",
    "err.url_error": "Erreur {code} pour accéder à {url}",
    "err.config_dir": "Impossible de récupérer le dossier de configuration !",
    "err.config_create": "Impossible de créer le dossier de configuration {path}",
    "err.config_write": "Impossible d'écrire le fichier de configuration {path}",
  },
  en: {
    "app.title": "GRIST backup",
    "h1.main": "GRIST documents backup tool",
    "global.options": "Global options for the GRIST workspace:",
    "global.server": "GRIST server URL:",
    "global.api": "API key:",
    "global.api_placeholder": "API key...",
    "global.autostart": "Launch at system startup",
    "global.autostart_unavailable": "Launch at system startup (unavailable)",
    "btn.save": "Save changes",
    "server.state": "Service status:",
    "status.stopped": "Stopped",
    "status.running": "Running",
    "btn.stop": "Stop scheduled backups",
    "btn.start": "Start scheduled backups",
    "docs.title": "Documents to back up:",
    "btn.add_doc": "Add a document to manage",
    "doc.ident": "Document identification:",
    "doc.select": "GRIST document:",
    "doc.id": "GRIST ID:",
    "doc.id_placeholder": "Document ID",
    "doc.name": "Document name:",
    "doc.name_placeholder": "Whatever you like",
    "full.title": "Full backup:",
    "full.enable": "Enable full backup (recommended)",
    "xls.title": "Excel spreadsheet backup:",
    "xls.enable": "Enable Excel backup (offline access)",
    "dir.label": "Destination folder:",
    "dir.placeholder": "Folder on disk",
    "freq.label": "Backup frequency:",
    "freq.days": "days",
    "freq.hours": "hours",
    "freq.minutes": "minutes",
    "btn.backup_now": "Back up now",
    "next.title": "Next backups:",
    "last.title": "Last backups:",
    "btn.remove_doc": "Stop managing this document",
    "btn.about": "About",
    "lang.title": "Language",
    "tray.configure": "Configure",
    "tray.quit": "Quit",
    "dialog.save_before_switch": "Do you want to save the data before switching documents?",
    "doc.unreachable": "The document is not accessible!",
    "doc.unnamed": "unnamed",
    "notif.saved": "Saved",
    "notif.saved_ok": "Backup completed successfully",
    "notif.grist_disabled_empty": " - GRIST disabled: empty folder",
    "notif.grist_disabled_freq": " - GRIST disabled: frequency below 1 min.",
    "notif.excel_disabled_empty": " - EXCEL disabled: empty folder",
    "notif.excel_disabled_freq": " - EXCEL disabled: frequency below 1 min.",
    "notif.autostart_fail": "Cannot enable autostart on this system",
    "backup.success_notif": "{name}: Backup completed!",
    "backup.error_notif": "{name}: {msg}",
    "about.version": "version: ",
    "about.license": "License: GPL-3.0-or-later",
    "about.copyright": "copyright: A.RENAUDIN 2026",
    "log.index_not_found": "Cannot save. Index not found",
    "err.unknown": "Error during backup",
    "err.conn": "Error accessing {url}",
    "err.deserialize": "Cannot parse the response from {url}",
    "err.dir": "The backup folder \"{dir}\" is not accessible!",
    "err.api_call": "Error calling the API",
    "err.api_read": "Unreadable GRIST API response",
    "err.file_write": "Cannot write the file {path}",
    "err.doc_not_found": "Cannot find the document (id={id})",
    "err.forbidden": "You don't have sufficient permissions (id={id})",
    "err.status": "Error {code} (id={id})",
    "err.url_not_found": "Cannot find {url}",
    "err.url_forbidden": "You don't have permission to access {url}",
    "err.url_auth": "Authentication error accessing {url}",
    "err.url_error": "Error {code} accessing {url}",
    "err.config_dir": "Cannot get the configuration folder!",
    "err.config_create": "Cannot create the configuration folder {path}",
    "err.config_write": "Cannot write the configuration file {path}",
  },
};

let lang = "fr";

export function set_lang(lg) {
  if (LANGS.includes(lg)) lang = lg;
}

export function get_lang() {
  return lang;
}

export function t(key, params) {
  let txt = translations[lang][key];
  if (typeof txt !== "string") txt = translations["en"][key];
  if (typeof txt !== "string") return key;
  if (params) {
    for (const k in params) {
      txt = txt.split("{" + k + "}").join(String(params[k]));
    }
  }
  return txt;
}

export function apply_i18n() {
  document.documentElement.lang = lang;
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
