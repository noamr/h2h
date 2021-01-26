import {transform, availablePresets} from '@babel/standalone'
import {ImportMap} from '../common/types'

const registry = new Map<string, string>()
let globalImportsInitialized = false
const createUID = () => `${Number(performance.now()).toString(36)}_${Number(Math.random() * 1000000).toString(36)}}`
async function resolveModule(code: string, href: string) {
    const pendingImports = new Set<string>()
    const transformImports = () => transform(code, {
        presets: [availablePresets.typescript],
        sourceMaps: 'inline',
        filename: new URL(href).pathname,
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

                    const value = new URL(node.source.value, href).href

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

async function resolveCode(code: string, href: string) {
    const result = await resolveModule(code, href)
    if (!result || !result.code)
        throw new Error(`Unable to import ${name}`)

    const blob = new Blob([result.code], {type: 'text/javascript'})
    const blobURL = URL.createObjectURL(blob)
    registry.set(href, blobURL)
    return blobURL
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
    return resolveCode(text, url.href)
}

class BundleLoadEvent extends Event {
    module: any
    constructor(module: any) {
        super('load')
        this.module = module
    }
}

let globalImportsInitializer: Promise<void> | null = null

const initGlobalImports = () => new Promise(resolve => {
    globalImportsInitializer = globalImportsInitializer || (async () => {
        const importMapLinks = Array.from(document.querySelectorAll('head link[rel="importmap"][href]')) as HTMLLinkElement[]
        const importLinks = Array.from(document.querySelectorAll('head link[rel="package"]')) as HTMLLinkElement[]
        const importMaps = [...await Promise.all(importMapLinks.map(async link => await (await fetch(link.href)).json() as ImportMap)),
            ...importLinks.map(
                l => ({[l.getAttribute('name') || '']: {global: l.getAttribute('global'), version: l.getAttribute('version'), url: l.getAttribute('href')}} as ImportMap))
        ]

        const importMap = importMaps.reduce((a, o) => Object.assign(a, o), {})
        console.log(importMap)
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

    })()

    globalImportsInitializer.then(() => resolve({}))
})
class BundleScript extends HTMLElement {
    shadow: HTMLShadowElement
    slotElement: HTMLSlotElement
    loaded: boolean

    constructor() {
        super()
        this.slotElement = document.createElement('slot')
        const style = document.createElement('style')
        this.shadow = this.attachShadow({mode: 'closed'})
        style.innerHTML = `:host { display: none }`
        this.shadow.appendChild(style)
        this.shadow.appendChild(this.slotElement)
        this.loaded = false
        this.slotElement.addEventListener('slotchange', () => {
            this.render()
        })
    }

    get observedAttributes() { return ['src', 'onerror'] }
    attributesChangedCallback() {
        this.render()
    }

    connectedCallback() {
        this.render()
    }

    async render() {
        if (this.loaded)
            return

        const src = this.getAttribute('src')
        const inner = this.innerText
        if (!src && !inner)
            return

        this.loaded = true

        await initGlobalImports()
        const defer = this.getAttribute('defer') === 'defer'
        
        const dispatch = async () => {
            const blobURL = inner ?
                await resolveCode(inner, location.href) :
                await resolve(src as string, location.href)

            const uid = createUID()
            const script = document.createElement('script')
            script.type = 'module'
            const textNode = document.createTextNode(`import('${blobURL}')`)
            script.appendChild(textNode)
            this.shadow.appendChild(script)
        }

        if (defer && document.readyState !== 'complete')
            window.addEventListener('DOMContentLoaded', dispatch)
        else
            dispatch()
    }
}

customElements.define('trans-script', BundleScript)