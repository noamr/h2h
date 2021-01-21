import {transform, availablePresets} from '@babel/standalone'

const registry = new Map<string, string>()
let globalImportsInitialized = false
const createUID = () => `${Number(performance.now()).toString(36)}_${Number(Math.random() * 1000000).toString(36)}}`
async function resolveModule(code: string, url: URL) {
    const pendingImports = new Set<string>()
    const transformImports = () => transform(code, {
        presets: [availablePresets.typescript],
        sourceMaps: 'inline',
        filename: url.pathname,
        plugins: [{
            visitor: {
                ImportDeclaration: (path, state) => {
                    const {node} = path
                    if (!node || !node.source)
                        return

                    if (registry.has(node.source.value)) {
                        node.source.value = registry.get(node.source.value)
                        return
                    }

                    const value = new URL(node.source.value, url).href

                    if (registry.has(value))
                        node.source.value = registry.get(value)
                    else
                        pendingImports.add(value)
                }
            }
        }
    ]})

    const tranformed = transformImports()
    if (!pendingImports.size)
        return tranformed

    await Promise.all(Array.from(pendingImports).map(importName => resolve(importName, url.href)))

    return transformImports()
}

export async function resolve(name: string, baseURL: string): Promise<string> {
    console.info(`Searching for module ${name}`)
    if (registry.has(name))
        return registry.get(name)

    console.info(`It is not in registry (${name})`)
    const url = new URL(name, baseURL)
    const response = await fetch(url.href)
    if (response.status !== 200)
        throw new Error(`Module not found: ${name}`)
    const text = await response.text()
    const result = await resolveModule(text, url)
    if (!result || !result.code)
        throw new Error(`Unable to import ${name}`)

    const blob = new Blob([result.code], {type: 'text/javascript'})
    const blobURL = URL.createObjectURL(blob)
    registry.set(url.href, blobURL)
    return blobURL
}

class BundleLoadEvent extends Event {
    module: any
    constructor(module: any) {
        super('load')
        this.module = module
    }
}

let globalImportsInitializer: Promise<void> | null = null
type ImportMap = {[libName: string]: {
    global: string,
    version: string,
    url: string
}}
const initGlobalImports = () => new Promise(resolve => {
    globalImportsInitializer = globalImportsInitializer || new Promise(r => {
        const links = Array.from(document.querySelectorAll('head link[rel="importmap"][href]')) as HTMLLinkElement[]
        Promise.all(links.map(async link => {
            const importMap = await (await fetch(link.href)).json() as ImportMap
            await Promise.all(Object.entries(importMap).map(async entry => {
                const libName = entry[0]
                const {global, version, url} = entry[1]
                const script = document.createElement('script')
                script.src = url
                console.info(`Loading library ${libName}`)
                const moduleURL = await new Promise(res => {
                    script.addEventListener('load', () => {
                        const lib = window[global]
                        const asModule = Object.keys(lib).map(key => `
                            export const ${key} = window["${global}"]["${key}"];
                        `).join('\n') + `
                        export default ${global};`
                        const blob = new Blob([asModule], {type: 'text/javascript'})
                        const blobURL = URL.createObjectURL(blob)
                        console.info(`Loaded library ${libName}`)
                        res(blobURL)
                    })
                    document.head.appendChild(script)
                })
                registry.set(libName, moduleURL)
            }))
        })).then(() => r(void 0))
    })

    globalImportsInitializer.then(() => resolve({}))
})
class BundleScript extends HTMLElement {
    shadow: HTMLShadowElement
    constructor() {
        super()
        this.shadow = this.attachShadow({mode: 'closed'})
    }

    async connectedCallback() {
        const src = this.getAttribute('src')
        if (!src)
            return

        await initGlobalImports()
        const defer = this.getAttribute('defer') === 'defer'
        
        const dispatch = async () => {
            const blobURL = await resolve(src, location.href)
            const uid = createUID()
            window[uid] = (module: any) => {
                this.dispatchEvent(new BundleLoadEvent(module))
                delete window[uid]
            }
            const script = document.createElement('script')
            script.type = 'module'
            const textNode = document.createTextNode(`
                import('${blobURL}').then(window['${uid}'])
            `)
            script.appendChild(textNode)
            this.shadow.appendChild(script)
        }

        if (defer && document.readyState !== 'complete')
            window.addEventListener('DOMContentLoaded', dispatch)
        else
            dispatch()
    }
}

customElements.define('bundle-script', BundleScript)