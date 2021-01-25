import {JSDOM} from 'jsdom'
import { parse, HTMLElement } from 'node-html-parser'
import {ImportMap} from '../common/types'
import fs from 'fs-extra'
import {rmdirSync} from 'fs'
import {tmpdir} from 'os'
import {exec} from 'child_process'
import {relate} from 'relateurl'
import path from 'path'
import express from 'express'

interface RewriteOptions {
    browser: string
    basePath: string
}

interface BuiltSite {
    dir: string
    clear: () => Promise<void>
}

const rewritten = new Map<string, string>()

async function rewriteBundles(documentElement: HTMLElement, options: RewriteOptions) {
    console.log(options.basePath, path.join(options.basePath, 'i.json'))
    const urlToPath = (url: string) => path.join(options.basePath, '..', url)
    const importMapLinks = Array.from(documentElement.querySelectorAll('head link[rel="importmap"][href]'))
    const importLinks = Array.from(documentElement.querySelectorAll('head link[rel="package"]'))
    const importMaps = [...await Promise.all(importMapLinks.map(async link => await (await fetch(link.getAttribute('href') as string)).json() as ImportMap)),
        ...importLinks.map(
            l => ({[l.getAttribute('name') || '']: {global: l.getAttribute('global'), version: l.getAttribute('version'), url: l.getAttribute('href')}} as ImportMap))
    ]

    const importMap = importMaps.reduce((a, o) => Object.assign(a, o), {})
    const bundleScriptTags = Array.from(documentElement.querySelectorAll('bundle-script'))
    const deps = new Set<string>()
    for (const name in importMap)
        deps.add(`${name}@${importMap[name].version}`)

    importLinks.forEach(l => l.remove())
    const inlines: Map<string, string> = new Map<string, string>()
    const bundles = new Set<string>()

    for (const script of bundleScriptTags) {
        let src = script.getAttribute('src')
        if (!src) {
            if (!script.innerText)
                continue
            src = `./${Number(new Date().valueOf()).toString(36)}.js`
            inlines.set(src, script.innerText)
        }
        bundles.add(src)
        script.insertAdjacentHTML('afterend', `
            <!-- ${script.outerHTML} -->
            <script src="${src}.bundle.js" async ${script.hasAttribute('defer') ? 'defer' : ''}>
            </script>
        `)
        script.remove()
    }

    for (const script of documentElement.querySelectorAll('script[side="dev"]'))
        script.remove()

    return {bundles, deps: Array.from(deps), inlines}
}

async function rewriteHTML(html: string, options: RewriteOptions) {
    const dom = parse(html) as HTMLElement
    const {bundles, deps, inlines} = await rewriteBundles(dom, options)

    return {
        html: dom.outerHTML,
        bundles,
        deps,
        inlines
    }
}

const app = express()
const rootDir = `${__dirname}/../../examples/kitchen-sink`

interface BuildOptions {
    browser: string
    rootDir: string
}

const builtPackages = new Map<string, string>()
let buildPending: Promise<string> | null = null
async function buildIfNeeded(options: BuildOptions) {
    if (buildPending) {
        await buildPending
        buildPending = null
    }

    const buildKey = JSON.stringify(options)
    const built = builtPackages.get(buildKey) as string
    if (built)
        return built
    buildPending = new Promise<string>(async r => {
        console.log(buildKey)
        const dir = await fs.mkdtemp(tmpdir())
        const distDir = path.join(dir, '.dist')
        await fs.mkdir(distDir)
        await fs.copy(options.rootDir, distDir)
        const siteMapPath = path.join(distDir, 'sitemap.txt')
        const htmlFiles = fs.existsSync(siteMapPath) ? (await fs.readFile(siteMapPath, 'utf8')).split('\n') : ['index.html']
        const bundlePaths = new Set()
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

        console.log(buildScript)
        await fs.writeFile(path.join(dir, 'build.sh'), buildScript)
        await new Promise(resolve => exec('./build.sh', {cwd: dir}, () => resolve({})))
        builtPackages.set(buildKey, dir)
        r(dir)
    })

    return await buildPending
}

export function serve(assetDir: string) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const userAgent = req.header('user-agent') || 'Chrome/80'
        const safariVersion = /\/(\d+).\d+.\d+ Safari\//.exec(userAgent)
        const chromeVersion = / Chrome\/(\d+)/.exec(userAgent)
        const firefoxVersion = / Firefox\/(\d+)/.exec(userAgent)
        const browser = safariVersion ? `safari${safariVersion[1]}` : chromeVersion ? `chrome${chromeVersion[1]}` : firefoxVersion ? `firefox${firefoxVersion[1]}` : 'chrome80'
        console.log(req.header('user-agent'))
        const dir = await buildIfNeeded({rootDir: path.normalize(assetDir), browser})
        express.static(path.join(dir, '.dist'))(req, res, next)
    }
}

app.use(serve(rootDir))

app.listen(3000)