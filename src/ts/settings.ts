import { browser } from "webextension-polyfill-ts";
import m from "mithril"
import { i18n, e, notify } from "./lib";
import { browserInfo } from "./ua";
import *  as domovik from "./domovik";;
import "../css/settings.scss";

declare var PRODUCTION: boolean;


let DEFAULT_BROWSER_NAME = i18n("defaultBrowserName", [browserInfo().name, browserInfo().os]);
var DEFAULT_SERVER_URL: string;
if (PRODUCTION) {
    DEFAULT_SERVER_URL = "https://domovik.app/api/v1/";
} else {
    DEFAULT_SERVER_URL = "http://127.0.0.1:4000/api/v1/";
}

type Alert = {
    msg: String,
    show: boolean,
    id: Number,
};
function local_notify(msg: String) {
    console.log(msg)
    state.notifications.push({
        msg: i18n(msg) || msg,
        show: true,
        id: Date.now(),
    })
}


function updateName() {
    let new_name = (e("browser_name") as HTMLInputElement).value || DEFAULT_BROWSER_NAME;

    return browser.storage.local.get(["uuid"])
        .then((s: { uuid: string }) => {
            return domovik.api("/browsers/" + s.uuid, "PATCH", {
                uuid: s.uuid,
                name: new_name
            })
        })
        .then((r: Response) => {
            if (!r.ok) {
                return Promise.reject(new Error(i18n("unableToUpdateBrowserName")))
            } else {
                return r.json()
            }
        })
        .then((json: { data: domovik.Browser }) => {
            return browser.storage.local.set({ browser_name: json.data.name })
                .then(() => { return json })
        })
}

function setEK(password: string, salt: string, iterations: number) {
    const encoder = new TextEncoder();
    const saltBuffer = encoder.encode(salt);

    return window.crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveKey"])
        .then((key: CryptoKey) => window.crypto.subtle.deriveKey(
            { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: iterations },
            key,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
        ))
        .then((key: CryptoKey) => window.crypto.subtle.exportKey("jwk", key))
        .then((jwk: JsonWebKey) => browser.storage.local.set({ EK: jwk }))
}

function login() {
    let email = (e("email") as HTMLInputElement).value;
    let password = (e("password") as HTMLInputElement).value;
    let server_url = (e("server_url") as HTMLInputElement).value || DEFAULT_SERVER_URL;
    return browser.storage.local.set({ serverUrl: server_url, email: email })
        .then(() => performLogin(server_url, email, password))
        .then(() => setEK(password, "", 15000))
}

// Same than login, but get the email from the local
// storage rather than from the input field
function reLogin() {
    return browser.storage.local.get(["serverUrl", "email"])
        .then((s: { serverUrl: string, email: string }) => {
            let password = (e("password") as HTMLInputElement).value;
            return performLogin(s.serverUrl, s.email, password)
        })
}

