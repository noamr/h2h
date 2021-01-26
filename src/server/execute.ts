import {JSDOM} from 'jsdom'

import executeMarkdown from './plugins/markdown'
import executeInclude from './plugins/includes'
import executeServerScripts from './plugins/server-scripts'

function removeDevScript(document: HTMLDocument) {
    for (const script of Array.from(document.querySelectorAll('script[dev-only]')))
        script.remove()
}

export async function executeHTML(html: string, basePath: string) {
    // TODO: this can be cached from rewriteHTML
    const jsdom = new JSDOM(html)
    removeDevScript(jsdom.window.document)
    await executeMarkdown(jsdom, basePath)
    await executeInclude(jsdom, basePath)
    html = await executeServerScripts(jsdom, basePath)

    return {
        html
    }
}