import { i18n, e, encodeXml } from "./lib";
import * as domovik from "./domovik";
import { browser } from "webextension-polyfill-ts";
declare var PRODUCTION: boolean;

var DOMOVIK_REFRESH: number;
if (PRODUCTION) {
    DOMOVIK_REFRESH = 3;
} else {
    DOMOVIK_REFRESH = 1;
}

browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.onClicked.addListener(domovik.sendCommand)
    browser.storage.local.get(["connected", "authorized", "linked"])
        .then((s: { connected: boolean, authorized: boolean, linked: boolean }) => {
            if (!s.linked || !s.connected || !s.authorized) {
                domovik.clear();
                browser.runtime.openOptionsPage();
            }
        })
});

function setupTimers() {
    browser.alarms.create('refreshDomovik', { periodInMinutes: DOMOVIK_REFRESH });
    browser.alarms.onAlarm.addListener(() => {
        domovik.syncBrowsers()
            .then(domovik.getCommands)
            .catch((e: Error) => console.log(e))
    });
}

function setupTabSync() {
    browser.tabs.onUpdated.addListener((_: any, info: { status: string }) => { if (info.status === "complete") { domovik.syncTabs() } });
    browser.tabs.onRemoved.addListener(domovik.syncTabs);
}

function setupBookmarksSync() {
    browser.bookmarks.onCreated.addListener(domovik.syncBookmarks);
    browser.bookmarks.onRemoved.addListener(domovik.syncBookmarks);
    browser.bookmarks.onChanged.addListener(domovik.syncBookmarks);
}

function setupOmnibox() {
    browser.omnibox.setDefaultSuggestion({ description: i18n("omnibarDescription") });
    browser.omnibox.onInputChanged.addListener((text: string, addSuggestions: any) => {
        let keywords = text.trim().split(/\s+/).map((k: string) => k.toLowerCase());
        browser.storage.local.get(["other_browsers", "bookmarks"])
            .then((s: { other_browsers: domovik.Browser[], bookmarks: domovik.Bookmark[] }) => {
                console.log(s)
                let r = s.other_browsers
                    .map((b: domovik.Browser) =>
                        b.tabs
                            .filter((t: domovik.Tab) => keywords.every((kw: string) => (t.url.toLowerCase().includes(kw)
                                || t.title.toLowerCase().includes(kw))))
                            .map((t: domovik.Tab) => ({
                                content: t.url,
                                description: `${encodeXml(t.title)} – ${i18n("tabFrom")} ${b.name}`
                            })))
                    .flat(Infinity)
                    .concat(s.bookmarks
                        .filter((b: domovik.Bookmark) => keywords.every((kw: string) => (b.url.toLowerCase().includes(kw)
                            || b.title.toLowerCase().includes(kw))))
                        .map((b: domovik.Bookmark) => ({
                            content: b.url,
                            description: `${encodeXml(b.title)} – ${i18n("bookmark")}`
                        })))

                return r
            })
            .then(addSuggestions)
    });
    browser.omnibox.onInputEntered.addListener((url: string, disposition: string) => {
        switch (disposition) {
            case "currentTab":
                browser.tabs.update({ url });
                break;
            case "newForegroundTab":
                browser.tabs.create({ url });
                break;
            case "newBackgroundTab":
                browser.tabs.create({ url, active: false });
                break;
        }
    });
}


setupOmnibox();
setupTabSync();
setupBookmarksSync();
setupTimers();


browser.storage.local.get(["connected", "authorized"])
    .then((s: { connected: boolean, authorized: boolean }) => {
        if (s.connected && s.authorized) {
            browser.browserAction.enable();
            domovik.syncBrowsers()
                .then(domovik.syncBookmarks)
                .then(domovik.getCommands)
                .catch((e: Error) => console.log(e))
        } else {
            browser.browserAction.disable();
        }
    })
    .catch((e: Error) => console.log(e));
