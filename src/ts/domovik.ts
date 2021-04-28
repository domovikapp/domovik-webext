import { notify, i18n, sleep } from "./lib";
import { browser } from "webextension-polyfill-ts";


export type Browser = {
    name: string,
    uuid: string,
    tabs: Tab[],
}
export type Tab = {
    title: string,
    url: string,
    favicon: string,
    active: boolean,
    pinned: boolean,
    index: number,
    window: number,
}
export type ListLink = {
    title: string,
    url: string,
    favicon: string,
    id: number,
};
export type ReadingList = {
    name: string,
    uuid: string,
    links: ListLink[],
};
export type Bookmark = {
    title: string,
    url: string,
};
export type EncryptedTab = Tab;
export type EncryptedBrowser = Browser;
export type EncryptedListLink = ListLink;
export type EncryptedReadingList = ReadingList;
export type EncryptedBookmark = Bookmark;

export function encryptPassword(password: string) {
    if (password.length < 1) {
        throw new Error();
    }
    const encoder = new TextEncoder();
    const passKey = encoder.encode(password);

    return window.crypto.subtle.importKey(
        "raw",
        passKey,
        { name: "PBKDF2" },
        false,
        ["deriveKey"]).
        then(key => window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: new Uint8Array(8),
                iterations: 1000,
                hash: "SHA-512"
            },
            key,
            { name: "AES-CBC", length: 256 },
            true,
            ["encrypt"]))
        .then(webKey => crypto.subtle.exportKey("raw", webKey))
        .then(buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))))
}


export function api(_action: string, _method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", _body?: any) {
    return browser.storage.local.get(["authorized"])
        .then((s: { authorized: boolean }) => s.authorized ? true : Promise.reject())
        .then(() => browser.storage.local.get(["access_token", "renewal_token", "serverUrl"]))
        .then((s: { access_token: string, renewal_token: string, serverUrl: string }) => {
            if (_method === "POST" || _method === "PATCH" || _method === "PUT") {
                return fetch(s.serverUrl + _action, {
                    headers: { "Authorization": s.access_token, "Content-Type": "application/json" },
                    cache: "no-cache",
                    method: _method,
                    body: JSON.stringify(_body)
                })
            } else { // Other methods calls have no body
                return fetch(s.serverUrl + _action, {
                    headers: { "Authorization": s.access_token, "Content-Type": "application/json" },
                    cache: "no-cache",
                    method: _method
                })
            }
        })
        .catch((e: Error) =>
            browser.storage.local.set({ connectionStatus: "networkError" })
                .then(() => Promise.reject(new Error("networkError"))))
        .then((r: Response) => {
            if (r.ok) {
                return browser.storage.local.set({ connectionStatus: "ok" })
                    .then(() => r)
            } else {
                switch (r.status) {
                    case 401:
                        return sleep((Math.random() * 3000) + 500)
                            .then(renewToken)
                            .catch((e: Error) => {
                                console.error("Post-renewal: ", e)
                                return performReLogin()
                            })
                            .catch((e: Error) => {
                                console.error("Post-relogin: ", e)
                                notify(i18n("browserUnauthorized"));
                                unAuthorizedHook();
                                return browser.storage.local.set({
                                    authorized: false, connectionStatus: "unAuthorized"
                                })
                                    .then(() => Promise.reject(new Error("browserUnauthorized")))
                            })
                            .then(() => api(_action, _method, _body))
                        break;
                    case 402:
                        return browser.storage.local.set({ connectionStatus: "unSubscribed" })
                            .then(() => Promise.reject(new Error("noSubscription")))
                        break;
                    case 410:
                        notify(i18n("browserRemotelyUnlinked"));
                        unAuthorizedHook();
                        return clear().then(() => Promise.reject(new Error("browserRemotelyUnlinked")))
                        break;
                    case 500:
                        return browser.storage.local.set({ connectionStatus: "serverError" })
                            .then(() => Promise.reject(new Error("serverError")))
                        break;
                    default:
                        console.error(r);
                        return browser.storage.local.set({ connectionStatus: "serverError" })
                            .then(() => Promise.reject(new Error("serverError")))
                }
            }
        })
}


export function encode(text?: string) {
    if (text) {
        return browser.storage.local.get(["EK"])
            .then((s: { EK: JsonWebKey }) => window.crypto.subtle.importKey(
                "jwk", s.EK,
                "AES-GCM",
                true,
                ["encrypt", "decrypt"]
            ))
            .then((key: CryptoKey) => window.crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12) },
                                                                   key,
                                                                   (new TextEncoder()).encode(text)))
            .then((x: ArrayBufferLike) => btoa(String.fromCharCode(...new Uint8Array(x))))
    } else {
        return Promise.resolve("");
    }
}

export function decode(text?: string) {
    if (text) {
        return browser.storage.local.get(["EK"])
            .then((s: { EK: JsonWebKey }) => window.crypto.subtle.importKey(
                "jwk", s.EK,
                "AES-GCM",
                true,
                ["encrypt", "decrypt"]
            ))
            .then((key: CryptoKey) => window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(12) },
                key,
                Uint8Array.from(atob(text), c => c.charCodeAt(0))))
            .then((x: ArrayBufferLike) => (new TextDecoder("utf-8")).decode(x))
    } else {
        return Promise.resolve("");
    }
}


