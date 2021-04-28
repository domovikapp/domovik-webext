export let i18n = browser.i18n.getMessage;
import { browser } from "webextension-polyfill-ts";

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function encodeXml(s: string) {
    let holder = document.createElement('div');
    holder.textContent = s;
    return holder.innerHTML;
}

export function e(id: string): HTMLElement | null { return document.getElementById(id); }

export function notify(message: string, contextMessage?: string) {
    return browser.notifications.create(undefined, {
        type: "basic",
        iconUrl: "/icons/domovik-96.png",
        title: "Domovik",
        message: message,
        contextMessage: contextMessage,
    })
}
