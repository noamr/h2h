import {ImportMap} from '../common/types'
import fs from 'fs-extra'
import {rmdirSync} from 'fs'
import {tmpdir} from 'os'
import {exec} from 'child_process'
import {relate} from 'relateurl'
import path from 'path'
import express from 'express'
import {JSDOM} from 'jsdom'

interface BuildOptions {
    browser: string
    rootDir: string
}

const builtPackages = new Map<string, string>()
let buildPending: Promise<string> | null = null

async function rewriteBundles(document: Document, options: BuildOptions) {
    const urlToPath = (url: string) => path.join(options.basePath, '..', url)
    const importMapLinks = Array.from(document.querySelectorAll('head link[rel="importmap"][href]'))
    const importLinks = Array.from(document.querySelectorAll('head link[rel="package"]'))
    const importMaps = [...await Promise.all(importMapLinks.map(async link => await (await fetch(link.getAttribute('href') as string)).json() as ImportMap)),
        ...importLinks.map(
            l => ({[l.getAttribute('name') || '']: {global: l.getAttribute('global'), version: l.getAttribute('version'), url: l.getAttribute('href')}} as ImportMap))
    ]

    const importMap = importMaps.reduce((a, o) => Object.assign(a, o), {})
    const bundleScriptTags = Array.from(document.querySelectorAll('bundle-script'))
    const deps = new Set<string>()
    for (const name in importMap)
        deps.add(`${name}@${importMap[name].version}`)

    importLinks.forEach(l => l.remove())
    const inlines: Map<string, string> = new Map<string, string>()
    const bundles = new Set<string>()

    for (const script of bundleScriptTags as HTMLScriptElement[]) {
        let src = script.getAttribute('src')
        if (!src) {
            if (!script.innerHTML)
                continue
            src = `./${Number(new Date().valueOf()).toString(36)}.js`
            inlines.set(src, script.innerHTML)
        }
        bundles.add(src)
        const newScript = document.createElement('script') as HTMLScriptElement
        newScript.src = `${src}.bundle.js`
        newScript.setAttribute('side', script.getAttribute('side') || 'client')
        if (script.hasAttribute('defer'))
            newScript.setAttribute('defer', 'defer');
        (script.parentElement as HTMLElement).replaceChild(newScript, script)
    }

    return {bundles, deps: Array.from(deps), inlines}
}

async function rewriteHTML(html: string, options: BuildOptions) {
    const {window} = new JSDOM(html)
    const {bundles, deps, inlines} = await rewriteBundles(window.document, options)

    return {
        html: window.document.documentElement.outerHTML,
        bundles,
        deps,
        inlines
    }
}

export async function buildIfNeeded(options: BuildOptions) {
    if (buildPending) {
        await buildPending
        buildPending = null
    }

    const buildKey = JSON.stringify(options)
    const built = builtPackages.get(buildKey) as string
    if (built)
        return built
    const watch = (p: string) => {
        fs.watchFile(p, () => {
            if (builtPackages.has(buildKey)) {
                console.log(`Invalidating ${buildKey}`)
                builtPackages.delete(buildKey)
            }
        })
    }

    buildPending = new Promise<string>(async r => {
        const dir = await fs.mkdtemp(tmpdir())
        const distDir = path.join(dir, '.dist')
        await fs.mkdir(distDir)
        await fs.copy(options.rootDir, distDir)
        const siteMapPath = path.join(distDir, 'sitemap.txt')
        const htmlFiles = fs.existsSync(siteMapPath) ? (await fs.readFile(siteMapPath, 'utf8')).split('\n') : ['index.html']
        const bundlePaths = new Set<string>()
        const depPaths = new Set()
        for (const htmlPath of htmlFiles) {
            const basePath = path.join(distDir, htmlPath)
            const {html, bundles, deps, inlines} = await rewriteHTML(await fs.readFile(basePath, 'utf8'), {browser: options.browser, basePath})
            await Promise.all(Array.from(inlines.entries()).map(([name, code]) => {
                return fs.writeFile(path.join(distDir, name), code)
            }))

            for (const b of Array.from(bundles))
                bundlePaths.add(b)
            for (const d of deps)
                depPaths.add(d)
            await fs.writeFile(basePath, html)
        }

        bundlePaths.forEach(p => watch(path.join(distDir, p)))

        await fs.copy(path.join(__dirname, 'template-dir'), dir)
        const buildScript = `
            nvm use
            nvm i
            npm i
            npm install ${Array.from(depPaths).join(' ')}
            ${Array.from(bundlePaths).map(p => `
                ./node_modules/.bin/esbuild --bundle --outfile=${distDir}/${p}.bundle.js --sourcemap --platform=browser --target=${options.browser} --minify ${distDir}/${p}
            `).join('')}
        `

        await fs.writeFile(path.join(dir, 'build.sh'), buildScript)
        await new Promise(resolve => exec('./build.sh', {cwd: dir}, () => resolve({})))
        builtPackages.set(buildKey, distDir)
        r(distDir)
    })

    return await buildPending
}
