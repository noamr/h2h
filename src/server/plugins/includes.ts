import {JSDOM} from 'jsdom'
import path from 'path'
import fs from 'fs-extra'

export default async function executeInclude({window}: JSDOM, basePath: string) {
    const includes = window.document.querySelectorAll('trans-inc')
    let needsClientSide = false
    for (const inc of Array.from(includes)) {
        const src = inc.getAttribute('src') as string
        const p = path.join(basePath, src)
        const html = await fs.readFile(p, 'utf8')
        inc.outerHTML = html
    }
}