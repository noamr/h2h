import {JSDOM} from 'jsdom'
import path from 'path'
import {readFile} from 'fs-extra'
import {runInNewContext} from 'vm'

export default async function executeServerScripts({window}: JSDOM, basePath: string) {
    const serverScripts = Array.from(window.document.querySelectorAll('script[side]'))
    const urlToPath = (url: string) => path.join(basePath, url)
    for (const serverScript of serverScripts) {
        const side = serverScript.getAttribute('side') || 'client'
        if (!side.includes('server'))
            continue

        const scriptPath = urlToPath(serverScript.getAttribute('src') as string)
        if (serverScript.getAttribute('side') === 'server')
            serverScript.remove()

        const code = await readFile(scriptPath, 'utf8')
        const result = runInNewContext(code, window)
        if (result instanceof Promise)
            await result
    }
}
