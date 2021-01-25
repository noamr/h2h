import {JSDOM} from 'jsdom'

import executeMarkdown from './plugins/markdown'
import executeInclude from './plugins/includes'
import executeServerScripts from './plugins/server-scripts'

function removeDevScript(document: HTMLDocument) {
    for (const script of Array.from(document.querySelectorAll('script[side="dev"]')))
        script.remove()
}

export async function executeHTML(html: string, basePath: string) {
    // TODO: this can be cached from rewriteHTML
    const jsdom = new JSDOM(html)
    await executeMarkdown(jsdom)
    await executeInclude(jsdom, basePath)
    await executeServerScripts(jsdom, basePath)
    removeDevScript(jsdom.window.document)

    html = jsdom.window.document.documentElement.outerHTML
    return {
        html
    }
}