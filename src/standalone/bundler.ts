import {transform, availablePresets} from '@babel/standalone'

const registry = new Map<string, string>()
async function resolveModule(code: string, url: URL) {
    const pendingImports = new Set<string>()
    const asJavascript = transform(code, {presets: [availablePresets.typescript], filename: url.pathname}).code
    if (!asJavascript)
        return null

    const transformImports = () => transform(asJavascript, {
        plugins: [{
            visitor: {
                ImportDeclaration: (path, state) => {
                    const {node} = path
                    if (!node || !node.source)
                        return

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

export async function resolve(name: string, baseURL: string = location.href): Promise<string> {
    if (registry.has(name))
        return registry.get(name)

    const url = new URL(name, baseURL)
    const text = await (await fetch(url.href)).text()
    const result = await resolveModule(text, url)
    if (!result || !result.code)
        throw new Error(`Unable to import ${name}`)

    const blob = new Blob([result.code], {type: 'text/javascript'})
    const blobURL = URL.createObjectURL(blob)
    registry.set(url.href, blobURL)
    console.log({blobURL, code: result.code})
    return blobURL
}

class BundleLoadEvent extends Event {
    module: any
    constructor(module: any) {
        super('load')
        this.module = module
    }
}

export class BundleScript extends HTMLElement {
    shadow: HTMLShadowElement
    constructor() {
        super()
        this.shadow = this.attachShadow({mode: 'closed'})
    }

    connectedCallback() {
        const src = this.getAttribute('src')
        if (!src)
            return
        const defer = this.getAttribute('defer') === 'defer'
        
        const dispatch = async () => {
            const blobURL = await resolve(src)
            const uid = `${Number(performance.now()).toString(36)}_${Number(Math.random() * 1000000).toString(36)}}`
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
