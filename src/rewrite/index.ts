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
    const importMaps = Array.from(documentElement.querySelectorAll('link[rel="importmap"][href]'))
    const bundleScriptTags = Array.from(documentElement.querySelectorAll('bundle-script'))
    const bundles = bundleScriptTags.map(b => b.getAttribute('src')) as string[]
    const deps = new Set<string>()
    for (const l of importMaps) {
        const importMap = JSON.parse(fs.readFileSync(urlToPath(l.getAttribute('href') as string), 'utf8')) as ImportMap
        for (const name in importMap)
            deps.add(`${name}@${importMap[name].version}`)

        l.remove()
    }

    for (const script of bundleScriptTags) {
        const src = script.getAttribute('src') || ''
        script.insertAdjacentHTML('afterend', `
            <!-- ${script.outerHTML} -->
            <script src="${script.getAttribute('src')}.bundle.js" async ${script.hasAttribute('defer') ? 'defer' : ''}>
            </script>
        `)
        script.remove()
    }

    return {bundles, deps: Array.from(deps)}
}

async function rewriteHTML(html: string, options: RewriteOptions): Promise<any> {
    const dom = parse(html) as HTMLElement
    const {bundles, deps} = await rewriteBundles(dom, options)

    return {
        html: dom.outerHTML,
        bundles,
        deps
    }
}

const app = express()
const rootDir = `${__dirname}/../../examples/kitchen-sink`

interface BuildOptions {
    browser: string
    rootDir: string
}

const builtPackages = new Map<string, string>()

async function buildIfNeeded(options: BuildOptions) {
    const buildKey = JSON.stringify(options)
    console.log(buildKey)
    const built = builtPackages.get(buildKey)
    if (built)
        return built
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
        const {html, bundles, deps} = await rewriteHTML(await fs.readFile(basePath, 'utf8'), {browser: options.browser, basePath})
        for (const b of bundles)
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
            ./node_modules/.bin/esbuild --bundle --outfile=${dir}/${p}.bundle.js --sourcemap --platform=browser --target=${options.browser} --minify ${dir}/${p}
        `)}
    `
    await fs.writeFile(path.join(dir, 'build.sh'), buildScript)
    await new Promise(resolve => exec('./build.sh', {cwd: dir}, () => resolve({})))
    builtPackages.set(options.rootDir, dir)
    return dir
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