async function performLogin(server_url: string, email: string, password: string) {
    let apiPassword = await domovik.encryptPassword(password);
    let r = await fetch(server_url + "/session", {
        method: "POST",
        body: `user[email]=${email}&user[password]=${encodeURIComponent(apiPassword)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    if (!r.ok) {
        switch (r.status) {
            case 401:
                return Promise.reject(new Error(i18n("checkCredentials")));
            case 404:
                return Promise.reject(new Error(i18n("serverNotFound", server_url)));
            case 500:
                return Promise.reject(new Error(i18n("serverError")));
            default:
                return Promise.reject(new Error(i18n("networkError")));
        }
    } else {
        await browser.storage.local.set({ apiPassword: apiPassword });
        return r.json()
            .then((json: { data: { access_token: string, renewal_token: string } }) => {
                return browser.storage.local.set({
                    linked: false,
                    authorized: true,
                    connected: true,
                    access_token: json.data.access_token,
                    renewal_token: json.data.renewal_token,
                    serverUrl: server_url,
                })
            });
    }
}

function registerBrowser() {
    let name = (e("browser_name") as HTMLInputElement).value || DEFAULT_BROWSER_NAME;
    if (name) { browser.storage.local.set({ browser_name: name }); }
    return domovik.api("/browsers", "POST", { name: (name ? name : DEFAULT_BROWSER_NAME) })
        .then((r: Response) => r.json())
        .then((json: { data: domovik.Browser }) => browser.storage.local.set({ uuid: json.data.uuid }));
}

function checkBrowser() {
    return browser.storage.local.get(["uuid"])
        .then((s: { uuid: string }) => {
            if (s.uuid) {
                return domovik.api("/browsers/" + s.uuid, "GET", {});
            } else {
                return Promise.reject(new Error(i18n("browserNotCurrentlyLinked")));
            }
        })
        .then((r: Response) => r.json())
        .then((json: { data: domovik.Browser }) => {
            if (json) {
                notify(i18n("browserLinked", json.data.name));
                return browser.storage.local.set({ linked: true });
            } else {
                return browser.storage.local.set({ linked: false })
                    .then(() => Promise.reject(new Error(i18n("cannotLinkBrowser"))));
            }
        });
}

function handleLoginError(e: Error) {
    browser.storage.local.set({ authorized: false, connected: false, linked: false });
    handleError(e);
}

function handleError(e: Error) {
    if (e.message) {
        notify(i18n(e.message.replace(/ /g, "_")) || e.message)
    }
    console.error(e)
}

function refresh() {
    return state.load()
        .then(m.redraw)
}

function linkBrowser(ev: Event) {
    let server_url = (<HTMLInputElement>e("server_url")).value || DEFAULT_SERVER_URL;
    ev.preventDefault();
    e("link")?.classList.add("loading")

    if (server_url != DEFAULT_SERVER_URL) {
        return browser.permissions.request({ origins: [`${server_url}/*`] })
            .then((response: boolean) => {
                if (response) {
                    return Promise.resolve("OK")
                } else {
                    throw new Error(i18n("noAccessGranted"));
                }
            })
            .catch(handleError)
            .then(login)
            .then(registerBrowser)
            .then(checkBrowser)
            .then(domovik.authorizedHook)
            .catch(handleLoginError)
            .finally(() => {
                e("link")?.classList.remove("loading")
                return refresh();
            })
    } else {
        return login()
            .then(registerBrowser)
            .then(checkBrowser)
            .then(domovik.authorizedHook)
            .catch(handleLoginError)
            .finally(() => {
                e("link")?.classList.remove("loading")
                return refresh();
            })
    }
}

function unlinkBrowser() {
    return domovik.logout()
        .then(() => notify(i18n("logoutSuccessful")))
        .finally(refresh)
}

function renameBrowser(ev: Event) {
    ev.preventDefault();
    e("rename")?.classList.add("loading")
    return updateName()
        .then((json: { data: { name: string } }) => notify(i18n("browserSuccessfullyRenamed", json.data.name)))
        .catch(handleError)
        .finally(() => {
            e("rename")?.classList.remove("loading")
            return refresh();
        })
}

function reAuthorize(ev: Event) {
    ev.preventDefault();
    return reLogin()
        .then(checkBrowser)
        .then(domovik.authorizedHook)
        .catch(handleError)
        .finally(refresh)
}


let state = {
    notifications: <Alert[]>[],
    s: {
        connected: false,
        authorized: false,
        connectionStatus: "ok",
        browser_name: "",
        email: "",
        serverUrl: "",
    },
    load: function() {
        return browser.storage.local.get([
            "connected", "authorized", "connectionStatus",
            "browser_name", "email", "serverUrl"])
            .then((s: {
                connected: boolean, authorized: boolean, connectionStatus: string,
                browser_name: string, email: string, serverUrl: string
            }) => {
                state.s.connected = s.connected;
                state.s.authorized = s.authorized;
                state.s.connectionStatus = s.connectionStatus;
                state.s.browser_name = s.browser_name;
                state.s.email = s.email;
                state.s.serverUrl = s.serverUrl;
            })
            .then(m.redraw)
    }
}


function closeNotification(id: Number) {
    return (() => {
        state!.notifications.find(e => e.id === id)!.show = false;
        m.redraw()
    })
}

let notificationsView = {
    view: function() {
        return state.notifications
            .filter(n => n.show)
            .map(n => m("div.alert", [
                m("a.close", { onclick: closeNotification(n.id) }, "×"),
                m("p", n.msg),
            ]))
    }
}
let statusView = {
    view: function() {
        switch (state.s.connectionStatus) {
            case "unAuthorized":
                return m("div.alert", m("p", i18n("browserUnauthorized")))
            case "unSubscribed":
                return m("div.alert", [
                    m("p", i18n("noSubscription")),
                    m("a", { href: state.s.serverUrl.replace("/api/v1", "/settings/billing") }, i18n("renewIt")),
                ])
            case "networkError":
                return m("div.alert", m("p", i18n("networkError")))
            case "serverError":
                return m("div.alert", m("p", i18n("serverError")))
            case "ok":
                return undefined
        }
    }
}
let linkView = {
    view: function() {
        return m("div", [
            m("form", { onsubmit: linkBrowser }, [
                m("label", { for: "server_url" }, i18n("server_url")),
                m("input#server_url", { type: "url", name: "server_url", placeholder: DEFAULT_SERVER_URL }),
                m("label", { for: "email" }, i18n("email")),
                m("input#email", { type: "email", name: "email", autofocus: true }),

                m("label", { for: "password" }, i18n("password")),
                m("input#password", { type: "password", name: "password" }),

                m("label", { for: "browser_name" }, i18n("nameBrowser")),
                m("input#browser_name", { type: "text", name: "browser_name", placeholder: DEFAULT_BROWSER_NAME }),

                m("button#link", { type: "submit" }, i18n("connectButton"))
            ]),
            m("p.ad", m.trust(i18n("ad")))
        ])
    }
};
let refreshView = {
    view: function() {
        return m("div", [
            m("p", [
                m("span.logged-as", i18n("connectedAs") + " "),
                m("span.email", state.s.email)
            ]),
            m("form", { onsubmit: reAuthorize }, [
                m("label", { for: "password" }, i18n("password")),
                m(".inline-input", [
                    m("input[type=password]#password.inline", { name: "password" }),
                    m("button.inline.green_button", { type: "submit" }, i18n("refreshButton"))
                ])
            ]),
            m("button.red_button", { onclick: unlinkBrowser }, i18n("logoutButton"))
        ]);
    }
};
let settingsView = {
    oncreate: () => {
        browser.storage.local.get(["browser_name"]).then((s: { browser_name: string }) => {
            (e("browser_name") as HTMLInputElement).value = s.browser_name
        });
    },
    view: function() {
        return m("div", [
            m("p", [
                m("span.logged-as", i18n("connectedAs") + " "),
                m("span.email", state.s.email),
                m("span.logged-as", " – "),
                m("a", { href: state.s.serverUrl.replace("/api/v1", "/settings") }, i18n("myAccount")),
            ]),
            m("form", { onsubmit: renameBrowser }, [
                m("label", { for: "browser_rename" }, i18n("browsingWith")),
                m(".inline-input", [
                    m("input#browser_name.inline", {
                        name: "browser_name",
                    }),
                    m("button.inline#rename", { type: "submit" }, i18n("renameButton"))
                ])
            ]),
            m("button.red_button", { onclick: unlinkBrowser }, i18n("logoutButton"))
        ]);
    }
};

let infosView = {
    view: () => {
        return m("div#infos", [
            m("p.version", `${browser.runtime.getManifest().name} v${browser.runtime.getManifest().version}`)
        ])
    }
}

let mainView = {
    oninit: state.load,
    view: function() {
        let v = [m(notificationsView)];
        if (state.s.connected && state.s.authorized) {
            v.push(m(statusView))
            v.push(m(settingsView))
        } else if (state.s.connected && !state.s.authorized) {
            v.push(m(refreshView))
        } else {
            v.push(m(linkView))
        }
        v.push(m(infosView))
        return v;
    }
};

(function mountMithril() {
    document.title = i18n("settingsTitle");
    let root = <Element>e("content");
    m.mount(root, mainView)
})()