// Called when the authentication succeeded
export function authorizedHook() {
    browser.browserAction.enable();
    syncTabs()
        .then(syncBrowsers)  // Will re-create context menus
        .then(syncBookmarks)
        .then(getCommands);

}

// Called when the authentification is denied
export function unAuthorizedHook() {
    browser.browserAction.disable();
    browser.contextMenus.removeAll();
}

// Called when the user wishes to unlink the browser
export function logout() {
    return browser.storage.local.get(["uuid"])
        .then((s: { uuid?: string }) => {
            if (s.uuid) {
                return api(`browsers/${s.uuid}`, "DELETE", {})
            } else {
                Promise.resolve("")
            }
        })
        .finally(clear)
}

export function clear() {
    browser.contextMenus.removeAll();

    browser.browserAction.disable();
    return browser.storage.local.set({
        connected: false, linked: false, authorized: false,
        serverUrl: "", email: "", apiPassword: "",
        access_token: "", renewal_token: "",
        uuid: "", browser_name: "",
        reading_lists: [], other_browsers: []
    })
}


export async function sendCommand(info: any, tab: any) {
    let url = "";
    if (info) {
        if (info.linkUrl) { url = info.linkUrl; }
        else if (info.pageUrl) { url = info.pageUrl; }
    }
    else if (tab.url) { url = tab.url }
    else { return; }
    let s = await browser.storage.local.get(["uuid"]);
    let urlEncoded = await encode(url);
    return api(`/browsers/${s.uuid}/command`, "POST",
               {target: info.menuItemId.split("|")[0], command: { op: "open", url: urlEncoded } })
        .catch((e: any) => {
            console.error(e)
            handleError(new Error("errorSendingLink"))
        })
}


// Returns a Promise
export function syncBrowsers() {
    browser.contextMenus.removeAll();
    return browser.storage.local.get(["linked"])
        .then((s: { linked: boolean }) => s.linked ? true : Promise.reject())
        .then(() => api("/browsers/", "GET", {}))
        .then((r: Response) => r.json())
        .then((json: { data: EncryptedBrowser[] }) => decodeBrowsers(json.data))
        .then((allBrowsers: Browser[]) => browser.storage.local.get(["uuid"]).then((s: { uuid: string }) => {
            return allBrowsers.filter(b => b.uuid != s.uuid)
        }))
        .then((browsers: Browser[]) => {
            browsers.forEach((b) => {
                browser.contextMenus.create({
                    id: `${b.uuid}|page`,
                    title: i18n("sendPageTo", b.name),
                    contexts: ["page"]
                })
                browser.contextMenus.create({
                    id: `${b.uuid}|link`,
                    title: i18n("sendLinkTo", b.name),
                    contexts: ["link"]
                })
            });
            browser.storage.local.set({ "other_browsers": browsers })
        })
}

export function syncLists() {
    return api("/lists/", "GET", {})
        .then((r: Response) => r.json())
        .then((json: { data: EncryptedReadingList[] }) => decodeReadingLists(json.data))
        .then((reading_lists: ReadingList[]) => {
            return browser.storage.local.set({ "reading_lists": reading_lists })
        })
}

// Returns a Promise
export function getCommands() {
    return browser.storage.local.get(["linked"])
        .then((s: { linked: boolean }) => s.linked ? true : Promise.reject())
        .then(() => browser.storage.local.get(["uuid"]))
        .then((s: { uuid: string }) => api(`/browsers/${s.uuid}/command`, "GET"))
        .then((r: Response) => r.json())
        .then((j: { data: any[] }) => {
            j.data.forEach((cmd: any) => {
                switch (cmd.op) {
                    case "open":
                        return decode(cmd.url)
                            .then((url: string) => browser.tabs.create({ url: url, active: false }))
                    default:
                        console.log("Unknown operation " + cmd.op)
                }
            })
        })
}

function renewToken() {
    return browser.storage.local.get(["access_token", "renewal_token", "serverUrl"])
        .then((s: { serverUrl: string, renewal_token: string, access_token: string }) => fetch(
            s.serverUrl + "session/renew",
            { headers: { Authorization: s.renewal_token }, method: "POST" }
        ))
        .then((r: Response) => (r.ok && r.status === 200) ? r.json() : Promise.reject("renewal failed"))
        .then((json: { data: { access_token: string, renewal_token: string } }) => browser.storage.local.set({
            authorized: true,
            access_token: json.data.access_token,
            renewal_token: json.data.renewal_token
        }))
}

async function performReLogin() {
    return browser.storage.local.get(["serverUrl", "email", "apiPassword"])
        .then(async (s: { serverUrl: string, email: string, apiPassword: string }) => {
            let r = await fetch(s.serverUrl + "/session", {
                method: "POST",
                body: `user[email]=${s.email}&user[password]=${encodeURIComponent(s.apiPassword)}`,
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });
            if (r.ok && r.status === 200) {
                return r.json()
                    .then((json: { data: { access_token: string, renewal_token: string } }) => {
                        return browser.storage.local.set({
                            access_token: json.data.access_token,
                            renewal_token: json.data.renewal_token,
                        })
                    });
            } else {
                return Promise.reject(new Error("reloginFailed"));
            }
        })
}

