import { browser } from "webextension-polyfill-ts";
import { i18n, e, notify } from "./lib";
import * as domovik from "./domovik";
import m from "mithril";

import "../css/popup.scss";

function refreshBrowsers() {
    return browser.storage.local.get(["other_browsers"])
        .then((s: { other_browsers: domovik.Browser[] }) => { state.data.browsers = s.other_browsers || []; })
        .then(m.redraw)
        .then(domovik.syncBrowsers)
        .then(() => browser.storage.local.get(["other_browsers"]))
        .then((s: { other_browsers: domovik.Browser[] }) => { state.data.browsers = s.other_browsers || []; })
        .then(m.redraw)
}

function refreshLists() {
    browser.storage.local.get(["reading_lists"])
        .then((s: { reading_lists: domovik.ReadingList[] }) => { state.data.reading_lists = s.reading_lists || []; })
        .then(m.redraw)
        .then(domovik.syncLists)
        .then(() => browser.storage.local.get(["reading_lists"]))
        .then((s: { reading_lists: domovik.ReadingList[] }) => { state.data.reading_lists = s.reading_lists || []; })
        .then(m.redraw)
}

function newList() {
    let name = window.prompt(i18n("newListName"));
    if (name) {
        return domovik.api(`/lists/`, "POST", { name: name })
            .catch((e: Error | any) => { handleError(e, i18n("unableToCreateList"), i18n(e.message)) })
            .then((r: Response) => r.json())
            .then((json: { data: { uuid: string } }) => {
                let uuid = json.data.uuid;
                return browser.tabs.query({ active: true, currentWindow: true })
                    .then(async (tabs: any[]) => {
                        let tab = tabs[0];
                        let url = await domovik.encode(tab.url);
                        let title = await domovik.encode(tab.title);
                        let favIconUrl = await domovik.encode(tab.favIconUrl);
                        return domovik.api(`/lists/${uuid}`, "POST", {
                            link: {
                                url: url,
                                title: title.length > 8000 ? i18n("titleTooLong") : title,
                                favicon: favIconUrl.length > 8000 ? "" : favIconUrl
                            }
                        }).then(() => browser.tabs.remove(tab.id))
                    })
                    .then(() => {
                        notify(i18n("savedIn", name))
                            .then(window.close);
                    })
                    .catch((e: Error) => { handleError(e, i18n("unableToSaveToList"), i18n(e.message)) })
            })
    }
}

function addToList(uuid: string, name: string) {
    return function() {
        browser.tabs.query({ active: true, currentWindow: true })
            .then(async (tabs: any[]) => {
                let tab = tabs[0];
                let url = await domovik.encode(tab.url);
                let title = await domovik.encode(tab.title);
                let favIconUrl = await domovik.encode(tab.favIconUrl);
                return domovik.api(`/lists/${uuid}`, "POST", {
                    link: {
                        url: url,
                        title: title.length > 8000 ? i18n("titleTooLong") : title,
                        favicon: favIconUrl.length > 8000 ? "" : favIconUrl
                    }
                }).then(() => browser.tabs.remove(tab.id))
            })
            .then(() => notify(i18n("savedIn", name)))
            .catch((e: Error) => handleError(e, i18n("unableToSaveToList", i18n(e.message))))
    }
}


function sendToBrowser(target: domovik.Browser) {
    return () => {
        browser.storage.local.get(["uuid"])
            .then((s: { uuid: string }) => {
                return browser.tabs.query({ active: true, currentWindow: true })
                    .then(async (tabs: any) => {
                        let tab = tabs[0];
                        let url = await domovik.encode(tab.url);

                        return domovik.api(`/browsers/${s.uuid}/command`, "POST",
                            { target: target.uuid, command: { op: "open", url: url } })
                    })
                    .then(() => {
                        notify(i18n("sentTo", target.name))
                            .then(window.close);
                    })
            })
            .catch((e: Error) => { handleError(e, i18n("unableToSaveToList")), i18n(e.message) })
    }
}


function handleError(e: Error, msg?: string, context?: string) {
    console.error(e)
    notify(msg ? msg : (i18n(e.message.replace(/ /g, "_")) || e.message), context)
        .then(window.close)
}


let state = {
    data: {
        reading_lists: <domovik.ReadingList[]>[],
        browsers: <domovik.Browser[]>[],
    },
    account: {
        connected: false,
        authorized: false,
    },
    load: function() {
        return browser.storage.local.get(["connected", "authorized"])
            .then((s: { connected: boolean, authorized: boolean }) => {
                state.account.connected = s.connected;
                state.account.authorized = s.authorized;
            })
            .then(() => {
                return Promise.all([
                    refreshBrowsers(),
                    refreshLists(),
                ])
            })
    }
};

const Popup = {
    oninit: state.load,
    view: function() {
        if (state.account.connected && state.account.authorized) {
            let all_lists = state.data.reading_lists.map((list: domovik.ReadingList) =>
                m("div.list", { onclick: addToList(list.uuid, list.name) }, list.name))
            all_lists.push(m("div.list", { style: "font-style: italic;", onclick: newList }, i18n("newList")))

            let all_browsers = state.data.browsers.map((browser: domovik.Browser) =>
                m("div.list", { onclick: sendToBrowser(browser) }, browser.name))

            let r = [];
            if (all_lists.length > 0) {
                r.push(m("h1", i18n("stashTitle")));
                r.push(m("div#lists", all_lists));
            }
            if (all_browsers.length > 0) {
                r.push(m("h1", i18n("sendToTitle")));
                r.push(m("div#lists", all_browsers));
            }

            return r;
        }
    },
};

(function mountMithril() {
    m.mount(<Element>e("main"), Popup);
})()
