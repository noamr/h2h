import {ImportMap} from '../common/types'
import fs from 'fs-extra'
import {rmdirSync} from 'fs'
import {tmpdir} from 'os'
import {exec} from 'child_process'
import {relate} from 'relateurl'
import path from 'path'
import express from 'express'
import vm from 'vm'
import {JSDOM} from 'jsdom'

interface RewriteOptions {
    browser: string
    basePath: string
}

interface BuiltSite {
    dir: string
    clear: () => Promise<void>
}

const rewritten = new Map<string, string>()

async function removeDevScript(document: HTMLDocument) {
    for (const script of Array.from(document.querySelectorAll('script[side="dev"]')))
        script.remove()
}

async function rewriteBundles(document: Document, options: RewriteOptions) {
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

async function rewriteHTML(html: string, options: RewriteOptions) {
    const {window} = new JSDOM(html)
    await removeDevScript(window.document)
    const {bundles, deps, inlines} = await rewriteBundles(window.document, options)

    return {
        html: window.document.documentElement.outerHTML,
        bundles,
        deps,
        inlines
    }
}

async function executeServerScripts({window}: JSDOM, options: RewriteOptions) {
    const serverScripts = Array.from(window.document.querySelectorAll('script[side]'))
    const urlToPath = (url: string) => path.join(options.basePath, url)
    for (const serverScript of serverScripts) {
        const side = serverScript.getAttribute('side') || 'client'
        if (!side.includes('server'))
            continue

        const scriptPath = urlToPath(serverScript.getAttribute('src') as string)
        if (serverScript.getAttribute('side') === 'server')
            serverScript.remove()

        const code = await fs.readFile(scriptPath, 'utf8')
//        eval(code)
        vm.runInNewContext(code, window)
    }

    return window.document.documentElement.outerHTML
}

async function executeHTML(html: string, options: RewriteOptions) {
    // TODO: this can be cached from rewriteHTML
    const jsdom = new JSDOM(html)
    
    return {
        html: await executeServerScripts(jsdom, options)
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

        await fs.writeFile(path.join(dir, 'build.sh'), buildScript)
        await new Promise(resolve => exec('./build.sh', {cwd: dir}, () => resolve({})))
        builtPackages.set(buildKey, distDir)
        r(distDir)
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
        const dir = await buildIfNeeded({rootDir: path.normalize(assetDir), browser})
        if ((req.headers['accept'] || '').includes('text/html')) {
            console.log({dir}, req.path, req.headers)
            const html = await fs.readFile(path.join(dir, req.path || 'index.html'), 'utf8')
            if (html) {
                const rewritten = await executeHTML(html, {basePath: dir, browser})
                res.setHeader('Content-type', 'text/html')
                res.send(rewritten.html)
                return
            }
        }
        express.static(dir)(req, res, next)
    }
}

app.use(serve(rootDir))

app.listen(3000)