import { browser } from "webextension-polyfill-ts";
import m from "mithril";
import Stream from "mithril/stream";
import { i18n, e, notify } from "./lib";
import * as domovik from "./domovik";

import "../css/newtab.scss";


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
    return browser.storage.local.get(["reading_lists"])
        .then((s: { reading_lists: domovik.ReadingList[] }) => { state.data.reading_lists = s.reading_lists || []; })
        .then(m.redraw)
        .then(domovik.syncLists)
        .then(() => browser.storage.local.get(["reading_lists"]))
        .then((s: { reading_lists: domovik.ReadingList[] }) => { state.data.reading_lists = s.reading_lists || []; })
        .then(m.redraw)
}

function refreshConnectionStatus() {
    return browser.storage.local.get(["connectionStatus"])
        .then((s: { connectionStatus: string }) => { state.connectionStatus = s.connectionStatus || "ok"; })
        .then(m.redraw)
}

let state = {
    data: {
        browsers: <domovik.Browser[]>[],
        reading_lists: <domovik.ReadingList[]>[],
    },
    connectionStatus: "ok",
    account: {
        connected: false,
        authorized: false,
    },
    loadAccount: function() {
        return browser.storage.local.get(["connected", "authorized", "connectionStatus"])
            .then((s: { connected: boolean, authorized: boolean, connectionStatus: string }) => {
                state.account.connected = s.connected;
                state.account.authorized = s.authorized;
                state.connectionStatus = s.connectionStatus;
                m.redraw()
            })
            .catch(handleError);
    },
    update: async function() {
        return Promise.all([
            domovik.getCommands(),
            refreshBrowsers(),
            refreshLists(),
            refreshConnectionStatus(),
        ]).catch(handleError)
    }
};


function handleError(e: Error | any) {
    // if (e instanceof Error) {
    //     notify(i18n(e.message.replace(/ /g, "_")) || e.message)
    // }
    console.error(e);
}

let LogIn = {
    oninit: state.loadAccount,
    view: function() {
        if (state.account.connected && !state.account.authorized) {
            return m("div.msg", [
                m("h3", i18n("browserUnauthorized")),
                m("a", { href: "/html/settings.html" }, i18n("reconnect"))
            ])
        } else {
            return null;
        }
    }
};

let Cog = {
    view: function() {
        switch (state.connectionStatus) {
            case "unAuthorized":
                return m(
                    "a.settings",
                    { onclick: () => browser.runtime.openOptionsPage(), title: i18n("browserUnauthorized") },
                    m("img#warning", { src: "/icons/warning.svg" }))
            case "unSubscribed":
                return m(
                    "a#unsubscribed",
                    { onclick: () => browser.runtime.openOptionsPage(), title: i18n("noSubscription") },
                    [m("span", i18n("noSubscription")),]
                )
            case "networkError":
                return m(
                    "a.settings",
                    { onclick: () => browser.runtime.openOptionsPage(), title: i18n("networkError") },
                    m("img#warning", { src: "/icons/warning.svg" }))
            case "serverError":
                return m(
                    "a.settings",
                    { onclick: () => browser.runtime.openOptionsPage(), title: i18n("servererror") },
                    m("img#warning", { src: "/icons/warning.svg" }))
            case "ok":
                return m(
                    "a.settings",
                    { onclick: () => browser.runtime.openOptionsPage() },
                    m("img#cog", { src: "/icons/cog.svg" }))
        }
    }
};


let listsView = function() {
    if (state.data.reading_lists && state.data.reading_lists.length > 0) {
        return m("div.lists", state.data.reading_lists.map(
            (list: domovik.ReadingList) => m("div", [
                m("h2", list.name),
                list.links.map((link: domovik.ListLink) => {
                    let content;
                    if (link.title) { content = link.title; } else { content = link.url; }
                    return m("div", [
                        m("a", {
                            href: link.url,
                            title: content,
                            onclick: () => domovik.api(`/lists/${list.uuid}/${link.id}`, "DELETE", {})
                                .catch(handleError)
                        }, content)
                    ])
                })
            ])
        ))
        // } else if (state.data.reading_lists && state.data.reading_lists.length == 0) {
        //     return m("div.msg", m.trust(i18n("noLists")))
    } else { }
};

let tabsView = function() {
    return m("div.lists", state.data.browsers
        .map((browser: domovik.Browser) => {
            let tabs = browser.tabs.sort(
                (t1: domovik.Tab, t2: domovik.Tab) =>
                    t1.index < t2.index ? -1 : (t1.index > t2.index ? 1 : 0));
            return m("div", [
                m("h2", browser.name),
                tabs.map((tab: domovik.Tab) => {
                    let content; if (tab.title) { content = tab.title; } else { content = tab.url; }
                    let favicon; if (tab.favicon) { favicon = tab.favicon; } else { favicon = "/icons/tab.png"; }
                    let classes = [];
                    if (tab.pinned) { classes.push("pinned") }
                    if (tab.active) { classes.push("active") }
                    return m("div", { class: classes.join(" ") }, [
                        m("img", { src: favicon }),
                        m("a", { href: tab.url, title: content }, content)
                    ])
                })
            ])
        }))
};

function Tabs() {
    const activeTab = Stream(0);
    return {
        view({ attrs }: any) {
            let navContent = attrs.tabs.map((tab: any, i: number) => m('a', {
                key: tab.id,
                className: activeTab() === i ? 'active' : '',
                onclick() { state.update(); activeTab(i); }
            }, tab.id));
            return (
                [
                    m(LogIn),
                    m('.Tabs',
                        m("div.header", [
                            m('#nav', navContent),
                            m(Cog)
                        ]),
                        m('.TabContent', attrs.tabs[activeTab()].content()))
                ]
            );
        }
    };
}

const tabContent = [
    { id: i18n("readingLists"), content: listsView },
    { id: i18n("otherBrowsers"), content: tabsView },
];

const Domovik = {
    oninit: state.update,
    view() {
        if (!state.account.connected) {
            return m("div.msg", [
                m("h3", i18n("notLinked")),
                m("p",
                    m("a", { href: "/html/settings.html" }, i18n("connect")),
                    m("a", { href: "https://domovik.app/" }, i18n("create"))
                )
            ])
        } else {
            return (m(Tabs, { tabs: tabContent }))
        }
    }
};

(function mountMithril() {
    state.loadAccount();
    document.title = i18n("newTab");
    m.mount(<Element>e("main"), Domovik);
})()
