/*
    Primo AdBlock — runtime seeding of fork-specific defaults.

    On every cache-miss inside readFilteringModeDetails (i.e. once per
    service-worker lifetime), we reconcile what the build wants to ship
    (globalDefault + per-site overrides from primo-defaults.json) with
    what the user currently has stored.

    Rule: only override a setting the user hasn't manually changed since
    we last seeded it. Concretely, for every site / global slot:

      - if we have never seeded it before AND the user has no explicit
        value, apply our default and remember it
      - if we have never seeded it before AND the user has their own
        explicit value, leave it alone forever (mark user-managed)
      - if we previously seeded value X and the user's current value is
        still X, the user hasn't touched it: apply the new default
      - if we previously seeded value X and the user's current value is
        anything else, the user has diverged: leave alone forever

    Sites that were once shipped in our list but have since been removed
    revert to globalDefault (cleared from every per-host set) for users
    who hadn't manually changed them.

    Caveat (accepted by Primo): if a user manually sets a site to the
    exact value we last seeded, we cannot tell that apart from "user
    didn't touch it", and a future default-change will overwrite their
    pick. Rare in practice, and avoiding it would require patching the
    upstream toggle path.

    Storage:  chrome.storage.local key 'primoSeeded'
              shape: {
                v: 1,
                global: { last: 0..3, userManaged: boolean } | null,
                sites:  { [hostname]: { last: 0..3, userManaged: boolean } }
              }
*/

import { localRead, localWrite } from './ext.js'
import {
    primoDefaultsVersion,
    primoGlobalDefault,
    primoSiteOverrides,
} from './primo-defaults.js'

const STORAGE_KEY = 'primoSeeded'
const ALL_URLS = 'all-urls'

const MODE_KEYS = ['none', 'basic', 'optimal', 'complete']

function explicitLevelOf (modes, hostname) {
    for (let level = 0; level < MODE_KEYS.length; level++) {
        if (modes[MODE_KEYS[level]].has(hostname)) { return level }
    }
    return undefined
}

function setLevelOf (modes, hostname, level) {
    for (const key of MODE_KEYS) { modes[key].delete(hostname) }
    if (level >= 0 && level < MODE_KEYS.length) {
        modes[MODE_KEYS[level]].add(hostname)
    }
}

function clearLevelOf (modes, hostname) {
    for (const key of MODE_KEYS) { modes[key].delete(hostname) }
}

function loadSeeded (raw) {
    const out = { v: 1, global: null, sites: {}, version: undefined }
    if (!raw || typeof raw !== 'object') { return out }
    if (raw.version) { out.version = String(raw.version) }
    if (raw.global && typeof raw.global === 'object') {
        const last = Number(raw.global.last)
        if (Number.isInteger(last) && last >= 0 && last <= 3) {
            out.global = { last, userManaged: !!raw.global.userManaged }
        }
    }
    if (raw.sites && typeof raw.sites === 'object') {
        for (const [hn, s] of Object.entries(raw.sites)) {
            if (!s || typeof s !== 'object') { continue }
            const last = Number(s.last)
            if (!Number.isInteger(last) || last < 0 || last > 3) { continue }
            out.sites[hn] = { last, userManaged: !!s.userManaged }
        }
    }
    return out
}

function deepEqualSeeded (a, b) {
    if (a.version !== b.version) { return false }
    const ag = a.global, bg = b.global
    if ((ag === null) !== (bg === null)) { return false }
    if (ag && (ag.last !== bg.last || ag.userManaged !== bg.userManaged)) {
        return false
    }
    const aHosts = Object.keys(a.sites), bHosts = Object.keys(b.sites)
    if (aHosts.length !== bHosts.length) { return false }
    for (const hn of aHosts) {
        const x = a.sites[hn], y = b.sites[hn]
        if (!y || x.last !== y.last || x.userManaged !== y.userManaged) {
            return false
        }
    }
    return true
}

function reconcileSite (modes, hostname, desiredLevel, prev) {
    // returns { applied, next } where `next` is the new seeded entry, or
    // null if we should stop tracking this hostname
    const explicit = explicitLevelOf(modes, hostname)
    if (!prev) {
        if (explicit === undefined) {
            setLevelOf(modes, hostname, desiredLevel)
            return { applied: true, next: { last: desiredLevel, userManaged: false } }
        }
        return { applied: false, next: { last: desiredLevel, userManaged: true } }
    }
    if (prev.userManaged) {
        return { applied: false, next: { last: desiredLevel, userManaged: true } }
    }
    if (explicit === prev.last) {
        const applied = desiredLevel !== prev.last
        if (applied) { setLevelOf(modes, hostname, desiredLevel) }
        return { applied, next: { last: desiredLevel, userManaged: false } }
    }
    return { applied: false, next: { last: prev.last, userManaged: true } }
}

function reconcileGlobal (modes, desiredLevel, prev) {
    const explicit = explicitLevelOf(modes, ALL_URLS)
    if (!prev) {
        const applied = explicit !== desiredLevel
        if (applied) { setLevelOf(modes, ALL_URLS, desiredLevel) }
        return { applied, next: { last: desiredLevel, userManaged: false } }
    }
    if (prev.userManaged) {
        return { applied: false, next: { last: desiredLevel, userManaged: true } }
    }
    if (explicit === prev.last) {
        const applied = desiredLevel !== prev.last
        if (applied) { setLevelOf(modes, ALL_URLS, desiredLevel) }
        return { applied, next: { last: desiredLevel, userManaged: false } }
    }
    return { applied: false, next: { last: prev.last, userManaged: true } }
}

function reconcileRemoval (modes, hostname, prev) {
    // returns true if `modes` was modified (entry was reverted to global)
    if (prev.userManaged) { return false }
    const explicit = explicitLevelOf(modes, hostname)
    if (explicit !== prev.last) { return false }
    clearLevelOf(modes, hostname)
    return true
}

export async function primoSeed (userModes) {
    const stored = loadSeeded(await localRead(STORAGE_KEY))
    const next = {
        v: 1,
        version: primoDefaultsVersion,
        global: null,
        sites: {},
    }
    let modesModified = false

    const wantedHosts = new Set()
    for (const { hostname, level } of primoSiteOverrides) {
        wantedHosts.add(hostname)
        const r = reconcileSite(userModes, hostname, level, stored.sites[hostname])
        if (r.applied) { modesModified = true }
        next.sites[hostname] = r.next
    }

    for (const [hostname, prev] of Object.entries(stored.sites)) {
        if (wantedHosts.has(hostname)) { continue }
        if (reconcileRemoval(userModes, hostname, prev)) {
            modesModified = true
        }
        // never re-add to next.sites — it's no longer ours
    }

    const g = reconcileGlobal(userModes, primoGlobalDefault, stored.global)
    if (g.applied) { modesModified = true }
    next.global = g.next

    const seedingChanged = !deepEqualSeeded(stored, next)
    if (seedingChanged) {
        await localWrite(STORAGE_KEY, next)
    }
    return { modesModified }
}