// Returns a Promise
export async function syncTabs() {
    return browser.storage.local.get(["linked"])
        .then((s: { linked?: boolean }) =>
            s.linked ? browser.storage.local.get(["uuid"]) : Promise.reject())
        .then((s: { uuid?: string }) => s.uuid ? s.uuid : Promise.reject("This browser has no UUID"))
        .then((uuid: string) => browser.tabs.query({})
            .then((ttabs: any[]) => {
                let tabs = ttabs.filter((tab: any) =>
                    tab.url.toLowerCase().startsWith("http") || tab.url.toLowerCase().startsWith("ftp"));
                return Promise.all(
                    tabs.map(async (tab: any): Promise<Tab> => {
                        let enc_title = await encode(tab.title);
                        let enc_url = await encode(tab.url);
                        let enc_favicon = await encode(tab.favIconUrl);
                        return {
                            title: enc_title,
                            url: tab.url.length > 8000 ? "" : enc_url,
                            favicon: tab.favIconUrl ? (tab.favIconUrl.length > 32000 ? "" : enc_favicon) : "",
                            active: tab.active, index: tab.index, pinned: tab.pinned, window: tab.windowId
                        }
                    }))
            })
            .then((myTabs: Tab[]) => {
                return ({
                    uuid: uuid,
                    timestamp: Math.floor(Date.now() / 100),
                    tabs: myTabs,
                })
            }))
        .then((payload: any) => {
            api("/browsers/tabs/", "POST", payload)
        })
}

type BookmarkTreeNode = any;

export function syncBookmarks() {
    // TODO add folders as #FOLDER1 #FOLDER2
    function bookmarksTreeToList(node: BookmarkTreeNode, ax: Bookmark[]) {
        if (node) {
            if (node.url) {
                ax.push({ title: node.title, url: node.url });
                return ax;
            } else {
                ax.push(node.children.map((x: BookmarkTreeNode) => bookmarksTreeToList(x, [])));
                return ax;
            }
        } else {
            return ax;
        }
    }

    return browser.storage.local.get(["linked"])
        .then((s: { linked: boolean }) =>
            s.linked ? browser.storage.local.get(["uuid"]) : Promise.reject("Not linked; aborting"))
        .then((s: { uuid?: string }) => s.uuid ? s.uuid : Promise.reject("This browser has no UUID"))
        .then((uuid: string) => browser.bookmarks.getTree()
            .then((tree: any) => bookmarksTreeToList(tree[0], []).flat(Infinity))
            .then((bookmarks_list: any[]) => Promise.all(bookmarks_list.map(async bookmark => {
                let title = await encode(bookmark.title);
                let url = await encode(bookmark.url);
                return { ...bookmark, title: title, url: url }
            })))
            .then((bookmarks: any) => ({
                uuid: uuid,
                bookmarks: bookmarks,
            })))
        .then((payload: any) => api("/bookmarks/", "PUT", payload))
        .then(() => api("/bookmarks/", "GET"))
        .then((r: Response) => r.json())
        .then((json: { data: EncryptedBookmark[] }) => decodeBookmarks(json.data))
        .then((bookmarks: Bookmark[]) => browser.storage.local.set({ "bookmarks": bookmarks }))
}

function handleError(e: any) {
    if (e.message) {
        notify(i18n(e.message.replace(/ /g, "_")) || e.message)
    }
    console.error(e)
}


export function decodeBrowsers(browsers: EncryptedBrowser[]) {
    return Promise.all(browsers.map(async (browser: EncryptedBrowser): Promise<Browser> => {
        let tabs = await Promise.all(browser.tabs.map(async (tab: EncryptedTab): Promise<Tab> => {
            let dec_title = await decode(tab.title);
            let dec_url = await decode(tab.url);
            let dec_favicon = await decode(tab.favicon);
            return {
                ...tab,
                title: dec_title,
                url: dec_url,
                favicon: dec_favicon,
            }
        }));
        return { ...browser, tabs: tabs }
    }))
}


export function decodeReadingLists(reading_lists: EncryptedReadingList[]) {
    return Promise.all(reading_lists.map(async (reading_list: EncryptedReadingList): Promise<ReadingList> => {
        let links = await Promise.all(reading_list.links.map(async (link: EncryptedListLink): Promise<ListLink> => {
            let dec_title = await decode(link.title);
            let dec_url = await decode(link.url);
            return {
                ...link,
                title: dec_title,
                url: dec_url,
            }
        }));
        return { ...reading_list, links: links }
    }))
}


export function decodeBookmarks(bookmarks: EncryptedBookmark[]) {
    return Promise.all(bookmarks.map(async (bookmark: EncryptedBookmark): Promise<Bookmark> => {
        let dec_title = await decode(bookmark.title);
        let dec_url = await decode(bookmark.url);
        return {
            ...bookmark,
            title: dec_title,
            url: dec_url,
        }
    }));
}
